/*
 * AI 助手 —— 浏览器端
 * 右下角气泡 → 聊天面板；回答走 SSE 流式输出，带打字机效果。
 */
(function () {
	'use strict';

	var MAX_HISTORY = 12;
	var STORE_KEY = 'campusAiHistoryV2';
	var QUICK_PROMPTS = [
		'用简单的话解释一下量子计算',
		'帮我把这段话改通顺：',
		'写一段自我介绍',
		'推荐三部好看的电影',
	];

	function isLoggedIn() {
		return window.app && window.app.user && parseInt(window.app.user.uid, 10) > 0;
	}

	function loadHistory() {
		try {
			var raw = localStorage.getItem(STORE_KEY);
			var list = raw ? JSON.parse(raw) : [];
			return Array.isArray(list) ? list.slice(-MAX_HISTORY) : [];
		} catch (e) {
			return [];
		}
	}

	function saveHistory(list) {
		try {
			localStorage.setItem(STORE_KEY, JSON.stringify(list.slice(-MAX_HISTORY)));
		} catch (e) {}
	}

	function el(tag, className, text) {
		var node = document.createElement(tag);
		if (className) node.className = className;
		if (text) node.textContent = text;
		return node;
	}

	function escapeHtml(str) {
		return String(str).replace(/[&<>"']/g, function (c) {
			return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
		});
	}

	// 极简 Markdown：加粗、行内代码、代码块、链接
	function renderMarkdown(text) {
		var html = escapeHtml(text);
		html = html.replace(/```([\s\S]*?)```/g, function (m, code) {
			return '<pre class="campus-ai-code">' + code.replace(/^[a-zA-Z]*\n/, '') + '</pre>';
		});
		html = html.replace(/`([^`\n]+)`/g, '<code class="campus-ai-inline-code">$1</code>');
		html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
		html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
		html = html.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
		html = html.replace(/\n/g, '<br>');
		return html;
	}

	function buildUi() {
		if (document.getElementById('campus-ai')) return null;

		var root = el('div', 'campus-ai');
		root.id = 'campus-ai';

		var bubble = el('button', 'campus-ai-bubble');
		bubble.type = 'button';
		bubble.setAttribute('aria-label', '打开 AI 助手');
		bubble.innerHTML = '<i class="fa fa-comments" aria-hidden="true"></i><span class="campus-ai-bubble-dot"></span>';

		var panel = el('div', 'campus-ai-panel');
		panel.setAttribute('role', 'dialog');
		panel.setAttribute('aria-label', 'AI 助手');

		var header = el('div', 'campus-ai-header');
		var titleWrap = el('div');
		var title = el('div', 'campus-ai-title', 'AI 小助手');
		var subtitle = el('div', 'campus-ai-subtitle', '学习、写作、翻译、编程，什么都能问');
		titleWrap.appendChild(title);
		titleWrap.appendChild(subtitle);

		var actions = el('div', 'campus-ai-actions');
		var clearBtn = el('button', 'campus-ai-head-btn');
		clearBtn.type = 'button';
		clearBtn.title = '清空对话';
		clearBtn.setAttribute('aria-label', '清空对话');
		clearBtn.innerHTML = '<i class="fa fa-eraser" aria-hidden="true"></i>';
		var closeBtn = el('button', 'campus-ai-close');
		closeBtn.type = 'button';
		closeBtn.setAttribute('aria-label', '关闭');
		closeBtn.innerHTML = '<i class="fa fa-times" aria-hidden="true"></i>';
		actions.appendChild(clearBtn);
		actions.appendChild(closeBtn);

		header.appendChild(titleWrap);
		header.appendChild(actions);

		var messages = el('div', 'campus-ai-messages');
		messages.setAttribute('role', 'log');
		messages.setAttribute('aria-live', 'polite');

		var quick = el('div', 'campus-ai-quick');
		QUICK_PROMPTS.forEach(function (p) {
			var chip = el('button', 'campus-ai-chip', p);
			chip.type = 'button';
			quick.appendChild(chip);
		});

		var welcome = el('div', 'campus-ai-welcome');
		welcome.innerHTML =
			'<div class="campus-ai-welcome-avatar"><i class="fa fa-robot"></i></div>' +
			'<p class="campus-ai-welcome-title">你好呀，我是 AI 小助手 👋</p>' +
			'<p class="campus-ai-welcome-sub">知识问答、写作润色、翻译、代码问题都可以问我，也可以点下面的快捷问题试试。</p>';

		var form = el('form', 'campus-ai-form');
		var input = el('textarea', 'campus-ai-input');
		input.rows = 1;
		input.placeholder = '想聊点什么？Enter 发送，Shift+Enter 换行';
		input.maxLength = 2000;

		var sendBtn = el('button', 'campus-ai-send');
		sendBtn.type = 'submit';
		sendBtn.setAttribute('aria-label', '发送');
		sendBtn.innerHTML = '<i class="fa fa-paper-plane" aria-hidden="true"></i>';

		form.appendChild(input);
		form.appendChild(sendBtn);

		var footer = el('div', 'campus-ai-foot');
		var footText = el('span', 'campus-ai-foot-text', 'AI 可能出错，重要信息请自行核实');
		var footQuota = el('span', 'campus-ai-foot-quota', '');
		footer.appendChild(footText);
		footer.appendChild(footQuota);

		panel.appendChild(header);
		panel.appendChild(messages);
		panel.appendChild(quick);
		panel.appendChild(form);
		panel.appendChild(footer);

		root.appendChild(panel);
		root.appendChild(bubble);
		document.body.appendChild(root);

		return {
			root: root, bubble: bubble, panel: panel, header: header,
			messages: messages, quick: quick, welcome: welcome,
			form: form, input: input, send: sendBtn,
			close: closeBtn, clear: clearBtn, footQuota: footQuota,
		};
	}

	function setup() {
		if (!isLoggedIn()) return;

		var ui = buildUi();
		if (!ui) return;

		var history = loadHistory();
		var controller = null;
		var busy = false;

		function scrollToBottom() {
			ui.messages.scrollTop = ui.messages.scrollHeight;
		}

		function addUserMessage(text) {
			var row = el('div', 'campus-ai-msg campus-ai-msg-user');
			var b = el('div', 'campus-ai-bubble-text');
			b.textContent = text;
			row.appendChild(b);
			ui.messages.appendChild(row);
			scrollToBottom();
			return row;
		}

		function addAssistantMessage() {
			var row = el('div', 'campus-ai-msg campus-ai-msg-assistant');
			var b = el('div', 'campus-ai-bubble-text');
			var body = el('div', 'campus-ai-md');
			body.innerHTML = '<span class="campus-ai-typing"><span></span><span></span><span></span></span>';
			b.appendChild(body);
			row.appendChild(b);
			ui.messages.appendChild(row);
			scrollToBottom();
			return { row: row, body: body };
		}

		function addErrorMessage(text) {
			var row = el('div', 'campus-ai-msg campus-ai-msg-error');
			var b = el('div', 'campus-ai-bubble-text');
			b.textContent = text;
			row.appendChild(b);
			ui.messages.appendChild(row);
			scrollToBottom();
		}

		function attachCopy(container, text) {
			var bar = el('div', 'campus-ai-msg-tools');
			var copy = el('button', 'campus-ai-tool-btn');
			copy.type = 'button';
			copy.innerHTML = '<i class="fa fa-copy" aria-hidden="true"></i> 复制';
			copy.addEventListener('click', function () {
				var done = function () {
					copy.innerHTML = '<i class="fa fa-check" aria-hidden="true"></i> 已复制';
					setTimeout(function () {
						copy.innerHTML = '<i class="fa fa-copy" aria-hidden="true"></i> 复制';
					}, 1500);
				};
				try {
					navigator.clipboard.writeText(text).then(done).catch(done);
				} catch (e) {
					done();
				}
			});
			bar.appendChild(copy);
			container.appendChild(bar);
		}

		function setBusy(state) {
			busy = state;
			ui.send.classList.toggle('is-stop', state);
			ui.send.innerHTML = state
				? '<i class="fa fa-stop" aria-hidden="true"></i>'
				: '<i class="fa fa-paper-plane" aria-hidden="true"></i>';
			ui.send.setAttribute('aria-label', state ? '停止生成' : '发送');
			ui.input.disabled = false;
		}

		function resetThread() {
			history = [];
			saveHistory(history);
			ui.messages.innerHTML = '';
			ui.messages.appendChild(ui.welcome);
			ui.quick.hidden = false;
			scrollToBottom();
		}

		function open() {
			ui.root.classList.add('open');
			ui.input.focus();
			scrollToBottom();
			refreshQuota();
		}

		function setQuota(n) {
			if (typeof n !== 'number') return;
			ui.footQuota.textContent = n > 0 ? `今日剩余 ${n} 次` : '今日次数已用完';
			ui.footQuota.classList.toggle('is-empty', n <= 0);
		}

		function refreshQuota() {
			fetch('/api/campus-ai/quota', { credentials: 'same-origin' })
				.then(function (r) { return r.json(); })
				.then(function (d) { if (d && typeof d.remaining === 'number') setQuota(d.remaining); })
				.catch(function () {});
		}

		function closePanel() {
			ui.root.classList.remove('open');
			ui.bubble.focus();
		}

		ui.bubble.addEventListener('click', function () {
			if (ui.root.classList.contains('open')) closePanel();
			else open();
		});
		ui.close.addEventListener('click', closePanel);
		ui.clear.addEventListener('click', function () {
			if (busy && controller) controller.abort();
			resetThread();
		});

		document.addEventListener('keydown', function (e) {
			if (e.key === 'Escape' && ui.root.classList.contains('open')) closePanel();
			if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
				e.preventDefault();
				if (ui.root.classList.contains('open')) closePanel();
				else open();
			}
		});

		ui.messages.appendChild(ui.welcome);
		refreshQuota();

		ui.input.addEventListener('input', function () {
			ui.input.style.height = 'auto';
			ui.input.style.height = Math.min(ui.input.scrollHeight, 120) + 'px';
		});

		ui.input.addEventListener('keydown', function (e) {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				submit();
			}
		});

		ui.quick.addEventListener('click', function (e) {
			var chip = e.target.closest('.campus-ai-chip');
			if (!chip) return;
			ui.input.value = chip.textContent;
			submit();
		});

		ui.send.addEventListener('click', function (e) {
			if (busy) {
				e.preventDefault();
				if (controller) controller.abort();
				return;
			}
		});

		ui.form.addEventListener('submit', function (e) {
			e.preventDefault();
			if (!busy) submit();
		});

		function submit() {
			var text = ui.input.value.trim();
			if (!text || busy) return;

			ui.quick.hidden = true;
			if (ui.welcome.parentNode) ui.welcome.remove();

			addUserMessage(text);
			ui.input.value = '';
			ui.input.style.height = 'auto';
			history.push({ role: 'user', content: text });

			var node = addAssistantMessage();
			var acc = '';
			var raf = null;

			function paint() {
				raf = null;
				node.body.innerHTML = acc
					? renderMarkdown(acc)
					: '<span class="campus-ai-typing"><span></span><span></span><span></span></span>';
				scrollToBottom();
			}

			function schedule() {
				if (!raf) raf = requestAnimationFrame(paint);
			}

			setBusy(true);
			controller = new AbortController();

			streamChat(text, history, controller.signal, function (delta) {
				acc += delta;
				schedule();
			}).then(function () {
				if (raf) {
					cancelAnimationFrame(raf);
					raf = null;
				}
				if (!acc) {
					node.body.innerHTML = '<span class="campus-ai-empty">（AI 这次没有回答，换个问法试试？）</span>';
					return;
				}
				node.body.innerHTML = renderMarkdown(acc);
				scrollToBottom();
				history.push({ role: 'assistant', content: acc });
				saveHistory(history);
				attachCopy(node.row, acc);
			}).catch(function (err) {
				if (raf) {
					cancelAnimationFrame(raf);
					raf = null;
				}
				if (err && err.name === 'AbortError') {
					node.body.innerHTML = renderMarkdown(acc || '（已停止）');
					if (acc) {
						history.push({ role: 'assistant', content: acc });
						saveHistory(history);
						attachCopy(node.row, acc);
					}
					return;
				}
				node.row.remove();
				addErrorMessage((err && err.message) || '网络好像不太稳定，再试一次');
			}).then(function () {
				controller = null;
				setBusy(false);
				ui.input.focus();
			});
		}

		// 流式请求；不支持流式的浏览器退回普通接口
		function streamChat(message, hist, signal, onDelta) {
			var payload = {
				message: message,
				history: hist.slice(-7, -1),
			};
			var csrf = (window.config && window.config.csrf_token) || '';
			var opts = {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
				credentials: 'same-origin',
				body: JSON.stringify(payload),
				signal: signal,
			};

			if (!window.fetch || !window.TextDecoder) {
				return Promise.reject(new Error('浏览器版本太旧，暂时无法使用 AI 助手'));
			}

			return fetch('/api/campus-ai/chat/stream', opts).then(function (res) {
				if (!res.ok) {
					return res.json().catch(function () { return {}; }).then(function (d) {
						throw new Error((d && d.error) || '请求失败，请稍后再试');
					});
				}
				if (!res.body || !res.body.getReader) {
					return fetch('/api/campus-ai/chat', opts).then(function (r2) {
						return r2.json();
					}).then(function (d) {
						if (d.error) throw new Error(d.error);
						onDelta(d.reply || '');
					});
				}

				var reader = res.body.getReader();
				var decoder = new TextDecoder('utf-8');
				var buffer = '';

				function pump() {
					return reader.read().then(function (result) {
						if (result.done) return;

						buffer += decoder.decode(result.value, { stream: true });
						var lines = buffer.split('\n');
						buffer = lines.pop() || '';

						for (var i = 0; i < lines.length; i += 1) {
							var line = lines[i].trim();
							if (!line || line.indexOf('data:') !== 0) continue;
							var data = line.slice(5).trim();
							if (!data || data === '[DONE]') continue;
							var json;
							try {
								json = JSON.parse(data);
							} catch (e) {
								continue;
							}
							if (json.error) throw new Error(json.error);
							if (json.meta && typeof json.meta.remaining === 'number') setQuota(json.meta.remaining);
							if (json.delta) onDelta(json.delta);
						}

						return pump();
					});
				}

				return pump();
			});
		}
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', setup);
	} else {
		setup();
	}
})();
