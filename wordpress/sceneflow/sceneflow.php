<?php
/**
 * Plugin Name:       SceneFlow
 * Plugin URI:        https://sceneflow.app
 * Description:       Interactive and shoppable video from SceneFlow on your WordPress site: shortcode, Gutenberg block, element placements, WooCommerce add-to-cart and a lightweight runtime.
 * Version:           0.3.0
 * Requires at least: 6.2
 * Requires PHP:      7.4
 * Author:            SceneFlow
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       sceneflow
 *
 * @package SceneFlow
 */

defined( 'ABSPATH' ) || exit;

define( 'SCENEFLOW_VERSION', '0.3.0' );
define( 'SCENEFLOW_FILE', __FILE__ );
define( 'SCENEFLOW_DIR', plugin_dir_path( __FILE__ ) );
define( 'SCENEFLOW_URL', plugin_dir_url( __FILE__ ) );
if ( ! defined( 'SCENEFLOW_APP_URL' ) ) {
	// The SceneFlow web app used for one-click connect. Override in wp-config.php for self-hosted / staging setups.
	define( 'SCENEFLOW_APP_URL', 'https://app.sceneflow.app' );
}

require_once SCENEFLOW_DIR . 'includes/class-sceneflow-signature.php';
require_once SCENEFLOW_DIR . 'includes/class-sceneflow-config.php';
require_once SCENEFLOW_DIR . 'includes/class-sceneflow-store.php';
require_once SCENEFLOW_DIR . 'includes/class-sceneflow-settings.php';
require_once SCENEFLOW_DIR . 'includes/class-sceneflow-woocommerce.php';
require_once SCENEFLOW_DIR . 'includes/class-sceneflow-rest.php';
require_once SCENEFLOW_DIR . 'includes/class-sceneflow-frontend.php';
require_once SCENEFLOW_DIR . 'includes/class-sceneflow-admin.php';
require_once SCENEFLOW_DIR . 'includes/class-sceneflow-plugin.php';

if ( defined( 'WP_CLI' ) && WP_CLI ) {
	require_once SCENEFLOW_DIR . 'includes/class-sceneflow-cli.php';
}

register_activation_hook( __FILE__, array( 'SceneFlow_Store', 'install' ) );

SceneFlow_Plugin::instance();
