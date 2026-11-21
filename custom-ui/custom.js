/*
 * 校园论坛 · 轻量交互脚本
 * 通过 NodeBB 后台「自定义 JavaScript」注入到每个页面底部。
 * 原则：只用原生 API、每一步都做存在性判断、出错静默不影响论坛本身。
 */
(function () {
	'use strict';

	var TOP_THRESHOLD = 400; // 滚动超过这个像素才显示“回到顶部”

	// ---------- 回到顶部按钮 ----------
	function ensureTopButton() {
		if (document.getElementById('dsh-top')) return;
		var btn = document.createElement('button');
		btn.id = 'dsh-top';
		btn.type = 'button';
		btn.setAttribute('aria-label', '回到顶部');
		btn.title = '回到顶部';
		btn.innerHTML = '<i class="fa fa-arrow-up" aria-hidden="true"></i>';
		btn.addEventListener('click', function () {
			window.scrollTo({ top: 0, behavior: 'smooth' });
		});
		document.body.appendChild(btn);
	}

	// ---------- 滚动相关反馈 ----------
	function onScroll() {
		var y = window.scrollY || document.documentElement.scrollTop || 0;

		var btn = document.getElementById('dsh-top');
		if (btn) btn.classList.toggle('show', y > TOP_THRESHOLD);

		var navbar = document.querySelector('.navbar');
		if (navbar) navbar.classList.toggle('dsh-scrolled', y > 8);
	}

	// ---------- 内容淡入（含站内无刷新跳转） ----------
	function fadeInContent() {
		var content = document.getElementById('content');
		if (!content) return;
		content.classList.remove('anim-in');
		void content.offsetWidth; // 强制重排，让动画能重新播放
		content.classList.add('anim-in');
	}

	// ---------- 点赞 / 收藏的点按反馈 ----------
	function bindPressFeedback() {
		var targets = document.querySelectorAll(
			'[component="post/upvote"], [component="post/downvote"], [component="post/bookmark"], ' +
			'[component="topic/upvote"], [component="post/reply"]'
		);
		Array.prototype.forEach.call(targets, function (el) {
			if (el.dataset.campusBound) return;
			el.dataset.campusBound = '1';
			el.addEventListener('click', function () {
				el.classList.remove('pop');
				void el.offsetWidth;
				el.classList.add('pop');
			});
		});
	}

	// ---------- 列表卡片：整卡可点 + 按下反馈 ----------
	function bindListCards() {
		var cards = document.querySelectorAll(
			'li[component="categories/category"], ul.topics-list > li.category-item'
		);
		Array.prototype.forEach.call(cards, function (li) {
			if (li.dataset.campusCard) return;
			li.dataset.campusCard = '1';

			li.addEventListener('click', function (e) {
				// 点到链接、按钮、回复预览这些真实交互元素时，交给它们自己处理
				if (e.target.closest('a, button, label, input, textarea, select, .teaser')) return;

				var link = li.querySelector('h2.title a[href], h3.title a[href], [component="topic/header"] a[href]');
				if (!link) return;

				li.classList.add('is-pressed');
				var href = link.getAttribute('href');
				setTimeout(function () {
					window.location.assign(href);
				}, 120);
			});
		});
	}

	// ---------- 左侧导航：标记当前所在页面 ----------
	function markCurrentNav() {
		var path = (window.location.pathname || '').replace(/\/+$/, '');
		var links = document.querySelectorAll('#main-nav .navigation-link');
		Array.prototype.forEach.call(links, function (a) {
			var href = (a.getAttribute('href') || '').replace(/\/+$/, '');
			var isCurrent = href && (path === href || (href !== '' && path.indexOf(href + '/') === 0));
			a.classList.toggle('is-current', !!isCurrent);
		});
	}

	// ---------- 左侧栏搜索框（含用户 / UID 联想） ----------
	function buildNavSearch() {
		if (document.getElementById('campus-nav-search')) return;
		var nav = document.getElementById('main-nav');
		if (!nav) return;

		var rp = (window.config && window.config.relative_path) || '';

		var wrap = document.createElement('li');
		wrap.className = 'nav-item campus-nav-search-item';
		wrap.id = 'campus-nav-search';
		wrap.innerHTML =
			'<form class="campus-search" role="search" action="' + rp + '/search" method="get" autocomplete="off">' +
			'<i class="fa fa-search campus-search-icon" aria-hidden="true"></i>' +
			'<input type="text" name="term" class="campus-search-input" placeholder="搜索帖子 / 用户 / UID" aria-label="搜索">' +
			'</form>' +
			'<div class="campus-search-results" hidden></div>';

		nav.insertBefore(wrap, nav.firstChild);

		// ---------- 左侧导航：新增「世界」入口（全站所有帖子） ----------
		if (!document.getElementById('campus-nav-world')) {
			var worldItem = document.createElement('li');
			worldItem.className = 'nav-item campus-nav-world-item';
			worldItem.id = 'campus-nav-world';
			worldItem.innerHTML =
				'<a class="nav-link campus-nav-world" href="' + rp + '/recent" title="看看全站所有帖子">' +
				'<i class="fa fa-globe campus-nav-world-icon" aria-hidden="true"></i>' +
				'<span class="campus-nav-world-text">世界</span>' +
				'</a>';
			nav.insertBefore(worldItem, wrap.nextSibling);
		}

		var form = wrap.querySelector('form');
		var input = wrap.querySelector('.campus-search-input');
		var panel = wrap.querySelector('.campus-search-results');
		var timer = null;

		function hidePanel() {
			panel.hidden = true;
			panel.innerHTML = '';
		}

		// 面板用 fixed 定位，避免被侧栏的滚动容器裁掉
		function positionPanel() {
			var rect = input.getBoundingClientRect();
			panel.style.top = Math.round(rect.bottom + 8) + 'px';
			panel.style.left = Math.round(rect.left) + 'px';
		}

		function render(users, posts) {
			users = users || [];
			posts = posts || [];
			if (!users.length && !posts.length) {
				hidePanel();
				return;
			}

			var html = '';

			if (users.length) {
				html += '<div class="campus-search-group"><span class="campus-search-group-title">用户</span>';
				html += users.map(function (u) {
					var pic = u.picture
						? '<img class="campus-hit-avatar" src="' + u.picture + '" alt="">'
						: '<span class="campus-hit-avatar">' + String(u.username || '?').slice(0, 1).toUpperCase() + '</span>';
					return '<a class="campus-search-hit" href="' + rp + '/user/' + u.userslug + '">' +
						pic +
						'<span class="campus-hit-name">' + u.username + '</span>' +
						'<span class="campus-hit-uid">UID ' + u.uid + '</span>' +
						'</a>';
				}).join('');
				html += '</div>';
			}

			if (posts.length) {
				html += '<div class="campus-search-group"><span class="campus-search-group-title">帖子</span>';
				html += posts.map(function (p) {
					var href = rp + '/topic/' + (p.slug || p.tid);
					return '<a class="campus-search-post" href="' + href + '">' +
						'<span class="campus-post-title"><i class="fa fa-file-text-o"></i>' + (p.title || '无标题帖子') + '</span>' +
						(p.snippet ? '<span class="campus-post-snippet">' + p.snippet + '</span>' : '') +
						'</a>';
				}).join('');
				html += '</div>';
			}

			panel.innerHTML = html;
			panel.hidden = false;
			positionPanel();
		}

		function lookup(q) {
			return fetch('/api/campus/find?q=' + encodeURIComponent(q) + '&limit=8', { credentials: 'same-origin' })
				.then(function (r) { return r.json(); })
				.then(function (d) { return { users: (d && d.users) || [], posts: (d && d.posts) || [] }; })
				.catch(function () { return { users: [], posts: [] }; });
		}

		input.addEventListener('input', function () {
			var q = input.value.trim();
			clearTimeout(timer);
			if (!q) {
				hidePanel();
				return;
			}
			timer = setTimeout(function () {
				lookup(q).then(function (d) { render(d.users, d.posts); });
			}, 220);
		});

		form.addEventListener('submit', function (e) {
			var q = input.value.trim();
			if (!q) {
				e.preventDefault();
				return;
			}

			// 回车：优先落到最相关的帖子，其次用户；都没有才进全站搜索
			e.preventDefault();
			lookup(q).then(function (d) {
				var target = '';
				if (d.posts && d.posts.length) {
					target = rp + '/topic/' + (d.posts[0].slug || d.posts[0].tid);
				} else if (d.users && d.users.length && d.users[0].userslug) {
					target = rp + '/user/' + d.users[0].userslug;
				} else {
					target = rp + '/search?term=' + encodeURIComponent(q);
				}
				render(d.users, d.posts);
				setTimeout(function () { window.location.assign(target); }, 120);
			});
		});

		document.addEventListener('click', function (e) {
			if (!wrap.contains(e.target)) hidePanel();
		});

		window.addEventListener('scroll', hidePanel, { passive: true });

		// 侧栏收起时只有图标，点一下就展开并把光标放进搜索框
		var sidebar = wrap.closest('nav.sidebar');
		wrap.addEventListener('click', function () {
			if (sidebar && !sidebar.classList.contains('open') && !input.value) {
				sidebar.classList.add('open');
				setTimeout(function () { input.focus(); }, 60);
			}
		});
	}

	// ---------- UID 徽章：帖子作者 + 个人主页 ----------
	function bindUidBadges() {
		var rp = (window.config && window.config.relative_path) || '';

		// 帖子页
		var posts = document.querySelectorAll('[component="post"]');
		Array.prototype.forEach.call(posts, function (post) {
			if (post.dataset.campusUid) return;
			var uid = post.getAttribute('data-uid');
			if (!uid || uid === '0') return;
			var link = post.querySelector('a[href*="/user/"]');
			if (!link || link.parentNode.querySelector('.campus-uid')) return;
			post.dataset.campusUid = '1';

			var badge = document.createElement('a');
			badge.className = 'campus-uid';
			badge.href = rp + '/search?term=' + uid + '&in=users';
			badge.textContent = 'UID ' + uid;
			badge.title = '点击按 UID 搜索';
			link.parentNode.insertBefore(badge, link.nextSibling);
		});

		// 个人主页
		if (/^\/user\//.test(window.location.pathname)) {
			var data = (window.ajaxify && window.ajaxify.data) || {};
			var nameEl = document.querySelector('h2.fullname, .fullname');
			if (data.uid && nameEl && !document.querySelector('.campus-uid-profile')) {
				var b = document.createElement('span');
				b.className = 'campus-uid campus-uid-profile';
				b.textContent = 'UID ' + data.uid;
				// 放在名字「里面」，和用户名同一行，不再单独占一行
				nameEl.appendChild(b);
			}
		}
	}

	// ---------- 邮箱验证码弹窗 ----------
	// ---------- 注册页：邮箱验证码 → 创建账号 ----------
	function campusAlert(type, msg) {
		if (window.app && window.app.alert && window.app.alert[type]) {
			window.app.alert[type](msg);
		} else {
			alert(msg);
		}
	}

	function postJson(url, data) {
		return fetch(url, {
			method: 'POST',
			credentials: 'same-origin',
			headers: {
				'Content-Type': 'application/json',
				'x-csrf-token': (window.config && window.config.csrf_token) || '',
			},
			body: JSON.stringify(data || {}),
		}).then(function (r) {
			return r.json().catch(function () { return {}; }).then(function (d) {
				if (!r.ok) throw new Error((d && d.error) || ('请求失败（' + r.status + '）'));
				return d;
			});
		});
	}

	function startCooldown(btn, seconds) {
		var left = seconds;
		btn.disabled = true;
		var original = btn.textContent;
		btn.textContent = left + ' 秒';
		var t = setInterval(function () {
			left -= 1;
			if (left <= 0) {
				clearInterval(t);
				btn.disabled = false;
				btn.textContent = original;
			} else {
				btn.textContent = left + ' 秒';
			}
		}, 1000);
	}

	function enhanceRegister() {
		var form = document.querySelector('form[component="register/local"]');
		if (!form || form.dataset.campusReg) return;
		form.dataset.campusReg = '1';

		var usernameEl = form.querySelector('#username');
		var emailEl = form.querySelector('#email');
		var passEl = form.querySelector('#password');
		var pass2El = form.querySelector('#password-confirm');
		if (!usernameEl || !emailEl || !passEl) return;

		var row = document.createElement('div');
		row.className = 'campus-code-row';
		row.innerHTML =
			'<input class="campus-code-input" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="6 位邮箱验证码">' +
			'<button type="button" class="campus-code-send">获取验证码</button>';
		emailEl.parentNode.insertBefore(row, emailEl.nextSibling);

		var codeEl = row.querySelector('.campus-code-input');
		var sendBtn = row.querySelector('.campus-code-send');

		var hint = document.createElement('div');
		hint.className = 'campus-code-hint';
		hint.textContent = '注册需要邮箱验证：先点「获取验证码」，再去邮箱查看 6 位数字。';
		row.parentNode.insertBefore(hint, row.nextSibling);

		sendBtn.addEventListener('click', function () {
			var username = (usernameEl.value || '').trim();
			var email = (emailEl.value || '').trim();
			var password = passEl.value || '';

			if (!username || username.length < 2) return campusAlert('error', '请先填用户名（至少 2 个字符）');
			if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return campusAlert('error', '请填写正确的邮箱');
			if (password.length < 6) return campusAlert('error', '密码至少 6 位');

			sendBtn.disabled = true;
			postJson('/api/campus/register/send', { username: username, email: email, password: password })
				.then(function (d) {
					campusAlert('success', '验证码已发送到 ' + (d.email || email));
					startCooldown(sendBtn, 60);
					codeEl.focus();
				})
				.catch(function (err) {
					sendBtn.disabled = false;
					campusAlert('error', err.message);
				});
		});

		form.addEventListener(
			'submit',
			function (e) {
				e.preventDefault();

				var username = (usernameEl.value || '').trim();
				var email = (emailEl.value || '').trim();
				var password = passEl.value || '';
				var code = (codeEl.value || '').replace(/\D/g, '');

				if (!username || username.length < 2) return campusAlert('error', '用户名至少 2 个字符');
				if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return campusAlert('error', '请填写正确的邮箱');
				if (password.length < 6) return campusAlert('error', '密码至少 6 位');
				if (pass2El && pass2El.value !== password) return campusAlert('error', '两次输入的密码不一致');
				if (code.length !== 6) return campusAlert('error', '请输入邮箱收到的 6 位验证码');

				var submitBtn = form.querySelector('button[type="submit"], .btn-primary');
				if (submitBtn) submitBtn.disabled = true;

				postJson('/api/campus/register/verify', {
					username: username,
					email: email,
					password: password,
					code: code,
				})
					.then(function () {
						campusAlert('success', '注册成功，正在进入论坛…');
						setTimeout(function () { window.location.assign('/'); }, 800);
					})
					.catch(function (err) {
						if (submitBtn) submitBtn.disabled = false;
						campusAlert('error', err.message);
					});
			},
			true
		);
	}

	// ---------- 登录页：忘记密码（邮箱验证后重设） ----------
	function enhanceLogin() {
		var form = document.getElementById('login-form');
		if (!form || form.dataset.campusForgot) return;
		form.dataset.campusForgot = '1';

		var link = document.createElement('button');
		link.type = 'button';
		link.className = 'campus-forgot';
		link.textContent = '忘记密码？用邮箱验证码重置';
		form.appendChild(link);

		link.addEventListener('click', function (e) {
			e.preventDefault();
			openPasswordModal();
		});
	}

	function openPasswordModal() {
		if (document.getElementById('campus-pwd-modal')) return;

		var el = document.createElement('div');
		el.id = 'campus-pwd-modal';
		el.className = 'campus-modal';
		el.innerHTML =
			'<div class="campus-modal-backdrop"></div>' +
			'<div class="campus-modal-card">' +
			'  <header class="campus-modal-head"><span><i class="fa fa-key"></i> 重置密码</span>' +
			'    <button type="button" class="campus-modal-close"><i class="fa fa-times"></i></button></header>' +
			'  <div class="campus-modal-body">' +
			'    <label class="campus-field"><span>注册邮箱</span>' +
			'      <input class="campus-pwd-email" type="email" placeholder="you@example.com"></label>' +
			'    <div class="campus-code-row">' +
			'      <input class="campus-pwd-code" inputmode="numeric" maxlength="6" placeholder="6 位验证码">' +
			'      <button type="button" class="campus-pwd-send">发送验证码</button>' +
			'    </div>' +
			'    <label class="campus-field"><span>新密码（至少 6 位）</span>' +
			'      <input class="campus-pwd-pass" type="password" autocomplete="new-password" placeholder="新密码"></label>' +
			'    <button type="button" class="campus-pwd-submit">确认修改</button>' +
			'    <p class="campus-modal-tip">修改成功后请用新密码登录。</p>' +
			'  </div>' +
			'</div>';
		document.body.appendChild(el);

		el.querySelector('.campus-modal-backdrop').addEventListener('click', function () { el.remove(); });
		el.querySelector('.campus-modal-close').addEventListener('click', function () { el.remove(); });

		var email = el.querySelector('.campus-pwd-email');
		var code = el.querySelector('.campus-pwd-code');
		var pass = el.querySelector('.campus-pwd-pass');
		var send = el.querySelector('.campus-pwd-send');
		var submit = el.querySelector('.campus-pwd-submit');

		send.addEventListener('click', function () {
			var e = (email.value || '').trim();
			if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return campusAlert('error', '请填写正确的邮箱');

			send.disabled = true;
			postJson('/api/campus/password/send', { email: e })
				.then(function (d) {
					campusAlert('success', '验证码已发送到 ' + (d.email || e));
					startCooldown(send, 60);
					code.focus();
				})
				.catch(function (err) {
					send.disabled = false;
					campusAlert('error', err.message);
				});
		});

		submit.addEventListener('click', function () {
			var e = (email.value || '').trim();
			var c = (code.value || '').replace(/\D/g, '');
			var p = pass.value || '';

			if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return campusAlert('error', '请填写正确的邮箱');
			if (c.length !== 6) return campusAlert('error', '请输入 6 位验证码');
			if (p.length < 6) return campusAlert('error', '新密码至少 6 位');

			submit.disabled = true;
			postJson('/api/campus/password/reset', { email: e, code: c, password: p })
				.then(function () {
					el.remove();
					campusAlert('success', '密码已修改，请用新密码登录');
				})
				.catch(function (err) {
					submit.disabled = false;
					campusAlert('error', err.message);
				});
		});

		setTimeout(function () { email.focus(); }, 50);
	}

	// ---------- 导航整理：去掉「标签」，把「热门」改为「世界」 ----------
	function tidyNavigation() {
		var lists = document.querySelectorAll('.navigation-dropdown li.nav-item, #main-nav li.nav-item');
		Array.prototype.forEach.call(lists, function (li) {
			var link = li.querySelector('a.nav-link') || li.querySelector('a');
			if (!link) return;
			var text = (link.textContent || '').replace(/\s+/g, '');
			var icon = link.querySelector('i.fa');

			// 去掉「标签」
			if (text.indexOf('标签') !== -1) {
				li.remove();
				return;
			}

			// 「热门」→「世界」
			if (text.indexOf('热门') !== -1 && !li.dataset.campusWorld) {
				li.dataset.campusWorld = '1';
				link.setAttribute('href', '/');
				var label = link.querySelector('.nav-text');
				if (label) {
					label.textContent = '世界';
				} else {
					link.textContent = '世界';
				}
				if (icon) icon.className = 'fa fa-fw fa-globe';
				link.setAttribute('title', '世界');
				link.addEventListener('click', function (e) {
					e.preventDefault();
					if (window.ajaxify && window.ajaxify.go) window.ajaxify.go('/');
					else window.location.href = '/';
				});
			}
		});
	}

	function buildVerifyModal() {
		var user = (window.app && window.app.user) || {};
		var uid = parseInt(user.uid, 10) || 0;

		if (!uid || user['email:confirmed']) {
			var old = document.getElementById('campus-verify');
			if (old) old.remove();
			return;
		}
		if (document.getElementById('campus-verify')) return;
		if (/^\/(login|register)/.test(window.location.pathname)) return;

		var rp = (window.config && window.config.relative_path) || '';
		var csrf = (window.config && window.config.csrf_token) || '';

		var mask = document.createElement('div');
		mask.id = 'campus-verify';
		mask.className = 'campus-verify-mask';
		mask.innerHTML =
			'<div class="campus-verify-card" role="dialog" aria-modal="true" aria-labelledby="campus-verify-title">' +
			'<div class="campus-verify-icon"><i class="fa fa-envelope-open-text"></i></div>' +
			'<h3 id="campus-verify-title">验证你的邮箱</h3>' +
			'<p class="campus-verify-tip" data-role="tip">正在把 6 位验证码发送到你的邮箱…</p>' +
			'<input class="campus-verify-input" data-role="input" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000" aria-label="6 位验证码">' +
			'<p class="campus-verify-msg" data-role="msg"></p>' +
			'<div class="campus-verify-actions">' +
			'<button type="button" class="campus-verify-resend" data-role="resend" disabled>重新发送</button>' +
			'<button type="button" class="campus-verify-submit" data-role="submit">验证</button>' +
			'</div>' +
			'<p class="campus-verify-foot">没收到？先翻一下垃圾邮件；验证码 10 分钟内有效。</p>' +
			'</div>';
		document.body.appendChild(mask);

		var tip = mask.querySelector('[data-role="tip"]');
		var input = mask.querySelector('[data-role="input"]');
		var msg = mask.querySelector('[data-role="msg"]');
		var resend = mask.querySelector('[data-role="resend"]');
		var submit = mask.querySelector('[data-role="submit"]');
		var cd = 0;
		var timer = null;

		function post(url, body) {
			return fetch(url, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
				credentials: 'same-origin',
				body: JSON.stringify(body || {}),
			}).then(function (r) {
				return r.json().catch(function () { return {}; }).then(function (d) {
					return { ok: r.ok, data: d };
				});
			});
		}

		function startCooldown() {
			cd = 60;
			resend.disabled = true;
			resend.textContent = '重新发送（' + cd + 's）';
			clearInterval(timer);
			timer = setInterval(function () {
				cd -= 1;
				if (cd <= 0) {
					clearInterval(timer);
					resend.disabled = false;
					resend.textContent = '重新发送';
				} else {
					resend.textContent = '重新发送（' + cd + 's）';
				}
			}, 1000);
		}

		function send() {
			msg.textContent = '';
			msg.className = 'campus-verify-msg';
			resend.disabled = true;
			tip.textContent = '正在发送验证码…';
			post('/api/campus/verify/send', {}).then(function (res) {
				if (res.ok) {
					if (res.data.alreadyVerified) {
						tip.textContent = '这个邮箱已经验证过了';
						setTimeout(function () { window.location.reload(); }, 800);
						return;
					}
					tip.innerHTML = '验证码已发送到 <b>' + (res.data.email || '你的邮箱') + '</b>，请查收';
					startCooldown();
					input.focus();
				} else {
					tip.textContent = '发送失败';
					msg.textContent = (res.data && res.data.error) || '请稍后再试';
					msg.className = 'campus-verify-msg is-error';
					resend.disabled = false;
				}
			}).catch(function () {
				tip.textContent = '网络不太稳定';
				msg.textContent = '请稍后点「重新发送」';
				msg.className = 'campus-verify-msg is-error';
				resend.disabled = false;
			});
		}

		function check() {
			var code = input.value.replace(/\D/g, '');
			if (code.length !== 6) {
				msg.textContent = '请输入 6 位数字验证码';
				msg.className = 'campus-verify-msg is-error';
				input.focus();
				return;
			}
			submit.disabled = true;
			msg.textContent = '';
			post('/api/campus/verify/check', { code: code }).then(function (res) {
				if (res.ok) {
					msg.textContent = '验证成功，正在进入论坛…';
					msg.className = 'campus-verify-msg is-ok';
					input.disabled = true;
					submit.disabled = true;
					setTimeout(function () { window.location.assign(rp + '/'); }, 1000);
				} else {
					submit.disabled = false;
					msg.textContent = (res.data && res.data.error) || '验证失败';
					msg.className = 'campus-verify-msg is-error';
				}
			}).catch(function () {
				submit.disabled = false;
				msg.textContent = '网络不太稳定，再试一次';
				msg.className = 'campus-verify-msg is-error';
			});
		}

		input.addEventListener('input', function () {
			input.value = input.value.replace(/\D/g, '').slice(0, 6);
			if (input.value.length === 6) check();
		});
		input.addEventListener('keydown', function (e) {
			if (e.key === 'Enter') check();
		});
		submit.addEventListener('click', check);
		resend.addEventListener('click', send);

		setTimeout(send, 400);
	}

	// ---------- 发帖框：上传图片 / 上传文件 / 表情 / @EVA / @ ----------
	function insertAtCursor(textarea, text) {
		if (!textarea) return;
		var start = textarea.selectionStart || 0;
		var end = textarea.selectionEnd || 0;
		var value = textarea.value || '';
		textarea.value = value.slice(0, start) + text + value.slice(end);
		var pos = start + text.length;
		textarea.focus();
		try {
			textarea.setSelectionRange(pos, pos);
		} catch (e) {}
		textarea.dispatchEvent(new Event('input', { bubbles: true }));
	}

	function uploadFile(file) {
		var fd = new FormData();
		fd.append('files[]', file);
		var csrf = (window.config && window.config.csrf_token) || '';
		return fetch('/api/post/upload', {
			method: 'POST',
			headers: { 'x-csrf-token': csrf },
			credentials: 'same-origin',
			body: fd,
		}).then(function (r) {
			return r
				.json()
				.catch(function () {
					return {};
				})
				.then(function (d) {
					if (!r.ok) {
						throw new Error((d && (d.error || d.message)) || '上传失败（HTTP ' + r.status + '）');
					}
					return d;
				});
		});
	}

	function makeToolButton(icon, title) {
		var b = document.createElement('button');
		b.type = 'button';
		b.className = 'campus-composer-tool';
		b.title = title;
		b.setAttribute('aria-label', title);
		b.innerHTML = '<i class="fa ' + icon + '" aria-hidden="true"></i>';
		return b;
	}

	function enhanceComposer() {
		var composers = document.querySelectorAll('[component="composer"]');
		Array.prototype.forEach.call(composers, function (composer) {
			if (composer.dataset.campusEva) return;
			var bar = composer.querySelector('.formatting-bar');
			if (!bar) return;
			composer.dataset.campusEva = '1';

			// ① 上传图片（手机可直接拍照/选相册）
			var imgBtn = makeToolButton('fa-image', '上传图片');
			imgBtn.addEventListener('click', function () {
				var textarea = composer.querySelector('textarea.write');
				var input = document.createElement('input');
				input.type = 'file';
				input.accept = 'image/*';
				input.onchange = function () {
					var f = input.files && input.files[0];
					if (!f || !textarea) return;
					imgBtn.disabled = true;
					uploadFile(f)
						.then(function (res) {
							var list = Array.isArray(res) ? res : [res];
							list.forEach(function (item) {
								if (!item || !item.url) return;
								var name = item.name || 'image';
								insertAtCursor(textarea, '![' + name + '](' + item.url + ')\n');
							});
						})
						.catch(function (err) {
							alert(err.message || '上传失败');
						})
						.then(function () {
							imgBtn.disabled = false;
						});
				};
				input.click();
			});
			bar.appendChild(imgBtn);

			// ② 上传文件
			var fileBtn = makeToolButton('fa-paperclip', '上传文件');
			fileBtn.addEventListener('click', function () {
				var textarea = composer.querySelector('textarea.write');
				var input = document.createElement('input');
				input.type = 'file';
				input.onchange = function () {
					var f = input.files && input.files[0];
					if (!f || !textarea) return;
					fileBtn.disabled = true;
					uploadFile(f)
						.then(function (res) {
							var list = Array.isArray(res) ? res : [res];
							list.forEach(function (item) {
								if (!item || !item.url) return;
								var name = item.name || '文件';
								insertAtCursor(textarea, '[' + name + '](' + item.url + ')\n');
							});
						})
						.catch(function (err) {
							alert(err.message || '上传失败');
						})
						.then(function () {
							fileBtn.disabled = false;
						});
				};
				input.click();
			});
			bar.appendChild(fileBtn);

			// ③ 表情
			var EMOJIS = ['😀', '😄', '😁', '😊', '😍', '🥰', '😘', '😎', '🤔', '😅', '😂', '🤣', '😭', '😡', '😱', '👍', '👎', '👏', '🙏', '💪', '🎉', '❤️', '🔥', '✨', '🌙', '🌸', '🍀', '⭐'];
			var emojiBtn = makeToolButton('fa-smile-o', '插入表情');
			var emojiPanel = document.createElement('div');
			emojiPanel.className = 'campus-emoji-panel hidden';
			EMOJIS.forEach(function (emo) {
				var b = document.createElement('button');
				b.type = 'button';
				b.textContent = emo;
				b.addEventListener('click', function () {
					insertAtCursor(composer.querySelector('textarea.write'), emo);
					emojiPanel.classList.add('hidden');
				});
				emojiPanel.appendChild(b);
			});
			emojiBtn.addEventListener('click', function (e) {
				e.stopPropagation();
				emojiPanel.classList.toggle('hidden');
			});
			document.addEventListener('click', function (e) {
				if (!emojiPanel.contains(e.target) && e.target !== emojiBtn) {
					emojiPanel.classList.add('hidden');
				}
			});
			bar.appendChild(emojiBtn);
			composer.appendChild(emojiPanel);

			var btn = document.createElement('button');
			btn.type = 'button';
			btn.className = 'campus-composer-eva';
			btn.title = '叫 AI 助手 EVA 来回答或翻译';
			btn.innerHTML = '<i class="fa fa-robot" aria-hidden="true"></i><span>@EVA</span>';

			btn.addEventListener('click', function () {
				var textarea = composer.querySelector('textarea.write');
				if (!textarea) return;
				var snippet = '@EVA ';
				var start = textarea.selectionStart || 0;
				var end = textarea.selectionEnd || 0;
				var value = textarea.value || '';
				textarea.value = value.slice(0, start) + snippet + value.slice(end);
				var pos = start + snippet.length;
				textarea.focus();
				try {
					textarea.setSelectionRange(pos, pos);
				} catch (e) {}
				textarea.dispatchEvent(new Event('input', { bubbles: true }));
			});

			bar.appendChild(btn);

			// 「@」快捷按钮：插入 @ 触发用户联想（手机上没有 @ 键的输入法也能用）
			var mentionBtn = document.createElement('button');
			mentionBtn.type = 'button';
			mentionBtn.className = 'campus-composer-mention';
			mentionBtn.title = '提及用户（@用户名）';
			mentionBtn.innerHTML = '<i class="fa fa-at" aria-hidden="true"></i>';
			mentionBtn.addEventListener('click', function () {
				var textarea = composer.querySelector('textarea.write');
				if (!textarea) return;
				var start = textarea.selectionStart || 0;
				var end = textarea.selectionEnd || 0;
				var value = textarea.value || '';
				textarea.value = value.slice(0, start) + '@' + value.slice(end);
				var pos = start + 1;
				textarea.focus();
				try {
					textarea.setSelectionRange(pos, pos);
				} catch (e) {}
				textarea.dispatchEvent(new Event('input', { bubbles: true }));
			});
			bar.appendChild(mentionBtn);
		});
	}

	// ---------- 子版块卡片：把统计数字挪到标题下面，避免挤成一列 ----------
	function enhanceSubcategoryCards() {
		var cards = document.querySelectorAll('[component="category/subcategory/container"] > li[component="categories/category"]');
		Array.prototype.forEach.call(cards, function (li) {
			if (li.dataset.campusSubCard) return;
			li.dataset.campusSubCard = '1';
			li.classList.add('campus-sub-card');

			var wrap = li.querySelector('.flex-grow-1');
			var title = li.querySelector('.title');
			if (!wrap || !title) return;

			var counts = [];
			var stats = li.querySelector('.meta.stats');
			if (stats) {
				var nums = stats.querySelectorAll('.card .fs-5');
				Array.prototype.forEach.call(nums, function (n) {
					counts.push(String(n.textContent || '').trim());
				});
			}

			if (counts.length >= 2) {
				var meta = document.createElement('div');
				meta.className = 'campus-sub-meta';
				meta.textContent = counts[0] + ' 主题 · ' + counts[1] + ' 帖子';
				title.parentNode.insertBefore(meta, title.nextSibling);
			}
		});
	}

	function boot() {
		try {
			ensureTopButton();
			onScroll();
			fadeInContent();
			bindPressFeedback();
			bindListCards();
			markCurrentNav();
			buildNavSearch();
			bindUidBadges();
			tidyNavigation();
			buildVerifyModal();
			enhanceRegister();
			enhanceLogin();
			enhanceComposer();
			enhanceSubcategoryCards();
		} catch (e) {
			/* 静默失败，绝不影响论坛本身 */
		}
	}

	window.addEventListener('scroll', onScroll, { passive: true });

	// NodeBB 用 ajaxify 做站内无刷新跳转，跳转完成后重新绑定
	if (window.jQuery && window.jQuery.fn) {
		window.jQuery(window).on('action:ajaxify.end', function () {
			try {
				fadeInContent();
				bindPressFeedback();
				bindListCards();
				markCurrentNav();
				buildNavSearch();
				bindUidBadges();
				tidyNavigation();
				buildVerifyModal();
				enhanceRegister();
				enhanceLogin();
				enhanceComposer();
				enhanceSubcategoryCards();
			} catch (e) {}
		});

		// 发帖框打开时也会触发
		window.jQuery(window).on('action:composer.loaded', function () {
			setTimeout(function () {
				try { enhanceComposer(); } catch (e) {}
			}, 100);
		});

		// ---------- 发帖 / 回复的最少字数提示（PC 与手机都生效） ----------
		var MIN_TITLE = 1;
		var MIN_POST = 1;

		document.addEventListener('click', function (e) {
			var btn = e.target && e.target.closest
				? e.target.closest('[data-action="post"], .composer-submit, [component="composer/submit"]')
				: null;
			if (!btn) return;

			var composer = document.querySelector('[component="composer"]');
			if (!composer) return;

			var titleEl = composer.querySelector('input.title, .title-container input');
			var textarea = composer.querySelector('textarea.write');
			if (!textarea) return;

			var title = (titleEl && titleEl.value ? titleEl.value : '').trim();
			var body = (textarea.value || '').trim();

			function block(msg, target) {
				e.preventDefault();
				e.stopPropagation();
				if (target) target.focus();
				// 用 NodeBB 自带的 alerts 更好看，没有就退回 alert
				if (window.app && window.app.alert) {
					window.app.alert.error(msg);
				} else {
					alert(msg);
				}
			}

			if (titleEl && title.length < MIN_TITLE) {
				block('标题至少 ' + MIN_TITLE + ' 个字（现在 ' + title.length + ' 个）', titleEl);
				return;
			}

			if (body.length < MIN_POST) {
				block('正文至少 ' + MIN_POST + ' 个字（现在 ' + body.length + ' 个）', textarea);
			}
		}, true);
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', boot);
	} else {
		boot();
	}
})();
