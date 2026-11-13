'use strict';

/*
 * QQ 邮箱 SMTP 配置向导（只在本地运行）
 * 打开 http://127.0.0.1:5600 填写 QQ 邮箱 + 授权码，
 * 保存到 NodeBB 设置，并立即发一封测试邮件验证是否真的能发出去。
 */
const fs = require('fs');
const path = require('path');
const express = require('express');
const nodemailer = require('nodemailer');
const { Client } = require('pg');

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const p = cfg.postgres;

const app = express();
app.use(express.urlencoded({ extended: true, limit: '64kb' }));

const page = (body) => `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>QQ 邮箱配置</title></head>
<body style="font-family:system-ui,'Microsoft YaHei';max-width:640px;margin:48px auto;padding:0 16px;line-height:1.9;font-size:17px">
${body}</body></html>`;

async function readConfig() {
	const client = new Client({ host: p.host, port: p.port, user: p.username, password: p.password, database: p.database });
	await client.connect();
	const r = await client.query(`SELECT data FROM legacy_hash WHERE _key = 'config'`);
	await client.end();
	return r.rows[0].data;
}

async function writeConfig(mutator) {
	const client = new Client({ host: p.host, port: p.port, user: p.username, password: p.password, database: p.database });
	await client.connect();
	const r = await client.query(`SELECT data FROM legacy_hash WHERE _key = 'config'`);
	const data = r.rows[0].data;
	mutator(data);
	await client.query(`UPDATE legacy_hash SET data = $1::jsonb WHERE _key = 'config'`, [JSON.stringify(data)]);
	await client.end();
	return data;
}

app.get('/', async (req, res, next) => {
	try {
		const d = await readConfig();
		const current = d['email:smtpTransport:user'] || '';
		const enabled = d['email:smtpTransport:enabled'] ? '已开启' : '未开启';
		const mustConfirm = d.requireEmailAddress ? '已开启' : '未开启';

		res.send(page(`
			<h2>QQ 邮箱发信配置</h2>
			<p style="color:#666;font-size:15px">
				当前状态：SMTP ${enabled}　|　发件邮箱 <code>${current || '（未填写）'}</code>　|　注册需验证邮箱 ${mustConfirm}
			</p>
			<form method="post" action="/save">
				<p>① 你的 QQ 邮箱地址<br>
				<input name="email" type="email" placeholder="123456@qq.com" value="${current}" required
					style="width:100%;padding:10px;font-size:16px;margin-top:6px"></p>

				<p>② QQ 邮箱的「授权码」（16 位字母，不是登录密码）<br>
				<input name="code" type="password" placeholder="abcdefghijklmnop" autocomplete="off" required
					style="width:100%;padding:10px;font-size:16px;margin-top:6px"></p>

				<p>③ 发件人显示名（收件人看到的发件人名字）<br>
				<input name="fromName" type="text" value="${d['email:from_name'] || '校园论坛'}"
					style="width:100%;padding:10px;font-size:16px;margin-top:6px"></p>

				<p style="margin-top:18px">
					<label><input type="checkbox" name="requireEmail" value="1" ${d.requireEmailAddress ? 'checked' : 'checked'}>
					开启「注册必须验证邮箱」（推荐：防止乱注册）</label>
				</p>

				<p><button type="submit" style="padding:12px 30px;font-size:17px">保存并发测试邮件</button></p>
			</form>
			<p style="color:#888;font-size:14px">
				这个页面只在你电脑本地运行；授权码只写进本地数据库。<br>
				保存后会立刻给你的邮箱发一封测试邮件，收到了就说明通了。
			</p>
		`));
	} catch (e) {
		next(e);
	}
});

app.post('/save', async (req, res) => {
	const email = String(req.body.email || '').trim();
	const code = String(req.body.code || '').replace(/\s+/g, '');
	const fromName = String(req.body.fromName || '校园论坛').trim() || '校园论坛';
	const requireEmail = req.body.requireEmail === '1';

	if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
		return res.send(page('<h2>❌ 邮箱格式不对</h2><p><a href="/">返回重填</a></p>'));
	}
	if (code.length < 8) {
		return res.send(page('<h2>❌ 授权码看起来不对</h2><p>QQ 授权码一般是 16 位字母。<a href="/">返回重填</a></p>'));
	}

	// 先用 nodemailer 试发一封，成功后再落库
	const transporter = nodemailer.createTransport({
		host: 'smtp.qq.com',
		port: 465,
		secure: true,
		auth: { user: email, pass: code },
	});

	let sent = false;
	let errText = '';
	try {
		await transporter.verify();
		await transporter.sendMail({
			from: `"${fromName}" <${email}>`,
			to: email,
			subject: '【校园论坛】SMTP 配置成功',
			text: `这是一封测试邮件。\n\n如果你收到了它，说明你的论坛已经可以用这个邮箱给别人发验证邮件了。\n\n发件人：${fromName}\n时间：${new Date().toLocaleString('zh-CN')}`,
			html: `<div style="font-family:system-ui,'Microsoft YaHei';line-height:1.8">
				<h3>🎉 配置成功</h3>
				<p>这是一封测试邮件。</p>
				<p>如果你收到了它，说明你的论坛已经可以用这个邮箱给别人发验证邮件了。</p>
				<p style="color:#888;font-size:13px">发件人：${fromName}　时间：${new Date().toLocaleString('zh-CN')}</p>
			</div>`,
		});
		sent = true;
	} catch (e) {
		errText = e.message;
	}

	if (!sent) {
		return res.send(page(`
			<h2>❌ 测试邮件没发出去</h2>
			<p style="padding:10px 12px;background:#fef3f2;border:1px solid #fecdca;border-radius:8px;font-size:15px">
				${errText.replace(/</g, '&lt;')}
			</p>
			<p>常见原因：</p>
			<ul>
				<li>授权码复制错了 / 复制时带了空格</li>
				<li>QQ 邮箱里的 <b>SMTP 服务没开启</b></li>
				<li>邮箱地址填成了 QQ 号（要填 <code>xxx@qq.com</code>）</li>
			</ul>
			<p><a href="/">← 返回重新填写</a></p>
		`));
	}

	// 发送成功，写入 NodeBB 设置
	await writeConfig((d) => {
		d['email:from'] = email;
		d['email:from_name'] = fromName;
		d['email:smtpTransport:enabled'] = 1;
		d['email:smtpTransport:service'] = 'nodebb-custom-smtp';
		d['email:smtpTransport:host'] = 'smtp.qq.com';
		d['email:smtpTransport:port'] = 465;
		d['email:smtpTransport:security'] = 'ENCRYPTED';
		d['email:smtpTransport:user'] = email;
		d['email:smtpTransport:pass'] = code;
		d['requireEmailAddress'] = requireEmail ? 1 : 0;
	});

	res.send(page(`
		<h2>✅ 配置成功，测试邮件已发出</h2>
		<p>请去 <b>${email}</b> 的收件箱看看（也可能在**垃圾邮件**里）。</p>
		<p>设置已经写入论坛：</p>
		<ul style="font-size:15px">
			<li>发件邮箱：<code>${email}</code></li>
			<li>发件人显示名：<code>${fromName}</code></li>
			<li>服务器：<code>smtp.qq.com:465</code>（SSL）</li>
			<li>注册必须验证邮箱：<b>${requireEmail ? '已开启' : '未开启'}</b></li>
		</ul>
		<p style="color:#b45309">👉 最后一步：告诉我「配好了」，我重启一次论坛让设置生效。</p>
	`));
});

app.listen(5600, '127.0.0.1', () => {
	console.log('QQ 邮箱配置页：http://127.0.0.1:5600');
});
