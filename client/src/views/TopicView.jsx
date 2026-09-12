import { useEffect, useState } from 'react';
import { api } from '../api.js';
import Switch from '../components/Switch.jsx';
import HotspotCard from '../components/HotspotCard.jsx';
import EmptyState from '../components/EmptyState.jsx';
import {
  PlusIcon,
  LoaderIcon,
  FlameIcon,
  RefreshIcon,
  XIcon,
  EditIcon,
  CheckIcon,
  TrendingUpIcon,
} from '../components/Icons.jsx';

const INTERVALS = [5, 10, 15, 30, 60];

export default function TopicView({ tick }) {
  const [topics, setTopics] = useState([]);
  const [allHotspots, setAllHotspots] = useState([]);
  const [input, setInput] = useState('');
  const [intervalMin, setIntervalMin] = useState(15);
  const [adding, setAdding] = useState(false);
  const [running, setRunning] = useState({});
  const [active, setActive] = useState('all');
  const [editing, setEditing] = useState(false);
  const [editInterval, setEditInterval] = useState(15);

  const loadTopics = () => api.getTopics().then(setTopics).catch(console.error);
  const loadAll = () => api.getHotspots().then(setAllHotspots).catch(console.error);

  useEffect(() => {
    loadTopics();
    loadAll();
  }, [tick]);

  const add = async (e) => {
    e.preventDefault();
    if (!input.trim() || adding) return;
    setAdding(true);
    try {
      await api.addTopic(input.trim(), intervalMin);
      setInput('');
      await loadTopics();
      await loadAll();
    } catch (err) {
      alert(err.message);
    } finally {
      setAdding(false);
    }
  };

  const remove = async (id) => {
    if (!window.confirm('确认删除该关注范围？')) return;
    await api.deleteTopic(id);
    setActive((cur) => (cur === id ? 'all' : cur));
    await loadTopics();
    await loadAll();
  };

  const toggle = async (t) => {
    await api.updateTopic(t.id, { enabled: !t.enabled });
    await loadTopics();
  };

  const run = async (id) => {
    setRunning((r) => ({ ...r, [id]: true }));
    try {
      await api.runTopic(id);
      await loadTopics();
      await loadAll();
    } catch (err) {
      alert(err.message);
    } finally {
      setRunning((r) => ({ ...r, [id]: false }));
    }
  };

  const startEdit = (t) => {
    setEditing(true);
    setEditInterval(t.intervalMin);
  };

  const saveEdit = async (id) => {
    await api.updateTopic(id, { intervalMin: editInterval });
    setEditing(false);
    await loadTopics();
  };

  const currentTopic = active === 'all' ? null : topics.find((t) => t.id === active);

  // 展示热点：全部视图按热度排序，单范围视图用其自带榜单
  const hotspots =
    active === 'all'
      ? [...allHotspots].sort((a, b) => (b.hotness ?? 0) - (a.hotness ?? 0))
      : currentTopic?.hotspots || [];

  return (
    <div className="space-y-5">
      {/* 页头 */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display font-extrabold text-xl text-slate-800 flex items-center gap-2">
            <FlameIcon width={20} height={20} className="text-orange-500" />
            热点发现
          </h2>
          <p className="text-xs text-slate-400 mt-1">定时搜集指定范围热点，AI 聚合去重</p>
        </div>
        <span className="shrink-0 rounded-full bg-mint-50 text-mint-700 text-xs font-semibold px-2.5 py-1 border border-mint-100">
          {topics.length} 个范围
        </span>
      </div>

      {/* 添加表单 */}
      <form onSubmit={add} className="panel rounded-2xl p-4 flex flex-col sm:flex-row gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="输入关注范围，如 AI编程、大模型、Agent…"
          aria-label="添加关注范围"
          className="flex-1 min-w-0 rounded-xl bg-white border border-mint-200 px-4 py-2.5 text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-mint-400/60 focus:border-mint-400 transition"
        />
        <div className="flex gap-2">
          <select
            value={intervalMin}
            onChange={(e) => setIntervalMin(Number(e.target.value))}
            aria-label="发现周期"
            className="rounded-xl bg-white border border-mint-200 px-3 py-2.5 text-sm text-slate-600 focus:outline-none focus:ring-2 focus:ring-mint-400/60 cursor-pointer"
          >
            {INTERVALS.map((m) => (
              <option key={m} value={m}>
                {m} 分钟
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={adding || !input.trim()}
            className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-amber-400 to-orange-400 text-white text-sm font-bold px-4 py-2.5 hover:shadow-lift disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer"
          >
            {adding ? <LoaderIcon width={16} height={16} /> : <PlusIcon width={16} height={16} />}
            添加
          </button>
        </div>
      </form>

      {/* 范围 chips */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setActive('all')}
          className={`flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold border transition-colors cursor-pointer ${
            active === 'all'
              ? 'bg-mint-500 border-mint-500 text-white'
              : 'bg-white border-mint-200 text-slate-600 hover:border-mint-400'
          }`}
        >
          <TrendingUpIcon width={13} height={13} />
          全部总榜
        </button>

        {topics.map((t) => {
          const isActive = active === t.id;
          return (
            <div
              key={t.id}
              className={`group flex items-center rounded-full border transition-all ${
                isActive
                  ? 'bg-mint-500 border-mint-500 text-white'
                  : 'bg-white border-mint-200 text-slate-600 hover:border-mint-400'
              }`}
            >
              <button
                onClick={() => setActive(t.id)}
                className="flex items-center gap-1.5 pl-3.5 py-2 pr-1 cursor-pointer"
              >
                <span className={`text-xs font-semibold ${isActive ? 'text-white' : 'text-slate-700'}`}>
                  {t.text}
                </span>
                <span className={`text-[10px] font-mono ${isActive ? 'text-white/80' : 'text-slate-400'}`}>
                  {t.hotspots?.length ?? 0}
                </span>
              </button>
              <button
                onClick={() => remove(t.id)}
                aria-label={`删除「${t.text}」范围`}
                className={`mr-1.5 p-1 rounded-full transition-colors cursor-pointer ${
                  isActive ? 'text-white/80 hover:bg-white/20' : 'text-slate-400 hover:text-rose-500 hover:bg-rose-50'
                }`}
              >
                <XIcon width={13} height={13} />
              </button>
            </div>
          );
        })}
      </div>

      {/* 热点榜 */}
      <div className="panel rounded-2xl p-5">
        {/* 榜头 */}
        <div className="flex items-center justify-between gap-3 mb-4">
          <h3 className="font-display font-bold text-sm text-slate-800 flex items-center gap-2">
            <FlameIcon width={16} height={16} className="text-orange-500" />
            {active === 'all' ? '全部范围 · 热点总榜' : `${currentTopic?.text} · 热点榜`}
          </h3>

          <div className="flex items-center gap-3">
            {currentTopic && (
              <>
                {editing ? (
                  <div className="flex items-center gap-1.5">
                    <select
                      value={editInterval}
                      onChange={(e) => setEditInterval(Number(e.target.value))}
                      className="rounded-lg bg-white border border-mint-200 px-2 py-1 text-xs text-slate-600 focus:outline-none cursor-pointer"
                    >
                      {INTERVALS.map((m) => (
                        <option key={m} value={m}>
                          {m} 分钟
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => saveEdit(currentTopic.id)}
                      className="p-1.5 rounded-lg text-mint-600 hover:bg-mint-50 cursor-pointer"
                      aria-label="保存周期"
                    >
                      <CheckIcon width={14} height={14} />
                    </button>
                    <button
                      onClick={() => setEditing(false)}
                      className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-50 cursor-pointer"
                      aria-label="取消编辑"
                    >
                      <XIcon width={14} height={14} />
                    </button>
                  </div>
                ) : (
                  <>
                    <span className="flex items-center gap-1.5 text-xs text-slate-500">
                      <Switch
                        checked={currentTopic.enabled}
                        onChange={() => toggle(currentTopic)}
                        label={`切换「${currentTopic.text}」发现状态`}
                      />
                      启用
                    </span>
                    <button
                      onClick={() => startEdit(currentTopic)}
                      className="flex items-center gap-1 text-xs font-semibold text-mint-600 hover:text-mint-700 cursor-pointer"
                    >
                      <EditIcon width={13} height={13} />
                      周期
                    </button>
                  </>
                )}
              </>
            )}

            {currentTopic && (
              <button
                onClick={() => run(currentTopic.id)}
                disabled={running[currentTopic.id]}
                className="flex items-center gap-1.5 text-xs font-semibold text-mint-600 hover:text-mint-700 transition-colors cursor-pointer disabled:opacity-40"
              >
                {running[currentTopic.id] ? (
                  <LoaderIcon width={14} height={14} />
                ) : (
                  <RefreshIcon width={14} height={14} />
                )}
                立即刷新
              </button>
            )}
          </div>
        </div>

        {/* 榜单内容 */}
        {hotspots.length === 0 ? (
          <EmptyState
            icon={<FlameIcon width={36} height={36} />}
            text="暂无热点"
            hint={active === 'all' ? '添加关注范围后开始发现热点' : '点击右上角立即刷新'}
          />
        ) : (
          <div className="space-y-2.5">
            {hotspots.map((h, i) => (
              <HotspotCard
                key={h.id}
                hotspot={h}
                showTopic={active === 'all'}
                rank={i + 1}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
