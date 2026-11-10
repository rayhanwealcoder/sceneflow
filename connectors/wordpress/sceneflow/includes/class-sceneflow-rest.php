<?php
/**
 * REST API: health, pairing, signed publish/preview/placements/media, public project configs.
 *
 * @package SceneFlow
 */

defined( 'ABSPATH' ) || exit;

/**
 * /wp-json/sceneflow/v1
 */
class SceneFlow_REST {

	const NS = 'sceneflow/v1';

	/**
	 * Registers routes.
	 */
	public function register_routes() {
		register_rest_route(
			self::NS,
			'/health',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'health' ),
				'permission_callback' => '__return_true',
			)
		);
		register_rest_route(
			self::NS,
			'/connect',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'connect' ),
				'permission_callback' => '__return_true',
			)
		);
		register_rest_route(
			self::NS,
			'/publish',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'publish' ),
				'permission_callback' => array( $this, 'permission_signed' ),
			)
		);
		register_rest_route(
			self::NS,
			'/publish/(?P<id>[A-Za-z0-9_-]{1,64})',
			array(
				'methods'             => WP_REST_Server::DELETABLE,
				'callback'            => array( $this, 'unpublish' ),
				'permission_callback' => array( $this, 'permission_signed' ),
			)
		);
		register_rest_route(
			self::NS,
			'/preview-session',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'preview_session' ),
				'permission_callback' => array( $this, 'permission_signed' ),
			)
		);
		register_rest_route(
			self::NS,
			'/pick-session',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'pick_session' ),
				'permission_callback' => array( $this, 'permission_signed' ),
			)
		);
		register_rest_route(
			self::NS,
			'/pages',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'pages' ),
				'permission_callback' => array( $this, 'permission_signed' ),
				'args'                => array( 'search' => self::search_arg() ),
			)
		);
		register_rest_route(
			self::NS,
			'/placements',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'placements' ),
					'permission_callback' => array( $this, 'permission_signed' ),
				),
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'save_placement' ),
					'permission_callback' => array( $this, 'permission_signed' ),
				),
			)
		);
		register_rest_route(
			self::NS,
			'/placements/(?P<id>[A-Za-z0-9_-]{1,64})',
			array(
				'methods'             => WP_REST_Server::DELETABLE,
				'callback'            => array( $this, 'delete_placement' ),
				'permission_callback' => array( $this, 'permission_signed' ),
			)
		);
		register_rest_route(
			self::NS,
			'/media',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'media' ),
				'permission_callback' => array( $this, 'permission_signed' ),
				'args'                => array(
					'search' => self::search_arg(),
					'page'   => self::page_arg(),
					'type'   => array(
						'type'    => 'string',
						'enum'    => array( '', 'image', 'video' ),
						'default' => '',
					),
				),
			)
		);
		register_rest_route(
			self::NS,
			'/project/(?P<id>[A-Za-z0-9_-]{1,64})',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'project' ),
				'permission_callback' => '__return_true',
			)
		);
		register_rest_route(
			self::NS,
			'/preview/(?P<token>[a-z0-9]{32})',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'preview' ),
				'permission_callback' => '__return_true',
			)
		);
		register_rest_route(
			self::NS,
			'/projects',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'projects_for_editor' ),
				'permission_callback' => static function () {
					return current_user_can( 'edit_posts' );
				},
			)
		);
		if ( SceneFlow_WooCommerce::is_active() ) {
			SceneFlow_WooCommerce::register_routes( $this );
		}
	}

	/**
	 * Free-text search parameter: plain text, at most 100 characters.
	 *
	 * @return array
	 */
	public static function search_arg() {
		return array(
			'type'              => 'string',
			'default'           => '',
			'sanitize_callback' => static function ( $value ) {
				return mb_substr( sanitize_text_field( (string) $value ), 0, 100 );
			},
		);
	}

	/**
	 * 1-based page number.
	 *
	 * @return array
	 */
	public static function page_arg() {
		return array(
			'type'              => 'integer',
			'default'           => 1,
			'minimum'           => 1,
			'maximum'           => 1000,
			'sanitize_callback' => 'absint',
		);
	}

	/* ---------- auth ---------- */

	/**
	 * Verifies the HMAC signature headers and rejects replays.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return true|WP_Error
	 */
	public function permission_signed( $request ) {
		if ( ! SceneFlow_Settings::is_connected() ) {
			return new WP_Error( 'not_connected', __( 'This site is not connected to SceneFlow.', 'sceneflow' ), array( 'status' => 401 ) );
		}
		$site = (string) $request->get_header( 'x-sceneflow-site' );
		if ( '' === $site || ! hash_equals( SceneFlow_Settings::site_id(), $site ) ) {
			return new WP_Error( 'wrong_site', __( 'Request was signed for a different site.', 'sceneflow' ), array( 'status' => 401 ) );
		}
		$nonce  = (string) $request->get_header( 'x-sceneflow-nonce' );
		$result = SceneFlow_Signature::verify(
			SceneFlow_Settings::secret(),
			$request->get_method(),
			$request->get_route(),
			$request->get_header( 'x-sceneflow-timestamp' ),
			$nonce,
			$request->get_body(),
			$request->get_header( 'x-sceneflow-signature' )
		);
		if ( empty( $result['ok'] ) ) {
			return new WP_Error( $result['error'], __( 'Request signature rejected.', 'sceneflow' ) . ' (' . $result['error'] . ')', array( 'status' => 401 ) );
		}
		$key = 'sceneflow_nonce_' . md5( $nonce );
		if ( get_transient( $key ) ) {
			return new WP_Error( 'replay', __( 'Request was already processed.', 'sceneflow' ), array( 'status' => 401 ) );
		}
		set_transient( $key, 1, 2 * SceneFlow_Signature::MAX_SKEW );
		return true;
	}

	/* ---------- public ---------- */

	/**
	 * Connector version and capabilities. Public, so it never leaks secrets and gives WordPress as major.minor
	 * only (no exact core / PHP versions for scanners); the full versions are sent once, in the pairing answer.
	 *
	 * @return array
	 */
	public function health() {
		return array(
			'version'      => SCENEFLOW_VERSION,
			'wp'           => implode( '.', array_slice( explode( '.', (string) get_bloginfo( 'version' ) ), 0, 2 ) ),
			'siteName'     => get_bloginfo( 'name' ),
			'connected'    => SceneFlow_Settings::is_connected(),
			'capabilities' => $this->capabilities(),
		);
	}

	/**
	 * Capabilities advertised to the cloud.
	 *
	 * @return array
	 */
	private function capabilities() {
		$caps = array( 'publish', 'preview', 'placements', 'media', 'shortcode', 'block' );
		if ( SceneFlow_WooCommerce::is_active() ) {
			$caps[] = 'woocommerce';
		}
		return $caps;
	}

	/**
	 * Unguessable, lowercase token (lowercase so it survives sanitize_key() and case-sensitive object caches).
	 *
	 * @return string
	 */
	private static function token() {
		return strtolower( wp_generate_password( 32, false, false ) );
	}

	/**
	 * Pairing: the cloud sends the code shown in wp-admin plus the credentials to store.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return array|WP_Error
	 */
	public function connect( $request ) {
		$code     = (string) $request->get_param( 'pairingCode' );
		$site_id  = (string) $request->get_param( 'siteId' );
		$secret   = (string) $request->get_param( 'secret' );
		$saas_url = esc_url_raw( (string) $request->get_param( 'saasUrl' ) );
		$app_url  = esc_url_raw( (string) $request->get_param( 'appUrl' ) );

		if ( ! preg_match( '/^[0-9a-f-]{36}$/i', $site_id ) || ! preg_match( '/^[a-f0-9]{64}$/', $secret ) || '' === $saas_url ) {
			return new WP_Error( 'invalid_pairing_payload', __( 'Pairing payload is invalid.', 'sceneflow' ), array( 'status' => 400 ) );
		}
		$error = SceneFlow_Settings::consume_pairing_code( $code );
		if ( '' !== $error ) {
			$messages = array(
				'too_many_attempts' => __( 'Too many attempts. Generate a new pairing code in wp-admin.', 'sceneflow' ),
				'no_pairing_code'   => __( 'No pairing code is active. Generate one under Settings → SceneFlow.', 'sceneflow' ),
				'bad_pairing_code'  => __( 'Pairing code is wrong or expired.', 'sceneflow' ),
			);
			return new WP_Error( $error, isset( $messages[ $error ] ) ? $messages[ $error ] : $error, array( 'status' => 403 ) );
		}
		SceneFlow_Settings::save_connection( $site_id, $secret, $saas_url, '' !== $app_url ? $app_url : $saas_url );
		return array(
			'ok'            => true,
			'siteName'      => get_bloginfo( 'name' ),
			'wpVersion'     => get_bloginfo( 'version' ),
			'pluginVersion' => SCENEFLOW_VERSION,
			'capabilities'  => $this->capabilities(),
		);
	}

	/**
	 * Public config of a published project (same-origin for the runtime).
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function project( $request ) {
		$row = SceneFlow_Store::get_project( (string) $request['id'] );
		if ( ! $row ) {
			return new WP_Error( 'not_found', __( 'Project not published on this site.', 'sceneflow' ), array( 'status' => 404 ) );
		}
		return $this->config_response( $row['config_json'], 'public, max-age=60, stale-while-revalidate=600', $row['checksum'] );
	}

	/**
	 * Draft config behind an unguessable, short-lived token.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function preview( $request ) {
		$data = get_transient( 'sceneflow_preview_' . sanitize_key( (string) $request['token'] ) );
		if ( ! is_array( $data ) || empty( $data['config'] ) ) {
			return new WP_Error( 'preview_expired', __( 'Preview expired. Start a new preview from SceneFlow.', 'sceneflow' ), array( 'status' => 404 ) );
		}
		return $this->config_response( $data['config'], 'no-store', '' );
	}

	/**
	 * Builds a JSON response from a raw config string.
	 *
	 * @param string $config_json Raw JSON.
	 * @param string $cache       Cache-Control value.
	 * @param string $etag        ETag or ''.
	 * @return WP_REST_Response
	 */
	private function config_response( $config_json, $cache, $etag ) {
		// Decoded as objects, never assoc arrays: `{}` must come out as `{}` (see SceneFlow_Config::decode_for_output).
		$response = new WP_REST_Response( SceneFlow_Config::decode_for_output( $config_json ) );
		$response->header( 'Cache-Control', $cache );
		$response->header( 'Access-Control-Allow-Origin', '*' );
		if ( '' !== $etag ) {
			$response->header( 'ETag', '"' . $etag . '"' );
		}
		return $response;
	}

	/**
	 * Published projects for the block editor's project picker.
	 *
	 * @return array
	 */
	public function projects_for_editor() {
		return array( 'projects' => SceneFlow_Store::all_projects() );
	}

	/* ---------- signed ---------- */

	/**
	 * Receives a published project.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return array|WP_Error
	 */
	public function publish( $request ) {
		$project_id  = (string) $request->get_param( 'projectId' );
		$name        = sanitize_text_field( (string) $request->get_param( 'name' ) );
		$version     = absint( $request->get_param( 'version' ) );
		$checksum    = (string) $request->get_param( 'checksum' );
		$config_json = $request->get_param( 'configJson' );

		if ( ! SceneFlow_Config::is_valid_id( $project_id ) || ! SceneFlow_Config::is_valid_checksum( $checksum ) || ! is_string( $config_json ) || $version < 1 ) {
			return new WP_Error( 'invalid_publish_payload', __( 'Publish payload is invalid.', 'sceneflow' ), array( 'status' => 400 ) );
		}
		if ( ! hash_equals( hash( 'sha256', $config_json ), $checksum ) ) {
			return new WP_Error( 'checksum_mismatch', __( 'Config checksum does not match.', 'sceneflow' ), array( 'status' => 422 ) );
		}
		$valid = SceneFlow_Config::validate( $config_json, $project_id );
		if ( empty( $valid['ok'] ) ) {
			return new WP_Error( $valid['error'], __( 'Config rejected: ', 'sceneflow' ) . $valid['error'], array( 'status' => 422 ) );
		}
		if ( ! SceneFlow_Store::save_project( $project_id, $name, $version, $checksum, $config_json ) ) {
			return new WP_Error( 'store_failed', __( 'Could not store the project.', 'sceneflow' ), array( 'status' => 500 ) );
		}
		return array(
			'ok'        => true,
			'projectId' => $project_id,
			'version'   => $version,
			'configUrl' => add_query_arg( 'v', $version, rest_url( self::NS . '/project/' . rawurlencode( $project_id ) ) ),
			'shortcode' => '[sceneflow id="' . $project_id . '"]',
		);
	}

	/**
	 * Removes a published project.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return array
	 */
	public function unpublish( $request ) {
		SceneFlow_Store::delete_project( (string) $request['id'] );
		return array( 'ok' => true );
	}

	/**
	 * Stores a draft for 30 minutes and returns the URL to view it inside the theme.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return array|WP_Error
	 */
	public function preview_session( $request ) {
		$project_id  = (string) $request->get_param( 'projectId' );
		$checksum    = (string) $request->get_param( 'checksum' );
		$config_json = $request->get_param( 'configJson' );
		if ( ! SceneFlow_Config::is_valid_id( $project_id ) || ! is_string( $config_json ) || ! SceneFlow_Config::is_valid_checksum( $checksum ) || ! hash_equals( hash( 'sha256', $config_json ), $checksum ) ) {
			return new WP_Error( 'invalid_preview_payload', __( 'Preview payload is invalid.', 'sceneflow' ), array( 'status' => 400 ) );
		}
		$valid = SceneFlow_Config::validate( $config_json, $project_id );
		if ( empty( $valid['ok'] ) ) {
			return new WP_Error( $valid['error'], __( 'Config rejected: ', 'sceneflow' ) . $valid['error'], array( 'status' => 422 ) );
		}
		$token = self::token();
		set_transient(
			'sceneflow_preview_' . $token,
			array(
				'project_id' => $project_id,
				'config'     => $config_json,
			),
			30 * MINUTE_IN_SECONDS
		);
		return array(
			'ok'         => true,
			'token'      => $token,
			'previewUrl' => add_query_arg(
				array(
					'sceneflow_preview' => $token,
					'sceneflow_embed'   => '1',
				),
				home_url( '/' )
			),
			'expiresIn'  => 30 * MINUTE_IN_SECONDS,
		);
	}

	/**
	 * Starts an element-picking session on a page of this site.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return array|WP_Error
	 */
	public function pick_session( $request ) {
		$post_id  = absint( $request->get_param( 'postId' ) );
		$page_url = esc_url_raw( (string) $request->get_param( 'pageUrl' ) );
		$base     = home_url( '/' );
		if ( $post_id && 'publish' === get_post_status( $post_id ) ) {
			$base = get_permalink( $post_id );
		} elseif ( '' !== $page_url && wp_parse_url( $page_url, PHP_URL_HOST ) === wp_parse_url( home_url(), PHP_URL_HOST ) ) {
			$base = $page_url;
		}
		$token = self::token();
		set_transient( 'sceneflow_pick_' . $token, 1, 30 * MINUTE_IN_SECONDS );
		return array(
			'ok'        => true,
			'token'     => $token,
			'pickUrl'   => add_query_arg( 'sceneflow_pick', $token, $base ),
			'expiresIn' => 30 * MINUTE_IN_SECONDS,
		);
	}

	/**
	 * Pages and posts the cloud can place a player on.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return array
	 */
	public function pages( $request ) {
		$search = sanitize_text_field( (string) $request->get_param( 'search' ) );
		$items  = array();
		$front  = (int) get_option( 'page_on_front' );
		if ( '' === $search || false !== stripos( get_bloginfo( 'name' ), $search ) || false !== stripos( 'home', $search ) ) {
			$items[] = array(
				'id'    => $front,
				'title' => __( 'Home page', 'sceneflow' ),
				'url'   => home_url( '/' ),
				'type'  => 'home',
				'path'  => '/',
			);
		}
		$posts = get_posts(
			array(
				'post_type'           => array( 'page', 'post' ),
				'post_status'         => 'publish',
				's'                   => $search,
				'posts_per_page'      => 30,
				'orderby'             => 'title',
				'order'               => 'ASC',
				'ignore_sticky_posts' => true,
			)
		);
		foreach ( $posts as $post ) {
			if ( $post->ID === $front ) {
				continue;
			}
			$url     = get_permalink( $post );
			$items[] = array(
				'id'    => $post->ID,
				'title' => get_the_title( $post ),
				'url'   => $url,
				'type'  => $post->post_type,
				'path'  => SceneFlow_Frontend::normalize_path( (string) wp_parse_url( $url, PHP_URL_PATH ) ),
			);
		}
		return array(
			'ok'    => true,
			'items' => $items,
		);
	}

	/**
	 * All placements.
	 *
	 * @return array
	 */
	public function placements() {
		return array(
			'ok'    => true,
			'items' => SceneFlow_Store::all_placements(),
		);
	}

	/**
	 * Creates or updates a placement (the cloud owns the id so both sides stay in sync).
	 *
	 * @param WP_REST_Request $request Request.
	 * @return array|WP_Error
	 */
	public function save_placement( $request ) {
		$id         = (string) $request->get_param( 'id' );
		$project_id = (string) $request->get_param( 'projectId' );
		$selector   = (string) $request->get_param( 'selector' );
		$mode       = (string) $request->get_param( 'mode' );
		$post_id    = absint( $request->get_param( 'postId' ) );
		$path       = (string) $request->get_param( 'path' );

		if ( ! SceneFlow_Config::is_valid_id( $id ) || ! SceneFlow_Config::is_valid_id( $project_id ) || ! SceneFlow_Config::is_valid_selector( $selector ) || ! in_array( $mode, SceneFlow_Store::MODES, true ) ) {
			return new WP_Error( 'invalid_placement', __( 'Placement is invalid.', 'sceneflow' ), array( 'status' => 400 ) );
		}
		if ( ! $post_id && '' === $path ) {
			return new WP_Error( 'invalid_placement_target', __( 'A placement needs a page (post id) or a path.', 'sceneflow' ), array( 'status' => 400 ) );
		}
		SceneFlow_Store::save_placement(
			array(
				'id'         => $id,
				'project_id' => $project_id,
				'post_id'    => $post_id,
				'path'       => '' !== $path ? SceneFlow_Frontend::normalize_path( $path ) : '',
				'selector'   => trim( $selector ),
				'mode'       => $mode,
			)
		);
		return array(
			'ok' => true,
			'id' => $id,
		);
	}

	/**
	 * Deletes a placement.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return array
	 */
	public function delete_placement( $request ) {
		SceneFlow_Store::delete_placement( (string) $request['id'] );
		return array( 'ok' => true );
	}

	/**
	 * Media library listing (images and videos) for the cloud editor.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return array
	 */
	public function media( $request ) {
		$type   = (string) $request->get_param( 'type' );
		$search = sanitize_text_field( (string) $request->get_param( 'search' ) );
		$page   = max( 1, absint( $request->get_param( 'page' ) ) );
		$mimes  = 'video' === $type ? array( 'video/mp4', 'video/webm', 'video/quicktime' ) : ( 'image' === $type ? array( 'image/jpeg', 'image/png', 'image/webp', 'image/gif' ) : array( 'image', 'video' ) );
		$query  = new WP_Query(
			array(
				'post_type'      => 'attachment',
				'post_status'    => 'inherit',
				'post_mime_type' => $mimes,
				's'              => $search,
				'posts_per_page' => 40,
				'paged'          => $page,
				'orderby'        => 'date',
				'order'          => 'DESC',
			)
		);
		$items  = array();
		foreach ( $query->posts as $post ) {
			$meta    = wp_get_attachment_metadata( $post->ID );
			$thumb   = wp_get_attachment_image_url( $post->ID, 'medium' );
			$items[] = array(
				'id'        => $post->ID,
				'title'     => get_the_title( $post ),
				'url'       => wp_get_attachment_url( $post->ID ),
				'mime'      => $post->post_mime_type,
				'width'     => isset( $meta['width'] ) ? (int) $meta['width'] : null,
				'height'    => isset( $meta['height'] ) ? (int) $meta['height'] : null,
				'thumbnail' => $thumb ? $thumb : null,
			);
		}
		return array(
			'ok'    => true,
			'items' => $items,
			'total' => (int) $query->found_posts,
		);
	}
}
