/*
 * 校园论坛 · 「世界」= 主页
 * 1) 打开网站首页，直接把世界帖子流渲染在主页内容区（不再弹窗）
 * 2) 快速发帖是一个可拖动的小浮窗，不遮挡浏览
 */
(function () {
	'use strict';

	var FEED_ID = 'campus-world-inline';
	var loading = false;
	var cached = null;
	var cacheTime = 0;
	var CACHE_TTL = 3 * 60 * 1000;

	// ---------------- 工具 ----------------
	function esc(s) {
		return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
			return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
		});
	}

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

	function isHome() {
		// 只有真正的首页才算「世界」；/categories 是版块页，不在里面显示世界
		var p = location.pathname.replace(/\/+$/, '');
		return p === '';
	}

	// ---------------- 帖子流 ----------------
	function feedHtml() {
		return (
			'<div class="campus-world-inline-head">' +
			'  <div class="campus-world-title"><i class="fa fa-globe"></i><span>世界</span>' +
			'    <small>全站所有帖子</small></div>' +
			'  <button type="button" class="campus-world-refresh" title="刷新"><i class="fa fa-refresh"></i></button>' +
			'</div>' +
			'<div class="campus-world-list"></div>' +
			'<div class="campus-world-foot">最近 24 小时的帖子 · 按时间倒序</div>'
		);
	}

	function renderPosts(list, posts) {
		if (!posts || !posts.length) {
			list.innerHTML = '<div class="campus-world-empty">还没有帖子，点右下角的笔写第一条吧 🌸</div>';
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
					'<article class="campus-world-post" data-url="' + esc(p.url || '#') + '" role="link" tabindex="0">' +
					'  <div class="campus-world-post-head">' + avatar +
					'    <a class="campus-world-user" href="/user/' + esc(user.userslug || '') + '">' + esc(user.username || '匿名') + '</a>' +
					'    <time>' + relativeTime(p.timestamp || Date.now()) + '</time>' + catChip +
					'  </div>' +
					'  <div class="campus-world-body">' + (p.content || '') + '</div>' +
					(topic.title && topic.title !== (p.content || '').replace(/<[^>]+>/g, '').trim()
						? '  <div class="campus-world-post-foot">' +
							'    <span class="campus-world-link">' + esc(topic.title) + ' <i class="fa fa-angle-right"></i></span>' +
							'  </div>'
						: '') +
					'</article>'
				);
			})
			.join('');

		// 点整张卡片进帖子；卡片内的链接/图片仍按原样处理
		Array.prototype.forEach.call(list.querySelectorAll('.campus-world-post'), function (card) {
			var url = card.getAttribute('data-url');
			if (!url) return;

			function go() {
				var path = url;
				try {
					var u = new URL(url, location.origin);
					path = u.pathname + u.search;
				} catch (e) {
					/* 保持原样 */
				}
				if (window.ajaxify && window.ajaxify.go) {
					try {
						window.ajaxify.go(path);
						return;
					} catch (e) {
						/* 退回整页跳转 */
					}
				}
				location.href = path;
			}

			card.addEventListener('click', function (e) {
				if (e.target.closest('a, button, img, video')) return;
				go();
			});
			card.addEventListener('keydown', function (e) {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					go();
				}
			});
		});
	}

	function fetchPosts(term) {
		return fetch('/api/recent/posts/' + term, { credentials: 'same-origin' })
			.then(function (r) {
				if (!r.ok) throw new Error('HTTP ' + r.status);
				return r.json();
			})
			.catch(function () { return []; });
	}

	// 只保留主帖（楼主的帖子），回复不进世界
	function fetchMainPosts(term) {
		return fetchPosts(term).then(function (list) {
			return (list || []).filter(function (p) {
				return p && p.isMainPost;
			});
		});
	}

	function load(list, force) {
		if (loading) return;
		if (!force && cached && Date.now() - cacheTime < CACHE_TTL) {
			renderPosts(list, cached);
			return;
		}
		loading = true;
		list.innerHTML = '<div class="campus-world-loading"><i class="fa fa-spinner fa-spin"></i> 正在加载…</div>';
		fetchMainPosts('24h')
			.then(function (posts) { return posts && posts.length ? posts : fetchMainPosts('7d'); })
			.then(function (posts) { return posts && posts.length ? posts : fetchMainPosts('30d'); })
			.then(function (posts) { return posts && posts.length ? posts : fetchMainPosts('365d'); })
			.then(function (posts) {
				cached = posts || [];
				cacheTime = Date.now();
				renderPosts(list, cached);
			})
			.catch(function () {
				list.innerHTML = '<div class="campus-world-empty">加载失败，请稍后重试</div>';
			})
			.then(function () { loading = false; });
	}

	function renderHome() {
		var content = document.getElementById('content');
		if (!content) return;

		if (!isHome()) {
			document.body.classList.remove('campus-home-world');
			var stale = document.getElementById(FEED_ID);
			if (stale) stale.remove();
			removeQuickFab();
			return;
		}

		document.body.classList.add('campus-home-world');

		var box = document.getElementById(FEED_ID);
		if (!box) {
			box = document.createElement('div');
			box.id = FEED_ID;
			box.className = 'campus-world-inline';
			box.innerHTML = feedHtml();
			content.insertBefore(box, content.firstChild);
			box.querySelector('.campus-world-refresh').addEventListener('click', function () {
				load(box.querySelector('.campus-world-list'), true);
			});
		}
		load(box.querySelector('.campus-world-list'));
		buildQuickFab();
	}

	// ---------------- 快速发帖：可拖动小浮窗 ----------------
	var quickEl = null;

	function removeQuickFab() {
		var fab = document.getElementById('campus-quick-fab');
		if (fab) fab.remove();
		if (quickEl) {
			quickEl.remove();
			quickEl = null;
		}
	}

	function buildQuickFab() {
		if (document.getElementById('campus-quick-fab')) return;
		var fab = document.createElement('button');
		fab.id = 'campus-quick-fab';
		fab.type = 'button';
		fab.title = '快速发帖';
		fab.innerHTML = '<i class="fa fa-pen"></i>';
		fab.addEventListener('click', toggleQuickWindow);
		document.body.appendChild(fab);
	}

	function toggleQuickWindow() {
		if (quickEl) {
			quickEl.remove();
			quickEl = null;
			return;
		}
		quickEl = buildQuickWindow();
		document.body.appendChild(quickEl);
		positionDefault(quickEl);
		makeDraggable(quickEl, quickEl.querySelector('.campus-quick-head'));
		quickEl.querySelector('.campus-world-quick-text').focus();
	}

	function positionDefault(el) {
		var w = el.offsetWidth || 300;
		var h = el.offsetHeight || 220;
		var x = window.innerWidth - w - 24;
		var y = window.innerHeight - h - 96;
		el.style.left = Math.max(12, x) + 'px';
		el.style.top = Math.max(12, y) + 'px';
	}

	function buildQuickWindow() {
		var el = document.createElement('div');
		el.className = 'campus-quick-window';
		el.innerHTML =
			'<div class="campus-quick-head">' +
			'  <span class="campus-quick-title"><i class="fa fa-pen"></i> 快速发帖</span>' +
			'  <button type="button" class="campus-quick-close" title="关闭"><i class="fa fa-times"></i></button>' +
			'</div>' +
			'<form class="campus-world-quick">' +
			'  <button type="button" class="campus-world-quick-title-toggle"><i class="fa fa-plus"></i><span>添加标题（可选）</span></button>' +
			'  <input class="campus-world-quick-title hidden" type="text" maxlength="120" placeholder="标题（不填自动截取正文）">' +
			'  <textarea class="campus-world-quick-text" rows="3" maxlength="5000" placeholder="说点什么…"></textarea>' +
			'  <div class="campus-world-quick-row">' +
			'    <select class="campus-world-quick-cid" aria-label="选择版块"></select>' +
			'    <button type="submit" class="campus-world-quick-send"><i class="fa fa-paper-plane"></i> 发布</button>' +
			'  </div>' +
			'</form>';

		el.querySelector('.campus-quick-close').addEventListener('click', function () {
			el.remove();
			quickEl = null;
		});

		bindQuickPost(el);
		return el;
	}

	function makeDraggable(el, handle) {
		var dragging = false;
		var startX = 0;
		var startY = 0;
		var left = 0;
		var top = 0;

		handle.style.cursor = 'grab';
		handle.style.touchAction = 'none';

		handle.addEventListener('pointerdown', function (e) {
			if (e.target.closest('button')) return;
			var r = el.getBoundingClientRect();
			left = r.left;
			top = r.top;
			startX = e.clientX;
			startY = e.clientY;
			dragging = true;
			handle.style.cursor = 'grabbing';
			if (handle.setPointerCapture) {
				try { handle.setPointerCapture(e.pointerId); } catch (err) {}
			}
		});

		handle.addEventListener('pointermove', function (e) {
			if (!dragging) return;
			var w = el.offsetWidth;
			var h = el.offsetHeight;
			var x = Math.min(Math.max(8, left + (e.clientX - startX)), window.innerWidth - w - 8);
			var y = Math.min(Math.max(8, top + (e.clientY - startY)), window.innerHeight - h - 8);
			el.style.left = x + 'px';
			el.style.top = y + 'px';
			if (e.cancelable) e.preventDefault();
		});

		function end() {
			dragging = false;
			handle.style.cursor = 'grab';
		}
		handle.addEventListener('pointerup', end);
		handle.addEventListener('pointercancel', end);
	}

	function loadCategories(select) {
		if (!select || select.dataset.loaded) return;
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
				select.innerHTML = options.map(function (o) {
					return '<option value="' + o.cid + '">' + (o.depth ? '　└ ' : '') + esc(o.name) + '</option>';
				}).join('');
				var def = options.filter(function (o) { return o.name.indexOf('综合') === 0; })[0] || options[0];
				if (def) select.value = String(def.cid);
			})
			.catch(function () { select.dataset.loaded = ''; });
	}

	function bindQuickPost(el) {
		var form = el.querySelector('.campus-world-quick');
		var text = el.querySelector('.campus-world-quick-text');
		var titleInput = el.querySelector('.campus-world-quick-title');
		var titleToggle = el.querySelector('.campus-world-quick-title-toggle');
		var select = el.querySelector('.campus-world-quick-cid');
		var send = el.querySelector('.campus-world-quick-send');

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
					var list = document.querySelector('.campus-world-inline .campus-world-list');
					if (list) load(list, true);
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

	// ---------------- 导航入口 ----------------
	function bindTriggers() {
		// PC 左侧「世界」→ 回到主页（主页就是世界）
		var item = document.getElementById('campus-nav-world');
		if (item) {
			var link = item.querySelector('a');
			if (link) {
				link.setAttribute('href', '/');
				link.addEventListener('click', function (e) {
					e.preventDefault();
					if (window.ajaxify && window.ajaxify.go) window.ajaxify.go('/');
					else location.href = '/';
				});
			}
		}

		// 手机底部导航：世界 + 热点
		var bar = document.querySelector('.bottombar .bottombar-nav');
		if (bar && !bar.dataset.campusExtra) {
			bar.dataset.campusExtra = '1';

			var world = document.createElement('a');
			world.href = '#';
			world.className = 'campus-bar-btn';
			world.title = '世界';
			world.innerHTML = '<i class="fa fa-globe"></i>';
			world.addEventListener('click', function (e) {
				e.preventDefault();
				if (window.ajaxify && window.ajaxify.go) window.ajaxify.go('/');
				else location.href = '/';
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
	}

	function boot() {
		bindTriggers();
		renderHome();
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
			try { bindTriggers(); } catch (e) {}
		});
	}
})();
