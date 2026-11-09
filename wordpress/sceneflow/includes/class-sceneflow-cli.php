<?php
/**
 * WP-CLI: `wp sceneflow pairing-code | status | disconnect`.
 *
 * @package SceneFlow
 */

defined( 'ABSPATH' ) || exit;

if ( ! class_exists( 'WP_CLI' ) ) {
	return;
}

/**
 * SceneFlow commands.
 */
class SceneFlow_CLI {

	/**
	 * Generates a one-time pairing code.
	 *
	 * ## EXAMPLES
	 *
	 *     wp sceneflow pairing-code
	 *
	 * @subcommand pairing-code
	 */
	public function pairing_code() {
		$code = SceneFlow_Settings::create_pairing_code();
		WP_CLI::success( 'Pairing code (valid 10 minutes): ' . substr( $code, 0, 4 ) . '-' . substr( $code, 4 ) );
	}

	/**
	 * Shows the connection status.
	 */
	public function status() {
		$c = SceneFlow_Settings::connection();
		if ( ! $c ) {
			WP_CLI::line( 'Not connected.' );
			return;
		}
		WP_CLI::line( 'Connected to ' . $c['saas_url'] . ' (site ' . $c['site_id'] . ')' );
		WP_CLI::line( 'Published projects: ' . count( SceneFlow_Store::all_projects() ) );
		WP_CLI::line( 'Placements: ' . count( SceneFlow_Store::all_placements() ) );
	}

	/**
	 * Forgets the pairing.
	 */
	public function disconnect() {
		SceneFlow_Settings::disconnect();
		WP_CLI::success( 'Disconnected.' );
	}
}

WP_CLI::add_command( 'sceneflow', 'SceneFlow_CLI' );
