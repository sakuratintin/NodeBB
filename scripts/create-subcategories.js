'use strict';

// 给现有板块创建子版块（子分类）
process.env.NODE_ENV = 'production';
require('./require-main');
const path = require('path');
const nconf = require('nconf');
nconf.argv().env().file({ file: 'config.json' });
nconf.set('upload_path', path.join(__dirname, 'public', 'uploads'));
nconf.set('url', 'http://localhost:4567');

const db = require('./src/database');

// 父板块 cid -> 子版块列表
const PLAN = {
	2: [ // 综合讨论
		{ name: '生活日常', description: '宿舍、食堂、天气，随便聊', icon: 'fa-coffee', bgColor: '#59b3d0' },
		{ name: '求助问答', description: '有问题？大家帮你一起想办法', icon: 'fa-circle-question', bgColor: '#59b3d0' },
	],
	9: [ // 学习
		{ name: '课程与选课', description: '选课经验、老师评价、作业讨论', icon: 'fa-book-open', bgColor: '#DC9656' },
		{ name: '考研保研', description: '考研、保研、出国的经验与资料', icon: 'fa-graduation-cap', bgColor: '#DC9656' },
		{ name: '学习资料', description: '笔记、真题、课件共享', icon: 'fa-folder-open', bgColor: '#DC9656' },
	],
	8: [ // 二次元
		{ name: '番剧推荐', description: '这一季在追什么？', icon: 'fa-tv', bgColor: '#b6c96a' },
		{ name: '手办谷子', description: '晒晒收藏，出物求物', icon: 'fa-box-open', bgColor: '#b6c96a' },
	],
	7: [ // 小说
		{ name: '书单推荐', description: '最近读了什么好书', icon: 'fa-book', bgColor: '#b6c96a' },
		{ name: '写作交流', description: '写作心得、连载、求点评', icon: 'fa-pen-nib', bgColor: '#b6c96a' },
	],
	6: [ // 游戏
		{ name: '手游', description: '抽卡、开黑、iOS/安卓', icon: 'fa-mobile-screen', bgColor: '#b6c96a' },
		{ name: '端游主机', description: 'PC 与主机游戏讨论', icon: 'fa-gamepad', bgColor: '#b6c96a' },
		{ name: '开黑组队', description: '找人一起玩，留个时间', icon: 'fa-users', bgColor: '#b6c96a' },
	],
	5: [ // 表白墙
		{ name: '匿名表白', description: '用 UID 或代号，说出想说的话', icon: 'fa-heart', bgColor: '#c48ec9' },
		{ name: '吃瓜现场', description: '校园趣事，文明吃瓜', icon: 'fa-comments', bgColor: '#c48ec9' },
	],
	1: [ // 公告
		{ name: '站务通知', description: '论坛规则、活动公告', icon: 'fa-bullhorn', bgColor: '#f0a05a' },
	],
	4: [ // 意见反馈
		{ name: '功能建议', description: '希望论坛增加什么功能', icon: 'fa-lightbulb', bgColor: '#59b3d0' },
		{ name: '问题反馈', description: '遇到 bug 或使用问题', icon: 'fa-bug', bgColor: '#59b3d0' },
	],
};

(async () => {
	await db.init();
	const meta = require('./src/meta');
	await meta.configs.init();
	const categories = require('./src/categories');

	for (const [parentCid, list] of Object.entries(PLAN)) {
		for (const item of list) {
			try {
				const data = await categories.create({
					name: item.name,
					description: item.description,
					parentCid: parseInt(parentCid, 10),
					icon: item.icon || 'fa-comments',
					bgColor: item.bgColor || '#59b3d0',
					color: '#ffffff',
					blockclass: '',
					order: 0,
				});
				console.log(`已创建子版块「${item.name}」(cid ${data.cid}) ← 父板块 ${parentCid}`);
			} catch (e) {
				console.log(`创建「${item.name}」失败: ${e.message}`);
			}
		}
	}

	await db.close();
	process.exit(0);
})().catch((e) => {
	console.error('出错:', e.message);
	process.exit(1);
});
