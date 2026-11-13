'use strict';

// 清理：只保留管理员(uid 1)和 AI 助手(EVA)，删除其他用户与全部帖子
process.env.NODE_ENV = 'production';
require('./require-main');
const path = require('path');
const nconf = require('nconf');
nconf.argv().env().file({ file: 'config.json' });
nconf.set('upload_path', path.join(__dirname, 'public', 'uploads'));
nconf.set('url', 'http://localhost:4567');

const db = require('./src/database');

(async () => {
	await db.init();
	const meta = require('./src/meta');
	await meta.configs.init();

	const user = require('./src/user');
	const topics = require('./src/topics');

	// 1) 删除所有帖子（含主题）
	const tids = await db.getSortedSetRange('topics:tid', 0, -1);
	console.log('准备删除主题数:', tids.length);
	for (const tid of tids) {
		try {
			await topics.purge(tid, 1);
		} catch (e) {
			console.log('清理主题', tid, '失败:', e.message);
		}
	}

	// 2) 删除除管理员与 EVA 之外的用户
	const evaUid = await user.getUidByUsername('EVA');
	const keep = new Set([1, parseInt(evaUid, 10) || 0]);
	const uids = await db.getSortedSetRange('users:joindate', 0, -1);

	for (const uid of uids) {
		if (keep.has(parseInt(uid, 10))) {
			console.log('保留用户 uid', uid);
			continue;
		}
		try {
			const name = await user.getUserField(uid, 'username');
			await user.delete(1, uid);
			console.log('已删除用户', uid, name);
		} catch (e) {
			console.log('删除用户', uid, '失败:', e.message);
		}
	}

	// 3) 校验
	const leftUsers = await db.getSortedSetRange('users:joindate', 0, -1);
	const topicCount = await db.getObjectField('global', 'topicCount');
	const postCount = await db.getObjectField('global', 'postCount');
	console.log('--- 清理后 ---');
	console.log('剩余用户:', leftUsers.length, '| 主题:', topicCount, '| 帖子:', postCount);

	await db.close();
	process.exit(0);
})().catch((e) => {
	console.error('出错:', e.message);
	process.exit(1);
});
