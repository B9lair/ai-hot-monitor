import { FlameIcon, ExternalIcon } from './Icons.jsx';
import { formatRelativeTime } from '../utils.js';

// 热点卡片（时间线 / 热点榜通用）
export default function HotspotCard({ hotspot, showTopic = true, rank }) {
  return (
    <div className="panel panel-hover rounded-2xl p-4">
      <div className="flex items-start gap-3">
        {/* 热度 / 排名标识 */}
        <div
          className={`shrink-0 w-9 h-9 rounded-xl flex items-center justify-center font-display font-extrabold text-sm ${
            rank && rank <= 3
              ? 'bg-gradient-to-br from-amber-400 to-orange-400 text-white'
              : 'bg-orange-50 text-orange-500'
          }`}
          title="热度"
        >
          {rank ? rank : <FlameIcon width={18} height={18} />}
        </div>

        <div className="min-w-0 flex-1">
          {/* 元信息行 */}
          <div className="flex items-center gap-2 flex-wrap text-[11px] text-slate-400 font-mono">
            {showTopic && hotspot.topic?.text && (
              <span className="rounded-full bg-orange-100 text-orange-600 font-semibold font-sans px-2 py-0.5">
                {hotspot.topic.text}
              </span>
            )}
            {hotspot.category && (
              <span className="rounded-full bg-mint-100 text-mint-700 font-semibold font-sans px-2 py-0.5">
                {hotspot.category}
              </span>
            )}
            {hotspot.source && <span>{hotspot.source}</span>}
            <span>·</span>
            <span>{formatRelativeTime(hotspot.createdAt)}</span>
            {typeof hotspot.hotness === 'number' && (
              <span className="ml-auto inline-flex items-center gap-1 font-bold font-sans text-orange-500">
                <FlameIcon width={13} height={13} />
                {Math.round(hotspot.hotness)}
              </span>
            )}
          </div>

          {/* 标题 */}
          {hotspot.url ? (
            <a
              href={hotspot.url}
              target="_blank"
              rel="noreferrer"
              className="block text-sm font-semibold text-slate-800 hover:text-mint-600 transition-colors mt-1 break-words group"
            >
              {hotspot.title}
              <ExternalIcon
                width={13}
                height={13}
                className="inline-block ml-1 opacity-0 group-hover:opacity-100 transition-opacity"
              />
            </a>
          ) : (
            <p className="text-sm font-semibold text-slate-800 mt-1 break-words">{hotspot.title}</p>
          )}

          {/* AI 摘要 */}
          {hotspot.summary && (
            <p className="text-xs text-slate-500 mt-1.5 line-clamp-2 break-words">{hotspot.summary}</p>
          )}
        </div>
      </div>
    </div>
  );
}
