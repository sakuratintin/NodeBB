#!/bin/bash
# 校园论坛启动脚本（不依赖任何挂载卷的权限）

set -e

APP_DIR=/usr/src/app
cd "$APP_DIR"

echo "========== 校园论坛启动 =========="

# 1) 准备 package.json（NodeBB 的依赖清单放在 install/ 下）
if [ ! -f "$APP_DIR/package.json" ]; then
    cp "$APP_DIR/install/package.json" "$APP_DIR/package.json"
fi

# 2) 安装 / 校准依赖
echo "[1/5] 检查依赖..."
npm install --no-audit --no-fund

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

# 6) 初始化（首次）或升级（后续）
if node -e "
const {Client}=require('pg');
const c=new Client({host:process.env.NODEBB_DB_HOST,port:+(process.env.NODEBB_DB_PORT||5432),user:process.env.NODEBB_DB_USER,password:process.env.NODEBB_DB_PASSWORD,database:process.env.NODEBB_DB_NAME||'nodebb',connectionTimeoutMillis:5000});
c.connect().then(async()=>{
  const r=await c.query(\"SELECT 1 FROM information_schema.tables WHERE table_name='legacy_object' LIMIT 1\");
  await c.end();
  process.exit(r.rows.length?0:1);
}).catch(()=>process.exit(1));
" 2>/dev/null; then
    echo "[5/5] 检测到已有数据，执行升级..."
    ./nodebb upgrade || echo "        升级跳过"
else
    echo "[5/5] 首次启动，初始化论坛..."
    ./nodebb setup --config="$APP_DIR/config.json" || echo "        初始化可能已完成"
fi

# 7) 构建前端资源
echo "构建前端资源..."
./nodebb build || echo "构建出现警告，继续启动"

# 8) 启动
echo "========== 启动 NodeBB =========="
exec ./nodebb start
