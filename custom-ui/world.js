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
			'  <form class="campus-world-quick">' +
			'    <button type="button" class="campus-world-quick-title-toggle">' +
			'      <i class="fa fa-plus"></i><span>添加标题（可选）</span></button>' +
			'    <input class="campus-world-quick-title hidden" type="text" maxlength="120" placeholder="标题（不填会自动截取正文开头）">' +
			'    <textarea class="campus-world-quick-text" rows="2" maxlength="5000" placeholder="说点什么…"></textarea>' +
			'    <div class="campus-world-quick-row">' +
			'      <select class="campus-world-quick-cid" aria-label="选择版块"></select>' +
			'      <button type="submit" class="campus-world-quick-send"><i class="fa fa-paper-plane"></i> 发布</button>' +
			'    </div>' +
			'  </form>' +
			'  <div class="campus-world-list"></div>' +
			'  <footer class="campus-world-foot">最近 24 小时的帖子 · 按时间倒序</footer>' +
			'</section>';
		document.body.appendChild(el);
		return el;
	}

	function loadCategories(select) {
		if (select.dataset.loaded) return;
		select.dataset.loaded = '1';
		fetch('/api/categories', { credentials: 'same-origin' })
			.then(function (r) { return r.json(); })
			.then(function (data) {
				var list = (data && data.categories) || [];
				var options = [];
				list.forEach(function (c) {
					if (!c || !c.cid) return;
					options.push({ cid: c.cid, name: c.name, depth: 0 });
					(c.children || []).forEach(function (sub) {
						if (sub && sub.cid) options.push({ cid: sub.cid, name: sub.name, depth: 1 });
					});
				});
				select.innerHTML = options
					.map(function (o) {
						return '<option value="' + o.cid + '">' + (o.depth ? '　└ ' : '') + esc(o.name) + '</option>';
					})
					.join('');
				// 默认选「综合讨论」，没有就选第一个
				var def = options.filter(function (o) { return o.name.indexOf('综合') === 0; })[0] || options[0];
				if (def) select.value = String(def.cid);
			})
			.catch(function () {
				select.dataset.loaded = '';
			});
	}

	function bindQuickPost(el) {
		var form = el.querySelector('.campus-world-quick');
		var text = el.querySelector('.campus-world-quick-text');
		var titleInput = el.querySelector('.campus-world-quick-title');
		var titleToggle = el.querySelector('.campus-world-quick-title-toggle');
		var select = el.querySelector('.campus-world-quick-cid');
		var send = el.querySelector('.campus-world-quick-send');
		var list = el.querySelector('.campus-world-list');

		loadCategories(select);

		titleToggle.addEventListener('click', function () {
			var opening = titleInput.classList.contains('hidden');
			titleInput.classList.toggle('hidden', !opening);
			titleToggle.classList.toggle('active', opening);
			titleToggle.querySelector('span').textContent = opening ? '收起标题' : '添加标题（可选）';
			if (opening) titleInput.focus();
		});

		form.addEventListener('submit', function (e) {
			e.preventDefault();
			var content = (text.value || '').trim();
			if (!content) {
				text.focus();
				return;
			}

			var uid = window.app && window.app.user && window.app.user.uid;
			if (!uid) {
				toast('请先登录再发帖');
				location.href = '/login';
				return;
			}

			var cid = parseInt(select.value, 10) || 2;
			var manualTitle = (titleInput.value || '').trim();
			var title = manualTitle || content.replace(/[#>*`_\-\n\r]+/g, ' ').trim().slice(0, 40) || '快速发帖';

			send.disabled = true;
			send.innerHTML = '<i class="fa fa-spinner fa-spin"></i> 发布中';

			fetch('/api/v3/topics', {
				method: 'POST',
				credentials: 'same-origin',
				headers: {
					'Content-Type': 'application/json',
					'x-csrf-token': (window.config && window.config.csrf_token) || '',
				},
				body: JSON.stringify({ cid: cid, title: title, content: content }),
			})
				.then(function (r) {
					return r.json().catch(function () { return {}; }).then(function (d) {
						if (!r.ok) {
							var msg = (d && d.status && d.status.message) || (d && d.error) || ('发布失败（HTTP ' + r.status + '）');
							throw new Error(msg);
						}
						return d;
					});
				})
				.then(function () {
					text.value = '';
					titleInput.value = '';
					toast('发布成功 🌸');
					load(list, true);
				})
				.catch(function (err) {
					toast(err.message || '发布失败');
				})
				.then(function () {
					send.disabled = false;
					send.innerHTML = '<i class="fa fa-paper-plane"></i> 发布';
				});
		});
	}

	function toast(msg) {
		var t = document.createElement('div');
		t.className = 'campus-world-toast';
		t.textContent = msg;
		document.body.appendChild(t);
		setTimeout(function () { t.classList.add('show'); }, 10);
		setTimeout(function () {
			t.classList.remove('show');
			setTimeout(function () { t.remove(); }, 250);
		}, 2200);
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
		bindQuickPost(el);
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

	function isHome() {
		var p = location.pathname.replace(/\/+$/, '');
		return p === '' || p === '/' || p === '/categories';
	}

	function boot() {
		var el = ensurePanel();
		wire(el);
		bindTriggers();
	}

	// 首次进站（首页）直接打开「世界」
	var autoShown = false;
	function autoOpen() {
		if (autoShown) return;
		if (!isHome()) return;
		autoShown = true;
		setTimeout(function () {
			try { open(); } catch (e) {}
		}, 250);
	}

	function startup() {
		boot();
		autoOpen();
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', startup);
	} else {
		startup();
	}

	if (window.jQuery && window.jQuery.fn) {
		window.jQuery(window).on('action:ajaxify.end', function () {
			try {
				boot();
				// 通过站内跳转回到首页，也打开世界
				if (!document.body.classList.contains('campus-world-open')) {
					autoShown = false;
					autoOpen();
				}
			} catch (e) {}
		});
		window.jQuery(window).on('action:widgets.loaded', function () {
			try { addMobileEntries(); } catch (e) {}
		});
	}
})();
