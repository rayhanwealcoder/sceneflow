<?php
/**
 * HMAC request signing shared with the SceneFlow cloud (mirror of packages/server/src/connector.ts).
 *
 * Canonical string: METHOD \n ROUTE \n TIMESTAMP \n NONCE \n sha256hex(BODY)
 * Signature: hex(hmac_sha256(secret, canonical))
 *
 * This class has no WordPress dependencies so it can be unit-tested with plain PHP.
 *
 * @package SceneFlow
 */

defined( 'ABSPATH' ) || exit;

/**
 * Builds and verifies connector signatures.
 */
class SceneFlow_Signature {

	/**
	 * Maximum clock skew accepted, in seconds.
	 */
	const MAX_SKEW = 300;

	/**
	 * Canonical string that gets signed.
	 *
	 * @param string     $method    HTTP method.
	 * @param string     $route     REST route, e.g. /sceneflow/v1/publish.
	 * @param int|string $timestamp Unix seconds.
	 * @param string     $nonce     Random nonce.
	 * @param string     $body      Raw request body.
	 * @return string
	 */
	public static function canonical( $method, $route, $timestamp, $nonce, $body ) {
		return strtoupper( (string) $method ) . "\n" . (string) $route . "\n" . (string) $timestamp . "\n" . (string) $nonce . "\n" . hash( 'sha256', (string) $body );
	}

	/**
	 * Signs a request.
	 *
	 * @param string     $secret    Shared secret.
	 * @param string     $method    HTTP method.
	 * @param string     $route     REST route.
	 * @param int|string $timestamp Unix seconds.
	 * @param string     $nonce     Nonce.
	 * @param string     $body      Raw body.
	 * @return string Hex signature.
	 */
	public static function sign( $secret, $method, $route, $timestamp, $nonce, $body ) {
		return hash_hmac( 'sha256', self::canonical( $method, $route, $timestamp, $nonce, $body ), (string) $secret );
	}

	/**
	 * Whether a timestamp is within the accepted skew.
	 *
	 * @param mixed    $timestamp Timestamp from the request.
	 * @param int|null $now       Current time (injectable for tests).
	 * @return bool
	 */
	public static function is_fresh( $timestamp, $now = null ) {
		if ( ! is_numeric( $timestamp ) ) {
			return false;
		}
		$now = null === $now ? time() : (int) $now;
		return abs( $now - (int) $timestamp ) <= self::MAX_SKEW;
	}

	/**
	 * Verifies a signature. Does not check nonce reuse; callers must do that with storage.
	 *
	 * @param string   $secret    Shared secret.
	 * @param string   $method    HTTP method.
	 * @param string   $route     REST route.
	 * @param mixed    $timestamp Timestamp header.
	 * @param mixed    $nonce     Nonce header.
	 * @param string   $body      Raw body.
	 * @param mixed    $signature Signature header.
	 * @param int|null $now       Current time (injectable for tests).
	 * @return array{ok: bool, error?: string}
	 */
	public static function verify( $secret, $method, $route, $timestamp, $nonce, $body, $signature, $now = null ) {
		if ( ! is_string( $signature ) || ! preg_match( '/^[a-f0-9]{64}$/', $signature ) ) {
			return array(
				'ok'    => false,
				'error' => 'invalid_signature',
			);
		}
		if ( ! self::is_fresh( $timestamp, $now ) ) {
			return array(
				'ok'    => false,
				'error' => 'stale_timestamp',
			);
		}
		if ( ! is_string( $nonce ) || ! preg_match( '/^[A-Za-z0-9_-]{16,64}$/', $nonce ) ) {
			return array(
				'ok'    => false,
				'error' => 'invalid_nonce',
			);
		}
		if ( ! is_string( $secret ) || '' === $secret ) {
			return array(
				'ok'    => false,
				'error' => 'not_connected',
			);
		}
		$expected = self::sign( $secret, $method, $route, (int) $timestamp, $nonce, $body );
		if ( ! hash_equals( $expected, $signature ) ) {
			return array(
				'ok'    => false,
				'error' => 'bad_signature',
			);
		}
		return array( 'ok' => true );
	}
}
