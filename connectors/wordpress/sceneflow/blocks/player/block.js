/* global wp */
( function () {
	var el = wp.element.createElement;
	var useState = wp.element.useState;
	var useEffect = wp.element.useEffect;
	var __ = wp.i18n.__;
	var InspectorControls = wp.blockEditor.InspectorControls;
	var useBlockProps = wp.blockEditor.useBlockProps;
	var PanelBody = wp.components.PanelBody;
	var SelectControl = wp.components.SelectControl;
	var TextControl = wp.components.TextControl;
	var Placeholder = wp.components.Placeholder;
	var Spinner = wp.components.Spinner;

	function useProjects() {
		var state = useState( { loading: true, items: [] } );
		useEffect( function () {
			var alive = true;
			wp.apiFetch( { path: '/sceneflow/v1/projects' } )
				.then( function ( r ) {
					if ( alive ) state[ 1 ]( { loading: false, items: ( r && r.projects ) || [] } );
				} )
				.catch( function () {
					if ( alive ) state[ 1 ]( { loading: false, items: [] } );
				} );
			return function () {
				alive = false;
			};
		}, [] );
		return state[ 0 ];
	}

	wp.blocks.registerBlockType( 'sceneflow/player', {
		edit: function ( props ) {
			var attrs = props.attributes;
			var projects = useProjects();
			var options = [ { value: '', label: __( 'Choose a published project…', 'sceneflow' ) } ].concat(
				projects.items.map( function ( p ) {
					return { value: p.project_id, label: ( p.name || p.project_id ) + ' (v' + p.version + ')' };
				} )
			);
			var current = projects.items.filter( function ( p ) {
				return p.project_id === attrs.projectId;
			} )[ 0 ];
			var blockProps = useBlockProps( { style: { maxWidth: attrs.maxWidth || undefined } } );

			return el(
				'div',
				blockProps,
				el(
					InspectorControls,
					null,
					el(
						PanelBody,
						{ title: __( 'SceneFlow project', 'sceneflow' ), initialOpen: true },
						projects.loading
							? el( Spinner )
							: el( SelectControl, {
									label: __( 'Published project', 'sceneflow' ),
									value: attrs.projectId,
									options: options,
									onChange: function ( v ) {
										props.setAttributes( { projectId: v } );
									},
							  } ),
						el( TextControl, {
							label: __( 'Project ID (advanced)', 'sceneflow' ),
							value: attrs.projectId,
							onChange: function ( v ) {
								props.setAttributes( { projectId: v } );
							},
							help: __( 'Paste an ID from SceneFlow if the project is not listed yet.', 'sceneflow' ),
						} ),
						el( TextControl, {
							label: __( 'Max width (CSS)', 'sceneflow' ),
							value: attrs.maxWidth,
							placeholder: '720px',
							onChange: function ( v ) {
								props.setAttributes( { maxWidth: v } );
							},
						} )
					)
				),
				el(
					Placeholder,
					{ icon: 'video-alt3', label: __( 'SceneFlow Video', 'sceneflow' ), instructions: attrs.projectId ? '' : __( 'Pick a published project in the block settings.', 'sceneflow' ) },
					attrs.projectId
						? el(
								'p',
								{ style: { margin: 0 } },
								( current ? current.name + ' · v' + current.version : attrs.projectId ) + ' — ' + __( 'the interactive player renders on the live page.', 'sceneflow' )
						  )
						: null
				)
			);
		},
		save: function () {
			return null;
		},
	} );
} )();
