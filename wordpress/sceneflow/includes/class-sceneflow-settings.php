<?php
/**
 * Connection settings and pairing codes.
 *
 * @package SceneFlow
 */

defined( 'ABSPATH' ) || exit;

/**
 * Stores the pairing with the SceneFlow cloud.
 */
class SceneFlow_Settings {

	const OPTION          = 'sceneflow_connection';
	const APP_URL_OPTION  = 'sceneflow_app_url';
	const PAIRING_TTL     = 600;
	const PAIRING_MAX_TRY = 10;

	/**
	 * URL of the SceneFlow web app used for one-click connect: option → SCENEFLOW_APP_URL constant.
	 * Filter `sceneflow_app_url` for staging / self-hosted setups.
	 *
	 * @return string Without trailing slash.
	 */
	public static function app_url() {
		$url = (string) get_option( self::APP_URL_OPTION, '' );
		if ( '' === $url ) {
			$url = SCENEFLOW_APP_URL;
		}
		return untrailingslashit( esc_url_raw( (string) apply_filters( 'sceneflow_app_url', $url ) ) );
	}

	/**
	 * Stores a custom app URL ('' resets to the default).
	 *
	 * @param string $url URL or ''.
	 */
	public static function save_app_url( $url ) {
		$url = esc_url_raw( trim( (string) $url ) );
		if ( '' === $url || ! preg_match( '#^https?://#i', $url ) ) {
			delete_option( self::APP_URL_OPTION );
			return;
		}
		update_option( self::APP_URL_OPTION, untrailingslashit( $url ), false );
	}

	/**
	 * One-click connect: creates a pairing code and builds the app URL the admin is sent to.
	 * The code is single-use and expires in 10 minutes; the app posts it back to /connect together with the credentials.
	 *
	 * @return string
	 */
	public static function connect_url() {
		$code = self::create_pairing_code();
		return add_query_arg(
			array(
				'site'   => rawurlencode( home_url( '/' ) ),
				'code'   => $code,
				'name'   => rawurlencode( get_bloginfo( 'name' ) ),
				'return' => rawurlencode( admin_url( 'options-general.php?page=sceneflow' ) ),
			),
			self::app_url() . '/connect'
		);
	}

	/**
	 * Current connection or null.
	 *
	 * @return array|null Keys: site_id, saas_url, app_url, connected_at.
	 */
	public static function connection() {
		$c = get_option( self::OPTION );
		return is_array( $c ) && ! empty( $c['site_id'] ) ? $c : null;
	}

	/**
	 * Whether the site is paired.
	 *
	 * @return bool
	 */
	public static function is_connected() {
		return null !== self::connection();
	}

	/**
	 * Stored site id (assigned by the cloud).
	 *
	 * @return string
	 */
	public static function site_id() {
		$c = self::connection();
		return $c ? (string) $c['site_id'] : '';
	}

	/**
	 * Cloud API origin.
	 *
	 * @return string
	 */
	public static function saas_url() {
		$c = self::connection();
		return $c && ! empty( $c['saas_url'] ) ? (string) $c['saas_url'] : '';
	}

	/**
	 * Origin of the SceneFlow web app (receives element-picker messages).
	 *
	 * @return string
	 */
	public static function app_origin() {
		$c   = self::connection();
		$url = $c && ! empty( $c['app_url'] ) ? (string) $c['app_url'] : self::saas_url();
		$p   = wp_parse_url( $url );
		if ( empty( $p['scheme'] ) || empty( $p['host'] ) ) {
			return '';
		}
		return $p['scheme'] . '://' . $p['host'] . ( empty( $p['port'] ) ? '' : ':' . $p['port'] );
	}

	/**
	 * Decrypted shared secret.
	 *
	 * @return string
	 */
	public static function secret() {
		$c = self::connection();
		return $c && ! empty( $c['secret'] ) ? self::decrypt( (string) $c['secret'] ) : '';
	}

	/**
	 * Saves a new pairing.
	 *
	 * @param string $site_id  Site id from the cloud.
	 * @param string $secret   Shared secret from the cloud.
	 * @param string $saas_url Cloud API url.
	 * @param string $app_url  Cloud web app url.
	 */
	public static function save_connection( $site_id, $secret, $saas_url, $app_url ) {
		update_option(
			self::OPTION,
			array(
				'site_id'      => $site_id,
				'secret'       => self::encrypt( $secret ),
				'saas_url'     => $saas_url,
				'app_url'      => $app_url,
				'connected_at' => time(),
			),
			false
		);
	}

	/**
	 * Forgets the pairing.
	 */
	public static function disconnect() {
		delete_option( self::OPTION );
	}

	/* ---------- pairing codes ---------- */

	/**
	 * Creates a one-time pairing code (10 minutes).
	 *
	 * @return string
	 */
	public static function create_pairing_code() {
		$alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
		$code     = '';
		for ( $i = 0; $i < 8; $i++ ) {
			$code .= $alphabet[ wp_rand( 0, strlen( $alphabet ) - 1 ) ];
		}
		set_transient( 'sceneflow_pairing', $code, self::PAIRING_TTL );
		delete_transient( 'sceneflow_pairing_attempts' );
		return $code;
	}

	/**
	 * Code currently waiting to be used (for display in wp-admin).
	 *
	 * @return string
	 */
	public static function pending_pairing_code() {
		$code = get_transient( 'sceneflow_pairing' );
		return is_string( $code ) ? $code : '';
	}

	/**
	 * Consumes a pairing code. Rate limited.
	 *
	 * @param string $code Code sent by the cloud.
	 * @return string '' on success or an error code.
	 */
	public static function consume_pairing_code( $code ) {
		$attempts = (int) get_transient( 'sceneflow_pairing_attempts' );
		if ( $attempts >= self::PAIRING_MAX_TRY ) {
			return 'too_many_attempts';
		}
		set_transient( 'sceneflow_pairing_attempts', $attempts + 1, self::PAIRING_TTL );
		$expected = get_transient( 'sceneflow_pairing' );
		if ( ! is_string( $expected ) || '' === $expected ) {
			return 'no_pairing_code';
		}
		$code = strtoupper( preg_replace( '/[^A-Za-z0-9]/', '', (string) $code ) );
		if ( ! hash_equals( $expected, $code ) ) {
			return 'bad_pairing_code';
		}
		delete_transient( 'sceneflow_pairing' );
		delete_transient( 'sceneflow_pairing_attempts' );
		return '';
	}

	/* ---------- secret at rest ---------- */

	/**
	 * Key derived from the site's auth salt.
	 *
	 * @return string
	 */
	private static function key() {
		return hash( 'sha256', 'sceneflow:' . wp_salt( 'auth' ), true );
	}

	/**
	 * Encrypts with AES-256-CBC when OpenSSL is available.
	 *
	 * @param string $plain Plain text.
	 * @return string
	 */
	private static function encrypt( $plain ) {
		if ( ! function_exists( 'openssl_encrypt' ) ) {
			return 'plain:' . $plain;
		}
		$iv  = random_bytes( 16 );
		$enc = openssl_encrypt( $plain, 'aes-256-cbc', self::key(), OPENSSL_RAW_DATA, $iv );
		if ( false === $enc ) {
			return 'plain:' . $plain;
		}
		return 'aes:' . base64_encode( $iv . $enc ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode -- Binary-safe storage, not obfuscation.
	}

	/**
	 * Reverses encrypt().
	 *
	 * @param string $stored Stored value.
	 * @return string
	 */
	private static function decrypt( $stored ) {
		if ( 0 === strpos( $stored, 'plain:' ) ) {
			return substr( $stored, 6 );
		}
		if ( 0 === strpos( $stored, 'aes:' ) && function_exists( 'openssl_decrypt' ) ) {
			$raw = base64_decode( substr( $stored, 4 ), true ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_decode -- See encrypt().
			if ( false !== $raw && strlen( $raw ) > 16 ) {
				$dec = openssl_decrypt( substr( $raw, 16 ), 'aes-256-cbc', self::key(), OPENSSL_RAW_DATA, substr( $raw, 0, 16 ) );
				return false === $dec ? '' : $dec;
			}
		}
		return '';
	}
}
