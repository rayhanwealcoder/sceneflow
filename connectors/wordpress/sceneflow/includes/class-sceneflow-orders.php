<?php
/**
 * Revenue attribution for WooCommerce: which orders contain products that a visitor added to the cart from a
 * SceneFlow video.
 *
 * The player sends `X-SceneFlow-Source: <project id>:<session id>` with its Store API add-to-cart request (only
 * while playback analytics runs). The plugin keeps that in the WooCommerce session, copies it onto the order
 * line at checkout (hidden meta) and marks the order. SceneFlow then asks for those orders with a signed
 * request (GET /sceneflow/v1/orders). Nothing is sent from this site on its own, and no customer data is
 * shared: order number, status, currency, dates and the credited lines (product, quantity, total) only.
 * Everything here is inactive while the site owner has playback analytics switched off.
 *
 * @package SceneFlow
 */

defined( 'ABSPATH' ) || exit;

/**
 * Order attribution.
 */
class SceneFlow_Orders {

	const SESSION_KEY  = 'sceneflow_sources';
	const META_ORDER   = '_sceneflow_attributed';
	const META_PROJECT = '_sceneflow_project';
	const META_SESSION = '_sceneflow_session';
	const HEADER       = 'HTTP_X_SCENEFLOW_SOURCE';
	const MAX_SOURCES  = 50;

	/**
	 * WooCommerce hooks (they only fire when WooCommerce runs).
	 */
	public static function init() {
		add_action( 'woocommerce_add_to_cart', array( __CLASS__, 'remember_source' ), 10, 4 );
		add_action( 'woocommerce_checkout_create_order_line_item', array( __CLASS__, 'tag_line_item' ), 10, 4 );
		add_action( 'woocommerce_cart_emptied', array( __CLASS__, 'forget_sources' ) );
	}

	/**
	 * Parses the header value: a project uuid and an optional anonymous session id.
	 *
	 * @param mixed $raw Header value.
	 * @return array|null { project, session } or null when it is not valid.
	 */
	public static function parse_source( $raw ) {
		if ( ! is_string( $raw ) || strlen( $raw ) > 120 ) {
			return null;
		}
		if ( ! preg_match( '/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):([A-Za-z0-9_-]{8,64})?$/', strtolower( substr( $raw, 0, 36 ) ) . substr( $raw, 36 ), $m ) ) {
			return null;
		}
		return array(
			'project' => $m[1],
			'session' => isset( $m[2] ) && '' !== $m[2] ? $m[2] : '',
		);
	}

	/**
	 * Add to cart from a player: remember which video it came from, per product, in the shop session.
	 *
	 * @param string $cart_item_key Cart item key (unused).
	 * @param int    $product_id    Product id.
	 * @param int    $quantity      Quantity (unused).
	 * @param int    $variation_id  Variation id.
	 */
	public static function remember_source( $cart_item_key, $product_id, $quantity, $variation_id ) {
		unset( $cart_item_key, $quantity );
		if ( ! isset( $_SERVER[ self::HEADER ] ) || ! SceneFlow_Settings::analytics_enabled() || ! function_exists( 'WC' ) || ! WC()->session ) {
			return;
		}
		$source = self::parse_source( sanitize_text_field( wp_unslash( $_SERVER[ self::HEADER ] ) ) );
		if ( ! $source ) {
			return;
		}
		$sources = WC()->session->get( self::SESSION_KEY );
		$sources = is_array( $sources ) ? $sources : array();
		$key     = (string) ( $variation_id ? $variation_id : $product_id );
		unset( $sources[ $key ] );
		$sources[ $key ] = $source;
		WC()->session->set( self::SESSION_KEY, array_slice( $sources, -self::MAX_SOURCES, null, true ) );
	}

	/**
	 * Checkout (classic and block): copy the source onto the order line and mark the order.
	 *
	 * @param WC_Order_Item_Product $item          Order line being created.
	 * @param string                $cart_item_key Cart item key (unused).
	 * @param array                 $values        Cart item.
	 * @param WC_Order              $order         Order.
	 */
	public static function tag_line_item( $item, $cart_item_key, $values, $order ) {
		unset( $cart_item_key );
		if ( ! SceneFlow_Settings::analytics_enabled() || ! function_exists( 'WC' ) || ! WC()->session ) {
			return;
		}
		$sources = WC()->session->get( self::SESSION_KEY );
		if ( ! is_array( $sources ) || ! $sources ) {
			return;
		}
		$keys = array();
		if ( ! empty( $values['variation_id'] ) ) {
			$keys[] = (string) $values['variation_id'];
		}
		if ( ! empty( $values['product_id'] ) ) {
			$keys[] = (string) $values['product_id'];
		}
		foreach ( $keys as $key ) {
			if ( isset( $sources[ $key ] ) ) {
				$item->add_meta_data( self::META_PROJECT, $sources[ $key ]['project'], true );
				if ( '' !== $sources[ $key ]['session'] ) {
					$item->add_meta_data( self::META_SESSION, $sources[ $key ]['session'], true );
				}
				$order->update_meta_data( self::META_ORDER, '1' );
				return;
			}
		}
	}

	/**
	 * The cart is gone (order placed or emptied): so are the remembered sources.
	 */
	public static function forget_sources() {
		if ( function_exists( 'WC' ) && WC()->session ) {
			WC()->session->set( self::SESSION_KEY, null );
		}
	}

	/**
	 * Signed REST route for the SceneFlow cloud.
	 *
	 * @param SceneFlow_REST $rest REST controller (for the signed permission callback).
	 */
	public static function register_routes( $rest ) {
		register_rest_route(
			SceneFlow_REST::NS,
			'/orders',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( __CLASS__, 'rest_orders' ),
				'permission_callback' => array( $rest, 'permission_signed' ),
				'args'                => array(
					'after' => array(
						'type'              => 'integer',
						'default'           => 0,
						'minimum'           => 0,
						'sanitize_callback' => 'absint',
					),
					'limit' => array(
						'type'              => 'integer',
						'default'           => 100,
						'minimum'           => 1,
						'maximum'           => 100,
						'sanitize_callback' => 'absint',
					),
				),
			)
		);
	}

	/**
	 * Maps a WooCommerce status to what SceneFlow counts.
	 *
	 * @param string $status Order status without the wc- prefix.
	 * @return string|null paid | refunded | cancelled, or null for orders that were never paid.
	 */
	public static function map_status( $status ) {
		$map = array(
			'processing' => 'paid',
			'completed'  => 'paid',
			'refunded'   => 'refunded',
			'cancelled'  => 'cancelled',
			'failed'     => 'cancelled',
		);
		return isset( $map[ $status ] ) ? $map[ $status ] : null;
	}

	/**
	 * Signed: orders with credited lines, changed at or after `after` (unix seconds), oldest change first.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return array
	 */
	public static function rest_orders( $request ) {
		if ( ! SceneFlow_WooCommerce::is_active() || ! SceneFlow_Settings::analytics_enabled() ) {
			return array(
				'ok'      => true,
				'enabled' => false,
				'orders'  => array(),
			);
		}
		$after  = (int) $request->get_param( 'after' );
		$limit  = min( 100, max( 1, (int) $request->get_param( 'limit' ) ) );
		$orders = wc_get_orders(
			array(
				'limit'         => $limit,
				'orderby'       => 'modified',
				'order'         => 'ASC',
				'type'          => 'shop_order',
				'status'        => array( 'wc-processing', 'wc-completed', 'wc-refunded', 'wc-cancelled', 'wc-failed' ),
				'date_modified' => '>=' . $after,
				'meta_key'      => self::META_ORDER, // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key -- only orders the plugin marked; small, indexed set.
				'meta_value'    => '1', // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_value
			)
		);
		$out    = array();
		foreach ( $orders as $order ) {
			$row = self::order_row( $order );
			if ( $row ) {
				$out[] = $row;
			}
		}
		return array(
			'ok'      => true,
			'enabled' => true,
			'orders'  => $out,
		);
	}

	/**
	 * One order as SceneFlow sees it: credited lines only, after refunds, no customer data.
	 *
	 * @param WC_Order $order Order.
	 * @return array|null
	 */
	public static function order_row( $order ) {
		$status = self::map_status( $order->get_status() );
		if ( ! $status ) {
			return null;
		}
		$paid     = $order->get_date_paid();
		$created  = $order->get_date_created();
		$modified = $order->get_date_modified();
		$lines    = array();
		foreach ( $order->get_items() as $item_id => $item ) {
			$project = (string) $item->get_meta( self::META_PROJECT, true );
			if ( '' === $project ) {
				continue;
			}
			$session = (string) $item->get_meta( self::META_SESSION, true );
			$lines[] = array(
				'id'        => (string) $item_id,
				'projectId' => $project,
				'sessionId' => '' !== $session ? $session : null,
				'productId' => (string) ( $item->get_variation_id() ? $item->get_variation_id() : $item->get_product_id() ),
				'quantity'  => max( 0, (int) $item->get_quantity() - absint( $order->get_qty_refunded_for_item( $item_id ) ) ),
				'total'     => max( 0, round( (float) $item->get_total() - abs( (float) $order->get_total_refunded_for_item( $item_id ) ), 2 ) ),
			);
		}
		if ( ! $lines ) {
			return null;
		}
		$paid_at = $paid ? $paid : $created;
		return array(
			'id'         => (string) $order->get_id(),
			'status'     => $status,
			'currency'   => (string) $order->get_currency(),
			'paidAt'     => $paid_at ? $paid_at->getTimestamp() : 0,
			'modifiedAt' => $modified ? $modified->getTimestamp() : 0,
			'lines'      => $lines,
		);
	}
}
