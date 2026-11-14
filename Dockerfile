# 校园论坛专用镜像
# 由 GitHub Actions 的 "Run Docker" 流程构建，产出 ghcr.io/<owner>/nodebb:latest
#
# 特点：
#   - 自带依赖 + 自带插件（plugins/ → node_modules/）
#   - 运行时不依赖任何挂载卷（配置由环境变量生成）
#   - 以 root 运行，避免云平台卷权限问题

FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    DAEMON=false \
    SILENT=false

WORKDIR /usr/src/app

# tini 负责信号转发，保证容器能正常停止
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get -y --no-install-recommends install tini \
    && rm -rf /var/lib/apt/lists/*

COPY . /usr/src/app/

# 1) NodeBB 的依赖清单在 install/package.json
# 2) 只装生产依赖（webpack/sass 等构建工具都在 dependencies 里，够用）
# 3) 把自定义插件放进 node_modules
RUN cp /usr/src/app/install/package.json /usr/src/app/package.json \
    && npm install --omit=dev --no-audit --no-fund \
    && mkdir -p /usr/src/app/node_modules \
    && cp -r /usr/src/app/plugins/nodebb-plugin-campus-ai /usr/src/app/node_modules/ \
    && rm -rf /usr/src/app/node_modules/nodebb-plugin-campus-ai/node_modules \
    && rm -rf /usr/src/app/.git /usr/src/app/.github /usr/src/app/test /usr/src/app/.npm

# 启动脚本（自动建库 / 初始化 / 构建 / 启动）
COPY docker-campus/start.sh /usr/local/bin/start-campus.sh
RUN chmod +x /usr/local/bin/start-campus.sh

EXPOSE 4567

# 上传目录建议挂载持久化（可选）
VOLUME ["/usr/src/app/public/uploads"]

ENTRYPOINT ["tini", "--", "/usr/local/bin/start-campus.sh"]
