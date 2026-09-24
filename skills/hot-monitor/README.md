# AI Hot Monitor Skill · 热点监控 Agent 技能

> 一个**自包含**的 AI 热点监控工具，封装为 Claude / CodeBuddy 的 Agent Skill。
> 输入关键词，即可跨 9 个数据源实时搜索 + AI 相关性判定与防伪，快速发现 AI / 科技领域的最新热点。

**无需后端服务、无需数据库** —— 安装依赖一次，之后每次一条命令即可。

---

## ✨ 特性

- **9 数据源多源聚合**：Twitter / HackerNews / GitHub / B站 / 微博 / 知乎 / Bing / 百度 / 搜狗
- **AI 相关性判定**：OpenRouter 驱动，严格判定「是否与关键词直接相关」，输出相关度分数与理由
- **AI 防伪识别**：过滤标题党 / 谣言 / 非官方渠道的假冒内容
- **查询扩展**：AI 自动生成同义/变体查询词，提高检索召回
- **账号检测**：`@xxx` 前缀直接获取账号信息与其最新动态
- **分层过滤 + 热度分**：时间窗口过滤、质量门槛、跨源归一化热度分（0~100）
- **无 Key 降级**：未配置 AI Key 时自动退化为关键词字面匹配，工具仍可用

---

## 🚀 快速开始

### 环境要求

- Node.js ≥ 18（使用原生 `fetch`）

### 1. 安装依赖

```bash
npm install
```

### 2. 配置

```bash
cp config.example.json config.json
```

编辑 `config.json`，填写必要项：

```json
{
  "openrouterApiKey": "sk-or-...",   // 必填：AI 判定 Key（缺失则降级为关键词匹配）
  "twitterApiKey": "",               // 可选：缺则跳过 Twitter
  "githubToken": "",                 // 可选：提升 GitHub 限流
  "weiboCookie": "",                 // 可选：缺则跳过微博
  "zhihuCookie": ""                  // 可选：缺则跳过知乎
}
```

> 也可用环境变量配置（`OPENROUTER_API_KEY`、`TWITTER_API_KEY` 等），优先级高于 `config.json`。

### 3. 搜索

```bash
node scripts/ahm.js search "GPT-5"
node scripts/ahm.js search "GPT-5" --pretty
```

输出 JSON：

```json
{
  "keyword": "GPT-5",
  "total": 12,
  "results": [
    {
      "title": "OpenAI 发布 GPT-5 ...",
      "url": "https://...",
      "source": "Twitter",
      "summary": "AI 总结：...",
      "relevance": 0.95,
      "hotScore": 82.4,
      "metrics": { "likes": 12000, "retweets": 890 },
      "isFake": false,
      "confidence": 0.9,
      "relevanceReason": "...",
      "author": "ElonMusk",
      "publishedAt": "2026-09-20T08:00:00.000Z"
    }
  ]
}
```

---

## 📖 使用示例

```bash
# 基础搜索
node scripts/ahm.js search "Claude Sonnet 4.6" --pretty

# 限定数据源
node scripts/ahm.js search "MCP" --source GitHub,HackerNews --pretty

# 只看真实内容（排除疑似假冒/标题党）
node scripts/ahm.js search "Sora" --exclude-fake

# 只看高热度
node scripts/ahm.js search "DeepSeek" --min-hot 50

# 账号检测（@ 前缀）
node scripts/ahm.js search "@哔哩哔哩" --pretty

# 关闭查询扩展（更快、省 token）
node scripts/ahm.js search "Cursor" --no-expand
```

### 全部选项

| 选项 | 说明 |
|------|------|
| `--source Twitter,GitHub` | 限定数据源（逗号分隔） |
| `--limit N` | 每源保留条数 |
| `--threshold 0.6` | 相关度阈值（0~1） |
| `--min-hot N` | 热度门槛（0~100） |
| `--exclude-fake` | 只输出非假冒内容 |
| `--no-expand` | 关闭查询扩展 |
| `--config file.json` | 指定配置文件 |
| `--pretty` | 缩进美化 JSON |

---

## 📁 目录结构

```
hot-monitor/
├── SKILL.md                  # Skill 元数据与使用说明（供 Agent 识别）
├── README.md                 # 本文件
├── package.json              # 依赖：axios / cheerio / zod
├── config.example.json       # 配置模板
├── scripts/
│   ├── ahm.js                # 入口 CLI（search 子命令）
│   ├── config.js             # 配置加载
│   ├── ai.js                 # AI 相关性 + 防伪
│   ├── prompts.js            # Prompt 集中管理
│   ├── expand.js             # 查询扩展
│   └── sources/
│       ├── index.js          # 多源聚合入口
│       ├── utils.js          # 归一化 / 热度分 / 时间解析
│       ├── filter.js         # 分层过滤
│       ├── twitter.js / github.js / hackernews.js
│       ├── bilibili.js / weibo.js / zhihu.js
│       ├── websearch.js      # Bing / 百度 / 搜狗
│       └── account.js        # 账号检测 @xxx
└── references/
    ├── sources.md            # 数据源清单与配置
    └── usage.md              # 使用示例
```

---

## 🧠 工作原理

```
关键词
  → 查询扩展（AI 生成同义词，可选）
  → 多源并行搜索（9 源）
  → 第一层 · 基础过滤（格式校验 + URL 去重 + 时间窗口）
  → 第二层 · 质量过滤（Twitter 门槛 + 蓝V加权 + 按热度分排序 + 每源保留上限）
  → AI 相关性判定（relevance ≥ 阈值）→ 真伪判定（isFake）
  → 输出热点列表（JSON）
```

- **相关性与真伪拆分为两次独立 AI 调用**：互不干扰，且不相关内容不消耗真伪判定 token。
- **AI 输出容错**：JSON 多级容错解析 + zod 语义校验 + 指数退避重试，杜绝静默故障。
- **无 AI Key 降级**：退化为关键词字面匹配，保证工具可用。

---

## 🌐 数据源

| 数据源 | 类型 | 需凭证 | 默认 |
|--------|------|--------|------|
| Twitter | API (twitterapi.io) | `twitterApiKey` | 开 |
| HackerNews | API (Algolia) | — | 开 |
| GitHub | API (Search) | `githubToken` 可选 | 开 |
| B站 | 爬虫 | — | 开 |
| 微博 | 爬虫 | `weiboCookie` | 开 |
| 知乎 | API (search_v3) | `zhihuCookie` | 开 |
| Bing / 百度 / 搜狗 | 爬虫 | — | 开 |

> 各源开关可通过 `config.json` 的 `enabledSources` 或 `SOURCE_*` 环境变量控制。

---

## 📝 说明

本技能提取自 `ai-hot-monitor` 项目的核心能力（关键词监控 + 多源搜索 + AI 筛选），剥离了数据库、定时调度、收藏、邮件通知等依赖服务的能力，改造成**零后端依赖**的自包含 CLI，使其可作为 Agent Skill 独立分发与使用。

**能力边界**：无持久化（每次独立搜索、不做跨次去重）、无收藏/统计/历史、按需触发（无定时）。

---

## 📄 License

[MIT](./LICENSE)
