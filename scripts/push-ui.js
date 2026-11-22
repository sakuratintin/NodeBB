'use strict';

/*
 * 把本地 custom-ui 的样式和脚本推送到指定数据库（用于线上环境）
 * 用法：
 *   $env:DB_HOST='dbconn.sealosgzg.site'; $env:DB_PORT='43932'; $env:DB_PASS='...'
 *   node scripts/push-ui.js
 */
const fs = require('fs');
const path = require('path');
const sass = require('sass');
const { Client } = require('pg');

const root = path.join(__dirname, '..');
const cssParts = [
	path.join(root, 'custom-ui', 'custom.css'),
	path.join(root, 'plugins', 'nodebb-plugin-campus-ai', 'public', 'ai-chat.scss'),
];
const jsParts = [
	path.join(root, 'custom-ui', 'custom.js'),
	path.join(root, 'custom-ui', 'hot.js'),
	path.join(root, 'custom-ui', 'world.js'),
	path.join(root, 'custom-ui', 'favicon.js'),
	path.join(root, 'plugins', 'nodebb-plugin-campus-ai', 'public', 'ai-chat.js'),
];

const cssSource = cssParts
	.map((f) => `/* ==== ${path.basename(f)} ==== */\n${fs.readFileSync(f, 'utf8')}`)
	.join('\n\n');
const jsSource = jsParts
	.map((f) => `/* ==== ${path.basename(f)} ==== */\n${fs.readFileSync(f, 'utf8')}`)
	.join('\n\n');

(async () => {
	const compiled = await sass.compileStringAsync(cssSource, { style: 'compressed' });
	const css = compiled.css.toString();

	const client = new Client({
		host: process.env.DB_HOST,
		port: parseInt(process.env.DB_PORT, 10),
		user: process.env.DB_USER || 'postgres',
		password: process.env.DB_PASS,
		database: process.env.DB_NAME || 'nodebb',
	});
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
	console.log('已推送：');
	console.log('  CSS 源码:', (d.customCSS || '').length, '| 编译后:', (d.renderedCustomCSS || '').length);
	console.log('  JS 源码:', (d.customJS || '').length);
	console.log('  useCustomCSS:', d.useCustomCSS, '| useCustomJS:', d.useCustomJS);

	await client.end();
	process.exit(0);
})().catch((e) => {
	console.error('出错:', e.message);
	process.exit(1);
});
