<?php
/**
 * Elementor widget "SceneFlow Video".
 *
 * Loaded by SceneFlow_Builders only inside Elementor's widget registration, where \Elementor\Widget_Base exists.
 *
 * @package SceneFlow
 */

defined( 'ABSPATH' ) || exit;

/**
 * A published SceneFlow video in an Elementor layout.
 */
class SceneFlow_Elementor_Widget extends \Elementor\Widget_Base {

	/**
	 * Widget slug.
	 *
	 * @return string
	 */
	public function get_name() {
		return 'sceneflow-video';
	}

	/**
	 * Panel title.
	 *
	 * @return string
	 */
	public function get_title() {
		return __( 'SceneFlow Video', 'sceneflow' );
	}

	/**
	 * Panel icon.
	 *
	 * @return string
	 */
	public function get_icon() {
		return 'eicon-play';
	}

	/**
	 * Panel group.
	 *
	 * @return array
	 */
	public function get_categories() {
		return array( 'general' );
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
	protected function register_controls() {
		$this->start_controls_section(
			'sceneflow_video',
			array(
				'label' => __( 'Video', 'sceneflow' ),
				'tab'   => \Elementor\Controls_Manager::TAB_CONTENT,
			)
		);
		$this->add_control(
			'project_id',
			array(
				'label'       => __( 'Video', 'sceneflow' ),
				'type'        => \Elementor\Controls_Manager::SELECT,
				'options'     => SceneFlow_Builders::project_options(),
				'default'     => '',
				'description' => __( 'Videos published to this site from SceneFlow.', 'sceneflow' ),
			)
		);
		$this->add_control(
			'max_width',
			array(
				'label'       => __( 'Maximum width', 'sceneflow' ),
				'type'        => \Elementor\Controls_Manager::TEXT,
				'placeholder' => '720px',
				'description' => __( 'Optional, e.g. 720px or 80%. Empty = full width of the column.', 'sceneflow' ),
			)
		);
		$this->end_controls_section();
	}

	/**
	 * Front end and editor preview (the runtime is enqueued by the render call, only on pages with a video).
	 */
	protected function render() {
		$settings = $this->get_settings_for_display();
		$project  = isset( $settings['project_id'] ) ? (string) $settings['project_id'] : '';
		$width    = isset( $settings['max_width'] ) ? (string) $settings['max_width'] : '';
		echo wp_kses( SceneFlow_Builders::render( $project, $width ), SceneFlow_Frontend::allowed_html() );
	}
}
