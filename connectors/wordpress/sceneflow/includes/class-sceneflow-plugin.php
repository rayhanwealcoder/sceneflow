<?php
/**
 * Plugin bootstrap.
 *
 * @package SceneFlow
 */

defined( 'ABSPATH' ) || exit;

/**
 * Wires everything together.
 */
final class SceneFlow_Plugin {

	/**
	 * Singleton.
	 *
	 * @var SceneFlow_Plugin|null
	 */
	private static $instance = null;

	/**
	 * Returns the instance.
	 *
	 * @return SceneFlow_Plugin
	 */
	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	/**
	 * Hooks.
	 */
	private function __construct() {
		add_action( 'plugins_loaded', array( 'SceneFlow_Store', 'maybe_upgrade' ) );
		add_action( 'init', array( $this, 'register_block' ) );
		add_action( 'rest_api_init', array( new SceneFlow_REST(), 'register_routes' ) );
		( new SceneFlow_Frontend() )->init();
		SceneFlow_Orders::init();
		SceneFlow_Builders::init();
		if ( is_admin() ) {
			( new SceneFlow_Admin() )->init();
		}
	}

	/**
	 * Registers the Gutenberg block from its block.json.
	 */
	public function register_block() {
		register_block_type( SCENEFLOW_DIR . 'blocks/player' );
	}
}
