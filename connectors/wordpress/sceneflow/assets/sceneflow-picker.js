/* SceneFlow element picker: hover to highlight, click to choose; posts the CSS selector to the SceneFlow app. */
( function () {
	'use strict';
	var cfg = window.SceneFlowPick;
	/* The token and page details only ever go to the connected SceneFlow app: no origin, no picker. */
	if ( ! cfg || ! cfg.origin || ! /^https?:\/\/[^/]+$/.test( cfg.origin ) ) {
		return;
	}

	var box = document.createElement( 'div' );
	box.setAttribute( 'data-sceneflow-ui', '1' );
	box.style.cssText =
		'position:fixed;z-index:2147483646;pointer-events:none;border:2px solid #4f46e5;background:rgba(79,70,229,.12);border-radius:4px;transition:all .06s;display:none';
	var label = document.createElement( 'div' );
	label.setAttribute( 'data-sceneflow-ui', '1' );
	label.style.cssText =
		'position:fixed;z-index:2147483647;pointer-events:none;background:#111;color:#fff;font:12px/1.4 system-ui,sans-serif;padding:3px 8px;border-radius:4px;display:none;max-width:60vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
	var bar = document.createElement( 'div' );
	bar.setAttribute( 'data-sceneflow-ui', '1' );
	bar.style.cssText =
		'position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:2147483647;background:#111;color:#fff;font:14px/1.4 system-ui,sans-serif;padding:10px 14px;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.35);display:flex;gap:12px;align-items:center';
	function setBar( before, code, after ) {
		while ( bar.firstChild ) {
			bar.removeChild( bar.firstChild );
		}
		var span = document.createElement( 'span' );
		span.appendChild( document.createTextNode( before ) );
		if ( code ) {
			var c = document.createElement( 'code' );
			c.style.cssText =
				'background:#333;padding:1px 6px;border-radius:4px';
			c.textContent = code;
			span.appendChild( c );
		}
		if ( after ) {
			span.appendChild( document.createTextNode( after ) );
		}
		bar.appendChild( span );
	}
	var i18n = cfg.i18n || {};
	setBar(
		i18n.start ||
			'Click the element where the video should go. Esc cancels.',
		'',
		''
	);
	document.body.appendChild( box );
	document.body.appendChild( label );
	document.body.appendChild( bar );

	var STABLE_CLASS =
		/^(?!wp-|is-|has-|js-|active|current|hover|focus|open|show|hide|sceneflow)[a-zA-Z][a-zA-Z0-9_-]*$/;
	var looksGenerated = /\d{3,}|--|__|^(css|sc|jsx|emotion|chakra|mui)-/;

	function stableClasses( el ) {
		return Array.prototype.filter
			.call( el.classList, function ( c ) {
				return STABLE_CLASS.test( c ) && ! looksGenerated.test( c );
			} )
			.slice( 0, 3 );
	}

	function unique( sel ) {
		try {
			return document.querySelectorAll( sel ).length === 1;
		} catch ( e ) {
			return false;
		}
	}

	function segment( el, withNth ) {
		var tag = el.tagName.toLowerCase();
		var classes = stableClasses( el );
		var s = tag + ( classes.length ? '.' + classes.join( '.' ) : '' );
		if ( withNth && el.parentNode ) {
			var sameTag = Array.prototype.filter.call(
				el.parentNode.children,
				function ( c ) {
					return c.tagName === el.tagName;
				}
			);
			if ( sameTag.length > 1 ) {
				s += ':nth-of-type(' + ( sameTag.indexOf( el ) + 1 ) + ')';
			}
		}
		return s;
	}

	/* Prefer a short, human-readable selector; fall back to a nth-of-type path. */
	function cssPath( el ) {
		if (
			el.id &&
			/^[a-zA-Z][\w-]*$/.test( el.id ) &&
			! /\d{4,}/.test( el.id ) &&
			unique( '#' + el.id )
		) {
			return '#' + el.id;
		}
		var parts = [];
		var node = el;
		while (
			node &&
			node.nodeType === 1 &&
			node !== document.body &&
			parts.length < 6
		) {
			var seg = segment( node, false );
			if ( node.id && /^[a-zA-Z][\w-]*$/.test( node.id ) ) {
				parts.unshift( '#' + node.id );
				break;
			}
			parts.unshift( seg );
			var candidate = parts.join( ' > ' );
			if ( unique( candidate ) ) {
				return candidate;
			}
			parts[ 0 ] = segment( node, true );
			candidate = parts.join( ' > ' );
			if ( unique( candidate ) ) {
				return candidate;
			}
			node = node.parentNode;
		}
		var sel = parts.join( ' > ' );
		return unique( sel ) ? sel : 'body > ' + sel;
	}

	function ignore( el ) {
		return (
			! el ||
			el === document.documentElement ||
			el === document.body ||
			el.closest( '[data-sceneflow-ui]' ) ||
			el.closest( '#wpadminbar' )
		);
	}

	function describe( el ) {
		var text = ( el.textContent || '' )
			.trim()
			.replace( /\s+/g, ' ' )
			.slice( 0, 60 );
		return (
			el.tagName.toLowerCase() +
			( el.id ? '#' + el.id : '' ) +
			( text ? ' — “' + text + '”' : '' )
		);
	}

	var hovered = null;
	function onMove( e ) {
		var el = document.elementFromPoint( e.clientX, e.clientY );
		if ( ignore( el ) ) {
			box.style.display = 'none';
			label.style.display = 'none';
			hovered = null;
			return;
		}
		hovered = el;
		var r = el.getBoundingClientRect();
		box.style.display = 'block';
		box.style.left = r.left + 'px';
		box.style.top = r.top + 'px';
		box.style.width = r.width + 'px';
		box.style.height = r.height + 'px';
		label.style.display = 'block';
		label.textContent = describe( el );
		label.style.left = Math.min( r.left, window.innerWidth - 300 ) + 'px';
		label.style.top = ( r.top > 28 ? r.top - 26 : r.bottom + 4 ) + 'px';
	}

	function post( msg ) {
		if ( window.parent && window.parent !== window ) {
			try {
				window.parent.postMessage( msg, cfg.origin );
			} catch ( e ) {
				/* ignore */
			}
		}
	}

	function onClick( e ) {
		var el = document.elementFromPoint( e.clientX, e.clientY );
		if ( ignore( el ) ) {
			return;
		}
		e.preventDefault();
		e.stopPropagation();
		var selector = cssPath( el );
		var r = el.getBoundingClientRect();
		post( {
			type: 'sceneflow:pick',
			token: cfg.token,
			selector: selector,
			tag: el.tagName.toLowerCase(),
			description: describe( el ),
			rect: {
				width: Math.round( r.width ),
				height: Math.round( r.height ),
			},
			path: cfg.path,
			postId: cfg.postId,
			pageUrl: location.href.split( '?' )[ 0 ],
			pageTitle: document.title,
		} );
		setBar(
			( i18n.selected || 'Selected' ) + ' ',
			selector,
			' — ' +
				( i18n.finish ||
					'finish in SceneFlow, or click another element.' )
		);
	}

	function onKey( e ) {
		if ( e.key === 'Escape' ) {
			post( { type: 'sceneflow:cancel', token: cfg.token } );
		}
	}

	/* Block navigation and form submits while picking. */
	document.addEventListener( 'click', onClick, true );
	document.addEventListener(
		'submit',
		function ( e ) {
			e.preventDefault();
		},
		true
	);
	document.addEventListener( 'mousemove', onMove, true );
	document.addEventListener( 'keydown', onKey, true );
	post( {
		type: 'sceneflow:ready',
		token: cfg.token,
		pageUrl: location.href.split( '?' )[ 0 ],
		pageTitle: document.title,
		path: cfg.path,
		postId: cfg.postId,
	} );
} )();
