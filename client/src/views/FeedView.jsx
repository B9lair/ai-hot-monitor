import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { api } from '../api.js';
import StatCards from '../components/StatCards.jsx';
import AlertCard from '../components/AlertCard.jsx';
import EmptyState from '../components/EmptyState.jsx';
import {
  RadarIcon,
  FlameIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  TrendingUpIcon,
  RefreshIcon,
  LoaderIcon,
  SearchIcon,
  XIcon,
  ChevronRightIcon,
  SortIcon,
  ClockIcon,
  TagIcon,
  ChevronLeftIcon,
} from '../components/Icons.jsx';

// 后端写入 alert.source 的实际取值（把 SOURCE_* 开关映射为可筛选的来源）
const SOURCE_VALUES = {
  twitter: 'Twitter',
  hackernews: 'HackerNews',
  bilibili: 'B站',
  weibo: '微博',
  weiboSearch: '微博', // 微博搜索与热搜共用同一来源标识
  bing: 'Bing',
  sogou: '搜狗',
  baidu: '百度',
  google: 'Google',
  duckduckgo: 'DuckDuckGo',
  github: 'GitHub',
  zhihu: '知乎',
  reddit: 'Reddit',
  v2ex: 'V2EX',
};

// 排序选项（value 由 sort + order 组合，后端据此排序）
const SORT_OPTIONS = [
  { value: 'createdAt_desc', label: '最新入库', sort: 'createdAt', order: 'desc' },
  { value: 'createdAt_asc', label: '最早入库', sort: 'createdAt', order: 'asc' },
  { value: 'publishedAt_desc', label: '最新发布', sort: 'publishedAt', order: 'desc' },
  { value: 'confidence_desc', label: '置信度 高→低', sort: 'confidence', order: 'desc' },
  { value: 'confidence_asc', label: '置信度 低→高', sort: 'confidence', order: 'asc' },
  { value: 'hotScore_desc', label: '热度 高→低', sort: 'hotScore', order: 'desc' },
  { value: 'relevance_desc', label: '相关度 高→低', sort: 'relevance', order: 'desc' },
  { value: 'trending_desc', label: '智能热榜', sort: 'trending', order: 'desc' },
];

const TIME_RANGES = [
  { value: 'all', label: '全部时间' },
  { value: 'today', label: '今天' },
  { value: '24h', label: '近 24 小时' },
  { value: '7d', label: '近 7 天' },
];

const CONFIDENCE_RANGES = [
  { value: 'all', label: '全部置信度' },
  { value: 'high', label: '高置信 ≥80%' },
  { value: 'mid', label: '中置信 60~80%' },
  { value: 'low', label: '低置信 <60%' },
];

const HOT_RANGES = [
  { value: 'all', label: '全部热度' },
  { value: 'high', label: '高热度 ≥50' },
  { value: 'mid', label: '中热度 20~50' },
  { value: 'low', label: '低热度 <20' },
];

const PAGE_SIZE = 20;

// 组装后端查询参数（筛选 + 排序）
function buildParams({ source, verdict, keywordId, timeRange, q, confidenceRange, hotRange, sort, order }) {
  const params = {};
  if (source !== 'all') params.source = source;
  if (verdict === 'real') params.isFake = 'false';
  if (verdict === 'fake') params.isFake = 'true';
  if (keywordId !== 'all') params.keywordId = keywordId;
  if (q && q.trim()) params.q = q.trim();

  if (timeRange === 'today') {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    params.from = start.toISOString();
  } else if (timeRange === '24h') {
    params.from = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  } else if (timeRange === '7d') {
    params.from = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  }

  if (confidenceRange === 'high') params.minConfidence = 0.8;
  else if (confidenceRange === 'mid') {
    params.minConfidence = 0.6;
    params.maxConfidence = 0.8;
  } else if (confidenceRange === 'low') params.maxConfidence = 0.6;

  if (hotRange === 'high') params.minHot = 50;
  else if (hotRange === 'mid') {
    params.minHot = 20;
    params.maxHot = 50;
  } else if (hotRange === 'low') params.maxHot = 20;

  params.sort = sort;
  params.order = order;
  return params;
}

export default function FeedView({ tick, status }) {
  const [feed, setFeed] = useState([]); // 当前页列表
  const [total, setTotal] = useState(0); // 筛选后总数
  const [totalPages, setTotalPages] = useState(1);
  const [statsData, setStatsData] = useState({ realAlerts: 0, fakeAlerts: 0, todayAlerts: 0, enabledKeywords: 0 });
  const [keywords, setKeywords] = useState([]);
  const [verdict, setVerdict] = useState('all'); // all | real | fake
  const [source, setSource] = useState('all');
  const [keywordId, setKeywordId] = useState('all');
  const [timeRange, setTimeRange] = useState('all');
  const [qInput, setQInput] = useState(''); // 搜索框即时值
  const [q, setQ] = useState(''); // 防抖后的查询词
  const [confidenceRange, setConfidenceRange] = useState('all');
  const [hotRange, setHotRange] = useState('all');
  const [sortKey, setSortKey] = useState('createdAt_desc');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const initialized = useRef(false);
  // 详情展开状态：记录展开的 alert id（配合"一键展开/折叠全部详情"）
  const [detailExpanded, setDetailExpanded] = useState(new Set());

  const sortOpt = SORT_OPTIONS.find((o) => o.value === sortKey) || SORT_OPTIONS[0];

  // 搜索框 300ms 防抖
  useEffect(() => {
    const t = setTimeout(() => setQ(qInput), 300);
    return () => clearTimeout(t);
  }, [qInput]);

  const params = useMemo(
    () =>
      buildParams({
        source,
        verdict,
        keywordId,
        timeRange,
        q,
        confidenceRange,
        hotRange,
        sort: sortOpt.sort,
        order: sortOpt.order,
      }),
    [source, verdict, keywordId, timeRange, q, confidenceRange, hotRange, sortOpt],
  );

  const load = useCallback(async () => {
    if (!initialized.current) setLoading(true);
    try {
      const [f, s, k] = await Promise.all([
        api.getAlerts({ ...params, page, pageSize: PAGE_SIZE }),
        api.getStats(),
        api.getKeywords(),
      ]);
      setFeed(f.list);
      setTotal(f.total);
      setTotalPages(Math.max(1, f.totalPages));
      setStatsData(s);
      setKeywords(k);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
      setRefreshing(false);
      initialized.current = true;
    }
  }, [params, page]);

  useEffect(() => {
    load();
  }, [load, tick]);

  // 来源筛选选项：仅列出后端已启用的数据源（与 .env 的 SOURCE_* 开关一致）
  const sources = useMemo(() => {
    const enabled = status?.sources || {};
    const list = [];
    for (const [key, on] of Object.entries(enabled)) {
      const value = SOURCE_VALUES[key];
      if (on && value && !list.includes(value)) list.push(value);
    }
    return list;
  }, [status]);

  const isFiltering =
    source !== 'all' ||
    verdict !== 'all' ||
    keywordId !== 'all' ||
    timeRange !== 'all' ||
    confidenceRange !== 'all' ||
    hotRange !== 'all' ||
    Boolean(qInput.trim()) ||
    sortKey !== 'createdAt_desc';

  const onFilterChange = (setter) => (e) => {
    setter(e.target.value);
    setPage(1);
  };

  const reset = () => {
    setSource('all');
    setVerdict('all');
    setKeywordId('all');
    setTimeRange('all');
    setQInput('');
    setConfidenceRange('all');
    setHotRange('all');
    setSortKey('createdAt_desc');
    setPage(1);
  };

  const toggleDetail = useCallback((id) => {
    setDetailExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const allDetailsOpen = feed.length > 0 && feed.every((a) => detailExpanded.has(a.id));

  const toggleAllDetails = () => {
    setDetailExpanded(allDetailsOpen ? new Set() : new Set(feed.map((a) => a.id)));
  };

  const hasAny = statsData.realAlerts + statsData.fakeAlerts > 0;

  // 页码列表（超过 7 页时用省略号）
  const pageItems = useMemo(() => {
    const t = totalPages;
    const c = page;
    if (t <= 7) return Array.from({ length: t }, (_, i) => i + 1);
    if (c <= 4) return [1, 2, 3, 4, 5, '...', t];
    if (c >= t - 3) return [1, '...', t - 4, t - 3, t - 2, t - 1, t];
    return [1, '...', c - 1, c, c + 1, '...', t];
  }, [page, totalPages]);

  const stats = [
    {
      label: '关注范围',
      value: statsData.enabledKeywords,
      icon: <RadarIcon width={20} height={20} />,
      iconBg: 'bg-mint-50',
      iconColor: 'text-mint-600',
    },
    {
      label: '真实热点',
      value: statsData.realAlerts,
      icon: <FlameIcon width={20} height={20} />,
      iconBg: 'bg-orange-50',
      iconColor: 'text-orange-500',
    },
    {
      label: '疑似假冒',
      value: statsData.fakeAlerts,
      icon: <ShieldAlertIcon width={20} height={20} />,
      iconBg: 'bg-rose-50',
      iconColor: 'text-rose-500',
    },
    {
      label: '今日新增',
      value: statsData.todayAlerts,
      icon: <TrendingUpIcon width={20} height={20} />,
      iconBg: 'bg-sky-50',
      iconColor: 'text-sky-500',
    },
  ];

  return (
    <div className="space-y-5">
      {/* 页头 */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display font-extrabold text-xl text-slate-800 flex items-center gap-2">
            <FlameIcon width={20} height={20} className="text-orange-500" />
            热点流
          </h2>
          <p className="text-xs text-slate-400 mt-1">关键词监控 + AI 验证，实时获取最新热点</p>
        </div>
        <div className="flex items-center gap-1.5">
          {feed.length > 0 && (
            <button
              onClick={toggleAllDetails}
              className="flex items-center gap-1 text-xs font-semibold text-mint-600 hover:text-mint-700 rounded-lg px-2.5 py-1.5 hover:bg-mint-50 transition-colors cursor-pointer"
            >
              <ChevronRightIcon
                width={13}
                height={13}
                className={`transition-transform ${allDetailsOpen ? 'rotate-90' : ''}`}
              />
              {allDetailsOpen ? '折叠全部详情' : '展开全部详情'}
            </button>
          )}
          <button
            onClick={() => {
              setRefreshing(true);
              load();
            }}
            className="flex items-center gap-1.5 text-xs font-semibold text-mint-600 hover:text-mint-700 rounded-lg px-2.5 py-1.5 hover:bg-mint-50 transition-colors cursor-pointer"
          >
            {refreshing ? <LoaderIcon width={14} height={14} /> : <RefreshIcon width={14} height={14} />}
            刷新
          </button>
        </div>
      </div>

      {/* KPI */}
      <StatCards stats={stats} />

      {/* 筛选条件 */}
      <div className="panel rounded-2xl px-3.5 py-3 space-y-2.5">
        {/* 第一行：排序 + 文本搜索 */}
        <div className="flex flex-wrap items-center gap-2.5">
          <FilterSelect
            icon={<SortIcon width={15} height={15} />}
            active={sortKey !== 'createdAt_desc'}
            value={sortKey}
            onChange={onFilterChange(setSortKey)}
            ariaLabel="排序方式"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </FilterSelect>

          <div className="relative flex-1 min-w-[200px]">
            <SearchIcon
              width={15}
              height={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              value={qInput}
              onChange={onFilterChange(setQInput)}
              placeholder="搜索标题 / 摘要 / 总结…"
              aria-label="文本搜索"
              className="w-full h-9 rounded-xl border border-mint-100 bg-white pl-9 pr-9 text-xs text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-mint-400/60 focus:border-mint-300 transition"
            />
            {qInput && (
              <button
                onClick={() => {
                  setQInput('');
                  setPage(1);
                }}
                aria-label="清除搜索"
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-slate-400 hover:text-rose-500 hover:bg-rose-50 transition-colors cursor-pointer"
              >
                <XIcon width={13} height={13} />
              </button>
            )}
          </div>
        </div>

        {/* 第二行：来源 / 真伪 / 关键词 / 时间 / 置信度 / 热度 */}
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500">
            <SearchIcon width={14} height={14} className="text-mint-500" />
            筛选
          </span>

          <FilterSelect
            icon={<RadarIcon width={15} height={15} />}
            active={source !== 'all'}
            value={source}
            onChange={onFilterChange(setSource)}
            ariaLabel="按数据来源筛选"
          >
            <option value="all">全部来源</option>
            {sources.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </FilterSelect>

          <FilterSelect
            icon={<ShieldCheckIcon width={15} height={15} />}
            active={verdict !== 'all'}
            value={verdict}
            onChange={onFilterChange(setVerdict)}
            ariaLabel="按真伪筛选"
          >
            <option value="all">全部真伪</option>
            <option value="real">真实热点</option>
            <option value="fake">疑似假冒</option>
          </FilterSelect>

          <FilterSelect
            icon={<TagIcon width={15} height={15} />}
            active={keywordId !== 'all'}
            value={keywordId}
            onChange={onFilterChange(setKeywordId)}
            ariaLabel="按关注范围筛选"
          >
            <option value="all">全部范围</option>
            {keywords.map((k) => (
              <option key={k.id} value={k.id}>
                {k.text}
              </option>
            ))}
          </FilterSelect>

          <FilterSelect
            icon={<ClockIcon width={15} height={15} />}
            active={timeRange !== 'all'}
            value={timeRange}
            onChange={onFilterChange(setTimeRange)}
            ariaLabel="按时间范围筛选"
          >
            {TIME_RANGES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </FilterSelect>

          <FilterSelect
            icon={<ShieldCheckIcon width={15} height={15} />}
            active={confidenceRange !== 'all'}
            value={confidenceRange}
            onChange={onFilterChange(setConfidenceRange)}
            ariaLabel="按置信度筛选"
          >
            {CONFIDENCE_RANGES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </FilterSelect>

          <FilterSelect
            icon={<FlameIcon width={15} height={15} />}
            active={hotRange !== 'all'}
            value={hotRange}
            onChange={onFilterChange(setHotRange)}
            ariaLabel="按热度筛选"
          >
            {HOT_RANGES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </FilterSelect>

          {isFiltering && (
            <button
              onClick={reset}
              className="inline-flex items-center gap-1 rounded-xl px-2.5 h-9 text-xs font-semibold text-slate-400 hover:text-rose-500 hover:bg-rose-50 transition-colors duration-200 cursor-pointer"
            >
              <XIcon width={13} height={13} />
              重置
            </button>
          )}

          <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-mint-50 text-mint-700 text-xs font-semibold px-2.5 py-1 border border-mint-100">
            <span className="w-1.5 h-1.5 rounded-full bg-mint-500" />
            共 {total} 条
          </span>
        </div>
      </div>

      {/* 热点榜 */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-mint-500">
          <LoaderIcon width={22} height={22} />
          <span className="ml-2 text-sm">加载中…</span>
        </div>
      ) : feed.length === 0 ? (
        <EmptyState
          icon={<FlameIcon width={36} height={36} />}
          text={hasAny ? '没有符合条件的热点' : '还没有热点'}
          hint={
            hasAny
              ? '试试调整上方的筛选条件'
              : '去「热点范围」添加关注范围，开始捕捉最新热点'
          }
        />
      ) : (
        <div className="space-y-3">
          {feed.map((a) => (
            <AlertCard
              key={a.id}
              alert={a}
              detailExpanded={detailExpanded.has(a.id)}
              onToggleDetail={toggleDetail}
            />
          ))}

          {/* 分页 */}
          {totalPages > 1 && (
            <div className="flex flex-wrap items-center justify-center gap-1.5 pt-3">
              <PageNavBtn
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                ariaLabel="上一页"
              >
                <ChevronLeftIcon width={15} height={15} />
              </PageNavBtn>

              {pageItems.map((it, i) =>
                it === '...' ? (
                  <span
                    key={`gap-${i}`}
                    className="min-w-[34px] h-9 flex items-center justify-center text-xs text-slate-300 select-none"
                  >
                    …
                  </span>
                ) : (
                  <PageNumBtn key={it} active={it === page} onClick={() => setPage(it)}>
                    {it}
                  </PageNumBtn>
                ),
              )}

              <PageNavBtn
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                ariaLabel="下一页"
              >
                <ChevronRightIcon width={15} height={15} />
              </PageNavBtn>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// 页码按钮（当前页渐变高亮）
function PageNumBtn({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`min-w-[34px] h-9 px-2 rounded-xl text-xs font-bold transition-all duration-200 cursor-pointer ${
        active
          ? 'bg-gradient-to-r from-mint-500 to-emerald-500 text-white shadow-soft'
          : 'bg-white border border-mint-100 text-slate-600 hover:border-mint-300 hover:text-mint-700 hover:bg-mint-50'
      }`}
    >
      {children}
    </button>
  );
}

// 上一页 / 下一页按钮
function PageNavBtn({ onClick, disabled, ariaLabel, children }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className="flex items-center justify-center w-9 h-9 rounded-xl border border-mint-100 bg-white text-slate-500 hover:border-mint-300 hover:text-mint-700 hover:bg-mint-50 disabled:opacity-35 disabled:cursor-not-allowed disabled:hover:bg-white disabled:hover:text-slate-500 disabled:hover:border-mint-100 transition-colors cursor-pointer"
    >
      {children}
    </button>
  );
}

// 筛选下拉：左侧图标 + 自定义箭头，选中态用薄荷绿高亮
function FilterSelect({ icon, active, value, onChange, ariaLabel, children }) {
  return (
    <div className="relative">
      <span
        aria-hidden
        className={`pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 transition-colors duration-200 ${
          active ? 'text-mint-600' : 'text-slate-400'
        }`}
      >
        {icon}
      </span>
      <select
        value={value}
        onChange={onChange}
        aria-label={ariaLabel}
        className={`appearance-none h-9 rounded-xl border pl-9 pr-8 text-xs font-semibold transition-colors duration-200 cursor-pointer focus:outline-none focus:ring-2 focus:ring-mint-400/60 ${
          active
            ? 'bg-mint-50 border-mint-300 text-mint-700'
            : 'bg-white border-mint-100 text-slate-600 hover:border-mint-300 hover:text-mint-700'
        }`}
      >
        {children}
      </select>
      <ChevronRightIcon
        width={14}
        height={14}
        aria-hidden
        className={`pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rotate-90 transition-colors duration-200 ${
          active ? 'text-mint-600' : 'text-slate-400'
        }`}
      />
    </div>
  );
}
