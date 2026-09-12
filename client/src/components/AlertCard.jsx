import { ShieldCheckIcon, ShieldAlertIcon, ExternalIcon } from './Icons.jsx';
import { formatRelativeTime } from '../utils.js';

// 关键词命中卡片（时间线用）
export default function AlertCard({ alert, showKeyword = true }) {
  const isFake = alert.isFake;
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
          {isFake ? (
            <ShieldAlertIcon width={18} height={18} />
          ) : (
            <ShieldCheckIcon width={18} height={18} />
          )}
        </div>

        <div className="min-w-0 flex-1">
          {/* 元信息行 */}
          <div className="flex items-center gap-2 flex-wrap text-[11px] text-slate-400 font-mono">
            {showKeyword && alert.keyword?.text && (
              <span className="rounded-full bg-mint-100 text-mint-700 font-semibold font-sans px-2 py-0.5">
                {alert.keyword.text}
              </span>
            )}
            <span
              className={`font-semibold font-sans ${isFake ? 'text-rose-500' : 'text-mint-600'}`}
            >
              {isFake ? '疑似假冒' : '真实命中'}
            </span>
            <span>{alert.source}</span>
            <span>·</span>
            <span>{formatRelativeTime(alert.createdAt)}</span>
            {typeof alert.confidence === 'number' && (
              <>
                <span>·</span>
                <span>置信 {Math.round(alert.confidence * 100)}%</span>
              </>
            )}
          </div>

          {/* 标题 */}
          {alert.url ? (
            <a
              href={alert.url}
              target="_blank"
              rel="noreferrer"
              className="block text-sm font-semibold text-slate-800 hover:text-mint-600 transition-colors mt-1 break-words group"
            >
              {alert.title}
              <ExternalIcon
                width={13}
                height={13}
                className="inline-block ml-1 opacity-0 group-hover:opacity-100 transition-opacity"
              />
            </a>
          ) : (
            <p className="text-sm font-semibold text-slate-800 mt-1 break-words">{alert.title}</p>
          )}

          {/* AI 摘要 */}
          {alert.summary && (
            <p className="text-xs text-slate-500 mt-1.5 line-clamp-2 break-words">{alert.summary}</p>
          )}
        </div>
      </div>
    </div>
  );
}
