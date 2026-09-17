import { useState } from 'react';
import {
  ShieldCheckIcon,
  ShieldAlertIcon,
  ExternalIcon,
  HeartIcon,
  MessageCircleIcon,
  RepeatIcon,
  QuoteIcon,
  EyeIcon,
  StarIcon,
  GitForkIcon,
  UsersIcon,
  BadgeCheckIcon,
  ArrowUpCircleIcon,
  ClockIcon,
  CalendarIcon,
  ChevronRightIcon,
} from './Icons.jsx';
import { formatRelativeTime, formatDateTime, formatCount } from '../utils.js';

// 来源平台徽标配色（彩色徽章，便于一眼区分平台）
const SOURCE_BADGE = {
  Twitter: 'bg-sky-50 text-sky-600 border-sky-100',
  HackerNews: 'bg-orange-50 text-orange-600 border-orange-100',
  'B站': 'bg-pink-50 text-pink-600 border-pink-100',
  微博: 'bg-rose-50 text-rose-600 border-rose-100',
  GitHub: 'bg-slate-100 text-slate-700 border-slate-200',
  知乎: 'bg-blue-50 text-blue-600 border-blue-100',
  Bing: 'bg-teal-50 text-teal-600 border-teal-100',
  百度: 'bg-red-50 text-red-600 border-red-100',
  搜狗: 'bg-indigo-50 text-indigo-600 border-indigo-100',
  Google: 'bg-sky-50 text-sky-600 border-sky-100',
  DuckDuckGo: 'bg-amber-50 text-amber-700 border-amber-100',
  Reddit: 'bg-orange-50 text-orange-600 border-orange-100',
  V2EX: 'bg-stone-100 text-stone-700 border-stone-200',
};

// 互动指标元信息（显示名 / 图标 / 颜色）
const METRIC_META = {
  likes: { label: '赞', icon: HeartIcon, cls: 'text-rose-500' },
  retweets: { label: '转发', icon: RepeatIcon, cls: 'text-emerald-500' },
  replyCount: { label: '评论', icon: MessageCircleIcon, cls: 'text-sky-500' },
  quoteCount: { label: '引用', icon: QuoteIcon, cls: 'text-violet-500' },
  views: { label: '浏览', icon: EyeIcon, cls: 'text-slate-400' },
  followers: { label: '粉丝', icon: UsersIcon, cls: 'text-amber-500' },
  stars: { label: 'Star', icon: StarIcon, cls: 'text-amber-500' },
  forks: { label: 'Fork', icon: GitForkIcon, cls: 'text-slate-400' },
  points: { label: '热度', icon: ArrowUpCircleIcon, cls: 'text-orange-500' },
  comments: { label: '评论', icon: MessageCircleIcon, cls: 'text-sky-500' },
};

// 各源按此顺序展示互动指标（无指标则自动隐藏）
const METRIC_ORDER = {
  Twitter: ['likes', 'retweets', 'replyCount', 'quoteCount', 'views', 'followers'],
  GitHub: ['stars', 'forks'],
  HackerNews: ['points', 'comments'],
  'B站': ['views'],
};

function parseMetrics(alert) {
  try {
    return JSON.parse(alert.metrics || '{}');
  } catch {
    return {};
  }
}

function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

// 关键词命中高亮（大小写不敏感，返回 React 片段）
function highlight(text, keyword) {
  if (!text || !keyword) return text;
  const lower = text.toLowerCase();
  const kw = keyword.toLowerCase();
  if (!lower.includes(kw)) return text;
  const parts = [];
  let start = 0;
  let i = lower.indexOf(kw);
  while (i !== -1) {
    if (i > start) parts.push(text.slice(start, i));
    parts.push(
      <mark key={i} className="bg-amber-100 text-amber-900 rounded-sm px-0.5">
        {text.slice(i, i + kw.length)}
      </mark>,
    );
    start = i + kw.length;
    i = lower.indexOf(kw, start);
  }
  if (start < text.length) parts.push(text.slice(start));
  return parts;
}

export default function AlertCard({ alert, showKeyword = true, detailExpanded, onToggleDetail }) {
  const isFake = alert.isFake;
  const [selfDetail, setSelfDetail] = useState(false);
  const detailOpen = detailExpanded ?? selfDetail;
  const toggleDetail = () => (onToggleDetail ? onToggleDetail(alert.id) : setSelfDetail((v) => !v));

  const metrics = parseMetrics(alert);
  const metricKeys = (METRIC_ORDER[alert.source] || []).filter((k) => Number.isFinite(metrics[k]));
  const keyword = alert.keyword?.text || '';
  const domain = domainOf(alert.url);
  const badge = SOURCE_BADGE[alert.source] || 'bg-slate-50 text-slate-600 border-slate-100';

  const hasRelevance = typeof alert.relevance === 'number';
  const hasConfidence = typeof alert.confidence === 'number';
  // 有可展开内容：原文摘要 / 相关理由 / 假冒原因
  const hasDetail = Boolean(alert.snippet || alert.relevanceReason || alert.fakeReason);

  return (
    <div className="panel panel-hover rounded-2xl p-4">
      <div className="flex items-start gap-3">
        {/* 状态标识 */}
        <div
          className={`shrink-0 w-9 h-9 rounded-xl flex items-center justify-center ${
            isFake ? 'bg-rose-50 text-rose-500' : 'bg-mint-50 text-mint-600'
          }`}
          title={isFake ? '疑似假冒' : '已验证真实'}
        >
          {isFake ? <ShieldAlertIcon width={18} height={18} /> : <ShieldCheckIcon width={18} height={18} />}
        </div>

        <div className="min-w-0 flex-1">
          {/* 元信息行：关键词 / 来源 / 真伪 / 评分徽章 / 作者 / 域名 */}
          <div className="flex items-center gap-1.5 flex-wrap text-[11px] text-slate-400">
            {showKeyword && keyword && (
              <span className="rounded-full bg-mint-100 text-mint-700 font-semibold font-sans px-2 py-0.5">
                {keyword}
              </span>
            )}
            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 font-sans font-semibold ${badge}`}>
              {alert.source}
            </span>
            <span className={`font-semibold font-sans ${isFake ? 'text-rose-500' : 'text-mint-600'}`}>
              {isFake ? '疑似假冒' : '真实命中'}
            </span>
            {hasRelevance && (
              <span className="inline-flex items-center rounded-full bg-mint-50 text-mint-700 border border-mint-100 px-1.5 py-0.5 font-sans font-semibold">
                相关 {Math.round(alert.relevance * 100)}%
              </span>
            )}
            {hasConfidence && (
              <span className="inline-flex items-center rounded-full bg-sky-50 text-sky-600 border border-sky-100 px-1.5 py-0.5 font-sans font-semibold">
                置信 {Math.round(alert.confidence * 100)}%
              </span>
            )}
            {alert.author && (
              <span className="inline-flex items-center gap-1 text-slate-500">
                <span>·</span>
                <span className="font-sans">{alert.author}</span>
                {alert.source === 'Twitter' && metrics.verified && (
                  <BadgeCheckIcon width={13} height={13} className="text-sky-500" />
                )}
              </span>
            )}
            {domain && <span className="inline-flex items-center gap-1">· {domain}</span>}
          </div>

          {/* 标题（含关键词高亮） */}
          {alert.url ? (
            <a
              href={alert.url}
              target="_blank"
              rel="noreferrer"
              className="block text-sm font-semibold text-slate-800 hover:text-mint-600 transition-colors mt-1 break-words group"
            >
              {highlight(alert.title, keyword)}
              <ExternalIcon
                width={13}
                height={13}
                className="inline-block ml-1 opacity-0 group-hover:opacity-100 transition-opacity"
              />
            </a>
          ) : (
            <p className="text-sm font-semibold text-slate-800 mt-1 break-words">{highlight(alert.title, keyword)}</p>
          )}

          {/* AI 总结（简短摘要，常驻） */}
          {alert.summary && (
            <p className="text-xs text-slate-500 mt-1.5 line-clamp-2 break-words">
              <span className="font-semibold text-mint-600">AI总结：</span>
              {alert.summary}
            </p>
          )}

          {/* 互动指标 */}
          {metricKeys.length > 0 && (
            <div className="flex items-center gap-3 flex-wrap mt-2">
              {metricKeys.map((k) => {
                const meta = METRIC_META[k];
                const Icon = meta.icon;
                return (
                  <span
                    key={k}
                    title={`${meta.label} ${formatCount(metrics[k])}`}
                    className={`inline-flex items-center gap-1 text-xs ${meta.cls}`}
                  >
                    <Icon width={13} height={13} />
                    <span className="font-mono font-semibold">{formatCount(metrics[k])}</span>
                  </span>
                );
              })}
            </div>
          )}

          {/* 时间：抓取时间 + 发布时间 */}
          <div className="flex items-center gap-1.5 flex-wrap text-[11px] text-slate-400 font-mono mt-2">
            <span
              className="inline-flex items-center gap-1"
              title={new Date(alert.createdAt).toLocaleString('zh-CN')}
            >
              <ClockIcon width={12} height={12} />
              抓取 {formatRelativeTime(alert.createdAt)}
            </span>
            {alert.publishedAt && (
              <span className="inline-flex items-center gap-1">
                <CalendarIcon width={12} height={12} />
                发布 {formatDateTime(alert.publishedAt)}
              </span>
            )}
          </div>

          {/* 展开详情：原文摘要 + AI 分析理由（单条展开，或由 FeedView 一键展开/折叠全部） */}
          {hasDetail && (
            <div className="mt-2 border-t border-mint-50 pt-2">
              <button
                onClick={toggleDetail}
                className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-mint-600 hover:text-mint-700 transition-colors cursor-pointer"
              >
                <ChevronRightIcon
                  width={12}
                  height={12}
                  className={`transition-transform ${detailOpen ? 'rotate-90' : ''}`}
                />
                {detailOpen ? '收起详情' : '展开详情'}
              </button>
              {detailOpen && (
                <div className="mt-1.5 space-y-1.5">
                  {alert.snippet && (
                    <p className="text-xs text-slate-500 break-words leading-relaxed bg-slate-50 rounded-lg px-2.5 py-2">
                      <span className="text-slate-400 font-semibold">原文摘要 · </span>
                      {highlight(alert.snippet, keyword)}
                    </p>
                  )}
                  {alert.relevanceReason && (
                    <p className="text-xs text-slate-600 break-words leading-relaxed">{alert.relevanceReason}</p>
                  )}
                  {alert.fakeReason && (
                    <p className="text-xs text-rose-600 break-words leading-relaxed bg-rose-50 rounded-lg px-2.5 py-2">
                      <span className="font-semibold">疑似假冒 · </span>
                      {alert.fakeReason}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
