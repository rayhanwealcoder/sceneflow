<?php
/**
 * Validation of published project configs. No WordPress dependencies (unit-tested with plain PHP).
 *
 * @package SceneFlow
 */

defined( 'ABSPATH' ) || exit;

/**
 * Validates a project JSON document before it is stored.
 */
class SceneFlow_Config {

	const MAX_BYTES    = 524288;
	const SCHEMA_MAJOR = 1;

	/**
	 * Validates a raw JSON string.
	 *
	 * @param string $json                Raw JSON.
	 * @param string $expected_project_id Project id the config must declare.
	 * @return array{ok: bool, error?: string, detail?: string, data?: array}
	 */
	public static function validate( $json, $expected_project_id ) {
		if ( ! is_string( $json ) || '' === $json ) {
			return self::error( 'empty_config' );
		}
		if ( strlen( $json ) > self::MAX_BYTES ) {
			return self::error( 'too_large' );
		}
		$data = json_decode( $json, true, 64 );
		if ( ! is_array( $data ) || JSON_ERROR_NONE !== json_last_error() ) {
			return self::error( 'invalid_json' );
		}
		$schema = isset( $data['schemaVersion'] ) ? $data['schemaVersion'] : '';
		if ( ! is_string( $schema ) || ! preg_match( '/^(\d+)\.\d+$/', $schema, $m ) || self::SCHEMA_MAJOR !== (int) $m[1] ) {
			return self::error( 'unsupported_schema' );
		}
		if ( ! isset( $data['projectId'] ) || $data['projectId'] !== $expected_project_id ) {
			return self::error( 'project_mismatch' );
		}
		if ( ! isset( $data['scenes'] ) || ! is_array( $data['scenes'] ) ) {
			return self::error( 'missing_scenes' );
		}
		$unsafe = self::find_unsafe_string( $data );
		if ( null !== $unsafe ) {
			return self::error( 'unsafe_url', $unsafe );
		}
		return array(
			'ok'   => true,
			'data' => $data,
		);
	}

	/**
	 * Decodes a stored config for serving. Objects stay objects: with assoc arrays an empty `{}` (a layer
	 * without styling, an empty override) would be re-encoded as `[]`, which the player's schema rejects.
	 *
	 * @param string $json Raw JSON as published.
	 * @return mixed stdClass tree, or null when the JSON is unreadable.
	 */
	public static function decode_for_output( $json ) {
		$data = json_decode( (string) $json, false, 64 );
		return JSON_ERROR_NONE === json_last_error() ? $data : null;
	}

	/**
	 * Finds the first string that looks like an executable / data URL.
	 *
	 * @param mixed $value Any decoded JSON value.
	 * @param int   $depth Recursion depth.
	 * @return string|null
	 */
	public static function find_unsafe_string( $value, $depth = 0 ) {
		if ( $depth > 64 ) {
			return 'too_deep';
		}
		if ( is_string( $value ) ) {
			return preg_match( '/^\s*(javascript|data|vbscript|file)\s*:/i', $value ) ? $value : null;
		}
		if ( is_array( $value ) ) {
			foreach ( $value as $item ) {
				$found = self::find_unsafe_string( $item, $depth + 1 );
				if ( null !== $found ) {
					return $found;
				}
			}
		}
		return null;
	}

	/**
	 * Project ids are opaque, URL-safe tokens.
	 *
	 * @param mixed $id Candidate.
	 * @return bool
	 */
	public static function is_valid_id( $id ) {
		return is_string( $id ) && 1 === preg_match( '/^[A-Za-z0-9_-]{1,64}$/', $id );
	}

	/**
	 * Hex SHA-256.
	 *
	 * @param mixed $checksum Candidate.
	 * @return bool
	 */
	public static function is_valid_checksum( $checksum ) {
		return is_string( $checksum ) && 1 === preg_match( '/^[a-f0-9]{64}$/', $checksum );
	}

	/**
	 * CSS selectors used for placements: no markup or braces, bounded length.
	 *
	 * @param mixed $selector Candidate.
	 * @return bool
	 */
	public static function is_valid_selector( $selector ) {
		return is_string( $selector ) && '' !== trim( $selector ) && strlen( $selector ) <= 500 && ! preg_match( '/[<{}\r\n]/', $selector );
	}

	/**
	 * A single CSS length such as 720px, 100%, 40rem (used for max-width attributes).
	 *
	 * @param mixed $value Candidate.
	 * @return bool
	 */
	public static function is_valid_css_length( $value ) {
		return is_string( $value ) && 1 === preg_match( '/^\d{1,5}(\.\d{1,3})?(px|%|em|rem|vw|vh|ch)$/', trim( $value ) );
	}

	/**
	 * Error shape.
	 *
	 * @param string $code   Error code.
	 * @param string $detail Optional detail.
	 * @return array
	 */
	private static function error( $code, $detail = '' ) {
		return array(
			'ok'     => false,
			'error'  => $code,
			'detail' => $detail,
		);
	}
}
