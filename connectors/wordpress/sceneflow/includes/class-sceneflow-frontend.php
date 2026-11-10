<?php
/**
 * Frontend: shortcode, element placements, draft preview page and the element picker.
 *
 * @package SceneFlow
 */

defined( 'ABSPATH' ) || exit;

/**
 * Renders players on the public site.
 */
class SceneFlow_Frontend {

	/**
	 * Hooks.
	 */
	public function init() {
		add_action( 'wp_enqueue_scripts', array( $this, 'register_assets' ), 5 );
		add_action( 'wp_enqueue_scripts', array( $this, 'enqueue_placements' ) );
		add_action( 'wp_enqueue_scripts', array( $this, 'maybe_picker' ) );
		add_action( 'wp_head', array( $this, 'print_placement_hints' ), 2 );
		add_action( 'template_redirect', array( $this, 'maybe_preview_page' ) );
		add_shortcode( 'sceneflow', array( $this, 'shortcode' ) );
	}

	/**
	 * Projects whose resource hints were already printed on this page.
	 *
	 * @var array<string, bool>
	 */
	private static $hinted = array();

	/**
	 * Resource hints for one player (page speed): preconnect to the media host, preload the thumbnail (it is the
	 * largest thing above the fold) and the config JSON (otherwise it is only requested once the deferred runtime
	 * has run). All three are `<link>` elements browsers accept in the body, so the shortcode can print them inline.
	 *
	 * @param string $project_id Project id.
	 * @return string HTML, '' when nothing is known about the project or the hints were printed already.
	 */
	public static function resource_hints( $project_id ) {
		if ( isset( self::$hinted[ $project_id ] ) || ! SceneFlow_Config::is_valid_id( $project_id ) ) {
			return '';
		}
		$stored = SceneFlow_Store::get_project( $project_id );
		if ( ! $stored || '' !== self::preview_token_for( $project_id ) ) {
			return '';
		}
		self::$hinted[ $project_id ] = true;
		$config                      = SceneFlow_Config::decode_for_output( $stored['config_json'] );
		$html                        = '<link rel="preload" as="fetch" crossorigin="anonymous" href="' . esc_url( self::config_url( $project_id ) ) . '">';
		if ( ! is_object( $config ) ) {
			return $html;
		}
		$first  = isset( $config->scenes[0]->background ) ? $config->scenes[0]->background : null;
		$poster = '';
		if ( ! empty( $config->poster ) ) {
			$poster = (string) $config->poster;
		} elseif ( ! empty( $config->video->poster ) ) {
			$poster = (string) $config->video->poster;
		} elseif ( $first && ! empty( $first->poster ) ) {
			$poster = (string) $first->poster;
		} elseif ( $first && isset( $first->type ) && 'image' === $first->type && ! empty( $first->src ) ) {
			$poster = (string) $first->src;
		}
		$media  = ! empty( $config->video->src ) ? (string) $config->video->src : ( $first && ! empty( $first->src ) ? (string) $first->src : $poster );
		$origin = self::origin_of( $media );
		if ( $origin && self::origin_of( home_url( '/' ) ) !== $origin ) {
			// Two connections: images and video elements use a plain one, the runtime's CORS fetch of the scrub file another.
			$html .= '<link rel="preconnect" href="' . esc_url( $origin ) . '"><link rel="preconnect" href="' . esc_url( $origin ) . '" crossorigin>';
		}
		if ( $poster ) {
			$html .= '<link rel="preload" as="image" fetchpriority="high" href="' . esc_url( $poster ) . '">';
		}
		return $html;
	}

	/**
	 * Origin (scheme://host[:port]) of a URL, or '' when it is not an absolute http(s) URL.
	 *
	 * @param string $url URL.
	 * @return string
	 */
	private static function origin_of( $url ) {
		$p = wp_parse_url( (string) $url );
		if ( empty( $p['scheme'] ) || empty( $p['host'] ) || ! in_array( $p['scheme'], array( 'http', 'https' ), true ) ) {
			return '';
		}
		return $p['scheme'] . '://' . $p['host'] . ( ! empty( $p['port'] ) ? ':' . (int) $p['port'] : '' );
	}

	/**
	 * Hints for element placements go in the head (they are known before the page renders).
	 */
	public function print_placement_hints() {
		if ( is_admin() || ! empty( $_GET['sceneflow_pick'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Read-only flag.
			return;
		}
		foreach ( $this->placements_for_request() as $p ) {
			echo self::resource_hints( $p['projectId'] ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- Built from escaped parts in resource_hints().
		}
	}

	/**
	 * Registers the packaged runtime and the small init script.
	 */
	public function register_assets() {
		if ( wp_script_is( 'sceneflow-runtime', 'registered' ) ) {
			return;
		}
		// Deferred (WP 6.3+ honours the strategy; older versions just load in the footer) so the runtime never blocks rendering.
		$args = array(
			'in_footer' => true,
			'strategy'  => 'defer',
		);
		wp_register_script( 'sceneflow-runtime', SCENEFLOW_URL . 'assets/sceneflow.runtime.min.js', array(), SCENEFLOW_VERSION, $args );
		// Commerce adapters register themselves before players mount; WooCommerce is optional.
		$deps = array( 'sceneflow-runtime' );
		if ( SceneFlow_WooCommerce::is_active() ) {
			SceneFlow_WooCommerce::register_script();
			$deps[] = 'sceneflow-woocommerce';
		}
		wp_register_script( 'sceneflow-init', SCENEFLOW_URL . 'assets/sceneflow-init.js', $deps, SCENEFLOW_VERSION, $args );
		// Site-level switches the init script passes to every player (analytics opt-out).
		wp_add_inline_script( 'sceneflow-init', 'window.SceneFlowSettings = ' . wp_json_encode( array( 'analytics' => SceneFlow_Settings::analytics_enabled() ) ) . ';', 'before' );
	}

	/**
	 * Enqueues runtime + init (idempotent).
	 */
	public static function enqueue_runtime() {
		( new self() )->register_assets();
		wp_enqueue_script( 'sceneflow-init' );
	}

	/**
	 * Normalizes a URL path to "/" or "/a/b/".
	 *
	 * @param string $path Raw path.
	 * @return string
	 */
	public static function normalize_path( $path ) {
		$path = '/' . trim( (string) $path, '/' );
		return '/' === $path ? '/' : $path . '/';
	}

	/**
	 * Path of the current request.
	 *
	 * @return string
	 */
	public static function current_path() {
		$uri  = isset( $_SERVER['REQUEST_URI'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REQUEST_URI'] ) ) : '/';
		$path = wp_parse_url( $uri, PHP_URL_PATH );
		return self::normalize_path( is_string( $path ) ? $path : '/' );
	}

	/**
	 * Preview token from the URL when it belongs to the given project.
	 *
	 * @param string $project_id Project id.
	 * @return string Token or ''.
	 */
	public static function preview_token_for( $project_id ) {
		if ( empty( $_GET['sceneflow_preview'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Token is the credential.
			return '';
		}
		$token = sanitize_key( wp_unslash( $_GET['sceneflow_preview'] ) ); // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Token is the credential.
		$data  = get_transient( 'sceneflow_preview_' . $token );
		return is_array( $data ) && isset( $data['project_id'] ) && $data['project_id'] === $project_id ? $token : '';
	}

	/**
	 * Same-origin URL the runtime loads the config from (draft when previewing).
	 *
	 * @param string $project_id Project id.
	 * @return string
	 */
	public static function config_url( $project_id ) {
		$token = self::preview_token_for( $project_id );
		if ( $token ) {
			return rest_url( SceneFlow_REST::NS . '/preview/' . $token );
		}
		$url    = rest_url( SceneFlow_REST::NS . '/project/' . rawurlencode( $project_id ) );
		$stored = SceneFlow_Store::get_project( $project_id );
		// The config answer may be cached for a minute (browser / page cache); the published version in the URL makes a fresh publish show on the very next page load.
		return $stored && ! empty( $stored['version'] ) ? add_query_arg( 'v', (int) $stored['version'], $url ) : $url;
	}

	/**
	 * Player container markup. All attribute values are escaped here.
	 *
	 * @param string $project_id Project id.
	 * @param string $max_width  Optional CSS max-width.
	 * @param string $css_class  Extra classes.
	 * @return string
	 */
	public static function render_player( $project_id, $max_width = '', $css_class = '' ) {
		if ( ! SceneFlow_Config::is_valid_id( $project_id ) ) {
			return '';
		}
		if ( ! SceneFlow_Store::get_project( $project_id ) && '' === self::preview_token_for( $project_id ) ) {
			if ( current_user_can( 'edit_posts' ) ) {
				return '<div class="sceneflow-missing" style="padding:12px;border:1px dashed #999;font:14px/1.4 sans-serif">' . esc_html__( 'SceneFlow: this project has not been published to this site yet.', 'sceneflow' ) . '</div>';
			}
			return '';
		}
		self::enqueue_runtime();
		// Only a plain CSS length is accepted, so a shortcode attribute can never inject other declarations.
		$style = SceneFlow_Config::is_valid_css_length( $max_width ) ? ' style="max-width:' . esc_attr( $max_width ) . ';margin-left:auto;margin-right:auto"' : '';
		return self::resource_hints( $project_id ) . '<div class="sceneflow-player ' . esc_attr( $css_class ) . '" data-sceneflow-id="' . esc_attr( $project_id ) . '" data-sceneflow-config="' . esc_url( self::config_url( $project_id ) ) . '"' . $style . '></div>';
	}

	/**
	 * [sceneflow id="..." max_width="720px" class="..."]
	 *
	 * @param array|string $atts Shortcode attributes.
	 * @return string
	 */
	public function shortcode( $atts ) {
		$atts = shortcode_atts(
			array(
				'id'        => '',
				'max_width' => '',
				'class'     => '',
			),
			$atts,
			'sceneflow'
		);
		return self::render_player( (string) $atts['id'], (string) $atts['max_width'], (string) $atts['class'] );
	}

	/**
	 * Placements that apply to the current request.
	 *
	 * @return array
	 */
	private function placements_for_request() {
		$all = SceneFlow_Store::all_placements();
		if ( empty( $all ) ) {
			return array();
		}
		$post_id = is_singular() ? (int) get_queried_object_id() : 0;
		$front   = is_front_page() ? (int) get_option( 'page_on_front' ) : -1;
		$path    = self::current_path();
		$out     = array();
		foreach ( $all as $p ) {
			$by_post = ! empty( $p['post_id'] ) && ( (int) $p['post_id'] === $post_id || (int) $p['post_id'] === $front );
			$by_path = ! empty( $p['path'] ) && $p['path'] === $path;
			if ( ! $by_post && ! $by_path ) {
				continue;
			}
			if ( ! SceneFlow_Store::get_project( $p['project_id'] ) && '' === self::preview_token_for( $p['project_id'] ) ) {
				continue;
			}
			$out[] = array(
				'id'        => $p['id'],
				'projectId' => $p['project_id'],
				'selector'  => $p['selector'],
				'mode'      => $p['mode'],
				'configUrl' => self::config_url( $p['project_id'] ),
			);
		}
		return $out;
	}

	/**
	 * Injects players into picked elements (client side). Skipped while picking.
	 */
	public function enqueue_placements() {
		if ( is_admin() || ! empty( $_GET['sceneflow_pick'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Read-only flag.
			return;
		}
		$list = $this->placements_for_request();
		if ( empty( $list ) ) {
			return;
		}
		self::enqueue_runtime();
		wp_add_inline_script( 'sceneflow-init', 'window.SceneFlowPlacements = ' . wp_json_encode( $list ) . ';', 'before' );
	}

	/**
	 * Element picker, only with a valid pick token.
	 */
	public function maybe_picker() {
		if ( empty( $_GET['sceneflow_pick'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Token is the credential.
			return;
		}
		$token = sanitize_key( wp_unslash( $_GET['sceneflow_pick'] ) ); // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Token is the credential.
		if ( ! get_transient( 'sceneflow_pick_' . $token ) ) {
			return;
		}
		nocache_headers();
		wp_enqueue_script( 'sceneflow-picker', SCENEFLOW_URL . 'assets/sceneflow-picker.js', array(), SCENEFLOW_VERSION, true );
		wp_add_inline_script(
			'sceneflow-picker',
			'window.SceneFlowPick = ' . wp_json_encode(
				array(
					'origin' => SceneFlow_Settings::app_origin(),
					'token'  => $token,
					'path'   => self::current_path(),
					'postId' => is_singular() ? (int) get_queried_object_id() : 0,
				)
			) . ';',
			'before'
		);
	}

	/**
	 * Standalone preview page inside the theme (wp_head/wp_footer) for a draft.
	 */
	public function maybe_preview_page() {
		if ( empty( $_GET['sceneflow_preview'] ) || empty( $_GET['sceneflow_embed'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Token is the credential.
			return;
		}
		$token = sanitize_key( wp_unslash( $_GET['sceneflow_preview'] ) ); // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Token is the credential.
		$data  = get_transient( 'sceneflow_preview_' . $token );
		if ( ! is_array( $data ) || empty( $data['project_id'] ) ) {
			wp_die( esc_html__( 'This SceneFlow preview has expired. Start a new preview from the editor.', 'sceneflow' ), '', array( 'response' => 410 ) );
		}
		nocache_headers();
		$project_id = (string) $data['project_id'];
		self::enqueue_runtime();
		?>
<!DOCTYPE html>
<html <?php language_attributes(); ?>>
<head>
	<meta charset="<?php bloginfo( 'charset' ); ?>">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<meta name="robots" content="noindex, nofollow">
	<title><?php esc_html_e( 'SceneFlow preview', 'sceneflow' ); ?></title>
		<?php wp_head(); ?>
	<style>.sceneflow-preview-wrap{max-width:1100px;margin:32px auto;padding:0 16px}.sceneflow-preview-note{font:13px/1.4 sans-serif;opacity:.7;margin:0 0 12px}</style>
</head>
<body <?php body_class( 'sceneflow-preview' ); ?>>
	<div class="sceneflow-preview-wrap">
		<p class="sceneflow-preview-note"><?php esc_html_e( 'Draft preview — not visible to visitors. Scroll-scrub projects need page height: scroll this page to test them.', 'sceneflow' ); ?></p>
		<?php echo self::render_player( $project_id ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- Markup is escaped in render_player(). ?>
	</div>
		<?php wp_footer(); ?>
</body>
</html>
		<?php
		exit;
	}
}
