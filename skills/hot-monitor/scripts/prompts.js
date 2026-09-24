/**
 * AI Prompt 集中管理（版本化）
 * 只保留「相关性判定」「真伪判定」「查询扩展」三个 prompt。
 */

/** prompt 版本号：评估结果会带上它，用于跨版本对比基线 */
export const PROMPT_VERSION = 'v2.0';

/** 相关性判定 prompt：只回答「与关键词的相关程度」 */
export function relevancePrompt(keyword, item) {
  return `你是一个严格的信息相关性审核助手。请判断下面这条内容与关键词「${keyword}」的关联程度。

【相关性判定标准（务必严格遵守）】
1. 只有当内容【明确提及关键词本身】或【无歧义地指向关键词所指的同一主体/产品/事件】，且关键词是该内容的【核心主题】时，才判为「直接相关」并给高 relevance（>=0.7）。
2. 仅提到同一领域/同一生态、但【未提及关键词本身】的内容（例如关键词是「Claude Sonnet 4.6」，内容只讲「OpenClaw」而没有提到 Claude Sonnet 4.6）→ 判为「不相关」，relevance 应 <0.3。
3. 只是顺带提一句、或在标题/摘要边缘出现关键词但主体无关 → 「间接相关」，relevance 给 0.3~0.6。
4. 判断依据必须来自「标题」和「摘要」里能指出的具体文字，不能臆测或脑补。
5. 只评估相关性。不要因为内容「看起来像营销、夸张、耸动」而调低 relevance —— 真伪由另一个环节单独判断，两边互不影响。

【校准示例】
- 关键词「Claude Sonnet 4.6」，标题「Anthropic 发布 Claude Sonnet 4.6，推理能力大幅提升」→ relevance 0.95，matchType "直接相关"，keywordMentioned true。
- 关键词「Claude Sonnet 4.6」，标题「OpenClaw 推出新的 agent 框架」，全文未提 Claude Sonnet 4.6 → relevance 0.05，matchType "不相关"，keywordMentioned false。
- 关键词「GPT-5」，标题「GPT-4 微调指南更新」→ relevance 0.05，matchType "不相关"，keywordMentioned false（版本号不同即不同主体）。
- 关键词「Sora」，标题「视频生成模型技术综述」，正文未提 Sora → relevance 0.10，matchType "不相关"，keywordMentioned false（仅同领域）。

【待审核内容】
标题：${item.title}
摘要：${item.snippet || '（无）'}
来源：${item.source || '（未知）'}

请严格只返回 JSON（不要输出任何其他文字），格式：
{
  "relevance": 0.0~1.0,           // 与关键词「${keyword}」的相关度（0 完全不相关，1 完全相关）
  "keywordMentioned": true/false, // 标题或摘要中是否明确提及关键词本身
  "matchType": "直接相关|间接相关|不相关",
  "summary": "一句话总结：该内容相对于关键词「${keyword}」讲了什么（核心要点 + 与关键词的关联点）",
  "relevanceReason": "1~2句，引用标题/摘要中的具体文字，说明为什么给出这个相关度"
}`;
}

/** 真伪判定 prompt（独立调用，仅对「已判定相关」的条目发起） */
export function authenticityPrompt(keyword, item) {
  return `你是一个严格的信息真实性审核助手。请判断下面这条与关键词「${keyword}」相关的内容，是否【疑似假冒 / 谣言 / 标题党 / 虚假信息】。

【判定为「疑似假冒」的特征】
1. 标题党、夸大其词、诱导点击（如「震惊」「速看」「最后一天」「免费领取」）；
2. 谣言、未经证实的爆料、非官方渠道的重大宣称（如「XX 已开放免费下载（非官方渠道）」）；
3. 与权威来源明显矛盾、或明显违背常识的宣称（如「某大模型已彻底开源且免费商用」）；
4. 诱导下载 / 加群 / 付费的引流内容。

【判定为「真实」的情形】
- 正常的新闻报道、官方发布、技术评测、开源仓库更新等；
- 内容没有明显可疑特征时，一律判 isFake=false。

【注意】
- 只评估真实性，不要因为内容与关键词相关性低而判为假冒；
- 证据不足、无法确定时，倾向 isFake=false（宁可漏判，不误伤真实热点）。

【待审内容】
关键词：${keyword}
标题：${item.title}
摘要：${item.snippet || '（无）'}
来源：${item.source || '（未知）'}

请严格只返回 JSON（不要输出任何其他文字），格式：
{
  "isFake": false/true,  // 是否疑似假冒、谣言、标题党或虚假信息
  "confidence": 0.0~1.0, // 真实性判断的置信度
  "fakeReason": "若 isFake 为 true，说明为什么疑似假冒/谣言/标题党；否则输出空字符串"
}`;
}

/** 查询扩展 prompt：为关键词生成同义/变体查询词以提高检索召回 */
export function queryExpansionPrompt(keyword, limit) {
  return `你是搜索查询扩展助手。给定用户关注的关键词，请生成最多 ${limit} 个「同义 / 变体 / 更完整表述」的查询词，用于提高搜索召回（换一种说法、补全主体、口语/书面变体均可）。

关键词：${keyword}

要求：
1. 每个查询词都应仍指向同一主题/主体，不要偏离原意；
2. 不要与关键词完全相同，不要生成过于宽泛的词；
3. 直接返回 JSON 对象。

示例：
- 输入「鱼皮的 AI 导航」→ {"queries": ["程序员鱼皮的 AI 导航", "AI 导航 鱼皮", "鱼皮 AI 编程教程"]}
- 输入「GPT-5」→ {"queries": ["GPT-5 发布", "OpenAI GPT-5", "GPT-5 模型"]}

请严格只返回 JSON（不要输出任何其他文字）。`;
}
