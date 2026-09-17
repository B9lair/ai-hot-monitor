import { config } from '../config.js';
import { http, normalize } from './utils.js';

/** 去掉搜索结果里的 <em> 等高亮标签 */
function stripHtml(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, '')
    .trim();
}

/**
 * 把知乎 API 链接转换为可点击的网页链接
 * - articles/{id}  → https://zhuanlan.zhihu.com/p/{id}
 * - questions/{id} → https://www.zhihu.com/question/{id}
 * - answers/{id}   → https://www.zhihu.com/answer/{id}
 */
function toWebUrl(rawUrl, obj = {}) {
  const m = String(rawUrl || '').match(/^https?:\/\/api\.zhihu\.com\/(articles|questions|answers)\/(\d+)/);
  const kind = m ? m[1] : obj.type;
  const id = m ? m[2] : obj.id;
  if (!kind || !id) return rawUrl || '';
  if (kind === 'articles') return `https://zhuanlan.zhihu.com/p/${id}`;
  if (kind === 'questions') return `https://www.zhihu.com/question/${id}`;
  if (kind === 'answers') return `https://www.zhihu.com/answer/${id}`;
  return rawUrl || '';
}

/**
 * 知乎内容搜索
 * 知乎反爬严格（无 cookie 直接 403），需配置 ZHIHU_COOKIE 后方可调用搜索 API；
 * 未配置 cookie 时返回空数组，不影响整体聚合。
 */
export async function searchZhihu(query, limit = 20) {
  const cookie = config.sources.zhihuCookie;
  if (!cookie) return [];

  try {
    const res = await http.get('https://www.zhihu.com/api/v4/search_v3', {
      params: { t: 'general', q: query, correction: 1, offset: 0, limit },
      headers: {
        Referer: `https://www.zhihu.com/search?type=content&q=${encodeURIComponent(query)}`,
        'x-api-version': '3.0.91',
        Cookie: cookie,
      },
    });
    const list = res.data?.data || [];
    return list
      .map((d) => {
        const o = d?.object || {};
        const title = stripHtml(o.title || o.question?.name || o.title_area?.text || '');
        const url = toWebUrl(o.url || o.html_url, o);
        return normalize({
          title,
          url,
          snippet: stripHtml(o.excerpt || o.description).slice(0, 200),
          source: '知乎',
          publishedAt: null,
        });
      })
      .filter((i) => i.title);
  } catch (err) {
    console.warn('[zhihu:search] 抓取失败:', err.message);
    return [];
  }
}
