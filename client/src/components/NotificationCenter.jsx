import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { BellIcon, MailIcon, InboxIcon, XIcon, ExternalIcon } from './Icons.jsx';
import { formatDateTime } from '../utils.js';

// 顶部通知中心（唯一通知入口）
export default function NotificationCenter({ unread, onClear }) {
  const [notifications, setNotifications] = useState([]);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  const load = () => api.getNotifications().then(setNotifications).catch(console.error);

  useEffect(() => {
    load();
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) {
      load();
      onClear?.();
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={toggle}
        aria-label="通知中心"
        className="relative w-9 h-9 rounded-xl border border-mint-100 bg-white text-slate-500 hover:text-mint-600 hover:border-mint-300 flex items-center justify-center transition-colors cursor-pointer"
      >
        <BellIcon width={17} height={17} />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center border-2 border-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 sm:w-96 max-w-[calc(100vw-2rem)] panel rounded-2xl overflow-hidden shadow-lift z-50 animate-pop-in">
          <div className="flex items-center justify-between px-4 py-3 border-b border-mint-100">
            <span className="font-display font-bold text-sm text-slate-800 flex items-center gap-2">
              <InboxIcon width={15} height={15} className="text-mint-600" />
              通知中心
            </span>
            <button
              onClick={() => setOpen(false)}
              aria-label="关闭通知中心"
              className="text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              <XIcon width={16} height={16} />
            </button>
          </div>

          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 && (
              <p className="text-center text-xs text-slate-400 py-10">暂无通知</p>
            )}
            {notifications.map((n) => (
              <div key={n.id} className="px-4 py-3 border-b border-mint-50 last:border-0 hover:bg-mint-50/40">
                <div className="flex items-start gap-2.5">
                  <span
                    className={`mt-0.5 shrink-0 w-6 h-6 rounded-lg flex items-center justify-center ${
                      n.channel === 'email' ? 'bg-violet-50 text-violet-500' : 'bg-mint-50 text-mint-600'
                    }`}
                  >
                    {n.channel === 'email' ? (
                      <MailIcon width={13} height={13} />
                    ) : (
                      <BellIcon width={13} height={13} />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-slate-700 break-words">{n.title}</p>
                    <p className="text-[11px] text-slate-500 mt-0.5 break-words line-clamp-2">
                      {n.content}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] text-slate-400 font-mono">
                        {formatDateTime(n.createdAt)}
                      </span>
                      {n.url && (
                        <a
                          href={n.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[10px] text-mint-600 font-semibold hover:underline inline-flex items-center gap-0.5"
                        >
                          原文 <ExternalIcon width={10} height={10} />
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
