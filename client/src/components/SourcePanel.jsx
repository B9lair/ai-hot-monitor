import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { DatabaseIcon, XIcon } from './Icons.jsx';
import Switch from './Switch.jsx';

/**
 * 顶部「数据源」下拉面板：动态开启/关闭各数据源，降低调用成本。
 * - sources: 后端 /api/sources 返回的完整列表（含 label/region/enabled/available/note）
 * - onSourcesChange: 切换成功后回传最新列表，供 App 同步 status
 */
export default function SourcePanel({ sources, onSourcesChange }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState({}); // key -> 是否请求中
  const ref = useRef(null);

  // 点击面板外部关闭
  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const toggle = async (key, next) => {
    if (busy[key]) return;
    setBusy((b) => ({ ...b, [key]: true }));
    try {
      const { sources: list } = await api.updateSource(key, next);
      onSourcesChange?.(list);
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy((b) => ({ ...b, [key]: false }));
    }
  };

  const domestic = sources.filter((s) => s.region === 'domestic');
  const foreign = sources.filter((s) => s.region === 'foreign');
  const enabledCount = sources.filter((s) => s.enabled).length;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="数据源开关"
        className="rounded-xl border border-mint-100 bg-white text-slate-500 hover:text-mint-600 hover:border-mint-300 flex items-center h-9 gap-1.5 px-3 transition-colors cursor-pointer"
      >
        <DatabaseIcon width={17} height={17} />
        <span className="text-xs font-semibold whitespace-nowrap">数据源</span>
        <span className="text-[10px] font-bold text-mint-600 bg-mint-50 rounded-full px-1.5 py-0.5 leading-4">
          {enabledCount}
        </span>
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 sm:w-[22rem] max-w-[calc(100vw-2rem)] panel rounded-2xl overflow-hidden shadow-lift z-50 animate-pop-in">
          <div className="flex items-center justify-between px-4 py-3 border-b border-mint-100">
            <span className="font-display font-bold text-sm text-slate-800 flex items-center gap-2">
              <DatabaseIcon width={15} height={15} className="text-mint-600" />
              数据源开关
            </span>
            <button
              onClick={() => setOpen(false)}
              aria-label="关闭数据源面板"
              className="text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              <XIcon width={16} height={16} />
            </button>
          </div>

          <p className="px-4 pt-3 text-[11px] text-slate-400">
            关闭用不到的数据源可降低调用成本，立即生效
          </p>

          <div className="max-h-96 overflow-y-auto px-2 py-2">
            <SourceGroup title="国内源" items={domestic} onToggle={toggle} />
            <SourceGroup title="境外源" items={foreign} onToggle={toggle} />
          </div>
        </div>
      )}
    </div>
  );
}

function SourceGroup({ title, items, onToggle }) {
  if (!items.length) return null;
  return (
    <div>
      <p className="px-2 pt-2 pb-1 text-[10px] font-semibold text-slate-400 tracking-wide">
        {title}
      </p>
      {items.map((s) => (
        <div
          key={s.key}
          className="flex items-center justify-between gap-3 px-2 py-2 rounded-xl hover:bg-mint-50/40"
        >
          <div className="min-w-0">
            <p className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
              {s.label}
              {!s.available && (
                <span className="text-[10px] font-medium text-amber-600 bg-amber-50 rounded px-1 py-0.5 whitespace-nowrap">
                  {s.needs === 'key' ? '未配置 Key' : '未配置 Cookie'}
                </span>
              )}
            </p>
            {s.note && <p className="text-[10px] text-slate-400 mt-0.5">{s.note}</p>}
          </div>
          <Switch
            checked={s.enabled}
            label={`切换 ${s.label}`}
            onChange={() => onToggle(s.key, !s.enabled)}
          />
        </div>
      ))}
    </div>
  );
}
