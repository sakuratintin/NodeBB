#!/bin/bash
# 校园论坛启动脚本（不依赖任何挂载卷的权限）

set -e

APP_DIR=/usr/src/app
cd "$APP_DIR"

echo "========== 校园论坛启动 =========="

# 国内访问 npm 官方仓库很慢，运行时统一走镜像站
export npm_config_registry="${npm_config_registry:-https://registry.npmmirror.com}"

# 1) 准备 package.json（NodeBB 的依赖清单放在 install/ 下）
if [ ! -f "$APP_DIR/package.json" ]; then
    cp "$APP_DIR/install/package.json" "$APP_DIR/package.json"
fi

# 1.5) 关键：把自定义插件登记成「本地目录依赖」
#     否则 NodeBB 升级时会把它当成网上的包去 npm 下载，必然 404
echo "[0/5] 登记本地插件..."
node -e '
const fs = require("fs");
const file = "/usr/src/app/package.json";
const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
pkg.dependencies = pkg.dependencies || {};
pkg.dependencies["nodebb-plugin-campus-ai"] = "file:plugins/nodebb-plugin-campus-ai";
fs.writeFileSync(file, JSON.stringify(pkg, null, 4));
console.log("        nodebb-plugin-campus-ai -> file:plugins/nodebb-plugin-campus-ai");
'

# 2) 安装 / 校准依赖（镜像里已经装好，这里只在缺包时补）
echo "[1/5] 检查依赖..."
if [ ! -d "$APP_DIR/node_modules/nconf" ]; then
    npm install --omit=dev --no-audit --no-fund
else
    echo "        依赖已就绪，跳过"
fi

# 3) 用环境变量生成 config.json（写在镜像内部，不碰挂载卷）
echo "[2/5] 生成配置..."
cat > "$APP_DIR/config.json" <<EOF
{
    "url": "${NODEBB_URL:-http://localhost:4567}",
    "secret": "${NODEBB_SECRET:-campus-forum-default-secret}",
    "database": "postgres",
    "port": 4567,
    "postgres": {
        "host": "${NODEBB_DB_HOST:-localhost}",
        "port": ${NODEBB_DB_PORT:-5432},
        "username": "${NODEBB_DB_USER:-postgres}",
        "password": "${NODEBB_DB_PASSWORD:-postgres}",
        "database": "${NODEBB_DB_NAME:-nodebb}",
        "ssl": ${NODEBB_DB_SSL:-false}
    }
}
EOF
echo "        数据库: ${NODEBB_DB_HOST:-localhost}:${NODEBB_DB_PORT:-5432}/${NODEBB_DB_NAME:-nodebb}"
echo "        站点地址: ${NODEBB_URL:-http://localhost:4567}"

# 4) 等待数据库就绪
echo "[3/5] 等待数据库..."
for i in $(seq 1 30); do
    if node -e "
const {Client}=require('pg');
const c=new Client({host:process.env.NODEBB_DB_HOST,port:+(process.env.NODEBB_DB_PORT||5432),user:process.env.NODEBB_DB_USER,password:process.env.NODEBB_DB_PASSWORD,database:'postgres',connectionTimeoutMillis:4000});
c.connect().then(()=>c.end()).then(()=>process.exit(0)).catch(()=>process.exit(1));
" 2>/dev/null; then
        echo "        数据库可连接"
        break
    fi
    echo "        第 $i 次重试..."
    sleep 3
done

# 5) 自动建库（如果不存在）
echo "[4/5] 检查数据库是否存在..."
node -e "
const {Client}=require('pg');
const name=process.env.NODEBB_DB_NAME||'nodebb';
(async()=>{
  const admin=new Client({host:process.env.NODEBB_DB_HOST,port:+(process.env.NODEBB_DB_PORT||5432),user:process.env.NODEBB_DB_USER,password:process.env.NODEBB_DB_PASSWORD,database:'postgres'});
  await admin.connect();
  const r=await admin.query('SELECT 1 FROM pg_database WHERE datname=\$1',[name]);
  if(!r.rows.length){
    console.log('        数据库 '+name+' 不存在，正在创建...');
    await admin.query('CREATE DATABASE \"'+name+'\"');
    console.log('        已创建数据库 '+name);
  } else {
    console.log('        数据库 '+name+' 已存在');
  }
  await admin.end();
})().catch(e=>{console.error('        建库失败:',e.message);process.exit(0);});
"

# 6) 判断数据库状态：全新 / 半成品 / 正常
#    半成品 = 有表结构但插件没激活（之前初始化中断留下的），必须重新初始化
DB_STATE="fresh"
node -e "
const {Client}=require('pg');
const c=new Client({host:process.env.NODEBB_DB_HOST,port:+(process.env.NODEBB_DB_PORT||5432),user:process.env.NODEBB_DB_USER,password:process.env.NODEBB_DB_PASSWORD,database:process.env.NODEBB_DB_NAME||'nodebb',connectionTimeoutMillis:5000});
c.connect().then(async()=>{
  const t=await c.query(\"SELECT 1 FROM information_schema.tables WHERE table_name='legacy_object' LIMIT 1\");
  if(!t.rows.length){ console.log('STATE=fresh'); await c.end(); return; }
  const p=await c.query(\"SELECT COUNT(*)::int AS n FROM legacy_zset WHERE _key='plugins:active'\");
  console.log('STATE=' + (p.rows[0].n > 0 ? 'ready' : 'broken'));
  await c.end();
}).catch(()=>console.log('STATE=fresh'));
" 2>/dev/null | grep -o 'STATE=[a-z]*' | cut -d= -f2 > /tmp/dbstate.txt || true
[ -s /tmp/dbstate.txt ] && DB_STATE=$(cat /tmp/dbstate.txt)
echo "[5/5] 数据库状态: $DB_STATE"

case "$DB_STATE" in
  ready)
    # 已有完整数据：不再跑 upgrade（它内部会 npm install + 全量重建，
    # 在容器里又慢又占磁盘）。表结构已是最新，直接启动。
    echo "        数据完整，跳过升级"
    ;;
  broken)
    echo "        检测到初始化中断（插件未激活），清空编译产物后重新初始化..."
    rm -rf "$APP_DIR/build"/* 2>/dev/null || true
    ./nodebb setup --config="$APP_DIR/config.json" || echo "        初始化遇到问题，继续尝试启动"
    ;;
  *)
    echo "        首次启动，初始化论坛..."
    ./nodebb setup --config="$APP_DIR/config.json" || echo "        初始化遇到问题，继续尝试启动"
    ;;
esac

# 7) 构建前端资源（没有编译产物才编译）
#    CAMPUS_FORCE_BUILD=true 时强制清空重编译（换了数据库 / 主题后需要）
if [ "${CAMPUS_FORCE_BUILD:-false}" = "true" ]; then
    echo "检测到 CAMPUS_FORCE_BUILD=true，清空旧编译产物..."
    rm -rf "$APP_DIR/build"/* 2>/dev/null || true
fi

if [ -f "$APP_DIR/build/cache-buster" ]; then
    echo "前端资源已存在，跳过编译"
else
    echo "构建前端资源（首次较慢，请耐心等待）..."
    echo "--- 磁盘情况 ---"
    df -h "$APP_DIR/build" 2>/dev/null || true
    echo "----------------"
    if ! ./nodebb build; then
        echo "!! 首次构建失败，10 秒后重试一次..."
        sleep 10
        if ! ./nodebb build; then
            echo "!! 构建仍然失败：请看上面的报错（常见是磁盘空间不足）"
        fi
    fi
fi

# 7.5) 校验编译产物，缺了就直接报错，避免页面 500 却不知道原因
if [ ! -d "$APP_DIR/build/public/templates" ]; then
    echo "!! 编译产物缺失：$APP_DIR/build/public/templates 不存在"
    echo "!! 请确认已给 /usr/src/app/build 挂载至少 5Gi 的持久卷"
fi

# 8) 启动
# 注意：不能用 "nodebb start"，它会把进程 fork 到后台然后自己退出，
# 容器里主进程一退出就会被杀掉。必须前台常驻。
echo "========== 启动 NodeBB =========="
exec node loader.js --daemon=false --no-silent
