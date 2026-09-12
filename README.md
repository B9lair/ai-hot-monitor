# AI Hot Monitor · 热点雷达

一个轻量的 AI 热点监控工具，帮你第一时间获取 AI 大模型更新与技术前沿信息，走在吃瓜第一线。

## 功能

1. **关键词监控**：手动输入关键词（如 GPT-5、Claude 4），定时从多源抓取，用 AI 识别真实动态并防伪（识别假冒/谣言/标题党），第一时间通知你。
2. **热点发现**：定时搜集指定范围（如「AI编程」）内的热点，AI 聚合去重后呈现。

## 技术栈

- 前端：React + Vite + TailwindCSS
- 后端：Node.js + Express
- 存储：Prisma + SQLite
- 实时通信：Socket.io
- 定时任务：node-cron
- AI 服务：OpenRouter（高性价比 flash 模型）

## 数据源

Twitter(X)、Bing、Google、DuckDuckGo、HackerNews、搜狗、B站、微博（多源聚合，避免单一信息源）。

## 快速开始

### 1. 后端

```bash
cd server
npm install
# 复制环境变量模板并填写
copy .env.example .env   # Linux/Mac: cp .env.example .env
# 生成 Prisma 客户端并初始化数据库
npx prisma generate
npx prisma db push
# 启动
npm run dev
```

### 2. 前端

```bash
cd client
npm install
npm run dev
```

打开 http://localhost:5173

## 环境变量说明（server/.env）

| 变量 | 必填 | 说明 |
|------|------|------|
| `OPENROUTER_API_KEY` | 是 | OpenRouter API Key（用于 AI 识别与聚合） |
| `OPENROUTER_MODEL` | 否 | 模型名，默认 `google/gemini-2.0-flash-001` |
| `TWITTER_API_KEY` | 否 | Sorsa API Key（不填则跳过 Twitter） |
| `SMTP_*` | 否 | 邮件通知配置（不填则只浏览器通知） |
| `NOTIFY_EMAIL_TO` | 否 | 接收通知的邮箱 |

> 未配置 `OPENROUTER_API_KEY` 时，系统退化为纯关键词匹配模式（无法 AI 防伪）。

## Agent Skills

见 `skills/ai-hot-monitor/`，封装后可供其他 AI 调用，独立监控与发现热点。
