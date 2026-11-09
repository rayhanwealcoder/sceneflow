<?php
/**
 * Removes everything SceneFlow stored when the plugin is deleted.
 *
 * @package SceneFlow
 */

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

global $wpdb;

delete_option( 'sceneflow_connection' );
delete_option( 'sceneflow_db_version' );
delete_option( 'sceneflow_app_url' );
delete_transient( 'sceneflow_pairing' );
delete_transient( 'sceneflow_pairing_attempts' );

// Short-lived tokens (previews, element picking, replay nonces) share the sceneflow_ prefix.
// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
$wpdb->query( $wpdb->prepare( "DELETE FROM {$wpdb->options} WHERE option_name LIKE %s OR option_name LIKE %s", $wpdb->esc_like( '_transient_sceneflow_' ) . '%', $wpdb->esc_like( '_transient_timeout_sceneflow_' ) . '%' ) );

// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.DirectDatabaseQuery.SchemaChange
$wpdb->query( 'DROP TABLE IF EXISTS `' . $wpdb->prefix . 'sceneflow_projects`' );
// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.DirectDatabaseQuery.SchemaChange
$wpdb->query( 'DROP TABLE IF EXISTS `' . $wpdb->prefix . 'sceneflow_placements`' );
