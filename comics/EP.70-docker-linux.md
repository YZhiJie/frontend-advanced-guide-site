# EP.70 Docker 让环境不再玄学

> 对应正文：[96-docker-linux.md](../96-docker-linux.md)（96.1 层缓存 / 96.2 多阶段 / 96.4 权限信号 / 96.5 CI/CD）· 示例：`examples/96-01-docker-linux.ts`

## 剧情回顾

- **第 1 格**：镜像 1.2G 构建 10 分钟——层缓存失效且没做多阶段。
- **第 2 格**：码叔揭秘层缓存+多阶段——依赖单独一层命中缓存，运行时用 nginx:alpine 瘦身。
- **第 3 格**：像素酱实证 Linux 权限（rwx=754）与信号（SIGTERM/SIGKILL）。
- **第 4 格**：码叔结案——compose 编排 + CI/CD 构建推送。

## 知识点拆解

### 第 1 格 · 层缓存失效

- `COPY . .` 放在 `npm ci` 前面，改源码导致依赖层失效；
- 应把 `COPY package*.json` 前置。

### 第 2 格 · 层缓存 + 多阶段

```dockerfile
COPY package*.json ./
RUN npm ci              # 命中缓存
COPY . .
# 多阶段：builder 产物拷到 nginx:alpine
```

- 多阶段把编译工具链丢弃，只留运行时产物；
- 350MB → 45MB。

### 第 3 格 · 权限与信号

- `rwxr-xr--` = 754（r=4,w=2,x=1，三组）；
- SIGTERM(15) 可捕获优雅退出，SIGKILL(9) 不可捕获强杀。

### 第 4 格 · compose 与 CI/CD

- compose 编排多服务，healthcheck 保证就绪；
- CI/CD 中镜像 tag 用 git sha，`--cache-from` 复用缓存。

## 坑点清单

> 🔗 正文对照：[《96.7 本章避坑清单》](../96-docker-linux#_96-7-本章避坑清单)

1. 依赖层放在源码后 → 每次重装；
2. 镜像过大 → 多阶段+alpine；
3. 容器不优雅退出 → 监听 SIGTERM 调 server.close()。

## 自测 3 题（含答案）

1. Docker 层缓存怎么最大化命中？——**把变化频率低的指令（依赖安装）放前面，源码拷贝放后面**。
2. `rwxr-xr--` 对应的权限数字？——**754**。
3. SIGTERM 和 SIGKILL 区别？——**SIGTERM 可捕获优雅退出，SIGKILL 不可捕获强杀**。
