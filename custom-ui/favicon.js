/*
 * 论坛图标（浏览器标签 / 手机主屏）
 * 由插件路由 /campus-icon/xxx 直接提供图片，避免把 base64 塞进 JS
 */
(function () {
	'use strict';

	var BASE = '/campus-icon/';

	function setLink(rel, href, sizes) {
		var el = document.querySelector('link[rel="' + rel + '"]');
		if (!el) {
			el = document.createElement('link');
			el.rel = rel;
			document.head.appendChild(el);
		}
		el.type = href.indexOf('.ico') !== -1 ? 'image/x-icon' : 'image/png';
		el.href = href;
		if (sizes) el.setAttribute('sizes', sizes);
	}

	function apply() {
		setLink('icon', BASE + '64', '64x64');
		setLink('shortcut icon', BASE + 'favicon.ico');
		setLink('apple-touch-icon', BASE + '180', '180x180');
		setLink('apple-touch-icon-precomposed', BASE + '180', '180x180');
		setLink('icon', BASE + '192', '192x192');
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', apply);
	} else {
		apply();
	}
})();
