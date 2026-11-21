'use strict';

/**
 * 校园论坛 AI 助手 —— 服务端
 *
 * 作用：
 * 1. 接收浏览器发来的问题 → 拿着 API Key 去问 DeepSeek → 把回答传回浏览器
 *    （Key 只存在服务器端，不会出现在网页里）
 * 2. 搜索建议接口：按用户名 / UID 找人
 * 3. 邮箱验证码接口：发送 6 位验证码、校验验证码并完成邮箱验证
 */

const bodyParser = require('body-parser');
const meta = require.main.require('./src/meta');
const db = require.main.require('./src/database');

const DEFAULTS = {
	baseUrl: 'https://api.deepseek.com',
	model: 'deepseek-chat',
	maxInputChars: 2000,
	maxTokens: 800,
	timeoutMs: 45000,
	limitPerMinute: 8,
};

// 支持的两家服务（都是 OpenAI 兼容接口，所以调用代码不用变）
const PROVIDERS = {
	deepseek: {
		name: 'DeepSeek',
		base: 'https://api.deepseek.com',
		model: 'deepseek-chat',
	},
	zhipu: {
		name: '智谱 GLM',
		base: 'https://open.bigmodel.cn/api/paas/v4',
		model: 'glm-4-flash',
	},
};

// 读取当前生效的 AI 配置（provider 决定默认地址和模型）
function aiConfig() {
	const provider = String(meta.config.campusAiProvider || 'deepseek').toLowerCase();
	const preset = PROVIDERS[provider] || PROVIDERS.deepseek;
	return {
		provider,
		providerName: preset.name,
		key: String(meta.config.campusAiKey || '').trim(),
		base: String(meta.config.campusAiBase || preset.base).replace(/\/+$/, ''),
		model: String(meta.config.campusAiModel || preset.model),
	};
}

const SYSTEM_PROMPT = [
	'你是一个友好、靠谱的 AI 助手，正在和中文用户对话。',
	'要求：',
	'1. 用简体中文回答，语气自然亲切，不要端着，也不要过度卖萌。',
	'2. 什么都能问：学习知识、写东西、翻译、编程、生活常识、情绪倾诉都可以正常回答。',
	'3. 回答清晰有条理；简单问题就直接答，复杂问题可以用要点分条说明。',
	'4. 不确定的事情就直说不确定，不要编造事实、数据或引用。',
	'5. 拒绝违法、作弊、代写论文作业、侵犯隐私这类请求，并简短说明原因。',
	'6. 如果对方情绪低落或提到自伤，先共情，并建议联系学校心理咨询中心或身边信任的人。',
].join('\n');

// 额度：每人每天 50 次，另外加 2 秒的最短间隔防连点
const DAILY_LIMIT = 50;
const MIN_INTERVAL_MS = 2000;
const lastCallAt = new Map();

function todayKey() {
	return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

async function consumeQuota(uid) {
	// 防连点
	const last = lastCallAt.get(uid) || 0;
	if (Date.now() - last < MIN_INTERVAL_MS) {
		return { ok: false, message: '慢一点，刚问过啦，2 秒后再发' };
	}

	const key = `campus:ai:quota:${todayKey()}:${uid}`;
	const used = await db.increment(key);
	if (used === 1) {
		await db.expire(key, 60 * 60 * 30); // 30 小时后自动清理
	}
	if (used > DAILY_LIMIT) {
		return { ok: false, message: `今天的 ${DAILY_LIMIT} 次 AI 对话已经用完了，明天再来吧` };
	}

	lastCallAt.set(uid, Date.now());
	return { ok: true, remaining: Math.max(0, DAILY_LIMIT - used) };
}

async function remainingQuota(uid) {
	const used = parseInt(await db.get(`campus:ai:quota:${todayKey()}:${uid}`) || 0, 10);
	return Math.max(0, DAILY_LIMIT - used);
}


function maskEmail(email) {
	const [name, domain] = String(email).split('@');
	if (!domain) return email;
	const head = name.slice(0, 2);
	return `${head}${'*'.repeat(Math.max(2, name.length - 2))}@${domain}`;
}

const VERIFY = {
	codeTtlMs: 10 * 60 * 1000, // 10 分钟有效
	resendCooldownMs: 60 * 1000, // 60 秒才能重发
	maxAttempts: 5,
};

const plugin = {};

// 注册时把用户填的邮箱先记住（此时 NodeBB 还没把它写进 user 表）
plugin.onUserCreate = async function (data) {
	try {
		const uid = data && data.user && data.user.uid;
		const email = data && data.data && data.data.email;
		if (uid && email) {
			await db.set(`campus:pending-email:${uid}`, String(email).trim());
		}
	} catch (err) {
		console.error('[campus-verify] 记录待验证邮箱失败', err.message);
	}
};

// ============ @EVA：帖子里 @EVA 就由 AI 回复 ============
let evaUidCache = 0;
const evaLastReply = new Map(); // tid -> 时间戳，防止刷屏

function stripHtml(html) {
	return String(html || '')
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<\/(p|div|li)>/gi, '\n')
		.replace(/<[^>]+>/g, '')
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

async function ensureEvaExempt(uid) {
	try {
		const groups = require.main.require('./src/groups');
		const exists = await groups.exists('bots');
		if (!exists) {
			await groups.create({ name: 'bots', description: 'AI 机器人账号', hidden: 1 });
		}
		await groups.join('bots', uid);

		const list = (meta.config.groupsExemptFromNewUserRestrictions || []).slice();
		if (!list.includes('bots')) {
			list.push('bots');
			await meta.settings.set('config', { groupsExemptFromNewUserRestrictions: list });
		}
	} catch (err) {
		console.error('[EVA] 设置新用户限制豁免失败:', err.message);
	}
}

async function getEvaUid() {
	if (evaUidCache) return evaUidCache;

	const crypto = require('crypto');
	const user = require.main.require('./src/user');

	let uid = await user.getUidByUsername('EVA');
	if (!uid) {
		uid = await user.create({
			username: 'EVA',
			password: crypto.randomBytes(24).toString('hex'),
			email: 'eva-bot@example.com',
		});
		await user.setUserFields(uid, {
			'email:confirmed': 1,
			// 把注册时间往前挪，避开「新用户发帖限制」
			joindate: Date.now() - 30 * 24 * 60 * 60 * 1000,
			signature: '我是论坛的 AI 助手 EVA —— 在帖子里 @EVA 就能叫我，可以回答问题、翻译、查站内帖子。',
			aboutme: 'AI 助手，随时待命。',
		});
		console.log('[EVA] 已创建 AI 助手账号 uid =', uid);
	}

	// 让 EVA 不再受「新用户发帖太频繁」限制
	await ensureEvaExempt(uid);

	evaUidCache = parseInt(uid, 10);
	return evaUidCache;
}

async function searchForum(term, uid) {
	try {
		const search = require.main.require('./src/search');
		const result = await search.search({
			term,
			searchIn: 'titlesposts',
			uid,
			start: 0,
			stop: 4,
		});
		const posts = (result && result.posts) || [];
		return posts.slice(0, 4).map((p) => {
			const title = (p.topic && p.topic.title) || p.title || '';
			const snippet = stripHtml(p.content).slice(0, 260).replace(/\n+/g, ' ');
			return `【帖子】${title}：${snippet}`;
		});
	} catch (err) {
		console.error('[EVA] 站内搜索失败:', err.message);
		return [];
	}
}

async function askEva({ question, topicTitle, topicPosts, searchResults }) {
	const ai = aiConfig();
	const apiKey = ai.key;
	if (!apiKey) return null;

	const base = ai.base;
	const model = ai.model;

	const system = [
		'你是校园论坛的 AI 助手，名字叫 EVA，被用户在帖子里 @ 时出来回答。',
		'规则：',
		'1. 用简体中文回答，简洁有条理，一般不超过 300 字。',
		'2. 如果用户要求“翻译”，就把用户给出的内容翻译成目标语言（没指定就中译英/英译中）。',
		'3. 如果提供了【站内搜索结果】，优先用这些内容回答站内相关问题，并说明来自哪个帖子。',
		'4. 不确定就说不确定，不要编造。',
		'5. 不提供作弊、违法、侵犯隐私的内容。',
	].join('\n');

	const context = [
		topicTitle ? `当前主题：《${topicTitle}》` : '',
		topicPosts && topicPosts.length ? `主题最近的发言：\n${topicPosts.join('\n')}` : '',
		searchResults && searchResults.length ? `站内搜索到的相关帖子：\n${searchResults.join('\n')}` : '站内没有搜到特别相关的帖子。',
	].filter(Boolean).join('\n\n');

	try {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), DEFAULTS.timeoutMs);
		const response = await fetch(`${base}/chat/completions`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
			body: JSON.stringify({
				model,
				messages: [
					{ role: 'system', content: system },
					{ role: 'user', content: `${context}\n\n用户 @EVA 说：${question}` },
				],
				temperature: 0.6,
				max_tokens: 600,
			}),
			signal: controller.signal,
		}).finally(() => clearTimeout(timer));

		const data = await response.json().catch(() => ({}));
		if (!response.ok) {
			console.error('[EVA] AI 返回错误:', (data.error && data.error.message) || response.status);
			return null;
		}
		return (data.choices && data.choices[0] && data.choices[0].message.content || '').trim() || null;
	} catch (err) {
		console.error('[EVA] 调用 AI 失败:', err.message);
		return null;
	}
}

plugin.onPostSave = async function (data) {
	try {
		const post = data && data.post;
		if (!post || !post.tid || !post.content) return;
		if (!/@\s?(eva|ai)/i.test(stripHtml(post.content))) return;

		const evaUid = await getEvaUid();
		if (!evaUid || parseInt(post.uid, 10) === evaUid) return;

		// 同一主题 30 秒内只回一次，避免刷屏
		const last = evaLastReply.get(post.tid) || 0;
		if (Date.now() - last < 30 * 1000) return;
		evaLastReply.set(post.tid, Date.now());

		const topics = require.main.require('./src/topics');
		const posts = require.main.require('./src/posts');

		const topicTitle = await topics.getTopicField(post.tid, 'title');
		const question = stripHtml(post.content).replace(/@\s?(eva|ai)/ig, '').trim();

		let topicContext = [];
		try {
			const recent = await posts.getPostsByTid(post.tid, Math.max(0, (post.postcount || 1) - 4), 20);
			topicContext = (recent || [])
				.filter((p) => p && p.pid !== post.pid)
				.slice(-4)
				.map((p) => `${p.user && p.user.username ? p.user.username : '某人'}：${stripHtml(p.content).slice(0, 160)}`);
		} catch (e) {}

		const searchResults = question ? await searchForum(question.slice(0, 60), evaUid) : [];

		const answer = await askEva({ question, topicTitle, topicPosts: topicContext, searchResults });
		if (!answer) return;

		await topics.reply({
			uid: evaUid,
			tid: post.tid,
			content: `> 🤖 **EVA** 回复\n\n${answer}`,
		});
	} catch (err) {
		console.error('[EVA] 回复失败:', err.message);
	}
};

// ============ 热点速看：抓取公开资讯源 ============
const HOT_SOURCES = {
	baidu: { name: '百度热搜', url: 'https://news.baidu.com/' },
	sina: { name: '新浪要闻', url: 'https://feed.mix.sina.com.cn/api/roll/get?pageid=153&lid=2509&num=20' },
	chinanews: { name: '中新网', url: 'https://www.chinanews.com.cn/rss/scroll-news.xml', type: 'rss' },
	anime: { name: '动漫', url: 'https://api.bilibili.com/x/web-interface/ranking/v2?rid=1&type=all', type: 'bili' },
	game: { name: '游戏', url: 'https://www.yystv.cn/rss/feed', type: 'rss' },
	book: { name: '文学', url: 'https://www.douban.com/feed/review/book', type: 'rss' },
	physics: { name: '物理', url: 'https://kexue.fm/feed', type: 'rss' },
};

const HOT_TTL = 12 * 60 * 60 * 1000; // 缓存 12 小时，避免频繁请求
const hotCache = new Map();

// 通用 RSS / Atom 解析
function parseRss(xml) {
	const items = [];
	const clean = (s) => decodeEntities(
		String(s)
			.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
			.replace(/<[^>]+>/g, '')
			.trim()
	);

	const isAtom = /<entry[\s>]/.test(xml);
	const blockRe = isAtom ? /<entry[\s>][\s\S]*?<\/entry>/g : /<item[\s>][\s\S]*?<\/item>/g;
	const blocks = xml.match(blockRe) || [];

	for (const block of blocks) {
		if (items.length >= 20) break;
		const t = block.match(/<title[^>]*>([\s\S]*?)<\/title>/);
		let url = '';
		if (isAtom) {
			const link = block.match(/<link[^>]*href="([^"]+)"/);
			url = link ? link[1] : '';
		} else {
			const link = block.match(/<link>([\s\S]*?)<\/link>/);
			url = link ? link[1].trim() : '';
		}
		const title = t ? clean(t[1]) : '';
		if (title && url) {
			items.push({ title, url: decodeEntities(url.trim()) });
		}
	}
	return items;
}

function decodeEntities(str) {
	return String(str || '')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&nbsp;/g, ' ');
}

async function fetchHot(source) {
	const key = HOT_SOURCES[source] ? source : 'baidu';
	const cfg = HOT_SOURCES[key];

	const cached = hotCache.get(key);
	if (cached && Date.now() - cached.at < HOT_TTL) {
		return cached.items;
	}

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 12000);
	let buf;
	try {
		const res = await fetch(cfg.url, {
			headers: {
				'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
				...(cfg.url.includes('bilibili.com') ? { Referer: 'https://www.bilibili.com/' } : {}),
			},
			signal: controller.signal,
		});
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		buf = Buffer.from(await res.arrayBuffer());
	} finally {
		clearTimeout(timer);
	}

	let items = [];

	if (key === 'baidu') {
		const html = buf.toString('utf8');
		const block = html.match(/class="hotwords[^"]*"[\s\S]*?<\/ul>/);
		if (block) {
			const re = /<a[^>]*title="([^"]{2,80})"[^>]*>/g;
			let m;
			while ((m = re.exec(block[0])) && items.length < 20) {
				items.push({ title: decodeEntities(m[1]), url: `https://www.baidu.com/s?wd=${encodeURIComponent(decodeEntities(m[1]))}` });
			}
		}
	} else if (cfg.type === 'rss') {
		items = parseRss(buf.toString('utf8'));
	} else if (cfg.type === 'bili') {
		const json = JSON.parse(buf.toString('utf8'));
		const list = (json.data && json.data.list) || [];
		list.forEach((v) => {
			if (items.length >= 20) return;
			const url = v.bvid ? `https://www.bilibili.com/video/${v.bvid}` : (v.short_link_v2 || '');
			if (v.title && url) items.push({ title: v.title, url });
		});
	} else {
		const json = JSON.parse(buf.toString('utf8'));
		const list = (json.result && json.result.data) || [];
		list.forEach((d) => {
			if (items.length >= 20) return;
			items.push({ title: decodeEntities(d.title), url: d.url });
		});
	}

	items = items.filter((i) => i.title && i.url && i.title.length > 1).slice(0, 20);
	hotCache.set(key, { at: Date.now(), items });
	return items;
}

plugin.init = async function (params) {
	const { router, middleware } = params;

	console.log('[campus-ai] plugin init：路由已注册');

	// 体检用的只读接口，用来确认插件是否真的加载了
	router.get('/api/campus-ai/ping', (req, res) => {
		res.json({ ok: true, plugin: 'nodebb-plugin-campus-ai' });
	});

	// 查询今天还剩几次 AI 对话
	router.get('/api/campus-ai/quota', middleware.authenticateRequest, async (req, res) => {		const uid = parseInt(req.uid, 10);
		if (!uid) {
			return res.json({ remaining: 0 });
		}
		try {
			res.json({ remaining: await remainingQuota(uid) });
		} catch (err) {
			res.json({ remaining: 0 });
		}
	});

	// 热点速看：抓取公开资讯源
	router.get('/api/campus/hot', async (req, res) => {
		const source = String((req.query && req.query.source) || 'baidu');
		try {
			const items = await fetchHot(source);
			res.json({
				source,
				name: (HOT_SOURCES[source] || HOT_SOURCES.baidu).name,
				sources: Object.entries(HOT_SOURCES).map(([id, s]) => ({ id, name: s.name })),
				items,
				at: Date.now(),
			});
		} catch (err) {
			res.status(502).json({
				error: `热点抓取失败：${err.message}`,
				source,
				sources: Object.entries(HOT_SOURCES).map(([id, s]) => ({ id, name: s.name })),
				items: [],
			});
		}
	});

	// 搜索建议：按用户名或 UID 找人
	// ---------- 站内搜索：用户 + 帖子（解决中文分词搜不到的问题） ----------
	router.get('/api/campus/find', async (req, res) => {
		const q = String((req.query && req.query.q) || '').trim();
		const limit = Math.min(parseInt((req.query && req.query.limit) || '10', 10) || 10, 30);
		if (!q) {
			return res.json({ users: [], posts: [] });
		}

		const stripHtml = (html) =>
			String(html || '')
				.replace(/<br\s*\/?>/gi, ' ')
				.replace(/<\/(p|div|li)>/gi, ' ')
				.replace(/<[^>]+>/g, '')
				.replace(/&nbsp;/g, ' ')
				.replace(/&amp;/g, '&')
				.replace(/&lt;/g, '<')
				.replace(/&gt;/g, '>')
				.replace(/&quot;/g, '"')
				.replace(/&#39;/g, "'")
				.replace(/\s+/g, ' ')
				.trim();

		const snippet = (text, term) => {
			if (!text) return '';
			const lower = text.toLowerCase();
			const idx = lower.indexOf(term.toLowerCase());
			if (idx < 0) return text.slice(0, 90);
			const start = Math.max(0, idx - 30);
			const end = Math.min(text.length, idx + term.length + 60);
			return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
		};

		let users = [];
		let posts = [];

		// ① 用户
		try {
			const user = require.main.require('./src/user');
			if (/^\d{1,10}$/.test(q)) {
				const data = await user.getUserFields(parseInt(q, 10), [
					'uid', 'username', 'userslug', 'picture', 'reputation', 'postcount', 'joindate',
				]);
				users = data && data.username && data.uid ? [data] : [];
			} else {
				const result = await user.search({ query: q, searchBy: 'username', paginate: false });
				users = (result && result.users ? result.users : []).slice(0, 6);
			}
		} catch (err) {
			users = [];
		}

		// ② 帖子正文 + 标题（ILIKE 模糊匹配，中文不做分词也能命中）
		try {
			const like = '%' + q.replace(/[\\%_]/g, (m) => '\\' + m) + '%';

			const byContent = await db.pool.query(
				`SELECT p.data->>'tid' AS tid,
				        p.data->>'content' AS content,
				        COALESCE(t.data->>'title', '') AS title,
				        COALESCE(t.data->>'slug', '') AS slug,
				        COALESCE((p.data->>'timestamp')::bigint, 0) AS ts
				 FROM legacy_hash p
				 LEFT JOIN legacy_hash t ON t._key = 'topic:' || (p.data->>'tid')
				 WHERE p._key LIKE 'post:%'
				   AND p.data->>'content' ILIKE $1
				 ORDER BY ts DESC
				 LIMIT $2`,
				[like, limit]
			);

			const seen = new Set();
			posts = (byContent.rows || []).map((r) => {
				const text = stripHtml(r.content);
				const tid = parseInt(r.tid, 10);
				seen.add(tid);
				return {
					tid,
					title: r.title || '无标题帖子',
					slug: r.slug || String(tid),
					snippet: snippet(text, q),
					timestamp: Number(r.ts) || 0,
				};
			});

			// 正文没命中时，再按标题找一遍
			if (!posts.length) {
				const byTitle = await db.pool.query(
					`SELECT data->>'tid' AS tid,
					        data->>'title' AS title,
					        data->>'slug' AS slug,
					        COALESCE((data->>'timestamp')::bigint, 0) AS ts
					 FROM legacy_hash
					 WHERE _key LIKE 'topic:%'
					   AND data->>'title' ILIKE $1
					 ORDER BY ts DESC
					 LIMIT $2`,
					[like, limit]
				);
				posts = (byTitle.rows || []).map((r) => ({
					tid: parseInt(r.tid, 10),
					title: r.title || '无标题帖子',
					slug: r.slug || String(parseInt(r.tid, 10)),
					snippet: snippet(String(r.title || ''), q),
					timestamp: Number(r.ts) || 0,
				}));
			}
		} catch (err) {
			console.error('[campus/find] 搜索失败:', err.message);
			posts = [];
		}

		return res.json({ users, posts });
	});

	// 发送邮箱验证码
	router.post(
		'/api/campus/verify/send',
		bodyParser.json({ limit: '16kb' }),
		middleware.authenticateRequest,
		async (req, res) => {
			try {
				const uid = parseInt(req.uid, 10);
				if (!uid) {
					return res.status(401).json({ error: '请先登录' });
				}

				const user = require.main.require('./src/user');
				const confirmed = await user.getUserField(uid, 'email:confirmed');
				if (parseInt(confirmed, 10) === 1) {
					return res.json({ ok: true, alreadyVerified: true });
				}

				// 冷却时间
				const last = parseInt(await db.get(`campus:code-sent:${uid}`) || 0, 10);
				if (last && Date.now() - last < VERIFY.resendCooldownMs) {
					const wait = Math.ceil((VERIFY.resendCooldownMs - (Date.now() - last)) / 1000);
					return res.status(429).json({ error: `刚刚已经发过了，${wait} 秒后再试` });
				}

				const pending = await db.get(`campus:pending-email:${uid}`);
				const current = await user.getUserField(uid, 'email');
				const email = String(pending || current || '').trim();
				if (!email) {
					return res.status(400).json({ error: '没有找到待验证的邮箱地址' });
				}

				const code = String(Math.floor(100000 + Math.random() * 900000));
				await db.set(`campus:code:${uid}`, JSON.stringify({
					code,
					email,
					expires: Date.now() + VERIFY.codeTtlMs,
					attempts: 0,
				}));
				await db.set(`campus:code-sent:${uid}`, String(Date.now()));

				await sendCodeEmail(email, code);

				return res.json({ ok: true, email: maskEmail(email) });
			} catch (err) {
				return res.status(500).json({ error: `验证码发送失败：${err.message}` });
			}
		}
	);

	// 校验邮箱验证码
	router.post(
		'/api/campus/verify/check',
		bodyParser.json({ limit: '16kb' }),
		middleware.authenticateRequest,
		async (req, res) => {
			try {
				const uid = parseInt(req.uid, 10);
				if (!uid) {
					return res.status(401).json({ error: '请先登录' });
				}

				const raw = await db.get(`campus:code:${uid}`);
				if (!raw) {
					return res.status(400).json({ error: '验证码已失效，请重新发送' });
				}

				let record;
				try {
					record = JSON.parse(raw);
				} catch (e) {
					return res.status(400).json({ error: '验证码数据异常，请重新发送' });
				}

				if (Date.now() > record.expires) {
					await db.delete(`campus:code:${uid}`);
					return res.status(400).json({ error: '验证码已过期，请重新发送' });
				}

				record.attempts = (record.attempts || 0) + 1;
				if (record.attempts > VERIFY.maxAttempts) {
					await db.delete(`campus:code:${uid}`);
					return res.status(429).json({ error: '错误次数太多，请重新发送验证码' });
				}

				const input = String((req.body && req.body.code) || '').replace(/\D/g, '');
				if (input !== record.code) {
					await db.set(`campus:code:${uid}`, JSON.stringify(record));
					return res.status(400).json({ error: '验证码不正确，请重新输入' });
				}

				const user = require.main.require('./src/user');
				await user.setUserField(uid, 'email', record.email);
				await user.email.confirmByUid(uid);

				await Promise.all([
					db.delete(`campus:code:${uid}`),
					db.delete(`campus:pending-email:${uid}`),
					db.delete(`campus:code-sent:${uid}`),
				]);

				return res.json({ ok: true });
			} catch (err) {
				return res.status(500).json({ error: `验证失败：${err.message}` });
			}
		}
	);

	// ============ 注册：先验证邮箱，再创建账号 ============
	function regKey(email) {
		return `campus:reg:${String(email || '').toLowerCase()}`;
	}

	router.post(
		'/api/campus/register/send',
		bodyParser.json({ limit: '16kb' }),
		async (req, res) => {
			try {
				const user = require.main.require('./src/user');
				const body = req.body || {};
				const username = String(body.username || '').trim();
				const email = String(body.email || '').trim().toLowerCase();
				const password = String(body.password || '');

				if (!username || username.length < 2) {
					return res.status(400).json({ error: '用户名至少 2 个字符' });
				}
				if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
					return res.status(400).json({ error: '邮箱格式不正确' });
				}
				if (password.length < 6) {
					return res.status(400).json({ error: '密码至少 6 位' });
				}

				const emailUid = await user.getUidByEmail(email);
				if (emailUid) {
					return res.status(400).json({ error: '这个邮箱已经注册过了' });
				}
				const nameUid = await user.getUidByUsername(username);
				if (nameUid) {
					return res.status(400).json({ error: '这个用户名已被占用' });
				}

				const last = parseInt(await db.get(regKey(email) + ':sent') || 0, 10);
				if (last && Date.now() - last < VERIFY.resendCooldownMs) {
					const wait = Math.ceil((VERIFY.resendCooldownMs - (Date.now() - last)) / 1000);
					return res.status(429).json({ error: `刚刚已经发过了，${wait} 秒后再试` });
				}

				const code = String(Math.floor(100000 + Math.random() * 900000));
				await db.set(regKey(email), JSON.stringify({
					code,
					expires: Date.now() + VERIFY.codeTtlMs,
					attempts: 0,
				}));
				await db.set(regKey(email) + ':sent', String(Date.now()));

				await sendCodeEmail(email, code);
				return res.json({ ok: true, email: maskEmail(email) });
			} catch (err) {
				return res.status(500).json({ error: `验证码发送失败：${err.message}` });
			}
		}
	);

	router.post(
		'/api/campus/register/verify',
		bodyParser.json({ limit: '16kb' }),
		async (req, res) => {
			try {
				const user = require.main.require('./src/user');
				const body = req.body || {};
				const username = String(body.username || '').trim();
				const email = String(body.email || '').trim().toLowerCase();
				const password = String(body.password || '');
				const input = String(body.code || '').replace(/\D/g, '');

				const raw = await db.get(regKey(email));
				if (!raw) {
					return res.status(400).json({ error: '验证码已失效，请重新发送' });
				}

				let record;
				try {
					record = JSON.parse(raw);
				} catch (e) {
					return res.status(400).json({ error: '验证码数据异常，请重新发送' });
				}

				if (Date.now() > record.expires) {
					await db.delete(regKey(email));
					return res.status(400).json({ error: '验证码已过期，请重新发送' });
				}

				record.attempts = (record.attempts || 0) + 1;
				if (record.attempts > VERIFY.maxAttempts) {
					await db.delete(regKey(email));
					return res.status(429).json({ error: '错误次数太多，请重新发送验证码' });
				}

				if (input !== record.code) {
					await db.set(regKey(email), JSON.stringify(record));
					return res.status(400).json({ error: '验证码不正确，请重新输入' });
				}

				if (await user.getUidByEmail(email)) {
					return res.status(400).json({ error: '这个邮箱已经注册过了' });
				}
				if (await user.getUidByUsername(username)) {
					return res.status(400).json({ error: '这个用户名已被占用' });
				}

				const created = await user.create({ username, password, email });
				const uid = parseInt(created && created.uid, 10);

				await user.setUserField(uid, 'email:confirmed', 1);
				await db.delete(regKey(email));
				await db.delete(regKey(email) + ':sent');

				// 自动登录
				let loggedIn = false;
				try {
					await new Promise((resolve, reject) => {
						req.login({ uid }, (err) => (err ? reject(err) : resolve()));
					});
					loggedIn = true;
				} catch (e) {
					loggedIn = false;
				}

				return res.json({ ok: true, uid, loggedIn });
			} catch (err) {
				return res.status(500).json({ error: `注册失败：${err.message}` });
			}
		}
	);

	// ============ 忘记密码：邮箱验证后重置 ============
	router.post(
		'/api/campus/password/send',
		bodyParser.json({ limit: '16kb' }),
		async (req, res) => {
			try {
				const user = require.main.require('./src/user');
				const email = String((req.body && req.body.email) || '').trim().toLowerCase();

				if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
					return res.status(400).json({ error: '邮箱格式不正确' });
				}

				const uid = await user.getUidByEmail(email);
				if (!uid) {
					return res.status(400).json({ error: '这个邮箱还没有注册' });
				}

				const last = parseInt(await db.get(`campus:pwd:${uid}:sent`) || 0, 10);
				if (last && Date.now() - last < VERIFY.resendCooldownMs) {
					const wait = Math.ceil((VERIFY.resendCooldownMs - (Date.now() - last)) / 1000);
					return res.status(429).json({ error: `刚刚已经发过了，${wait} 秒后再试` });
				}

				const code = String(Math.floor(100000 + Math.random() * 900000));
				await db.set(`campus:pwd:${uid}`, JSON.stringify({
					code,
					email,
					expires: Date.now() + VERIFY.codeTtlMs,
					attempts: 0,
				}));
				await db.set(`campus:pwd:${uid}:sent`, String(Date.now()));

				await sendCodeEmail(email, code);
				return res.json({ ok: true, email: maskEmail(email) });
			} catch (err) {
				return res.status(500).json({ error: `验证码发送失败：${err.message}` });
			}
		}
	);

	router.post(
		'/api/campus/password/reset',
		bodyParser.json({ limit: '16kb' }),
		async (req, res) => {
			try {
				const user = require.main.require('./src/user');
				const body = req.body || {};
				const email = String(body.email || '').trim().toLowerCase();
				const input = String(body.code || '').replace(/\D/g, '');
				const password = String(body.password || '');

				if (password.length < 6) {
					return res.status(400).json({ error: '新密码至少 6 位' });
				}

				const uid = await user.getUidByEmail(email);
				if (!uid) {
					return res.status(400).json({ error: '这个邮箱还没有注册' });
				}

				const raw = await db.get(`campus:pwd:${uid}`);
				if (!raw) {
					return res.status(400).json({ error: '验证码已失效，请重新发送' });
				}

				let record;
				try {
					record = JSON.parse(raw);
				} catch (e) {
					return res.status(400).json({ error: '验证码数据异常，请重新发送' });
				}

				if (Date.now() > record.expires) {
					await db.delete(`campus:pwd:${uid}`);
					return res.status(400).json({ error: '验证码已过期，请重新发送' });
				}

				record.attempts = (record.attempts || 0) + 1;
				if (record.attempts > VERIFY.maxAttempts) {
					await db.delete(`campus:pwd:${uid}`);
					return res.status(429).json({ error: '错误次数太多，请重新发送验证码' });
				}

				if (input !== record.code) {
					await db.set(`campus:pwd:${uid}`, JSON.stringify(record));
					return res.status(400).json({ error: '验证码不正确，请重新输入' });
				}

				await user.setPassword(uid, password);
				await Promise.all([
					db.delete(`campus:pwd:${uid}`),
					db.delete(`campus:pwd:${uid}:sent`),
				]);

				return res.json({ ok: true, username: await user.getUserField(uid, 'username') });
			} catch (err) {
				return res.status(500).json({ error: `修改密码失败：${err.message}` });
			}
		}
	);

	router.post(
		'/api/campus-ai/chat',
		bodyParser.json({ limit: '64kb' }),
		middleware.authenticateRequest,
		async (req, res) => {
			try {
				await handleChat(req, res);
			} catch (err) {
				res.status(500).json({ error: `服务器出错了：${err.message}` });
			}
		}
	);

	// 流式输出（打字机效果）
	router.post(
		'/api/campus-ai/chat/stream',
		bodyParser.json({ limit: '64kb' }),
		middleware.authenticateRequest,
		async (req, res) => {
			try {
				await handleChatStream(req, res);
			} catch (err) {
				try {
					res.status(500).json({ error: `服务器出错了：${err.message}` });
				} catch (e) {}
			}
		}
	);
};

// 各种排序对应的 Redis 集合后缀
const SORT_SUFFIX = {
	recently_created: ':tids:create',
	most_posts: ':tids:posts',
	most_votes: ':tids:votes',
	most_views: ':tids:views',
};

// 找一个板块的所有子版块 cid
async function childrenOf(cid) {
	const parent = parseInt(cid, 10);
	const cids = await db.getSortedSetRange('categories:cid', 0, -1);
	const children = [];
	for (const c of cids) {
		const parentCid = await db.getObjectField(`category:${c}`, 'parentCid');
		if (parseInt(parentCid, 10) === parent) {
			children.push(parseInt(c, 10));
		}
	}
	return children;
}

/**
 * 父板块的帖子列表 = 自己 + 所有子版块，按最后回复时间合并排序。
 * 这样用户点进「学习」就能一次看到「课程与选课 / 考研保研 / 学习资料」的全部帖子。
 */
plugin.getTopicIds = async function (payload) {
	const data = payload.data || {};
	const pinned = payload.pinnedTids || [];
	const cid = parseInt(data.cid, 10);
	const sort = data.sort
		|| (data.settings && data.settings.categoryTopicSort)
		|| meta.config.categoryTopicSort
		|| 'recently_replied';
	const suffix = SORT_SUFFIX[sort] || ':tids';

	const children = await childrenOf(cid);
	const cids = [cid].concat(children);

	// 每个集合取足够条目再合并（论坛体量小，200 条足够翻好几页）
	const sets = cids.map((c) => `cid:${c}${suffix}`);
	const lists = await Promise.all(sets.map((s) => db.getSortedSetRevRangeWithScores(s, 0, 199)));

	const scoreMap = new Map();
	lists.forEach((list) => {
		list.forEach((item) => {
			if (!scoreMap.has(item.value)) {
				scoreMap.set(item.value, item.score);
			}
		});
	});

	// 按“最后回复时间”倒序，并剔除置顶（置顶由框架自己加在列表前面）
	const merged = Array.from(scoreMap.entries())
		.sort((a, b) => b[1] - a[1])
		.map((item) => item[0])
		.filter((tid) => !pinned.includes(tid));

	let start = parseInt(data.start, 10) || 0;
	const totalPinnedCount = payload.totalPinnedCount || 0;
	if (start > 0 && totalPinnedCount) {
		start -= totalPinnedCount - pinned.length;
	}
	const count = payload.normalTidsToGet != null
		? payload.normalTidsToGet
		: ((parseInt(data.stop, 10) || 0) - (parseInt(data.start, 10) || 0) + 1);

	const page = merged.slice(Math.max(0, start), Math.max(0, start) + count);
	return { tids: pinned.concat(page) };
};

// 父板块的「主题数」把子版块也算上
plugin.getTopicCount = async function (payload) {
	const data = payload.data || {};
	const children = await childrenOf(parseInt(data.cid, 10));
	if (!children.length) {
		return { topicCount: payload.topicCount };
	}

	let total = parseInt(payload.topicCount, 10) || 0;
	for (const c of children) {
		const count = parseInt(await db.getObjectField(`category:${c}`, 'topic_count'), 10) || 0;
		total += count;
	}
	return { topicCount: total };
};

async function sendCodeEmail(email, code) {	const Emailer = require.main.require('./src/emailer');
	const transport = Emailer.createSmtpTransport(meta.config);
	const fromName = meta.config['email:from_name'] || meta.config.title || '校园论坛';
	const from = meta.config['email:from'];

	try {
		await transport.sendMail({
			from: `"${fromName}" <${from}>`,
			to: email,
			subject: `【${fromName}】邮箱验证码：${code}`,
			text: `你的邮箱验证码是：${code}\n\n10 分钟内有效，请回到论坛页面输入完成注册。\n如果不是你本人操作，请忽略这封邮件。`,
			html: `<div style="font-family:system-ui,'Microsoft YaHei';line-height:1.8;font-size:15px">
				<p>你好，欢迎加入 <b>${fromName}</b>！</p>
				<p>你的邮箱验证码是：</p>
				<p style="font-size:28px;font-weight:700;letter-spacing:6px;color:#f7608a;margin:12px 0">${code}</p>
				<p>验证码 <b>10 分钟</b>内有效，请回到论坛页面输入以完成注册。</p>
				<p style="color:#888;font-size:12px">如果不是你本人操作，请忽略这封邮件。</p>
			</div>`,
		});
	} finally {
		if (transport && typeof transport.close === 'function') {
			transport.close();
		}
	}
}

// 校验 + 组装请求，返回 { error, status } 或 { uid, apiKey, base, model, messages, remaining }
async function prepareChat(req) {
	const uid = parseInt(req.uid, 10);
	if (!uid) {
		return { error: '请先登录后再使用 AI 助手', status: 401 };
	}

	const ai = aiConfig();
	const apiKey = ai.key;
	if (!apiKey) {
		return { error: '管理员还没有配置 AI 的 API Key', status: 503 };
	}

	const message = String((req.body && req.body.message) || '').slice(0, DEFAULTS.maxInputChars).trim();
	if (!message) {
		return { error: '消息不能为空', status: 400 };
	}

	const quota = await consumeQuota(uid);
	if (!quota.ok) {
		return { error: quota.message, status: 429 };
	}

	const base = ai.base;
	const model = ai.model;

	const history = Array.isArray(req.body && req.body.history) ? req.body.history.slice(-6) : [];
	const messages = [
		{ role: 'system', content: SYSTEM_PROMPT },
		...history
			.filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
			.map((m) => ({ role: m.role, content: m.content.slice(0, DEFAULTS.maxInputChars) })),
		{ role: 'user', content: message },
	];

	return { uid, apiKey, base, model, messages, remaining: quota.remaining };
}

async function handleChat(req, res) {
	const ctx = await prepareChat(req);
	if (ctx.error) {
		return res.status(ctx.status).json({ error: ctx.error });
	}

	try {
		const response = await fetch(`${ctx.base}/chat/completions`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${ctx.apiKey}`,
			},
			body: JSON.stringify({
				model: ctx.model,
				messages: ctx.messages,
				temperature: 0.7,
				max_tokens: DEFAULTS.maxTokens,
				stream: false,
			}),
			signal: AbortSignal.timeout(DEFAULTS.timeoutMs),
		});

		const data = await response.json().catch(() => ({}));
		if (!response.ok) {
			const detail = (data && data.error && data.error.message) || `HTTP ${response.status}`;
			return res.status(502).json({ error: `AI 服务返回错误：${detail}` });
		}

		const reply = data && data.choices && data.choices[0] && data.choices[0].message
			? String(data.choices[0].message.content || '').trim()
			: '';

		return res.json({ reply: reply || '（AI 这次没有回答，换个问法试试？）', remaining: ctx.remaining });
	} catch (err) {
		if (err.name === 'TimeoutError' || err.name === 'AbortError') {
			return res.status(504).json({ error: 'AI 响应超时了，稍后再试一次' });
		}
		return res.status(502).json({ error: `连不上 AI 服务：${err.message}` });
	}
}

// 流式输出（打字机效果）：逐块把 AI 的回答推给浏览器
async function handleChatStream(req, res) {
	const ctx = await prepareChat(req);
	if (ctx.error) {
		return res.status(ctx.status).json({ error: ctx.error });
	}

	res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
	res.setHeader('Cache-Control', 'no-cache, no-transform');
	res.setHeader('Connection', 'keep-alive');
	res.setHeader('X-Accel-Buffering', 'no');
	if (typeof res.flushHeaders === 'function') {
		res.flushHeaders();
	}

	// 先把今日剩余次数告诉前端
	res.write(`data: ${JSON.stringify({ meta: { remaining: ctx.remaining } })}\n\n`);

	const controller = new AbortController();
	const onClose = () => controller.abort();
	req.on('close', onClose);

	try {
		const response = await fetch(`${ctx.base}/chat/completions`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${ctx.apiKey}`,
				Accept: 'text/event-stream',
			},
			body: JSON.stringify({
				model: ctx.model,
				messages: ctx.messages,
				temperature: 0.7,
				max_tokens: DEFAULTS.maxTokens,
				stream: true,
			}),
			signal: AbortSignal.any
				? AbortSignal.any([controller.signal, AbortSignal.timeout(DEFAULTS.timeoutMs)])
				: controller.signal,
		});

		if (!response.ok) {
			const data = await response.json().catch(() => ({}));
			const detail = (data && data.error && data.error.message) || `HTTP ${response.status}`;
			res.write(`data: ${JSON.stringify({ error: `AI 服务返回错误：${detail}` })}\n\n`);
			res.end();
			return;
		}

		const reader = response.body.getReader();
		const decoder = new TextDecoder('utf-8');
		let buffer = '';

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split('\n');
			buffer = lines.pop() || '';

			for (const line of lines) {
				const trimmed = line.trim();
				if (!trimmed.startsWith('data:')) continue;
				const payload = trimmed.slice(5).trim();
				if (!payload) continue;
				if (payload === '[DONE]') {
					res.write('data: [DONE]\n\n');
					res.end();
					return;
				}
				try {
					const json = JSON.parse(payload);
					const delta = json.choices && json.choices[0] && json.choices[0].delta
						? json.choices[0].delta.content
						: '';
					if (delta) {
						res.write(`data: ${JSON.stringify({ delta })}\n\n`);
					}
				} catch (e) {
					// 忽略解析不了的行
				}
			}
		}

		res.write('data: [DONE]\n\n');
		res.end();
	} catch (err) {
		const msg = (err.name === 'TimeoutError' || err.name === 'AbortError')
			? 'AI 响应超时了，稍后再试一次'
			: `连不上 AI 服务：${err.message}`;
		try {
			res.write(`data: ${JSON.stringify({ error: msg })}\n\n`);
			res.end();
		} catch (e) {}
	} finally {
		req.removeListener('close', onClose);
	}
}

module.exports = plugin;
