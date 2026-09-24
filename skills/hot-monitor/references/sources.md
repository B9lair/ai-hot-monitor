# 数据源清单与配置

## 数据源总表（9 个，均为国内可用）

| key | 来源 | 类型 | 需凭证 | 说明 |
|-----|------|------|--------|------|
| twitter | Twitter | API (twitterapi.io) | `twitterApiKey` | 缺 Key 则跳过 |
| hackernews | HackerNews | API (Algolia) | — | 无需凭证 |
| github | GitHub | API (Search) | `githubToken` 可选 | 匿名限流 10 次/分钟 |
| bilibili | B站 | 爬虫 | `biliSessdata` 可选 | 详情富化 `enrichBilibili` |
| weibo | 微博 | 爬虫 | `weiboCookie` | 缺 Cookie 则跳过 |
| zhihu | 知乎 | API (search_v3) | `zhihuCookie` | 缺 Cookie 则跳过 |
| bing | Bing | 爬虫 | — | 无需凭证 |
| baidu | 百度 | 爬虫 (m.baidu.com) | — | 无需凭证 |
| sogou | 搜狗 | 爬虫 | — | 无需凭证 |

## 配置方式

优先级：**环境变量 > `config.json` > 内置默认值**。

### 方式一：config.json（推荐）

复制 `config.example.json` 为 `config.json` 填写：

```json
{
  "openrouterApiKey": "sk-or-...",
  "twitterApiKey": "",
  "githubToken": "",
  "weiboCookie": "",
  "zhihuCookie": "",
  "enabledSources": { "twitter": true, "hackernews": true, "github": true, "bilibili": true, "weibo": true, "zhihu": true, "bing": true, "baidu": true, "sogou": true }
}
```

### 方式二：环境变量

| 变量 | 说明 |
|------|------|
| `OPENROUTER_API_KEY` | AI 判定 Key |
| `OPENROUTER_MODEL` | 模型，默认 deepseek-v4-flash |
| `RELEVANCE_THRESHOLD` | 相关度阈值，默认 0.6 |
| `TWITTER_API_KEY` / `GITHUB_TOKEN` / `WEIBO_COOKIE` / `ZHIHU_COOKIE` / `BILI_SESSDATA` | 各源凭证 |
| `SOURCE_*` | 各源开关（如 `SOURCE_TWITTER=false`） |
| `COLLECT_LIMIT` / `PER_SOURCE_LIMIT` / `MIN_HOT_SCORE` / `TIME_WINDOW_HOURS` | 采集/过滤参数 |
| `QUERY_EXPAND` / `QUERY_EXPAND_LIMIT` | 查询扩展 |
| `AHM_CONFIG` | 指定 config.json 路径 |

## 关键配置项默认值

| 项 | 默认 | 说明 |
|----|------|------|
| `openrouterModel` | deepseek-v4-flash | AI 判定模型 |
| `relevanceThreshold` | 0.6 | 相关性阈值 |
| `timeWindowHours` | 168 | 默认时间窗口（小时） |
| `collectLimit` | 20 | 每源采集条数 |
| `perSourceLimit` | 8 | 每源保留条数 |
| `minHotScore` | 0 | 热度门槛（0=关闭） |
| `queryExpand` | true | 查询扩展 |
| `enrichBilibili` | true | B站详情富化 |

## 账号检测

关键词以 `@` 开头（如 `@哔哩哔哩`）触发账号检测：返回 B站 UP 主 / 微博 / Twitter 账号信息与其最新动态，**不走**关键词搜索与质量门槛。

## 分层过滤（理解命中质量的背景）

1. **采集**：各源并行，每源 `collectLimit` 条。
2. **第一层 · 基础过滤**：title/url 校验 + URL 去重 + 按源时间窗口。
3. **第二层 · 质量过滤**：Twitter 互动门槛 + 蓝V加权；非 Twitter 源按 `hotScore` 降序；每源保留 `perSourceLimit`。
4. **第三层 · AI 深度分析**：相关性判定（`relevance >= 阈值`）+ 真伪判定（`isFake`）。
