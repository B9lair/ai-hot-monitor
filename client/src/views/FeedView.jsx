import { useEffect, useState, useMemo, useCallback } from 'react';
import { api } from '../api.js';
import StatCards from '../components/StatCards.jsx';
import AlertCard from '../components/AlertCard.jsx';
import HotspotCard from '../components/HotspotCard.jsx';
import EmptyState from '../components/EmptyState.jsx';
import {
  RadarIcon,
  FlameIcon,
  ShieldCheckIcon,
  TrendingUpIcon,
  RefreshIcon,
  LoaderIcon,
  ActivityIcon,
} from '../components/Icons.jsx';

const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'alerts', label: '关键词命中' },
  { key: 'hotspots', label: '热点' },
];

export default function FeedView({ tick }) {
  const [alerts, setAlerts] = useState([]);
  const [hotspots, setHotspots] = useState([]);
  const [keywords, setKeywords] = useState([]);
  const [topics, setTopics] = useState([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [a, h, k, t] = await Promise.all([
        api.getAlerts(),
        api.getHotspots(),
        api.getKeywords(),
        api.getTopics(),
      ]);
      setAlerts(a);
      setHotspots(h);
      setKeywords(k);
      setTopics(t);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, tick]);

  // 合并时间线，按时间倒序
  const feed = useMemo(() => {
    const items = [];
    if (filter !== 'hotspots') {
      for (const a of alerts) items.push({ kind: 'alert', time: a.createdAt, data: a });
    }
    if (filter !== 'alerts') {
      for (const h of hotspots) items.push({ kind: 'hotspot', time: h.createdAt, data: h });
    }
    items.sort((x, y) => new Date(y.time) - new Date(x.time));
    return items;
  }, [alerts, hotspots, filter]);

  const enabledKeywords = keywords.filter((k) => k.enabled).length;
  const realAlerts = alerts.filter((a) => !a.isFake).length;

  const stats = [
    {
      label: '监控关键词',
      value: enabledKeywords,
      icon: <RadarIcon width={20} height={20} />,
      iconBg: 'bg-mint-50',
      iconColor: 'text-mint-600',
    },
    {
      label: '关注范围',
      value: topics.length,
      icon: <TrendingUpIcon width={20} height={20} />,
      iconBg: 'bg-sky-50',
      iconColor: 'text-sky-500',
    },
    {
      label: '真实命中',
      value: realAlerts,
      icon: <ShieldCheckIcon width={20} height={20} />,
      iconBg: 'bg-emerald-50',
      iconColor: 'text-emerald-600',
    },
    {
      label: '热点',
      value: hotspots.length,
      icon: <FlameIcon width={20} height={20} />,
      iconBg: 'bg-orange-50',
      iconColor: 'text-orange-500',
    },
  ];

  return (
    <div className="space-y-5">
      {/* 页头 */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display font-extrabold text-xl text-slate-800 flex items-center gap-2">
            <ActivityIcon width={20} height={20} className="text-mint-600" />
            实时动态流
          </h2>
          <p className="text-xs text-slate-400 mt-1">多源聚合 + AI 验证，最新真实动态与热点一览</p>
        </div>
        <button
          onClick={() => {
            setRefreshing(true);
            load(true);
          }}
          className="flex items-center gap-1.5 text-xs font-semibold text-mint-600 hover:text-mint-700 rounded-lg px-2.5 py-1.5 hover:bg-mint-50 transition-colors cursor-pointer"
        >
          {refreshing ? (
            <LoaderIcon width={14} height={14} />
          ) : (
            <RefreshIcon width={14} height={14} />
          )}
          刷新
        </button>
      </div>

      {/* KPI */}
      <StatCards stats={stats} />

      {/* 过滤 */}
      <div className="flex items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-semibold border transition-colors cursor-pointer ${
              filter === f.key
                ? 'bg-mint-500 border-mint-500 text-white'
                : 'bg-white border-mint-100 text-slate-500 hover:border-mint-300 hover:text-mint-600'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* 时间线 */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-mint-500">
          <LoaderIcon width={22} height={22} />
          <span className="ml-2 text-sm">加载中…</span>
        </div>
      ) : feed.length === 0 ? (
        <EmptyState
          icon={<RadarIcon width={36} height={36} />}
          text="还没有动态"
          hint="去「关键词监控」添加关键词，或「热点发现」添加关注范围"
        />
      ) : (
        <div className="space-y-3">
          {feed.map((item) =>
            item.kind === 'alert' ? (
              <AlertCard key={`a-${item.data.id}`} alert={item.data} />
            ) : (
              <HotspotCard key={`h-${item.data.id}`} hotspot={item.data} />
            ),
          )}
        </div>
      )}
    </div>
  );
}
