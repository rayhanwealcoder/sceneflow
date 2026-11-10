<?php
/**
 * Settings → SceneFlow: one-click connect, pairing code fallback and an overview of what is published here.
 *
 * @package SceneFlow
 */

defined( 'ABSPATH' ) || exit;

/**
 * Admin screen.
 */
class SceneFlow_Admin {

	/**
	 * Hooks.
	 */
	public function init() {
		add_action( 'admin_menu', array( $this, 'menu' ) );
		add_action( 'admin_post_sceneflow_connect', array( $this, 'handle_connect' ) );
		add_action( 'admin_post_sceneflow_pairing', array( $this, 'handle_pairing' ) );
		add_action( 'admin_post_sceneflow_disconnect', array( $this, 'handle_disconnect' ) );
		add_action( 'admin_post_sceneflow_app_url', array( $this, 'handle_app_url' ) );
		add_action( 'admin_post_sceneflow_analytics', array( $this, 'handle_analytics' ) );
		add_filter( 'plugin_action_links_' . plugin_basename( SCENEFLOW_FILE ), array( $this, 'action_links' ) );
		add_action( 'admin_init', array( $this, 'privacy_policy' ) );
	}

	/**
	 * Suggested text for Settings → Privacy (what the plugin sends where, and that analytics is opt-in).
	 */
	public function privacy_policy() {
		if ( ! function_exists( 'wp_add_privacy_policy_content' ) ) {
			return;
		}
		$text  = '<p>' . esc_html__( 'Interactive videos on this site are provided by SceneFlow. Video files and images are loaded from SceneFlow’s media storage when a video plays; your browser’s IP address is visible to that storage service like to any web server.', 'sceneflow' ) . '</p>';
		$text .= '<p>' . esc_html__( 'If the site owner has turned on playback analytics, the player sends anonymous events (video loaded, played, how far it was watched, clicks on buttons and products) with the page address, a device class and a random per-tab id to SceneFlow. No cookies are set, no IP address or personal data is stored, and browsers that send “Do Not Track” or Global Privacy Control are not counted.', 'sceneflow' ) . '</p>';
		$text .= '<p>' . esc_html__( 'Adding a product to the cart from a video uses this shop’s own cart; nothing about the order is sent to SceneFlow.', 'sceneflow' ) . '</p>';
		wp_add_privacy_policy_content( 'SceneFlow', wp_kses_post( $text ) );
	}

	/**
	 * Lets wp_safe_redirect() send the admin to the SceneFlow app (one-click connect) and nowhere else.
	 *
	 * @param array $hosts Allowed hosts.
	 * @return array
	 */
	public function allow_app_host( $hosts ) {
		$host = SceneFlow_Settings::app_host();
		if ( '' !== $host ) {
			$hosts[] = $host;
		}
		return $hosts;
	}

	/**
	 * Turns anonymous playback analytics on or off for players on this site.
	 */
	public function handle_analytics() {
		$this->guard( 'sceneflow_analytics' );
		SceneFlow_Settings::save_analytics( ! empty( $_POST['sceneflow_analytics'] ) ); // phpcs:ignore WordPress.Security.NonceVerification.Missing -- Nonce verified in guard().
		wp_safe_redirect( admin_url( 'options-general.php?page=sceneflow&saved=1' ) );
		exit;
	}

	/**
	 * Adds the settings page.
	 */
	public function menu() {
		add_options_page( __( 'SceneFlow', 'sceneflow' ), __( 'SceneFlow', 'sceneflow' ), 'manage_options', 'sceneflow', array( $this, 'render' ) );
	}

	/**
	 * "Settings" link on the plugins screen.
	 *
	 * @param array $links Existing links.
	 * @return array
	 */
	public function action_links( $links ) {
		array_unshift( $links, '<a href="' . esc_url( admin_url( 'options-general.php?page=sceneflow' ) ) . '">' . esc_html__( 'Settings', 'sceneflow' ) . '</a>' );
		return $links;
	}

	/**
	 * Guards every admin-post handler: capability + nonce.
	 *
	 * @param string $action Nonce action.
	 */
	private function guard( $action ) {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'You are not allowed to do that.', 'sceneflow' ), '', array( 'response' => 403 ) );
		}
		check_admin_referer( $action );
	}

	/**
	 * One-click connect: sends the admin to the SceneFlow app with a fresh pairing code.
	 */
	public function handle_connect() {
		$this->guard( 'sceneflow_connect' );
		add_filter( 'allowed_redirect_hosts', array( $this, 'allow_app_host' ) );
		wp_safe_redirect( SceneFlow_Settings::connect_url(), 302, 'SceneFlow' );
		exit;
	}

	/**
	 * Generates a pairing code (manual fallback).
	 */
	public function handle_pairing() {
		$this->guard( 'sceneflow_pairing' );
		SceneFlow_Settings::create_pairing_code();
		wp_safe_redirect( admin_url( 'options-general.php?page=sceneflow&paired=0' ) );
		exit;
	}

	/**
	 * Forgets the pairing.
	 */
	public function handle_disconnect() {
		$this->guard( 'sceneflow_disconnect' );
		SceneFlow_Settings::disconnect();
		wp_safe_redirect( admin_url( 'options-general.php?page=sceneflow&disconnected=1' ) );
		exit;
	}

	/**
	 * Saves a custom app URL (advanced).
	 */
	public function handle_app_url() {
		$this->guard( 'sceneflow_app_url' );
		$url = isset( $_POST['sceneflow_app_url'] ) ? sanitize_text_field( wp_unslash( $_POST['sceneflow_app_url'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Missing -- Nonce verified in guard().
		SceneFlow_Settings::save_app_url( $url );
		wp_safe_redirect( admin_url( 'options-general.php?page=sceneflow&saved=1' ) );
		exit;
	}

	/**
	 * Renders the page.
	 */
	public function render() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}
		$connection = SceneFlow_Settings::connection();
		$code       = SceneFlow_Settings::pending_pairing_code();
		$projects   = SceneFlow_Store::all_projects();
		$placements = SceneFlow_Store::all_placements();
		$site_url   = home_url( '/' );
		$app_url    = SceneFlow_Settings::app_url();
		$woo        = SceneFlow_WooCommerce::is_active();
		// phpcs:disable WordPress.Security.NonceVerification.Recommended -- Read-only flags set by our own redirects.
		$just_connected = ! empty( $_GET['sceneflow_connected'] ) && $connection;
		$disconnected   = ! empty( $_GET['disconnected'] );
		$saved          = ! empty( $_GET['saved'] );
		// phpcs:enable
		?>
		<div class="wrap">
			<h1><?php esc_html_e( 'SceneFlow', 'sceneflow' ); ?></h1>

			<?php if ( $just_connected ) : ?>
				<div class="notice notice-success is-dismissible"><p><?php esc_html_e( 'Your site is connected to SceneFlow. Publish a project from the editor and it appears here.', 'sceneflow' ); ?></p></div>
			<?php elseif ( $disconnected ) : ?>
				<div class="notice notice-info is-dismissible"><p><?php esc_html_e( 'Disconnected. Published videos keep working.', 'sceneflow' ); ?></p></div>
			<?php elseif ( $saved ) : ?>
				<div class="notice notice-success is-dismissible"><p><?php esc_html_e( 'Settings saved.', 'sceneflow' ); ?></p></div>
			<?php endif; ?>

			<?php if ( $connection && ! SceneFlow_Settings::analytics_decided() ) : ?>
				<div class="card" style="max-width:720px;border-left:4px solid #2271b1" id="sceneflow-analytics-question">
					<h2 style="margin-top:0"><?php esc_html_e( 'See how your videos perform?', 'sceneflow' ); ?></h2>
					<p><?php esc_html_e( 'SceneFlow can show loads, plays, how far people watch and which buttons and products they click. For that, players on this site send anonymous events to SceneFlow: no cookies, no IP addresses, and visitors with “Do Not Track” are not counted. It stays off unless you turn it on, and you can change it any time under Advanced.', 'sceneflow' ); ?></p>
					<div style="display:flex;gap:8px;flex-wrap:wrap">
						<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
							<input type="hidden" name="action" value="sceneflow_analytics">
							<input type="hidden" name="sceneflow_analytics" value="1">
							<?php wp_nonce_field( 'sceneflow_analytics' ); ?>
							<?php submit_button( __( 'Turn on analytics', 'sceneflow' ), 'primary', 'submit', false ); ?>
						</form>
						<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
							<input type="hidden" name="action" value="sceneflow_analytics">
							<?php wp_nonce_field( 'sceneflow_analytics' ); ?>
							<?php submit_button( __( 'No thanks', 'sceneflow' ), 'secondary', 'submit', false ); ?>
						</form>
					</div>
				</div>
			<?php endif; ?>

			<?php if ( $connection ) : ?>
				<div class="card" style="max-width:720px">
					<h2 style="margin-top:0"><?php esc_html_e( 'Connected', 'sceneflow' ); ?> <span class="dashicons dashicons-yes-alt" style="color:#00a32a"></span></h2>
					<p>
						<?php
						printf(
							/* translators: 1: cloud URL, 2: date */
							esc_html__( 'Connected to %1$s since %2$s.', 'sceneflow' ),
							'<code>' . esc_html( $connection['saas_url'] ) . '</code>',
							esc_html( wp_date( get_option( 'date_format' ), (int) $connection['connected_at'] ) )
						);
						?>
						<?php if ( $woo ) : ?>
							<br><?php esc_html_e( 'WooCommerce detected: products from this store can be added to videos and bought from the player.', 'sceneflow' ); ?>
						<?php endif; ?>
					</p>
					<p>
						<a class="button button-primary" href="<?php echo esc_url( $app_url . '/projects' ); ?>" target="_blank" rel="noopener"><?php esc_html_e( 'Open SceneFlow', 'sceneflow' ); ?></a>
					</p>
					<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" style="margin:12px 0 0">
						<input type="hidden" name="action" value="sceneflow_disconnect">
						<?php wp_nonce_field( 'sceneflow_disconnect' ); ?>
						<?php submit_button( __( 'Disconnect this site', 'sceneflow' ), 'link-delete', 'submit', false ); ?>
						<p class="description"><?php esc_html_e( 'Published videos keep working after disconnecting; you just cannot publish new versions until you connect again.', 'sceneflow' ); ?></p>
					</form>
				</div>
			<?php else : ?>
				<div class="card" style="max-width:720px">
					<h2 style="margin-top:0"><?php esc_html_e( 'Connect this site to SceneFlow', 'sceneflow' ); ?></h2>
					<p><?php esc_html_e( 'One click: you will be asked to sign in to SceneFlow (or create a free account), approve the connection and you come straight back here.', 'sceneflow' ); ?></p>
					<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
						<input type="hidden" name="action" value="sceneflow_connect">
						<?php wp_nonce_field( 'sceneflow_connect' ); ?>
						<?php submit_button( __( 'Connect with SceneFlow', 'sceneflow' ), 'primary large', 'submit', false ); ?>
					</form>
					<details style="margin-top:16px">
						<summary><?php esc_html_e( 'Connect with a pairing code instead', 'sceneflow' ); ?></summary>
						<ol style="margin-top:8px">
							<li><?php esc_html_e( 'Click “Generate pairing code” below.', 'sceneflow' ); ?></li>
							<li><?php esc_html_e( 'In SceneFlow, open Projects → WordPress sites → Connect a site.', 'sceneflow' ); ?></li>
							<li>
								<?php
								printf(
									/* translators: %s: site URL */
									esc_html__( 'Enter this site’s address (%s) and the code.', 'sceneflow' ),
									'<code>' . esc_html( $site_url ) . '</code>'
								);
								?>
							</li>
						</ol>
						<?php if ( $code ) : ?>
							<p style="font-size:28px;letter-spacing:6px;font-weight:700;margin:8px 0"><code style="font-size:inherit"><?php echo esc_html( substr( $code, 0, 4 ) . '-' . substr( $code, 4 ) ); ?></code></p>
							<p class="description"><?php esc_html_e( 'Valid for 10 minutes and usable once.', 'sceneflow' ); ?></p>
						<?php endif; ?>
						<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
							<input type="hidden" name="action" value="sceneflow_pairing">
							<?php wp_nonce_field( 'sceneflow_pairing' ); ?>
							<?php submit_button( $code ? __( 'Generate a new code', 'sceneflow' ) : __( 'Generate pairing code', 'sceneflow' ), 'secondary', 'submit', false ); ?>
						</form>
					</details>
				</div>
			<?php endif; ?>

			<h2 style="margin-top:32px"><?php esc_html_e( 'Published on this site', 'sceneflow' ); ?></h2>
			<?php if ( empty( $projects ) ) : ?>
				<p class="description"><?php esc_html_e( 'Nothing yet. Publish a project from SceneFlow and it will appear here.', 'sceneflow' ); ?></p>
			<?php else : ?>
				<table class="widefat striped" style="max-width:900px">
					<thead><tr><th><?php esc_html_e( 'Project', 'sceneflow' ); ?></th><th><?php esc_html_e( 'Version', 'sceneflow' ); ?></th><th><?php esc_html_e( 'Shortcode', 'sceneflow' ); ?></th><th><?php esc_html_e( 'Published', 'sceneflow' ); ?></th><th></th></tr></thead>
					<tbody>
					<?php foreach ( $projects as $p ) : ?>
						<tr>
							<td><?php echo esc_html( $p['name'] ? $p['name'] : $p['project_id'] ); ?></td>
							<td>v<?php echo esc_html( $p['version'] ); ?></td>
							<td><code>[sceneflow id="<?php echo esc_attr( $p['project_id'] ); ?>"]</code></td>
							<td><?php echo esc_html( get_date_from_gmt( $p['published_at'], get_option( 'date_format' ) . ' ' . get_option( 'time_format' ) ) ); ?></td>
							<td><a href="<?php echo esc_url( $app_url . '/projects/' . rawurlencode( $p['project_id'] ) . '/editor' ); ?>" target="_blank" rel="noopener"><?php esc_html_e( 'Edit in SceneFlow', 'sceneflow' ); ?></a></td>
						</tr>
					<?php endforeach; ?>
					</tbody>
				</table>
				<p class="description" style="margin-top:8px"><?php esc_html_e( 'Use the shortcode or the “SceneFlow Video” block anywhere, or place a player on an existing element from SceneFlow (Projects → Place on your site).', 'sceneflow' ); ?></p>
			<?php endif; ?>

			<?php if ( ! empty( $placements ) ) : ?>
				<h2 style="margin-top:24px"><?php esc_html_e( 'Element placements', 'sceneflow' ); ?></h2>
				<table class="widefat striped" style="max-width:900px">
					<thead><tr><th><?php esc_html_e( 'Project', 'sceneflow' ); ?></th><th><?php esc_html_e( 'Page', 'sceneflow' ); ?></th><th><?php esc_html_e( 'Element', 'sceneflow' ); ?></th><th><?php esc_html_e( 'Mode', 'sceneflow' ); ?></th></tr></thead>
					<tbody>
					<?php foreach ( $placements as $pl ) : ?>
						<tr>
							<td><?php echo esc_html( $pl['project_id'] ); ?></td>
							<td><?php echo esc_html( $pl['post_id'] ? get_the_title( (int) $pl['post_id'] ) : $pl['path'] ); ?></td>
							<td><code><?php echo esc_html( $pl['selector'] ); ?></code></td>
							<td><?php echo esc_html( $pl['mode'] ); ?></td>
						</tr>
					<?php endforeach; ?>
					</tbody>
				</table>
			<?php endif; ?>

			<details style="margin-top:32px;max-width:720px">
				<summary><?php esc_html_e( 'Advanced', 'sceneflow' ); ?></summary>
				<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" style="margin-top:8px">
					<input type="hidden" name="action" value="sceneflow_app_url">
					<?php wp_nonce_field( 'sceneflow_app_url' ); ?>
					<label for="sceneflow_app_url"><?php esc_html_e( 'SceneFlow app URL', 'sceneflow' ); ?></label><br>
					<input type="url" class="regular-text" id="sceneflow_app_url" name="sceneflow_app_url" value="<?php echo esc_attr( (string) get_option( SceneFlow_Settings::APP_URL_OPTION, '' ) ); ?>" placeholder="<?php echo esc_attr( SCENEFLOW_APP_URL ); ?>">
					<?php submit_button( __( 'Save', 'sceneflow' ), 'secondary', 'submit', false ); ?>
					<p class="description"><?php esc_html_e( 'Only for self-hosted or staging SceneFlow installs. Leave empty to use the default.', 'sceneflow' ); ?></p>
				</form>
				<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" style="margin-top:16px">
					<input type="hidden" name="action" value="sceneflow_analytics">
					<?php wp_nonce_field( 'sceneflow_analytics' ); ?>
					<label>
						<input type="checkbox" name="sceneflow_analytics" value="1" <?php checked( SceneFlow_Settings::analytics_enabled() ); ?>>
						<?php esc_html_e( 'Send anonymous playback analytics to SceneFlow (loads, plays, clicks — no cookies, no IP addresses, honours Do Not Track). Off unless you turn it on.', 'sceneflow' ); ?>
					</label>
					<?php submit_button( __( 'Save', 'sceneflow' ), 'secondary', 'submit', false ); ?>
					<p class="description"><?php esc_html_e( 'Powers the Analytics page of each video in SceneFlow. Turn it off if your privacy policy does not cover it.', 'sceneflow' ); ?></p>
				</form>
			</details>
		</div>
		<?php
	}
}
