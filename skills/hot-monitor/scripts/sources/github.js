import { config } from '../config.js';
import { http, normalize } from './utils.js';

/**
 * GitHub 仓库搜索（官方 Search API）
 * - 匿名调用限流约 10 次/分钟；配置 GITHUB_TOKEN 后提升至 30 次/分钟
 */
export async function searchGithub(query, limit = 20) {
  try {
    const headers = { Accept: 'application/vnd.github+json' };
    if (config.sources.githubToken) {
      headers.Authorization = `Bearer ${config.sources.githubToken}`;
    }

    const s = config.sources;
    const hours = s.timeWindowBySource?.GitHub ?? s.timeWindowHours;
    const since = new Date(Date.now() - Math.max(1, hours) * 3600 * 1000).toISOString().slice(0, 10);

    const res = await http.get('https://api.github.com/search/repositories', {
      params: { q: `${query} pushed:>${since}`, sort: 'stars', order: 'desc', per_page: limit },
      headers,
    });
    const items = res.data?.items || [];
    return items
      .slice(0, limit)
      .map((r) =>
        normalize({
          title: r.full_name || '',
          url: r.html_url || '',
          snippet: String(r.description || '').slice(0, 200),
          source: 'GitHub',
          publishedAt: r.pushed_at ? new Date(r.pushed_at) : null,
          author: r.owner?.login || '',
          metrics: {
            stars: r.stargazers_count || 0,
            forks: r.forks_count || 0,
            watchers: r.watchers_count || 0,
            issues: r.open_issues_count || 0,
          },
        }),
      )
      .filter((i) => i.title);
  } catch (err) {
    console.warn('[github:search] 抓取失败:', err.message);
    return [];
  }
}
