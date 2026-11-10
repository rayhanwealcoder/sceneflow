<?php
/**
 * Page builder integrations: a native "SceneFlow Video" element in Elementor and in Bricks.
 *
 * Both render exactly what the shortcode renders (SceneFlow_Frontend::render_player), so a video looks and
 * behaves the same however it was placed. Each integration loads only when its builder is active. Other
 * builders (Divi, Breakdance, Oxygen, Beaver Builder) use the [sceneflow id="…"] shortcode in their text or
 * shortcode module.
 *
 * @package SceneFlow
 */

defined( 'ABSPATH' ) || exit;

/**
 * Registers the builder elements.
 */
class SceneFlow_Builders {

	/**
	 * Hooks (each only fires when its builder runs).
	 */
	public static function init() {
		add_action( 'elementor/widgets/register', array( __CLASS__, 'register_elementor' ) );
		add_action( 'elementor/preview/enqueue_scripts', array( __CLASS__, 'elementor_preview_scripts' ) );
		add_action( 'init', array( __CLASS__, 'register_bricks' ), 11 );
	}

	/**
	 * Published projects as select options ("" = choose one).
	 *
	 * @return array project id => label
	 */
	public static function project_options() {
		$options = array( '' => __( '— Choose a video —', 'sceneflow' ) );
		foreach ( SceneFlow_Store::all_projects() as $row ) {
			$name = '' !== (string) $row['name'] ? (string) $row['name'] : (string) $row['project_id'];
			/* translators: 1: video name, 2: published version number. */
			$options[ (string) $row['project_id'] ] = sprintf( __( '%1$s (v%2$d)', 'sceneflow' ), $name, (int) $row['version'] );
		}
		return $options;
	}

	/**
	 * What an editor sees in the builder while no video is chosen (visitors see nothing).
	 *
	 * @return string
	 */
	public static function placeholder() {
		if ( ! current_user_can( 'edit_posts' ) ) {
			return '';
		}
		$text = SceneFlow_Store::all_projects()
			? __( 'SceneFlow Video: choose a video in the element settings.', 'sceneflow' )
			: __( 'SceneFlow Video: publish a video to this site from SceneFlow first, then choose it here.', 'sceneflow' );
		return '<div class="sceneflow-missing" style="padding:16px;border:1px dashed #999;font:14px/1.4 sans-serif;text-align:center">' . esc_html( $text ) . '</div>';
	}

	/**
	 * The player (or the editor placeholder) for a builder element.
	 *
	 * @param string $project_id Project id.
	 * @param string $max_width  CSS length or ''.
	 * @return string Markup; print it through wp_kses( …, SceneFlow_Frontend::allowed_html() ).
	 */
	public static function render( $project_id, $max_width ) {
		$project_id = (string) $project_id;
		if ( '' === $project_id ) {
			return self::placeholder();
		}
		return SceneFlow_Frontend::render_player( $project_id, (string) $max_width );
	}

	/**
	 * Elementor: registers the widget.
	 *
	 * @param \Elementor\Widgets_Manager $widgets_manager Widgets manager.
	 */
	public static function register_elementor( $widgets_manager ) {
		require_once SCENEFLOW_DIR . 'includes/builders/class-sceneflow-elementor-widget.php';
		$widgets_manager->register( new SceneFlow_Elementor_Widget() );
	}

	/**
	 * Elementor editor preview: the runtime is always there, and widgets mount again after every edit.
	 */
	public static function elementor_preview_scripts() {
		SceneFlow_Frontend::enqueue_runtime();
		wp_enqueue_script(
			'sceneflow-elementor',
			SCENEFLOW_URL . 'assets/sceneflow-elementor.js',
			array( 'sceneflow-init', 'elementor-frontend' ),
			SCENEFLOW_VERSION,
			array( 'in_footer' => true )
		);
	}

	/**
	 * Bricks: registers the element (Bricks theme active).
	 */
	public static function register_bricks() {
		if ( class_exists( '\Bricks\Elements' ) ) {
			\Bricks\Elements::register_element( SCENEFLOW_DIR . 'includes/builders/class-sceneflow-bricks-element.php' );
		}
	}
}
