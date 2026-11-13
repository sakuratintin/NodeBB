/*
 * 热点速看 —— 左侧栏目入口 + 弹层
 * 数据来自后端 /api/campus/hot（服务器抓取公开资讯源，缓存 10 分钟）
 */
(function () {
	'use strict';

	function el(tag, cls, text) {
		var n = document.createElement(tag);
		if (cls) n.className = cls;
		if (text) n.textContent = text;
		return n;
	}

	function injectNavItem() {
		if (document.getElementById('campus-hot-btn')) return;
		var nav = document.getElementById('main-nav');
		if (!nav) return;

		var li = el('li', 'nav-item');
		li.title = '热点速看';
		li.innerHTML =
			'<a id="campus-hot-btn" class="nav-link navigation-link d-flex gap-2 justify-content-between align-items-center" href="#" aria-label="热点速看">' +
			'<span class="d-flex gap-2 align-items-center">' +
			'<span><i class="fa fa-fire" aria-hidden="true"></i></span>' +
			'<span class="nav-text small visible-open fw-semibold">热点速看</span>' +
			'</span></a>';

		var searchItem = document.getElementById('campus-nav-search');
		if (searchItem && searchItem.parentNode === nav) {
			nav.insertBefore(li, searchItem.nextSibling);
		} else {
			nav.insertBefore(li, nav.firstChild);
		}
	}

	function buildPanel() {
		if (document.getElementById('campus-hot')) return;

		var root = el('div', 'campus-hot');
		root.id = 'campus-hot';
		root.innerHTML =
			'<div class="campus-hot-mask" data-role="mask"></div>' +
			'<div class="campus-hot-card" role="dialog" aria-label="热点速看">' +
			'<div class="campus-hot-header">' +
			'<div><div class="campus-hot-title"><i class="fa fa-fire"></i> 热点速看</div>' +
			'<div class="campus-hot-sub">聚合公开资讯，每 12 小时更新</div></div>' +
			'<div class="campus-hot-actions">' +
			'<button type="button" class="campus-hot-icon-btn" data-role="refresh" title="刷新"><i class="fa fa-rotate"></i></button>' +
			'<button type="button" class="campus-hot-icon-btn" data-role="close" title="关闭"><i class="fa fa-times"></i></button>' +
			'</div></div>' +
			'<div class="campus-hot-tabs" data-role="tabs"></div>' +
			'<div class="campus-hot-list" data-role="list"><div class="campus-hot-loading"><i class="fa fa-spinner fa-spin"></i> 正在抓取…</div></div>' +
			'<div class="campus-hot-summary hidden" data-role="summary"></div>' +
			'<div class="campus-hot-foot">' +
			'<button type="button" class="campus-hot-ai" data-role="ai"><i class="fa fa-wand-magic-sparkles"></i> AI 速读</button>' +
			'<span class="campus-hot-tip">内容来自公开资讯源</span>' +
			'</div></div>';
		document.body.appendChild(root);

		var tabsEl = root.querySelector('[data-role="tabs"]');
		var listEl = root.querySelector('[data-role="list"]');
		var summaryEl = root.querySelector('[data-role="summary"]');
		var current = 'baidu';
		var currentItems = [];

		function renderTabs(sources) {
			if (!sources || !sources.length) return;
			tabsEl.innerHTML = sources.map(function (s) {
				return '<button type="button" class="campus-hot-tab' + (s.id === current ? ' is-active' : '') +
					'" data-source="' + s.id + '">' + s.name + '</button>';
			}).join('');
		}

		function renderItems(items) {
			currentItems = items || [];
			if (!currentItems.length) {
				listEl.innerHTML = '<div class="campus-hot-empty">暂时没抓到内容，换个来源或稍后刷新</div>';
				return;
			}
			listEl.innerHTML = currentItems.map(function (item, i) {
				return '<a class="campus-hot-item" href="' + item.url + '" target="_blank" rel="noopener noreferrer">' +
					'<span class="campus-hot-rank' + (i < 3 ? ' is-top' : '') + '">' + (i + 1) + '</span>' +
					'<span class="campus-hot-text">' + String(item.title).replace(/</g, '&lt;') + '</span>' +
					'</a>';
			}).join('');
		}

		function load(source, force) {
			current = source || current;
			summaryEl.classList.add('hidden');
			summaryEl.innerHTML = '';
			listEl.innerHTML = '<div class="campus-hot-loading"><i class="fa fa-spinner fa-spin"></i> 正在抓取…</div>';
			fetch('/api/campus/hot?source=' + encodeURIComponent(current) + (force ? '&t=' + Date.now() : ''), { credentials: 'same-origin' })
				.then(function (r) { return r.json(); })
				.then(function (d) {
					renderTabs(d.sources);
					renderItems(d.items);
				})
				.catch(function () {
					listEl.innerHTML = '<div class="campus-hot-empty">抓取失败，稍后再试</div>';
				});
		}

		tabsEl.addEventListener('click', function (e) {
			var t = e.target.closest('.campus-hot-tab');
			if (!t) return;
			load(t.getAttribute('data-source'));
		});

		root.querySelector('[data-role="refresh"]').addEventListener('click', function () { load(current, true); });
		root.querySelector('[data-role="close"]').addEventListener('click', function () { root.classList.remove('open'); });
		root.querySelector('[data-role="mask"]').addEventListener('click', function () { root.classList.remove('open'); });

		root.querySelector('[data-role="ai"]').addEventListener('click', function () {
			if (!currentItems.length) return;
			var titles = currentItems.slice(0, 10).map(function (i) { return '- ' + i.title; }).join('\n');
			var csrf = (window.config && window.config.csrf_token) || '';
			summaryEl.classList.remove('hidden');
			summaryEl.innerHTML = '<div class="campus-hot-loading"><i class="fa fa-spinner fa-spin"></i> AI 正在速读…</div>';

			fetch('/api/campus-ai/chat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
				credentials: 'same-origin',
				body: JSON.stringify({
					message: '下面是今天的新闻热点标题，请用 3 条要点总结大家在关注什么，每条不超过 30 字：\n' + titles,
					history: [],
				}),
			}).then(function (r) { return r.json(); }).then(function (d) {
				if (d.error) {
					summaryEl.innerHTML = '<div class="campus-hot-err">' + d.error + '</div>';
				} else {
					summaryEl.innerHTML = '<div class="campus-hot-summary-title"><i class="fa fa-wand-magic-sparkles"></i> AI 速读</div>' +
						'<div class="campus-hot-summary-body">' + String(d.reply || '').replace(/</g, '&lt;').replace(/\n/g, '<br>') + '</div>';
				}
			}).catch(function () {
				summaryEl.innerHTML = '<div class="campus-hot-err">网络不稳定，稍后再试</div>';
			});
		});

		var btn = document.getElementById('campus-hot-btn');
		if (btn) {
			btn.addEventListener('click', function (e) {
				e.preventDefault();
				if (root.classList.contains('open')) {
					root.classList.remove('open');
				} else {
					root.classList.add('open');
					if (!currentItems.length) load(current);
				}
			});
		}

		document.addEventListener('keydown', function (e) {
			if (e.key === 'Escape') root.classList.remove('open');
		});
	}

	function init() {
		try {
			injectNavItem();
			buildPanel();
		} catch (e) {}
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init);
	} else {
		init();
	}

	// 站内无刷新跳转后，导航可能重绘，重新插一次入口
	if (window.jQuery && window.jQuery.fn) {
		window.jQuery(window).on('action:ajaxify.end', function () {
			setTimeout(init, 50);
		});
	}
})();
