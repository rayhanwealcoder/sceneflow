/* SceneFlow WordPress bootstrap: mounts players for shortcodes/blocks and for element placements. */
( function () {
	'use strict';

	function mountContainers( root ) {
		if ( ! window.SceneFlow || ! window.SceneFlow.Player ) {
			return;
		}
		var nodes = ( root || document ).querySelectorAll(
			'[data-sceneflow-id]:not([data-sceneflow-ready])'
		);
		Array.prototype.forEach.call( nodes, function ( node ) {
			node.setAttribute( 'data-sceneflow-ready', '1' );
			/* Commerce goes through the global registry (SceneFlow.commerce): the WooCommerce adapter registers itself when WooCommerce is active. */
			var settings = window.SceneFlowSettings || {};
			var player = new window.SceneFlow.Player( {
				target: node,
				configUrl: node.getAttribute( 'data-sceneflow-config' ),
				/* Anonymous playback analytics; off when the site owner disabled it in Settings → SceneFlow. */
				analytics: false !== settings.analytics,
			} );
			player.init();
			node.sceneflowPlayer = player;
			var evt;
			try {
				evt = new CustomEvent( 'sceneflow:mounted', {
					detail: {
						player: player,
						projectId: node.getAttribute( 'data-sceneflow-id' ),
					},
				} );
			} catch ( e ) {
				evt = document.createEvent( 'CustomEvent' );
				evt.initCustomEvent( 'sceneflow:mounted', true, false, {
					player: player,
				} );
			}
			node.dispatchEvent( evt );
		} );
	}

	/* Placements: put a player into an element picked from SceneFlow. */
	function applyPlacements() {
		var list = window.SceneFlowPlacements;
		if ( ! list || ! list.length ) {
			return;
		}
		list.forEach( function ( p ) {
			if (
				! /^[A-Za-z0-9_-]{1,64}$/.test( String( p.id ) ) ||
				document.querySelector(
					'[data-sceneflow-placement="' + p.id + '"]'
				)
			) {
				return;
			}
			var target;
			try {
				target = document.querySelector( p.selector );
			} catch ( e ) {
				target = null;
			}
			if ( ! target || ! target.parentNode ) {
				return;
			}
			var host = document.createElement( 'div' );
			host.className = 'sceneflow-player sceneflow-placement';
			host.setAttribute( 'data-sceneflow-id', p.projectId );
			host.setAttribute( 'data-sceneflow-config', p.configUrl );
			host.setAttribute( 'data-sceneflow-placement', p.id );
			switch ( p.mode ) {
				case 'before':
					target.parentNode.insertBefore( host, target );
					break;
				case 'after':
					target.parentNode.insertBefore( host, target.nextSibling );
					break;
				case 'prepend':
					target.insertBefore( host, target.firstChild );
					break;
				case 'append':
					target.appendChild( host );
					break;
				default: // replace the element's content
					while ( target.firstChild ) {
						target.removeChild( target.firstChild );
					}
					target.appendChild( host );
			}
		} );
	}

	function init() {
		applyPlacements();
		mountContainers( document );
	}

	if ( document.readyState === 'loading' ) {
		document.addEventListener( 'DOMContentLoaded', init );
	} else {
		init();
	}
	window.sceneflowInit = init;
	/* Bricks calls this after it renders a SceneFlow element in the builder canvas. */
	window.sceneflowBricksInit = init;
} )();
