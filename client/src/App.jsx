import { useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';
import { motion } from 'motion/react';
import { cn } from './lib/utils.js';
import { api } from './api.js';
import {
  LeafIcon,
  BellIcon,
  RadarIcon,
  FlameIcon,
} from './components/Icons.jsx';
import AuroraBackground from './components/AuroraBackground.jsx';
import NotificationCenter from './components/NotificationCenter.jsx';
import FeedView from './views/FeedView.jsx';
import KeywordView from './views/KeywordView.jsx';

const TABS = [
  { key: 'feed', label: '热点流', icon: FlameIcon },
  { key: 'keywords', label: '热点范围', icon: RadarIcon },
];

export default function App() {
  const [status, setStatus] = useState(null);
  const [activeTab, setActiveTab] = useState('feed');
  const [unread, setUnread] = useState(0);
  const [tick, setTick] = useState(0);
  const [monitorProgress, setMonitorProgress] = useState(null);
  const socketRef = useRef(null);

  // 加载状态
  useEffect(() => {
    api.getStatus().then(setStatus).catch(console.error);
  }, []);

  // Socket.io 连接，实时联动
  useEffect(() => {
    const socket = io('/', { path: '/socket.io' });
    socketRef.current = socket;

    socket.on('connect', () => console.log('[socket] 已连接'));
    // 关键词监控进度（立即检查时显示「AI 校验中 x/y」）
    socket.on('monitor_progress', (payload) => setMonitorProgress(payload));
    socket.on('notification', (payload) => {
      // 任何后端事件都触发数据刷新
      setTick((t) => t + 1);

      // 真实通知（含标题）才提示 + 未读计数
      if (payload?.title) {
        setUnread((u) => u + 1);
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification(payload.title, { body: payload.content || '' });
        }
      }
    });

    return () => socket.disconnect();
  }, []);

  const enableBrowserNotify = useCallback(async () => {
    if ('Notification' in window) {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') alert('未授权浏览器通知，将仅通过页面内提醒。');
    } else {
      alert('当前浏览器不支持通知。');
    }
  }, []);

  return (
    <div className="relative min-h-screen bg-[#f4f9f6] text-slate-700">
      {/* 顶部极光氛围背景（纯装饰，不遮挡内容） */}
      <AuroraBackground />

      {/* 顶部导航 */}
      <header className="sticky top-0 z-30 bg-white/80 backdrop-blur-xl border-b border-mint-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="h-14 flex items-center justify-between gap-4">
            {/* Logo */}
            <div className="flex items-center gap-2.5 shrink-0">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-mint-400 to-emerald-500 flex items-center justify-center text-white shadow-soft">
                <LeafIcon width={18} height={18} />
              </div>
              <div className="leading-tight">
                <h1 className="font-display font-extrabold text-base text-slate-800">
                  AI Hot Monitor
                </h1>
                <p className="text-[10px] text-slate-400 font-medium">热点雷达 · 吃瓜第一线</p>
              </div>
            </div>

            {/* 桌面 Tab */}
            <nav className="hidden md:flex items-center gap-1">
              {TABS.map((t) => (
                <TabBtn
                  key={t.key}
                  active={activeTab === t.key}
                  onClick={() => setActiveTab(t.key)}
                  icon={<t.icon width={16} height={16} />}
                  label={t.label}
                  layoutId="nav-desktop"
                />
              ))}
            </nav>

            {/* 右侧状态 + 通知 */}
            <div className="flex items-center gap-2 shrink-0">
              <StatusBadge ok={status?.hasAI} label="AI" />
              <StatusBadge ok={status?.hasSMTP} label="邮件" className="hidden sm:flex" />
              <button
                onClick={enableBrowserNotify}
                title="开启浏览器通知"
                className="hidden sm:flex items-center gap-1.5 rounded-xl border border-mint-100 bg-white text-mint-700 text-xs font-semibold px-3 py-2 hover:border-mint-300 hover:bg-mint-50 transition-colors cursor-pointer"
              >
                <BellIcon width={14} height={14} />
                开启通知
              </button>
              <NotificationCenter unread={unread} onClear={() => setUnread(0)} />
            </div>
          </div>

          {/* 移动端 Tab */}
          <nav className="md:hidden flex items-center gap-1 overflow-x-auto -mx-4 px-4 pb-2.5">
            {TABS.map((t) => (
              <TabBtn
                key={t.key}
                active={activeTab === t.key}
                onClick={() => setActiveTab(t.key)}
                icon={<t.icon width={15} height={15} />}
                label={t.label}
                layoutId="nav-mobile"
              />
            ))}
          </nav>
        </div>
      </header>

      {/* 主内容 */}
      <main className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 py-6 pb-20">
        {activeTab === 'feed' && <FeedView tick={tick} status={status} />}
        {activeTab === 'keywords' && <KeywordView status={status} tick={tick} progress={monitorProgress} />}
      </main>
    </div>
  );
}

function TabBtn({ active, onClick, icon, label, layoutId }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'relative flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-semibold whitespace-nowrap transition-colors cursor-pointer',
        active ? 'text-white' : 'text-slate-500 hover:text-mint-600 hover:bg-mint-50',
      )}
    >
      {active && (
        <motion.div
          layoutId={layoutId}
          transition={{ type: 'spring', bounce: 0.25, duration: 0.5 }}
          className="absolute inset-0 rounded-full bg-gradient-to-r from-mint-500 to-emerald-500 shadow-soft"
        />
      )}
      <span className="relative z-10 flex items-center gap-1.5">
        {icon}
        {label}
      </span>
    </button>
  );
}

function StatusBadge({ ok, label, className = '' }) {
  return (
    <div
      className={`flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-semibold border transition-colors ${className} ${
        ok ? 'bg-mint-50 border-mint-200 text-mint-700' : 'bg-slate-50 border-slate-200 text-slate-400'
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-mint-500' : 'bg-slate-300'}`} />
      {label}
    </div>
  );
}


