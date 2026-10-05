# ============================================================
# @lmliheng/rag-chunk — 微信云托管部署镜像
# ============================================================

FROM node:24-alpine AS builder

WORKDIR /app

# 1) 安装依赖（利用 Docker 缓存层）
COPY package.json package-lock.json ./
RUN npm ci

# 2) 编译 TypeScript
COPY tsconfig.json ./
COPY src/ ./src/
COPY index.ts ./
RUN npx tsc --project tsconfig.json

# ============================================================
# 运行阶段：最小化镜像，只保留编译产物和运行时依赖
# ============================================================
FROM node:24-alpine

WORKDIR /app

# 复制编译产物
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/index.js ./
COPY --from=builder /app/index.d.ts ./
COPY --from=builder /app/src/ ./src/

# 示例文档目录（可选）
COPY documents/ ./documents/

# 微信云托管要求容器监听 80 端口
EXPOSE 80

# 云托管的环境变量通过平台注入，无需 .env 文件
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:80/ || exit 1

# 启动服务
CMD ["node", "--env-file=/etc/.env", "index.js"]