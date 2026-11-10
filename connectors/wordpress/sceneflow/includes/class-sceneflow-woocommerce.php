<?php
/**
 * WooCommerce adapter: normalized products for the SceneFlow editor and the front-end cart adapter.
 *
 * WooCommerce is optional. When it is not active nothing here runs and the runtime falls back to
 * product links; other shop systems can provide their own adapter the same way.
 *
 * @package SceneFlow
 */

defined( 'ABSPATH' ) || exit;

/**
 * Products + cart for WooCommerce stores.
 */
class SceneFlow_WooCommerce {

	/**
	 * Whether WooCommerce is active and usable.
	 *
	 * @return bool
	 */
	public static function is_active() {
		return class_exists( 'WooCommerce' ) && function_exists( 'wc_get_products' ) && function_exists( 'wc_price' );
	}

	/**
	 * Registers the front-end adapter script (loaded before players mount). Idempotent.
	 */
	public static function register_script() {
		if ( ! self::is_active() || wp_script_is( 'sceneflow-woocommerce', 'registered' ) ) {
			return;
		}
		wp_register_script(
			'sceneflow-woocommerce',
			SCENEFLOW_URL . 'assets/sceneflow-woo.js',
			array( 'sceneflow-runtime' ),
			SCENEFLOW_VERSION,
			array(
				'in_footer' => true,
				'strategy'  => 'defer',
			)
		);
		wp_localize_script(
			'sceneflow-woocommerce',
			'SceneFlowWoo',
			array(
				'storeApi'    => esc_url_raw( rest_url( 'wc/store/v1' ) ),
				'productApi'  => esc_url_raw( rest_url( SceneFlow_REST::NS . '/product/' ) ),
				'nonce'       => wp_create_nonce( 'wc_store_api' ),
				'cartUrl'     => function_exists( 'wc_get_cart_url' ) ? wc_get_cart_url() : '',
				'checkoutUrl' => function_exists( 'wc_get_checkout_url' ) ? wc_get_checkout_url() : '',
				'i18n'        => array(
					'added'      => __( 'Added to cart', 'sceneflow' ),
					'coupon'     => __( 'Coupon applied', 'sceneflow' ),
					'failed'     => __( 'Could not add to cart', 'sceneflow' ),
					'checkout'   => __( 'Going to checkout…', 'sceneflow' ),
					'outOfStock' => __( 'This product is out of stock', 'sceneflow' ),
				),
			)
		);
	}

	/**
	 * REST routes (registered by SceneFlow_REST when WooCommerce is active).
	 *
	 * @param SceneFlow_REST $rest REST controller (for the signed permission callback).
	 */
	public static function register_routes( $rest ) {
		register_rest_route(
			SceneFlow_REST::NS,
			'/products',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( __CLASS__, 'rest_products' ),
				'permission_callback' => array( $rest, 'permission_signed' ),
				'args'                => array(
					'search' => SceneFlow_REST::search_arg(),
					'page'   => SceneFlow_REST::page_arg(),
				),
			)
		);
		register_rest_route(
			SceneFlow_REST::NS,
			'/products/(?P<id>\d{1,12})',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( __CLASS__, 'rest_product_signed' ),
				'permission_callback' => array( $rest, 'permission_signed' ),
			)
		);
		// Public, same-origin: live price/stock/variants for product cards on the front end (published products only).
		register_rest_route(
			SceneFlow_REST::NS,
			'/product/(?P<id>\d{1,12})',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( __CLASS__, 'rest_product_public' ),
				'permission_callback' => '__return_true',
			)
		);
	}

	/**
	 * Signed: search products for the editor's picker.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return array
	 */
	public static function rest_products( $request ) {
		$search = sanitize_text_field( (string) $request->get_param( 'search' ) );
		$page   = max( 1, absint( $request->get_param( 'page' ) ) );
		$query  = wc_get_products(
			array(
				'status'   => 'publish',
				'limit'    => 24,
				'page'     => $page,
				's'        => $search,
				'orderby'  => '' === $search ? 'date' : 'relevance',
				'order'    => 'DESC',
				'paginate' => true,
				'type'     => array( 'simple', 'variable' ),
			)
		);
		$items  = array();
		foreach ( $query->products as $product ) {
			$items[] = self::normalize( $product, false );
		}
		return array(
			'ok'    => true,
			'items' => $items,
			'total' => (int) $query->total,
		);
	}

	/**
	 * Signed: one product with its variations.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return array
	 */
	public static function rest_product_signed( $request ) {
		$product = self::published_product( (int) $request['id'] );
		return array(
			'ok'      => true,
			'product' => $product ? self::normalize( $product, true ) : null,
		);
	}

	/**
	 * Public: one published product with variations, cached briefly.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public static function rest_product_public( $request ) {
		$product = self::published_product( (int) $request['id'] );
		if ( ! $product ) {
			return new WP_Error( 'not_found', __( 'Product not found.', 'sceneflow' ), array( 'status' => 404 ) );
		}
		$response = new WP_REST_Response( self::normalize( $product, true ) );
		$response->header( 'Cache-Control', 'public, max-age=60' );
		return $response;
	}

	/**
	 * Loads a product that visitors are allowed to see.
	 *
	 * @param int $id Product id.
	 * @return WC_Product|null
	 */
	private static function published_product( $id ) {
		$product = $id ? wc_get_product( $id ) : null;
		if ( ! $product || 'publish' !== $product->get_status() || ! in_array( $product->get_type(), array( 'simple', 'variable' ), true ) ) {
			return null;
		}
		return $product;
	}

	/**
	 * Normalized product (doc 14.1).
	 *
	 * @param WC_Product $product         Product.
	 * @param bool       $with_variations Include variations (one extra query per variation).
	 * @return array
	 */
	public static function normalize( $product, $with_variations ) {
		$is_variable = $product->is_type( 'variable' );
		$price       = (float) wc_get_price_to_display( $product );
		$data        = array(
			'id'          => (string) $product->get_id(),
			'source'      => 'woocommerce',
			'type'        => $is_variable ? 'variable' : 'simple',
			'name'        => $product->get_name(),
			'image'       => self::image_url( $product->get_image_id() ),
			'price'       => $is_variable ? self::variable_price_label( $product ) : self::money( $price ),
			'priceAmount' => $is_variable ? (float) $product->get_variation_price( 'min', true ) : $price,
			'currency'    => get_woocommerce_currency(),
			'stockStatus' => self::stock_status( $product ),
			'purchasable' => $product->is_purchasable() && $product->is_in_stock(),
			'productUrl'  => get_permalink( $product->get_id() ),
			'variations'  => array(),
		);
		if ( ! $is_variable && $product->is_on_sale() && '' !== $product->get_regular_price() ) {
			$data['regularPrice'] = self::money( (float) wc_get_price_to_display( $product, array( 'price' => $product->get_regular_price() ) ) );
			$data['salePrice']    = $data['price'];
		}
		if ( $with_variations && $is_variable ) {
			foreach ( $product->get_children() as $child_id ) {
				$variation = wc_get_product( $child_id );
				if ( ! $variation || 'publish' !== $variation->get_status() ) {
					continue;
				}
				$data['variations'][] = self::normalize_variation( $variation );
			}
		}
		return $data;
	}

	/**
	 * One variation.
	 *
	 * @param WC_Product_Variation $variation Variation.
	 * @return array
	 */
	private static function normalize_variation( $variation ) {
		$options = array();
		$parts   = array();
		foreach ( $variation->get_variation_attributes() as $key => $value ) {
			$taxonomy = str_replace( 'attribute_', '', $key );
			$label    = wc_attribute_label( $taxonomy, $variation );
			if ( taxonomy_exists( $taxonomy ) ) {
				$term  = get_term_by( 'slug', $value, $taxonomy );
				$value = $term ? $term->name : $value;
			}
			$value             = '' === (string) $value ? __( 'Any', 'sceneflow' ) : (string) $value;
			$options[ $label ] = $value;
			$parts[]           = $value;
		}
		$image = $variation->get_image_id() ? self::image_url( $variation->get_image_id() ) : null;
		return array(
			'id'          => (string) $variation->get_id(),
			'title'       => implode( ' / ', $parts ),
			'price'       => self::money( (float) wc_get_price_to_display( $variation ) ),
			'priceAmount' => (float) wc_get_price_to_display( $variation ),
			'inStock'     => $variation->is_purchasable() && $variation->is_in_stock(),
			'image'       => $image,
			'options'     => $options,
		);
	}

	/**
	 * "$129.00" or "$129.00 – $149.00" for variable products.
	 *
	 * @param WC_Product_Variable $product Product.
	 * @return string
	 */
	private static function variable_price_label( $product ) {
		$min = (float) $product->get_variation_price( 'min', true );
		$max = (float) $product->get_variation_price( 'max', true );
		return $min === $max ? self::money( $min ) : self::money( $min ) . ' – ' . self::money( $max );
	}

	/**
	 * Store-formatted price as plain text.
	 *
	 * @param float $amount Amount.
	 * @return string
	 */
	public static function money( $amount ) {
		return html_entity_decode( wp_strip_all_tags( wc_price( $amount ) ), ENT_QUOTES, 'UTF-8' );
	}

	/**
	 * Normalized stock status.
	 *
	 * @param WC_Product $product Product.
	 * @return string
	 */
	private static function stock_status( $product ) {
		$status = $product->get_stock_status();
		return in_array( $status, array( 'instock', 'outofstock', 'onbackorder' ), true ) ? $status : 'unknown';
	}

	/**
	 * Image URL or null.
	 *
	 * @param int $attachment_id Attachment id.
	 * @return string|null
	 */
	private static function image_url( $attachment_id ) {
		if ( ! $attachment_id ) {
			return null;
		}
		$url = wp_get_attachment_image_url( (int) $attachment_id, 'woocommerce_single' );
		if ( ! $url ) {
			$url = wp_get_attachment_image_url( (int) $attachment_id, 'large' );
		}
		return $url ? $url : null;
	}
}
