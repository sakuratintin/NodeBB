'use strict';

// 修正清理后的计数（purge 会把全局计数减成负数）
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

	// 全局计数归零
	await db.setObject('global', { topicCount: 0, postCount: 0 });
	console.log('全局计数已归零');

	// 分类计数归零
	const cids = await db.getSortedSetRange('categories:cid', 0, -1);
	for (const cid of cids) {
		await db.setObject(`category:${cid}`, { topic_count: 0, post_count: 0 });
	}
	console.log('分类计数已归零，共', cids.length, '个版块');

	// 保留的用户：帖子/主题计数归零
	const evaUid = await user.getUidByUsername('EVA');
	for (const uid of [1, parseInt(evaUid, 10)]) {
		if (!uid) continue;
		await user.setUserFields(uid, { postcount: 0, topiccount: 0 });
		await db.sortedSetAdd('users:postcount', 0, uid);
		console.log('用户', uid, '计数归零');
	}

	const topicCount = await db.getObjectField('global', 'topicCount');
	const postCount = await db.getObjectField('global', 'postCount');
	const uids = await db.getSortedSetRange('users:joindate', 0, -1);
	console.log('--- 最终 ---');
	console.log('用户:', uids.length, '| 主题:', topicCount, '| 帖子:', postCount);

	await db.close();
	process.exit(0);
})().catch((e) => {
	console.error('出错:', e.message);
	process.exit(1);
});
