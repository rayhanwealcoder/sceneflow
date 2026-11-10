<?php
/**
 * Bricks element "SceneFlow Video".
 *
 * Loaded by Bricks itself (\Bricks\Elements::register_element in SceneFlow_Builders), where \Bricks\Element exists.
 *
 * @package SceneFlow
 */

defined( 'ABSPATH' ) || exit;

/**
 * A published SceneFlow video in a Bricks layout.
 */
class SceneFlow_Bricks_Element extends \Bricks\Element {

	/**
	 * Element panel group.
	 *
	 * @var string
	 */
	public $category = 'media';

	/**
	 * Element slug.
	 *
	 * @var string
	 */
	public $name = 'sceneflow-video';

	/**
	 * Panel icon (Themify icon set bundled with Bricks).
	 *
	 * @var string
	 */
	public $icon = 'ti-video-clapper';

	/**
	 * Global JS function Bricks calls after rendering the element in the builder canvas.
	 *
	 * @var array
	 */
	public $scripts = array( 'sceneflowBricksInit' );

	/**
	 * Panel title.
	 *
	 * @return string
	 */
	public function get_label() {
		return esc_html__( 'SceneFlow Video', 'sceneflow' );
	}

	/**
	 * Search words.
	 *
	 * @return array
	 */
	public function get_keywords() {
		return array( 'sceneflow', 'video', 'interactive', 'shoppable', 'scroll' );
	}

	/**
	 * Settings: which video, and an optional maximum width.
	 */
	public function set_controls() {
		$this->controls['projectId'] = array(
			'tab'         => 'content',
			'label'       => esc_html__( 'Video', 'sceneflow' ),
			'type'        => 'select',
			'options'     => SceneFlow_Builders::project_options(),
			'inline'      => false,
			'description' => esc_html__( 'Videos published to this site from SceneFlow.', 'sceneflow' ),
		);
		$this->controls['maxWidth']  = array(
			'tab'         => 'content',
			'label'       => esc_html__( 'Maximum width', 'sceneflow' ),
			'type'        => 'text',
			'placeholder' => '720px',
			'description' => esc_html__( 'Optional, e.g. 720px or 80%. Empty = full width.', 'sceneflow' ),
		);
	}

	/**
	 * Runtime on pages (and in the builder canvas) that contain this element.
	 */
	public function enqueue_scripts() {
		SceneFlow_Frontend::enqueue_runtime();
	}

	/**
	 * Front end and builder canvas.
	 */
	public function render() {
		$project = isset( $this->settings['projectId'] ) ? (string) $this->settings['projectId'] : '';
		$width   = isset( $this->settings['maxWidth'] ) ? (string) $this->settings['maxWidth'] : '';
		// render_attributes() is escaped by Bricks (the element's root id, classes and styles).
		echo '<div ' . $this->render_attributes( '_root' ) . '>'; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- Escaped by Bricks.
		echo wp_kses( SceneFlow_Builders::render( $project, $width ), SceneFlow_Frontend::allowed_html() );
		echo '</div>';
	}
}
