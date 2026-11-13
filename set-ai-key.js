'use strict';

/*
 * 一次性小工具：在浏览器里安全地配置 AI（智谱 / DeepSeek）。
 * 保存前会先拿 Key 真调一次接口，验证有效才写入数据库。
 * 打开 http://127.0.0.1:5599 使用，填完就可以关掉。
 */
const fs = require('fs');
const path = require('path');
const express = require('express');
const { Client } = require('pg');

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const p = cfg.postgres;

const PROVIDERS = {
	zhipu: {
		name: '智谱 GLM（国内直连，glm-4-flash 免费）',
		base: 'https://open.bigmodel.cn/api/paas/v4',
		model: 'glm-4-flash',
		signup: 'https://open.bigmodel.cn',
		keyHint: '智谱的 Key 形如 xxxxxxxx.xxxxxxxx（中间有一个点）',
	},
	deepseek: {
		name: 'DeepSeek（国内直连，按量计费）',
		base: 'https://api.deepseek.com',
		model: 'deepseek-chat',
		signup: 'https://platform.deepseek.com',
		keyHint: 'DeepSeek 的 Key 以 sk- 开头',
	},
};

const app = express();
app.use(express.urlencoded({ extended: true, limit: '32kb' }));

const page = (body) => `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>配置 AI</title></head>
<body style="font-family:system-ui,'Microsoft YaHei';max-width:660px;margin:44px auto;padding:0 16px;line-height:1.9;font-size:17px">
${body}</body></html>`;

async function db(fn) {
	const client = new Client({ host: p.host, port: p.port, user: p.username, password: p.password, database: p.database });
	await client.connect();
	try {
		return await fn(client);
	} finally {
		await client.end();
	}
}

async function readConfig() {
	return db(async (client) => {
		const r = await client.query(`SELECT data FROM legacy_hash WHERE _key = 'config'`);
		return r.rows[0].data;
	});
}

function mask(key) {
	if (!key) return '（还没配置）';
	return `${key.slice(0, 6)}****${key.slice(-4)}`;
}

app.get('/', async (req, res, next) => {
	try {
		const d = await readConfig();
		const provider = d.campusAiProvider || 'deepseek';
		const preset = PROVIDERS[provider] || PROVIDERS.deepseek;
		const key = d.campusAiKey || '';
		const model = d.campusAiModel || preset.model;

		const options = Object.entries(PROVIDERS)
			.map(([id, item]) => `<option value="${id}"${id === provider ? ' selected' : ''}>${item.name}</option>`)
			.join('');

		res.send(page(`
			<h2>配置 AI 助手</h2>
			<p>当前：<b>${preset.name}</b>　模型 <code>${model}</code>　Key <code>${mask(key)}</code></p>
			<form method="post" action="/save">
				<p>选择服务商：<br>
				<select name="provider" style="width:100%;padding:10px;font-size:16px;margin-top:6px">${options}</select></p>

				<p>API Key：<br>
				<input type="password" name="key" placeholder="粘贴 Key" autocomplete="off" required
					style="width:100%;padding:10px;font-size:16px;margin-top:6px"></p>

				<p>模型（留空则用默认）：<br>
				<input type="text" name="model" placeholder="glm-4-flash / deepseek-chat"
					style="width:100%;padding:10px;font-size:16px;margin-top:6px"></p>

				<p><button type="submit" style="padding:10px 26px;font-size:17px">测试并保存</button></p>
			</form>
			<p style="color:#888;font-size:14px">
				点保存后会先拿这个 Key 真的问一次 AI：<br>
				· 通过 → 写入论坛，并提示重启<br>
				· 不通过 → 立刻显示失败原因（Key 失效 / 模型名错 / 余额不足）
			</p>
			<p style="color:#888;font-size:13px">
				没注册过？智谱：<a href="https://open.bigmodel.cn" target="_blank">open.bigmodel.cn</a>（glm-4-flash 免费额度够用）　
				DeepSeek：<a href="https://platform.deepseek.com" target="_blank">platform.deepseek.com</a>
			</p>
		`));
	} catch (e) {
		next(e);
	}
});

app.post('/save', async (req, res) => {
	const provider = String(req.body.provider || 'deepseek');
	const preset = PROVIDERS[provider] || PROVIDERS.deepseek;
	const key = String(req.body.key || '').trim();
	const model = String(req.body.model || '').trim() || preset.model;

	if (!key) {
		return res.send(page('<h2>❌ Key 不能为空</h2><p><a href="/">返回</a></p>'));
	}
	if (provider === 'deepseek' && !key.startsWith('sk-')) {
		return res.send(page('<h2>❌ DeepSeek 的 Key 应该以 sk- 开头</h2><p><a href="/">返回</a></p>'));
	}
	if (provider === 'zhipu' && !key.includes('.')) {
		return res.send(page('<h2>❌ 智谱的 Key 中间应该有一个点</h2><p>形如 <code>xxxxxxxx.xxxxxxxx</code>，去 open.bigmodel.cn 重新复制一次。<a href="/">返回</a></p>'));
	}

	let ok = false;
	let detail = '';
	try {
		const r = await fetch(`${preset.base}/chat/completions`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
			body: JSON.stringify({
				model,
				messages: [{ role: 'user', content: '回复 OK' }],
				max_tokens: 8,
				stream: false,
			}),
			signal: AbortSignal.timeout(30000),
		});
		const j = await r.json().catch(() => ({}));
		if (r.ok) {
			ok = true;
		} else {
			detail = (j.error && (j.error.message || j.error.code)) || JSON.stringify(j).slice(0, 200) || `HTTP ${r.status}`;
		}
	} catch (e) {
		detail = e.message;
	}

	if (!ok) {
		return res.send(page(`
			<h2>❌ 这个 Key 不能用</h2>
			<p style="padding:10px 12px;background:#fef3f2;border:1px solid #fecdca;border-radius:8px;font-size:15px">
				${String(detail).replace(/</g, '&lt;')}
			</p>
			<ul>
				<li>确认是 <b>${preset.name}</b> 的 Key（别把两家的 Key 弄混）</li>
				<li>${preset.keyHint}</li>
				<li>模型名是否正确（智谱：glm-4-flash；DeepSeek：deepseek-chat）</li>
				<li>账户是否还有额度 / 是否实名认证过</li>
			</ul>
			<p><a href="/">← 返回重填</a></p>
		`));
	}

	await db(async (client) => {
		const r = await client.query(`SELECT data FROM legacy_hash WHERE _key = 'config'`);
		const d = r.rows[0].data;
		d.campusAiProvider = provider;
		d.campusAiKey = key;
		d.campusAiModel = model;
		d.campusAiBase = preset.base;
		await client.query(`UPDATE legacy_hash SET data = $1::jsonb WHERE _key = 'config'`, [JSON.stringify(d)]);
	});

	res.send(page(`
		<h2>✅ 测试通过，已保存</h2>
		<p>服务商：<b>${preset.name}</b>　模型：<code>${model}</code></p>
		<p style="color:#b45309">👉 现在告诉我「配好了」，我重启一次论坛就生效。</p>
	`));
});

app.listen(5599, '127.0.0.1', () => {
	console.log('AI 配置页：http://127.0.0.1:5599');
});
