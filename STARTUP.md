# AI Hot Monitor · 启动指南

前后端本地开发启动/重启手册。

## 环境要求

- Node.js 18+（建议 20 LTS）
- npm（随 Node 安装）
- SQLite（Prisma 内置，无需单独安装）

---

## 首次准备（仅需一次）

### 1. 配置后端环境变量

```bash
# Windows (cmd)
copy server\.env.example server\.env

# macOS / Linux
cp server/.env.example server/.env
```

编辑 `server/.env`，至少填写：

| 变量 | 必填 | 说明 |
|------|------|------|
| `OPENROUTER_API_KEY` | 是 | OpenRouter API Key（AI 识别与聚合） |
| `TWITTER_API_KEY` | 否 | Sorsa API Key（不填则跳过 Twitter 源） |
| `OPENROUTER_MODEL` | 否 | 模型名，默认 `deepseek-v4-flash` |

### 2. 安装依赖并初始化数据库

```bash
# 后端
cd server
npm install
npx prisma generate   # 生成 Prisma 客户端
npx prisma db push    # 创建 SQLite 表结构

# 前端
cd ../client
npm install
```

---

## 启动后端（端口 4000）

```bash
cd server
npm run dev
```

> `npm run dev` 使用 `node --watch`，代码改动会自动重启。

**Windows 下开独立窗口后台启动：**

```bat
start "ai-hot-server" cmd /k "cd /d d:\Projects\ai-hot-monitor\server && npm run dev"
```

---

## 启动前端（端口 5173）

```bash
cd client
npm run dev
```

**Windows 下开独立窗口后台启动：**

```bat
start "ai-hot-client" cmd /k "cd /d d:\Projects\ai-hot-monitor\client && npm run dev"
```

---

## 访问地址

- 前端界面：http://localhost:5173
- 后端健康检查：http://localhost:4000/api/status

---

## 重启服务

1. 关闭对应服务所在窗口；或按 PID 结束进程：

   ```bat
   netstat -ano | findstr ":4000 :5173"   REM 查看监听端口对应的 PID
   taskkill /PID <PID> /F                 REM 替换为实际 PID
   ```

2. 重新执行上面的启动命令即可。

---

## 常见问题

| 现象 | 处理 |
|------|------|
| 提示 `OPENROUTER_API_KEY` 未配置 | 检查 `server/.env` 是否已创建并填写 |
| 请求接口报 401 | Twitter Key 需为 Sorsa API Key；OpenRouter Key 是否有效 |
| 端口被占用 | `netstat -ano \| findstr ":4000"` 找到 PID 后 `taskkill /F` |
| 数据库报错/表缺失 | 在 `server` 目录执行 `npx prisma db push` |
