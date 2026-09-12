import { http, normalize } from './utils.js';

/**
 * 微博数据源
 * 热搜榜使用公开接口（无需登录），搜索接口需要 cookie，故优先用热搜榜
 */
export async function getWeiboHot(limit = 20) {
  try {
    const res = await http.get('https://weibo.com/ajax/side/hotSearch', {
      headers: { Referer: 'https://weibo.com/hot/search' },
    });
    const list = res.data?.data?.realtime || [];
    return list
      .slice(0, limit)
      .map((r) =>
        normalize({
          title: r.note || r.word || '',
          url: r.word_scheme || `https://s.weibo.com/weibo?q=${encodeURIComponent(r.word || '')}`,
          snippet: r.category ? `分类：${r.category}` : '',
          source: '微博',
          publishedAt: null,
        }),
      )
      .filter((i) => i.title);
  } catch (err) {
    console.warn('[weibo:hot] 抓取失败:', err.message);
    return [];
  }
}
