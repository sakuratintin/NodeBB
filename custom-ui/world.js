/*
 * 校园论坛 · 「世界」帖子流
 * 展示全站所有「帖子」（不是主题标题），支持 PC 侧栏与手机底部导航入口
 */
(function () {
	'use strict';

	var PANEL_ID = 'campus-world';
	var loading = false;
	var cached = null;
	var cacheTime = 0;
	var CACHE_TTL = 3 * 60 * 1000;

	function relativeTime(ts) {
		var diff = Date.now() - ts;
		var m = Math.floor(diff / 60000);
		if (m < 1) return '刚刚';
		if (m < 60) return m + ' 分钟前';
		var h = Math.floor(m / 60);
		if (h < 24) return h + ' 小时前';
		var d = Math.floor(h / 24);
		if (d < 30) return d + ' 天前';
		return new Date(ts).toLocaleDateString('zh-CN');
	}

	function esc(s) {
		return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
			return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
		});
	}

	function buildPanel() {
		var el = document.createElement('div');
		el.id = PANEL_ID;
		el.className = 'campus-world hidden';
		el.innerHTML =
			'<div class="campus-world-backdrop"></div>' +
			'<section class="campus-world-card" role="dialog" aria-label="世界帖子流">' +
			'  <header class="campus-world-head">' +
			'    <div class="campus-world-title"><i class="fa fa-globe"></i><span>世界</span>' +
			'      <small>全站所有帖子</small></div>' +
			'    <div class="campus-world-actions">' +
			'      <button type="button" class="campus-world-refresh" title="刷新"><i class="fa fa-refresh"></i></button>' +
			'      <button type="button" class="campus-world-close" title="关闭"><i class="fa fa-times"></i></button>' +
			'    </div>' +
			'  </header>' +
			'  <div class="campus-world-list"></div>' +
			'  <footer class="campus-world-foot">最近 24 小时的帖子 · 按时间倒序</footer>' +
			'</section>';
		document.body.appendChild(el);
		return el;
	}

	function ensurePanel() {
		var el = document.getElementById(PANEL_ID);
		return el || buildPanel();
	}

	function renderList(list, posts) {
		if (!posts || !posts.length) {
			list.innerHTML = '<div class="campus-world-empty">还没有帖子，去发第一条吧 🌸</div>';
			return;
		}
		list.innerHTML = posts
			.map(function (p) {
				var user = p.user || {};
				var topic = p.topic || {};
				var cat = p.category || {};
				var avatar = user.picture
					? '<img class="campus-world-avatar" src="' + esc(user.picture) + '" alt="">'
					: '<span class="campus-world-avatar campus-world-avatar-text">' + esc((user.username || '?').slice(0, 1).toUpperCase()) + '</span>';
				var catChip = cat.name
					? '<span class="campus-world-cat" style="--c:' + esc(cat.bgColor || '#f7608a') + '">' + esc(cat.name) + '</span>'
					: '';
				return (
					'<article class="campus-world-post">' +
					'  <div class="campus-world-post-head">' +
					avatar +
					'    <a class="campus-world-user" href="/user/' + esc(user.userslug || '') + '">' + esc(user.username || '匿名') + '</a>' +
					'    <time>' + relativeTime(p.timestamp || Date.now()) + '</time>' +
					catChip +
					'  </div>' +
					'  <div class="campus-world-body">' + (p.content || '') + '</div>' +
					'  <div class="campus-world-post-foot">' +
					'    <a class="campus-world-link" href="' + esc(p.url || '#') + '">' +
					(topic.title ? esc(topic.title) : '查看帖子') + ' <i class="fa fa-angle-right"></i></a>' +
					'  </div>' +
					'</article>'
				);
			})
			.join('');
	}

	function fetchPosts(term) {
		return fetch('/api/recent/posts/' + term, { credentials: 'same-origin' })
			.then(function (r) {
				if (!r.ok) throw new Error('HTTP ' + r.status);
				return r.json();
			})
			.catch(function () {
				return [];
			});
	}

	function load(list, force) {
		if (loading) return;
		if (!force && cached && Date.now() - cacheTime < CACHE_TTL) {
			renderList(list, cached);
			return;
		}
		loading = true;
		list.innerHTML = '<div class="campus-world-loading"><i class="fa fa-spinner fa-spin"></i> 正在加载…</div>';

		fetchPosts('24h').then(function (posts) {
			if (posts && posts.length) return posts;
			return fetchPosts('7d');
		}).then(function (posts) {
			if (!posts || !posts.length) return fetchPosts('30d');
			return posts;
		}).then(function (posts) {
			cached = posts || [];
			cacheTime = Date.now();
			renderList(list, cached);
		}).catch(function () {
			list.innerHTML = '<div class="campus-world-empty">加载失败，请稍后重试</div>';
		}).then(function () {
			loading = false;
		});
	}

	function open() {
		var el = ensurePanel();
		el.classList.remove('hidden');
		document.body.classList.add('campus-world-open');
		load(el.querySelector('.campus-world-list'));
	}

	function close() {
		var el = document.getElementById(PANEL_ID);
		if (!el) return;
		el.classList.add('hidden');
		document.body.classList.remove('campus-world-open');
	}

	function wire(el) {
		el.querySelector('.campus-world-backdrop').addEventListener('click', close);
		el.querySelector('.campus-world-close').addEventListener('click', close);
		el.querySelector('.campus-world-refresh').addEventListener('click', function () {
			load(el.querySelector('.campus-world-list'), true);
		});
		document.addEventListener('keydown', function (e) {
			if (e.key === 'Escape') close();
		});
	}

	// 手机底部导航：补上「世界」和「热点速看」入口
	function addMobileEntries() {
		var bar = document.querySelector('.bottombar .bottombar-nav');
		if (!bar || bar.dataset.campusExtra) return;
		bar.dataset.campusExtra = '1';

		var world = document.createElement('a');
		world.href = '#';
		world.className = 'campus-bar-btn';
		world.title = '世界';
		world.innerHTML = '<i class="fa fa-globe"></i>';
		world.addEventListener('click', function (e) {
			e.preventDefault();
			open();
		});

		var hot = document.createElement('a');
		hot.href = '#';
		hot.className = 'campus-bar-btn';
		hot.title = '热点速看';
		hot.innerHTML = '<i class="fa fa-fire"></i>';
		hot.addEventListener('click', function (e) {
			e.preventDefault();
			var btn = document.getElementById('campus-hot-btn');
			if (btn) btn.click();
		});

		bar.insertBefore(world, bar.firstChild);
		bar.insertBefore(hot, world.nextSibling);
	}

	function bindTriggers() {
		var btn = document.getElementById('campus-nav-world');
		if (btn && !btn.dataset.bound) {
			btn.dataset.bound = '1';
			var link = btn.querySelector('a');
			if (link) link.setAttribute('href', '#');
			btn.addEventListener('click', function (e) {
				e.preventDefault();
				open();
			});
		}
		addMobileEntries();
	}

	function boot() {
		var el = ensurePanel();
		wire(el);
		bindTriggers();
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', boot);
	} else {
		boot();
	}

	if (window.jQuery && window.jQuery.fn) {
		window.jQuery(window).on('action:ajaxify.end', function () {
			try { boot(); } catch (e) {}
		});
		window.jQuery(window).on('action:widgets.loaded', function () {
			try { addMobileEntries(); } catch (e) {}
		});
	}
})();
