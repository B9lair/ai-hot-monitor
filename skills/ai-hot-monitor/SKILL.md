---
name: ai-hot-monitor
description: AI 热点监控与发现技能。当用户需要监控某个关键词的最新动态、发现某领域的热点、追踪 AI 大模型更新或技术前沿信息时使用。支持多数据源（Twitter、Bing、Google、DuckDuckGo、HackerNews、搜狗、B站、微博）聚合，并用 OpenRouter AI 进行真实性验证（防伪）与热点聚合去重。
---

# AI Hot Monitor 技能

监控关键词真实动态、发现指定领域热点，第一时间获知 AI 领域最新消息。

## 使用场景

- 用户说「监控 GPT-5 的动态」「Claude 有什么新消息」「有 Sora 的新闻吗」→ 用 `monitor.mjs`
- 用户说「AI编程 最近有什么热点」「大模型领域最新进展」→ 用 `discover.mjs`

## 前置条件

需要配置 OpenRouter API Key（环境变量 `OPENROUTER_API_KEY`）。可选配置 Twitter API Key（`TWITTER_API_KEY`）。

方式一：在 `server/.env` 中配置，脚本会自动读取。
方式二：直接设置环境变量。

## 调用方式

### 1. 关键词监控（`scripts/monitor.mjs`）

```bash
node skills/ai-hot-monitor/scripts/monitor.mjs --keyword "GPT-5" --limit 10
```

参数：
- `--keyword, -k`（必填）：要监控的关键词
- `--limit, -l`（可选）：每个数据源抓取条数，默认 10
- `--json`（可选）：输出纯 JSON（默认已是 JSON）

输出（JSON）：
```json
{
  "keyword": "GPT-5",
  "scanned": 32,
  "verified": 3,
  "alerts": [
    {
      "title": "OpenAI 发布 GPT-5 正式版",
      "url": "https://...",
      "source": "HackerNews",
      "snippet": "...",
      "isFake": false,
      "confidence": 0.96,
      "summary": "OpenAI 正式发布 GPT-5"
    }
  ]
}
```

### 2. 热点发现（`scripts/discover.mjs`）

```bash
node skills/ai-hot-monitor/scripts/discover.mjs --topic "AI编程" --limit 10
```

参数：
- `--topic, -t`（必填）：关注的范围/领域
- `--limit, -l`（可选）：每个数据源抓取条数，默认 10

输出（JSON）：
```json
{
  "topic": "AI编程",
  "scanned": 40,
  "hotspots": [
    {
      "title": "热点标题",
      "category": "模型发布",
      "summary": "一句话总结",
      "hotness": 85
    }
  ]
}
```

## 工作原理

1. 从多个数据源并行抓取内容（Twitter、Bing、Google、DuckDuckGo、HackerNews、搜狗、B站、微博）
2. 关键词监控：AI 验证内容是否真实相关 + 是否假冒/谣言/标题党
3. 热点发现：AI 聚合去重、分类、提炼主题、生成摘要
4. 输出结构化 JSON，供上层 AI 直接使用

## 注意事项

- 爬虫类数据源（Bing/Google/DuckDuckGo/搜狗）已内置延时控制，避免频繁请求被封
- 未配置 OpenRouter API Key 时，关键词监控退化为纯关键词匹配，热点发现退化为去重列表
- 数据源 API（Twitter）未配置时会自动跳过
