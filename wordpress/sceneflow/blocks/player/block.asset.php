<?php
/**
 * Dependencies of block.js (no build step; plain wp.* globals).
 * WordPress looks for "{script}.asset.php" next to the script, so this file name is required.
 *
 * @package SceneFlow
 */

// phpcs:disable WordPress.Files.FileName

return array(
	'dependencies' => array( 'wp-blocks', 'wp-element', 'wp-components', 'wp-block-editor', 'wp-api-fetch', 'wp-i18n' ),
	'version'      => '0.1.0',
);
