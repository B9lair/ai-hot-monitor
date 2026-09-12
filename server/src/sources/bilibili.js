import { http, normalize } from './utils.js';

const BILI_HEADERS = {
  Referer: 'https://www.bilibili.com',
  Origin: 'https://www.bilibili.com',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Cookie: 'buvid3=infoc; buvid4=infoc',
};

/**
 * B站数据源（公开搜索接口，无需 key）
 */
export async function searchBilibili(query, limit = 20) {
  try {
    const res = await http.get('https://api.bilibili.com/x/web-interface/search/type', {
      params: { search_type: 'video', keyword: query },
      headers: BILI_HEADERS,
    });
    const results = res.data?.data?.result || [];
    return results
      .slice(0, limit)
      .map((r) =>
        normalize({
          title: r.title ? r.title.replace(/<[^>]+>/g, '') : '',
          url: r.bvid ? `https://www.bilibili.com/video/${r.bvid}` : (r.arcurl || ''),
          snippet: (r.description || '').slice(0, 200),
          source: 'B站',
          publishedAt: r.pubdate ? new Date(r.pubdate * 1000) : null,
        }),
      )
      .filter((i) => i.title);
  } catch (err) {
    console.warn('[bilibili] 抓取失败:', err.message);
    return [];
  }
}

/**
 * B站热门榜（用于热点发现）
 */
export async function getBilibiliHot(limit = 20) {
  try {
    const res = await http.get('https://api.bilibili.com/x/web-interface/popular', {
      params: { ps: limit, pn: 1 },
      headers: BILI_HEADERS,
    });
    const list = res.data?.data?.list || [];
    return list
      .slice(0, limit)
      .map((r) =>
        normalize({
          title: r.title || '',
          url: r.bvid ? `https://www.bilibili.com/video/${r.bvid}` : (r.short_link_v2 || ''),
          snippet: (r.desc || '').slice(0, 200),
          source: 'B站',
          publishedAt: r.pubdate ? new Date(r.pubdate * 1000) : null,
        }),
      )
      .filter((i) => i.title);
  } catch (err) {
    console.warn('[bilibili:hot] 抓取失败:', err.message);
    return [];
  }
}
