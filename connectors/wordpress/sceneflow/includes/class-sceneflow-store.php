<?php
/**
 * Local storage of published projects and element placements.
 *
 * Published configs live in this database so the website keeps working even when the
 * SceneFlow cloud is unreachable (AC-004).
 *
 * @package SceneFlow
 */

defined( 'ABSPATH' ) || exit;

/**
 * Custom tables.
 */
class SceneFlow_Store {

	const DB_VERSION = '1';
	const MODES      = array( 'replace', 'before', 'after', 'append', 'prepend' );

	/**
	 * Projects table name.
	 *
	 * @return string
	 */
	public static function projects_table() {
		global $wpdb;
		return $wpdb->prefix . 'sceneflow_projects';
	}

	/**
	 * Placements table name.
	 *
	 * @return string
	 */
	public static function placements_table() {
		global $wpdb;
		return $wpdb->prefix . 'sceneflow_placements';
	}

	/**
	 * Creates / upgrades tables. Safe to call repeatedly.
	 */
	public static function install() {
		global $wpdb;
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		$charset  = $wpdb->get_charset_collate();
		$projects = self::projects_table();
		$places   = self::placements_table();

		dbDelta(
			"CREATE TABLE {$projects} (
				project_id varchar(64) NOT NULL,
				name varchar(190) NOT NULL DEFAULT '',
				version int(10) unsigned NOT NULL DEFAULT 1,
				checksum char(64) NOT NULL DEFAULT '',
				config_json longtext NOT NULL,
				published_at datetime NOT NULL,
				PRIMARY KEY  (project_id)
			) {$charset};"
		);
		dbDelta(
			"CREATE TABLE {$places} (
				id varchar(64) NOT NULL,
				project_id varchar(64) NOT NULL,
				post_id bigint(20) unsigned NULL,
				path varchar(255) NULL,
				selector varchar(500) NOT NULL,
				mode varchar(16) NOT NULL DEFAULT 'replace',
				created_at datetime NOT NULL,
				PRIMARY KEY  (id),
				KEY project_id (project_id),
				KEY post_id (post_id)
			) {$charset};"
		);
		update_option( 'sceneflow_db_version', self::DB_VERSION );
	}

	/**
	 * Runs install when the schema version changed (e.g. after a plugin update).
	 */
	public static function maybe_upgrade() {
		if ( get_option( 'sceneflow_db_version' ) !== self::DB_VERSION ) {
			self::install();
		}
	}

	/* ---------- projects ---------- */

	/**
	 * Stores (or replaces) a published project.
	 *
	 * @param string $project_id  Project id.
	 * @param string $name        Display name.
	 * @param int    $version     Version number.
	 * @param string $checksum    SHA-256 of the raw config.
	 * @param string $config_json Raw config JSON.
	 * @return bool
	 */
	public static function save_project( $project_id, $name, $version, $checksum, $config_json ) {
		global $wpdb;
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- Custom table; cache is invalidated below.
		$ok = $wpdb->replace(
			self::projects_table(),
			array(
				'project_id'   => $project_id,
				'name'         => $name,
				'version'      => (int) $version,
				'checksum'     => $checksum,
				'config_json'  => $config_json,
				'published_at' => current_time( 'mysql', true ),
			),
			array( '%s', '%s', '%d', '%s', '%s', '%s' )
		);
		wp_cache_delete( 'project_' . $project_id, 'sceneflow' );
		wp_cache_delete( 'projects_all', 'sceneflow' );
		return false !== $ok;
	}

	/**
	 * Fetches a published project.
	 *
	 * @param string $project_id Project id.
	 * @return array|null Row with project_id, name, version, checksum, config_json, published_at.
	 */
	public static function get_project( $project_id ) {
		global $wpdb;
		$cached = wp_cache_get( 'project_' . $project_id, 'sceneflow' );
		if ( false !== $cached ) {
			return $cached ? $cached : null;
		}
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery -- Custom table, cached below.
		$row = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$wpdb->prefix}sceneflow_projects WHERE project_id = %s", $project_id ), ARRAY_A );
		wp_cache_set( 'project_' . $project_id, $row ? $row : 0, 'sceneflow', 300 );
		return $row ? $row : null;
	}

	/**
	 * All published projects (without the heavy config column).
	 *
	 * @return array
	 */
	public static function all_projects() {
		global $wpdb;
		$cached = wp_cache_get( 'projects_all', 'sceneflow' );
		if ( false !== $cached ) {
			return $cached;
		}
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery -- Custom table, cached below.
		$rows = $wpdb->get_results( "SELECT project_id, name, version, published_at FROM {$wpdb->prefix}sceneflow_projects ORDER BY published_at DESC", ARRAY_A );
		$rows = is_array( $rows ) ? $rows : array();
		wp_cache_set( 'projects_all', $rows, 'sceneflow', 300 );
		return $rows;
	}

	/**
	 * Removes a published project and its placements.
	 *
	 * @param string $project_id Project id.
	 */
	public static function delete_project( $project_id ) {
		global $wpdb;
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- Custom table; cache invalidated below.
		$wpdb->delete( self::projects_table(), array( 'project_id' => $project_id ), array( '%s' ) );
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- Custom table; cache invalidated below.
		$wpdb->delete( self::placements_table(), array( 'project_id' => $project_id ), array( '%s' ) );
		wp_cache_delete( 'project_' . $project_id, 'sceneflow' );
		wp_cache_delete( 'projects_all', 'sceneflow' );
		wp_cache_delete( 'placements_all', 'sceneflow' );
	}

	/* ---------- placements ---------- */

	/**
	 * Saves (or replaces) a placement.
	 *
	 * @param array $placement Keys: id, project_id, post_id, path, selector, mode.
	 * @return bool
	 */
	public static function save_placement( $placement ) {
		global $wpdb;
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- Custom table; cache invalidated below.
		$ok = $wpdb->replace(
			self::placements_table(),
			array(
				'id'         => $placement['id'],
				'project_id' => $placement['project_id'],
				'post_id'    => $placement['post_id'] ? (int) $placement['post_id'] : null,
				'path'       => $placement['path'] ? $placement['path'] : null,
				'selector'   => $placement['selector'],
				'mode'       => in_array( $placement['mode'], self::MODES, true ) ? $placement['mode'] : 'replace',
				'created_at' => current_time( 'mysql', true ),
			),
			array( '%s', '%s', '%d', '%s', '%s', '%s', '%s' )
		);
		wp_cache_delete( 'placements_all', 'sceneflow' );
		return false !== $ok;
	}

	/**
	 * All placements.
	 *
	 * @return array
	 */
	public static function all_placements() {
		global $wpdb;
		$cached = wp_cache_get( 'placements_all', 'sceneflow' );
		if ( false !== $cached ) {
			return $cached;
		}
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery -- Custom table, cached below.
		$rows = $wpdb->get_results( "SELECT * FROM {$wpdb->prefix}sceneflow_placements ORDER BY created_at DESC", ARRAY_A );
		$rows = is_array( $rows ) ? $rows : array();
		wp_cache_set( 'placements_all', $rows, 'sceneflow', 300 );
		return $rows;
	}

	/**
	 * Deletes one placement.
	 *
	 * @param string $id Placement id.
	 */
	public static function delete_placement( $id ) {
		global $wpdb;
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- Custom table; cache invalidated below.
		$wpdb->delete( self::placements_table(), array( 'id' => $id ), array( '%s' ) );
		wp_cache_delete( 'placements_all', 'sceneflow' );
	}
}
