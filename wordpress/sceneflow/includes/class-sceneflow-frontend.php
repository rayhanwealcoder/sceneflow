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
		add_action( 'template_redirect', array( $this, 'maybe_preview_page' ) );
		add_shortcode( 'sceneflow', array( $this, 'shortcode' ) );
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
		return $token ? rest_url( SceneFlow_REST::NS . '/preview/' . $token ) : rest_url( SceneFlow_REST::NS . '/project/' . rawurlencode( $project_id ) );
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
		return '<div class="sceneflow-player ' . esc_attr( $css_class ) . '" data-sceneflow-id="' . esc_attr( $project_id ) . '" data-sceneflow-config="' . esc_url( self::config_url( $project_id ) ) . '"' . $style . '></div>';
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
