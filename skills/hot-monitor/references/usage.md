# 使用示例

## 基础搜索

```bash
node scripts/ahm.js search "GPT-5"
node scripts/ahm.js search "GPT-5" --pretty
```

输出结构：

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

## 限定数据源

```bash
node scripts/ahm.js search "Claude Sonnet 4.6" --source GitHub,HackerNews --pretty
node scripts/ahm.js search "MCP" --source B站 --pretty
```

## 过滤与排序

```bash
# 只看真实内容（排除疑似假冒/标题党）
node scripts/ahm.js search "Sora" --exclude-fake

# 只看高热度（hotScore >= 50）
node scripts/ahm.js search "DeepSeek" --min-hot 50

# 提高相关度门槛
node scripts/ahm.js search "Gemini" --threshold 0.8
```

## 查询扩展与账号检测

```bash
# 关闭查询扩展（更快、更省 token）
node scripts/ahm.js search "Cursor" --no-expand

# 账号检测（@ 前缀）
node scripts/ahm.js search "@哔哩哔哩" --pretty
node scripts/ahm.js search "@OpenAI" --pretty
```

## 指定配置文件

```bash
node scripts/ahm.js search "豆包" --config /path/to/my-config.json
# 或通过环境变量
AHM_CONFIG=/path/to/my-config.json node scripts/ahm.js search "豆包"
```

## 无 AI Key 的降级行为

未配置 `openrouterApiKey` 时，工具退化为「关键词字面匹配」：标题/摘要含关键词即判定相关（`relevance` = 阈值，`relevanceReason` 标注降级说明），仍可正常输出结果。
