import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { formatInterval, splitInterval, toMinutes } from '../lib/utils.js';
import Switch from '../components/Switch.jsx';
import AlertCard from '../components/AlertCard.jsx';
import EmptyState from '../components/EmptyState.jsx';
import {
  PlusIcon,
  TrashIcon,
  PlayIcon,
  LoaderIcon,
  SearchIcon,
  RadarIcon,
  EditIcon,
  CheckIcon,
  XIcon,
  ChevronRightIcon,
} from '../components/Icons.jsx';

const UNITS = [
  { value: 'minute', label: '分钟' },
  { value: 'hour', label: '小时' },
  { value: 'day', label: '天' },
];

export default function KeywordView({ status, tick, progress }) {
  const [keywords, setKeywords] = useState([]);
  const [input, setInput] = useState('');
  const [intervalValue, setIntervalValue] = useState(1);
  const [intervalUnit, setIntervalUnit] = useState('hour');
  const [adding, setAdding] = useState(false);
  const [running, setRunning] = useState({});
  const [editing, setEditing] = useState(null);
  const [editIntervalValue, setEditIntervalValue] = useState(1);
  const [editIntervalUnit, setEditIntervalUnit] = useState('hour');
  const [expanded, setExpanded] = useState(null);

  const load = () => api.getKeywords().then(setKeywords).catch(console.error);
  useEffect(() => {
    load();
  }, [tick]);

  const add = async (e) => {
    e.preventDefault();
    if (!input.trim() || adding) return;
    setAdding(true);
    try {
      await api.addKeyword(input.trim(), toMinutes(intervalValue, intervalUnit));
      setInput('');
      await load();
    } catch (err) {
      alert(err.message);
    } finally {
      setAdding(false);
    }
  };

  const toggle = async (kw) => {
    await api.updateKeyword(kw.id, { enabled: !kw.enabled });
    await load();
  };

  const remove = async (id) => {
    if (!window.confirm('确认删除该关键词？')) return;
    await api.deleteKeyword(id);
    await load();
  };

  const run = async (id) => {
    setRunning((r) => ({ ...r, [id]: true }));
    try {
      await api.runKeyword(id);
      await load();
    } catch (err) {
      alert(err.message);
    } finally {
      setRunning((r) => ({ ...r, [id]: false }));
    }
  };

  const startEdit = (kw) => {
    setEditing(kw.id);
    const { value, unit } = splitInterval(kw.intervalMin);
    setEditIntervalValue(value);
    setEditIntervalUnit(unit);
  };

  const saveEdit = async (id) => {
    await api.updateKeyword(id, { intervalMin: toMinutes(editIntervalValue, editIntervalUnit) });
    setEditing(null);
    await load();
  };

  const enabledCount = keywords.filter((k) => k.enabled).length;

  return (
    <div className="space-y-5">
      {/* 页头 */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display font-extrabold text-xl text-slate-800 flex items-center gap-2">
            <RadarIcon width={20} height={20} className="text-mint-600" />
            热点范围
          </h2>
          <p className="text-xs text-slate-400 mt-1">定义要关注的热点范围，AI 实时搜索并拦截假冒与标题党</p>
        </div>
        <span className="shrink-0 rounded-full bg-mint-50 text-mint-700 text-xs font-semibold px-2.5 py-1 border border-mint-100">
          {enabledCount}/{keywords.length} 关注中
        </span>
      </div>

      {/* 添加表单 */}
      <form onSubmit={add} className="panel rounded-2xl p-4 flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1 min-w-0">
          <SearchIcon
            width={16}
            height={16}
            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="输入要关注的热点范围，如 GPT-5、Claude 4、Sora…"
            aria-label="添加关注范围"
            className="w-full rounded-xl bg-white border border-mint-200 pl-10 pr-4 py-2.5 text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-mint-400/60 focus:border-mint-400 transition"
          />
        </div>
        <div className="flex gap-2">
          <div className="flex items-center gap-1 rounded-xl bg-white border border-mint-200 px-2 py-1">
            <input
              type="number"
              min={1}
              value={intervalValue}
              onChange={(e) => setIntervalValue(e.target.value)}
              aria-label="抓取间隔数值"
              className="w-12 rounded-lg bg-white text-sm text-slate-700 text-center focus:outline-none focus:ring-2 focus:ring-mint-400/60"
            />
            <select
              value={intervalUnit}
              onChange={(e) => setIntervalUnit(e.target.value)}
              aria-label="抓取间隔单位"
              className="rounded-lg bg-white text-sm text-slate-600 focus:outline-none cursor-pointer"
            >
              {UNITS.map((u) => (
                <option key={u.value} value={u.value}>
                  {u.label}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={adding || !input.trim()}
            className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-mint-500 to-emerald-500 text-white text-sm font-bold px-4 py-2.5 hover:shadow-lift disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer"
          >
            {adding ? <LoaderIcon width={16} height={16} /> : <PlusIcon width={16} height={16} />}
            添加
          </button>
        </div>
      </form>

      {!status?.hasAI && (
        <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
          <span className="shrink-0">⚠️</span>
          <span>未配置 OpenRouter API Key，当前退化为纯关键词匹配（无法 AI 防伪）。</span>
        </div>
      )}

      {/* 关键词列表 */}
      {keywords.length === 0 ? (
        <div className="panel rounded-2xl">
          <EmptyState icon={<RadarIcon width={36} height={36} />} text="还没有关注范围" hint="添加一个关注范围，开始捕捉最新热点" />
        </div>
      ) : (
        <div className="space-y-3">
          {keywords.map((kw) => {
            const isEditing = editing === kw.id;
            const isExpanded = expanded === kw.id;
            return (
              <div key={kw.id} className={`panel panel-hover rounded-2xl p-4 ${!kw.enabled ? 'opacity-60' : ''}`}>
                <div className="flex items-center gap-3">
                  <Switch
                    checked={kw.enabled}
                    onChange={() => toggle(kw)}
                    label={`切换「${kw.text}」监控状态`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-800 truncate">{kw.text}</p>
                    {isEditing ? (
                      <div className="flex items-center gap-1.5 mt-1">
                        <input
                          type="number"
                          min={1}
                          value={editIntervalValue}
                          onChange={(e) => setEditIntervalValue(e.target.value)}
                          aria-label="抓取间隔数值"
                          className="w-12 rounded-lg bg-white border border-mint-200 px-2 py-1 text-xs text-slate-600 text-center focus:outline-none cursor-pointer"
                        />
                        <select
                          value={editIntervalUnit}
                          onChange={(e) => setEditIntervalUnit(e.target.value)}
                          aria-label="抓取间隔单位"
                          className="rounded-lg bg-white border border-mint-200 px-1.5 py-1 text-xs text-slate-600 focus:outline-none cursor-pointer"
                        >
                          {UNITS.map((u) => (
                            <option key={u.value} value={u.value}>
                              {u.label}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() => saveEdit(kw.id)}
                          className="p-1 rounded-lg text-mint-600 hover:bg-mint-50 cursor-pointer"
                          aria-label="保存周期"
                        >
                          <CheckIcon width={14} height={14} />
                        </button>
                        <button
                          onClick={() => setEditing(null)}
                          className="p-1 rounded-lg text-slate-400 hover:bg-slate-50 cursor-pointer"
                          aria-label="取消编辑"
                        >
                          <XIcon width={14} height={14} />
                        </button>
                      </div>
                    ) : (
                      <p className="text-[11px] text-slate-400 font-mono mt-0.5">
                        每 {formatInterval(kw.intervalMin)} · {kw.alerts?.length ?? 0} 条命中
                      </p>
                    )}
                    {running[kw.id] && (
                      <p className="mt-0.5 flex items-center gap-1 text-[11px] font-mono text-mint-600">
                        <LoaderIcon width={11} height={11} />
                        {progress?.keywordId === kw.id && progress.total > 0
                          ? `AI 校验中 ${progress.done}/${progress.total}`
                          : '多源扫描中…'}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <IconBtn
                      onClick={() => setExpanded(isExpanded ? null : kw.id)}
                      title={isExpanded ? '收起命中' : '查看命中'}
                    >
                      <ChevronRightIcon
                        width={16}
                        height={16}
                        className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                      />
                    </IconBtn>
                    <IconBtn onClick={() => run(kw.id)} disabled={running[kw.id]} title="立即检查">
                      {running[kw.id] ? (
                        <LoaderIcon width={16} height={16} />
                      ) : (
                        <PlayIcon width={16} height={16} />
                      )}
                    </IconBtn>
                    <IconBtn onClick={() => startEdit(kw)} title="编辑周期">
                      <EditIcon width={16} height={16} />
                    </IconBtn>
                    <IconBtn onClick={() => remove(kw.id)} title="删除" variant="danger">
                      <TrashIcon width={16} height={16} />
                    </IconBtn>
                  </div>
                </div>

                {/* 命中历史 */}
                {isExpanded && (
                  <div className="mt-3 space-y-2.5 border-t border-mint-50 pt-3">
                    {(kw.alerts || []).length === 0 ? (
                      <p className="text-xs text-slate-400 py-2 text-center">暂无命中记录</p>
                    ) : (
                      kw.alerts.map((a) => (
                        <AlertCard key={a.id} alert={a} showKeyword={false} />
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function IconBtn({ onClick, disabled, title, variant = 'default', children }) {
  const baseCls = 'p-2 rounded-lg transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed';
  const variantCls =
    variant === 'danger'
      ? 'text-slate-400 hover:text-rose-500 hover:bg-rose-50'
      : 'text-slate-400 hover:text-mint-600 hover:bg-mint-50';
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={`${baseCls} ${variantCls}`}
    >
      {children}
    </button>
  );
}
