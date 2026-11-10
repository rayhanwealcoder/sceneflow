<?php
/**
 * Server render of the SceneFlow Video block.
 *
 * @package SceneFlow
 *
 * @var array $attributes Block attributes.
 */

defined( 'ABSPATH' ) || exit;

$sceneflow_project_id = isset( $attributes['projectId'] ) ? (string) $attributes['projectId'] : '';
if ( '' === $sceneflow_project_id ) {
	return;
}
$sceneflow_max_width = isset( $attributes['maxWidth'] ) ? (string) $attributes['maxWidth'] : '';
?>
<div <?php echo get_block_wrapper_attributes(); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- Core escapes this. ?>>
	<?php echo wp_kses( SceneFlow_Frontend::render_player( $sceneflow_project_id, $sceneflow_max_width ), SceneFlow_Frontend::allowed_html() ); ?>
</div>
