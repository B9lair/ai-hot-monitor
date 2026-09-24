---
name: hot-monitor
description: 自包含的「AI 热点监控」工具，无需后端服务。通过多源搜索（Twitter/GitHub/HackerNews/B站/微博/知乎/Bing/百度/搜狗）+ AI 相关性判定与防伪，从关键词快速发现 AI / 科技热点。当用户需要监控或查询某个关键词/话题的最新动态、检索某技术/产品的相关热点、或排查某账号（@xxx）的最新动态时使用。触发语示例：「看看 GPT-5 最近有什么热点」「搜索 Sora 的最新动态」「查一下 @哔哩哔哩 最近发了什么」。
---

# AI Hot Monitor · 热点监控（自包含）

无需启动后端服务。首次使用 `npm install` 一次即可。

## 前置准备

1. 安装依赖（仅一次）：`cd skills/hot-monitor && npm install`
2. 配置：复制 `config.example.json` 为 `config.json`，填写必要项：
   - `openrouterApiKey`：OpenRouter AI 判定 Key（缺失则降级为关键词字面匹配）
   - 可选：`twitterApiKey` / `githubToken` / `weiboCookie` / `zhihuCookie`（缺则跳过对应源）

## 快速开始

```bash
node scripts/ahm.js search <关键词> [选项]
```

- 输出 JSON：`{ keyword, total, results: [...] }`
- 每条含：`title / url / source / summary / relevance / hotScore / metrics / isFake / confidence / relevanceReason / author / publishedAt`

## 选项

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

## 常见场景

- 查话题最新动态：`node scripts/ahm.js search "GPT-5" --pretty`
- 限定源搜索：`node scripts/ahm.js search "Claude Sonnet 4.6" --source GitHub,HackerNews`
- 账号检测：`node scripts/ahm.js search "@哔哩哔哩" --pretty`
- 只看真实、按热度：`node scripts/ahm.js search "MCP" --exclude-fake --min-hot 20`

## 使用要点

- 无 `openrouterApiKey` 时降级为关键词字面匹配（结果相关度 = 阈值）。
- `@` 前缀关键词触发账号检测（B站 UP 主 / 微博 / Twitter），不走关键词搜索。
- 搜索引擎（Bing/百度/搜狗）无互动指标，`hotScore` 为 `null`，排序排最后。
- 无持久化：每次运行独立搜索，不做跨次去重。

## 参考资料（按需加载，勿一次性全读）

- **数据源清单与配置**：`references/sources.md`
- **使用示例**：`references/usage.md`
