/* SceneFlow in the Elementor editor: mount the player again every time the widget re-renders. */
( function () {
	'use strict';
	function mount() {
		if ( window.sceneflowInit ) {
			window.sceneflowInit();
		}
	}
	function hook() {
		if (
			window.elementorFrontend &&
			window.elementorFrontend.hooks &&
			window.elementorFrontend.hooks.addAction
		) {
			window.elementorFrontend.hooks.addAction(
				'frontend/element_ready/sceneflow-video.default',
				mount
			);
		}
	}
	if ( window.elementorFrontend && window.elementorFrontend.hooks ) {
		hook();
	} else {
		window.addEventListener( 'elementor/frontend/init', hook );
	}
} )();
