'use strict';

// 把「动效样式」和「AI 聊天面板样式」合并写入 NodeBB 后台的自定义 CSS / JS
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const sass = require('sass');

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const p = cfg.postgres;

const cssParts = [
	path.join(__dirname, 'custom-ui', 'custom.css'),
	path.join(__dirname, 'plugins', 'nodebb-plugin-campus-ai', 'public', 'ai-chat.scss'),
];
const jsParts = [
	path.join(__dirname, 'custom-ui', 'custom.js'),
	path.join(__dirname, 'custom-ui', 'hot.js'),
	path.join(__dirname, 'custom-ui', 'world.js'),
	path.join(__dirname, 'plugins', 'nodebb-plugin-campus-ai', 'public', 'ai-chat.js'),
];

const cssSource = cssParts.map((f) => `/* ==== ${path.basename(f)} ==== */\n${fs.readFileSync(f, 'utf8')}`).join('\n\n');
const jsSource = jsParts.map((f) => `/* ==== ${path.basename(f)} ==== */\n${fs.readFileSync(f, 'utf8')}`).join('\n\n');

(async () => {
	const compiled = await sass.compileStringAsync(cssSource, { style: 'compressed' });
	const css = compiled.css.toString();

	const client = new Client({ host: p.host, port: p.port, user: p.username, password: p.password, database: p.database });
	await client.connect();

	const cur = await client.query(`SELECT data FROM legacy_hash WHERE _key = 'config'`);
	const data = cur.rows[0].data;

	data.customCSS = cssSource;
	data.renderedCustomCSS = css;
	data.useCustomCSS = 1;
	data.customJS = jsSource;
	data.useCustomJS = 1;

	await client.query(`UPDATE legacy_hash SET data = $1::jsonb WHERE _key = 'config'`, [JSON.stringify(data)]);

	const after = await client.query(`SELECT data FROM legacy_hash WHERE _key = 'config'`);
	const d = after.rows[0].data;
	console.log('渲染后 CSS 长度:', (d.renderedCustomCSS || '').length);
	console.log('自定义 JS 长度:', (d.customJS || '').length);

	await client.end();
	process.exit(0);
})().catch((e) => {
	console.error('出错:', e.message);
	process.exit(1);
});
