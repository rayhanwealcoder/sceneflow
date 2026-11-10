/* SceneFlow WooCommerce adapter: live product data from this site and cart actions through the WooCommerce Store API. */
( function () {
	'use strict';
	var cfg = window.SceneFlowWoo;
	if (
		! cfg ||
		! window.SceneFlow ||
		! window.SceneFlow.commerce ||
		! window.fetch
	) {
		return;
	}
	var nonce = cfg.nonce || '';
	var cartToken = '';
	var primed = null;

	function headers( json ) {
		var h = { Accept: 'application/json' };
		if ( json ) {
			h[ 'Content-Type' ] = 'application/json';
		}
		if ( nonce ) {
			h.Nonce = nonce;
		}
		if ( cartToken ) {
			h[ 'Cart-Token' ] = cartToken;
		}
		return h;
	}

	/* The Store API rotates nonces; remember the latest one (and the cart token) from every response. */
	function remember( res ) {
		var n =
			res.headers.get( 'Nonce' ) ||
			res.headers.get( 'X-WC-Store-API-Nonce' );
		if ( n ) {
			nonce = n;
		}
		var t = res.headers.get( 'Cart-Token' );
		if ( t ) {
			cartToken = t;
		}
		return res;
	}

	function store( path, init ) {
		init = init || {};
		init.credentials = 'same-origin';
		init.headers = headers( !! init.body );
		return fetch( cfg.storeApi + path, init ).then( remember );
	}

	/* Cached pages can carry a stale nonce: fetch the cart once to get a fresh one before mutating. */
	function prime() {
		if ( ! primed ) {
			primed = store( '/cart' )
				.then( function ( res ) {
					return res.json().catch( function () {
						return null;
					} );
				} )
				.catch( function () {
					return null;
				} );
		}
		return primed;
	}

	function readError( res, fallback ) {
		return res
			.json()
			.then( function ( data ) {
				return {
					ok: false,
					message: ( data && data.message ) || fallback,
				};
			} )
			.catch( function () {
				return { ok: false, message: fallback };
			} );
	}

	function notifyCartChanged( cart ) {
		/* Classic mini cart (fragments) and the block mini cart (wp.data store). */
		if ( window.jQuery ) {
			window.jQuery( document.body ).trigger( 'wc_fragment_refresh' );
			window.jQuery( document.body ).trigger( 'added_to_cart' );
		}
		try {
			if (
				window.wp &&
				window.wp.data &&
				window.wp.data.dispatch( 'wc/store/cart' )
			) {
				var d = window.wp.data.dispatch( 'wc/store/cart' );
				if ( cart && d.receiveCart ) {
					d.receiveCart( cart );
				} else if ( d.invalidateResolutionForStore ) {
					d.invalidateResolutionForStore();
				}
			}
		} catch ( e ) {
			/* ignore */
		}
		document.dispatchEvent(
			new CustomEvent( 'sceneflow:cartChanged', {
				detail: { cart: cart },
			} )
		);
	}

	function itemCount( cart ) {
		return cart && typeof cart.items_count === 'number'
			? cart.items_count
			: undefined;
	}

	function addToCart( line ) {
		var id = parseInt(
			line.product.variantId || line.product.productId,
			10
		);
		if ( ! id ) {
			return Promise.resolve( { ok: false, message: cfg.i18n.failed } );
		}
		return prime()
			.then( function () {
				return store( '/cart/add-item', {
					method: 'POST',
					body: JSON.stringify( {
						id: id,
						quantity: line.quantity || 1,
					} ),
				} );
			} )
			.then( function ( res ) {
				if ( ! res.ok ) {
					return readError( res, cfg.i18n.failed );
				}
				return res.json().then( function ( cart ) {
					notifyCartChanged( cart );
					return {
						ok: true,
						message: cfg.i18n.added,
						cartUrl: cfg.cartUrl,
						checkoutUrl: cfg.checkoutUrl,
						itemCount: itemCount( cart ),
					};
				} );
			} )
			.catch( function () {
				return { ok: false, message: cfg.i18n.failed };
			} );
	}

	window.SceneFlow.commerce.register(
		{
			id: 'woocommerce',
			getProduct: function ( ref ) {
				var id = parseInt( ref.productId, 10 );
				if ( ! id ) {
					return Promise.resolve( null );
				}
				return fetch( cfg.productApi + id, {
					credentials: 'same-origin',
					headers: { Accept: 'application/json' },
				} )
					.then( function ( res ) {
						return res.ok ? res.json() : null;
					} )
					.catch( function () {
						return null;
					} );
			},
			addToCart: addToCart,
			buyNow: function ( line ) {
				return addToCart( line ).then( function ( r ) {
					if ( r.ok && cfg.checkoutUrl ) {
						window.location.assign( cfg.checkoutUrl );
						return { ok: true, message: cfg.i18n.checkout };
					}
					return r;
				} );
			},
			viewProduct: function ( ref ) {
				if ( ref.url ) {
					window.location.assign( ref.url );
					return { ok: true };
				}
				return { ok: false, message: cfg.i18n.failed };
			},
			openCart: function () {
				if ( cfg.cartUrl ) {
					window.location.assign( cfg.cartUrl );
				}
				return { ok: !! cfg.cartUrl };
			},
			openCheckout: function () {
				if ( cfg.checkoutUrl ) {
					window.location.assign( cfg.checkoutUrl );
				}
				return { ok: !! cfg.checkoutUrl };
			},
			applyCoupon: function ( code ) {
				return prime()
					.then( function () {
						return store( '/cart/apply-coupon', {
							method: 'POST',
							body: JSON.stringify( { code: code } ),
						} );
					} )
					.then( function ( res ) {
						if ( ! res.ok ) {
							return readError( res, cfg.i18n.failed );
						}
						return res.json().then( function ( cart ) {
							notifyCartChanged( cart );
							return {
								ok: true,
								message: cfg.i18n.coupon,
								cartUrl: cfg.cartUrl,
								itemCount: itemCount( cart ),
							};
						} );
					} )
					.catch( function () {
						return { ok: false, message: cfg.i18n.failed };
					} );
			},
		},
		{ default: true }
	);
} )();
