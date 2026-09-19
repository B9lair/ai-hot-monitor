import { http, normalize } from './utils.js';

/**
 * V2EX 话题检索
 * 说明：V2EX 无公开的关键词搜索 API，故拉取「最新话题」后按关键词过滤标题/正文。
 *      V2EX 为境外站点，国内网络不可直连，默认关闭（SOURCE_V2EX=false），
 *      挂代理/换网络后可经 .env 手动开启。
 */
export async function searchV2ex(query, limit = 20) {
  try {
    const res = await http.get('https://www.v2ex.com/api/topics/latest.json');
    const list = Array.isArray(res.data) ? res.data : [];
    const kw = String(query || '').toLowerCase();
    return list
      .filter((t) => {
        if (!kw) return true;
        const text = `${t.title || ''} ${t.content || ''}`.toLowerCase();
        return text.includes(kw);
      })
      .slice(0, limit)
      .map((t) =>
        normalize({
          title: t.title || '',
          url: t.url || (t.id ? `https://www.v2ex.com/t/${t.id}` : ''),
          snippet: String(t.content || '').slice(0, 200),
          source: 'V2EX',
          publishedAt: t.created ? new Date(t.created * 1000) : null,
          author: t.member?.username || '',
          ...(t.replies ? { metrics: { comments: t.replies } } : {}),
        }),
      )
      .filter((i) => i.title && i.url);
  } catch (err) {
    console.warn('[v2ex:search] 抓取失败:', err.message);
    return [];
  }
}
