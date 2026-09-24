import { useEffect, useRef, useState, useCallback } from "react";
import { io } from "socket.io-client";
import { motion } from "motion/react";
import { cn, formatInterval } from "./lib/utils.js";
import { api } from "./api.js";
import {
  LeafIcon,
  BellIcon,
  RadarIcon,
  FlameIcon,
  BookmarkIcon,
  MailIcon,
} from "./components/Icons.jsx";
import AuroraBackground from "./components/AuroraBackground.jsx";
import NotificationCenter from "./components/NotificationCenter.jsx";
import SourcePanel from "./components/SourcePanel.jsx";
import FeedView from "./views/FeedView.jsx";
import KeywordView from "./views/KeywordView.jsx";
import FavoritesView from "./views/FavoritesView.jsx";
import LoginView from "./views/LoginView.jsx";
import GateView from "./views/GateView.jsx";

const TABS = [
  { key: "feed", label: "热点流", icon: FlameIcon },
  { key: "keywords", label: "热点范围", icon: RadarIcon },
  { key: "favorites", label: "收藏夹", icon: BookmarkIcon },
];

// 邮件发送间隔预设档位（分钟）
const EMAIL_INTERVAL_OPTIONS = [
  { value: 30, label: "30 分钟" },
  { value: 60, label: "1 小时" },
  { value: 120, label: "2 小时" },
  { value: 240, label: "4 小时" },
  { value: 360, label: "6 小时" },
  { value: 720, label: "12 小时" },
  { value: 1440, label: "1 天" },
  { value: 4320, label: "3 天" },
  { value: 10080, label: "7 天" },
];

/** 生成下拉选项；若当前间隔不在预设里，则额外插入一个当前值项 */
function emailIntervalOptions(current) {
  const cur = Number(current);
  if (!cur || !Number.isFinite(cur)) return EMAIL_INTERVAL_OPTIONS;
  if (!EMAIL_INTERVAL_OPTIONS.some((o) => o.value === cur)) {
    return [
      { value: cur, label: formatInterval(cur) },
      ...EMAIL_INTERVAL_OPTIONS,
    ];
  }
  return EMAIL_INTERVAL_OPTIONS;
}

export default function App() {
  const [status, setStatus] = useState(null);
  const [user, setUser] = useState(null);
  const [showLogin, setShowLogin] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [pendingSettings, setPendingSettings] = useState(false); // ?settings=notify 待处理
  const [authResolved, setAuthResolved] = useState(false); // 首次 me() 是否已返回
  const [activeTab, setActiveTab] = useState("feed");
  const [unread, setUnread] = useState(0);
  const [tick, setTick] = useState(0);
  const [monitorProgress, setMonitorProgress] = useState(null);
  const [gate, setGate] = useState(null); // null=加载中，{required, authed}
  const [sources, setSources] = useState([]); // 数据源开关列表（运行时动态切换）
  const socketRef = useRef(null);

  const gateOk = !!gate && (!gate.required || gate.authed);

  const refreshUser = useCallback(async () => {
    try {
      const { user: u } = await api.me();
      setUser(u);
    } catch {
      setUser(null);
    } finally {
      setAuthResolved(true);
    }
  }, []);

  // 启动：查询访问口令门禁状态（需要口令且未通过时渲染 GateView）
  useEffect(() => {
    api
      .gateStatus()
      .then(setGate)
      .catch(() => setGate({ required: false, authed: true }));
  }, []);

  // 任意请求返回「需要访问口令」时，切回门禁页（兜底：口令被改 / 会话过期）
  useEffect(() => {
    const onNeedGate = () => setGate({ required: true, authed: false });
    window.addEventListener("ahm:need-gate", onNeedGate);
    return () => window.removeEventListener("ahm:need-gate", onNeedGate);
  }, []);

  // 启动：确认登录态（登录是可选的，失败也照常使用）
  useEffect(() => {
    if (!gateOk) return;
    const params = new URLSearchParams(window.location.search);
    const flag = params.get("login");
    if (flag === "expired" || flag === "error") {
      setLoginError(
        flag === "expired"
          ? "登录链接已失效或已被使用，请重新获取。"
          : "登录失败，请重新尝试。",
      );
      // 不再自动弹出登录框：等用户主动点击主页「登录」按钮时再展示
    } else if (params.get("settings") === "notify") {
      setPendingSettings(true);
    }
    if (flag || params.get("settings")) {
      window.history.replaceState({}, "", window.location.pathname);
    }
    refreshUser();
  }, [refreshUser, gateOk]);

  // 邮件里的「管理通知偏好」：已登录直接展开头像菜单，未登录才弹登录
  useEffect(() => {
    if (!pendingSettings || !authResolved) return;
    if (user) setMenuOpen(true);
    else setShowLogin(true);
    setPendingSettings(false);
  }, [pendingSettings, authResolved, user]);

  // 状态（AI / 邮件）与登录无关，通过门禁后加载
  useEffect(() => {
    if (!gateOk) return;
    api.getStatus().then(setStatus).catch(console.error);
    api
      .getSources()
      .then((r) => setSources(r.sources))
      .catch(console.error);
  }, [gateOk]);

  // 数据源开关切换后：更新本地列表，并同步刷新 status（热点流来源筛选随开关联动）
  const handleSourcesChange = useCallback(async (list) => {
    setSources(list);
    try {
      const st = await api.getStatus();
      setStatus(st);
    } catch (err) {
      console.error(err);
    }
  }, []);

  // 登录弹层打开期间轮询：用户在邮件里点完链接后自动进入登录态
  useEffect(() => {
    if (!showLogin || user || !gateOk) return;
    const timer = setInterval(async () => {
      try {
        const { user: u } = await api.me();
        if (u) {
          setUser(u);
          setShowLogin(false);
          setLoginError("");
          setTick((t) => t + 1);
        }
      } catch {
        /* 忽略：未登录或网络抖动 */
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [showLogin, user, gateOk]);

  // Socket.io 连接（通过门禁后连接），实时联动
  useEffect(() => {
    if (!gateOk) return;
    const socket = io("/", { path: "/socket.io", withCredentials: true });
    socketRef.current = socket;

    // 连接 / 重连成功后刷新一次，补偿断线期间错过的实时提醒
    socket.on("connect", () => setTick((t) => t + 1));
    // 关键词监控进度（立即检查时显示「AI 校验中 x/y」）
    socket.on("monitor_progress", (payload) => setMonitorProgress(payload));
    socket.on("notification", (payload) => {
      setTick((t) => t + 1);
      if (payload?.title) {
        setUnread((u) => u + 1);
        if ("Notification" in window && Notification.permission === "granted") {
          new Notification(payload.title, { body: payload.content || "" });
        }
      }
    });

    return () => socket.disconnect();
  }, [gateOk]);

  const enableBrowserNotify = useCallback(async () => {
    if ("Notification" in window) {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") alert("未授权浏览器通知，将仅通过页面内提醒。");
    } else {
      alert("当前浏览器不支持通知。");
    }
  }, []);

  // 门禁状态加载中：先渲染空（避免闪屏）
  if (!gate) return null;
  // 需要口令且未通过：全屏口令页（此时不渲染业务内容、不连 Socket）
  if (gate.required && !gate.authed) {
    return <GateView onOk={() => setGate((g) => ({ ...g, authed: true }))} />;
  }

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
                <p className="text-[10px] text-slate-400 font-medium">
                  热点雷达 · 吃瓜第一线
                </p>
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

            {/* 右侧状态 + 通知 + 用户 */}
            <div className="flex items-center gap-2 shrink-0">
              <SourcePanel sources={sources} onSourcesChange={handleSourcesChange} />
              <NotificationCenter
                unread={unread}
                onClear={() => setUnread(0)}
                refreshKey={tick}
                label="通知"
              />
              {user ? (
                <UserMenu
                  user={user}
                  open={menuOpen}
                  onOpenChange={setMenuOpen}
                  onUserChange={setUser}
                  onLogout={() => setUser(null)}
                />
              ) : (
                <button
                  onClick={() => setShowLogin(true)}
                  title="登录后可接收邮件通知"
                  className="rounded-xl border border-mint-200 bg-white text-mint-700 text-xs font-semibold px-3 py-2 hover:bg-mint-50 transition-colors cursor-pointer"
                >
                  登录
                </button>
              )}
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
        {activeTab === "feed" && <FeedView tick={tick} status={status} />}
        {activeTab === "favorites" && <FavoritesView tick={tick} />}
        {activeTab === "keywords" && (
          <KeywordView status={status} tick={tick} progress={monitorProgress} />
        )}
      </main>

      {/* 登录弹层（可选） */}
      {showLogin && !user && (
        <LoginView
          initialError={loginError}
          onClose={() => {
            setShowLogin(false);
            setLoginError("");
          }}
        />
      )}
    </div>
  );
}

/** 用户菜单：邮箱 + 邮件通知开关 + 退出登录（展开状态由父组件控制，便于 ?settings=notify 直达） */
function UserMenu({ user, open, onOpenChange, onUserChange, onLogout }) {
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onOpenChange(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onOpenChange]);

  const toggleNotify = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const updated = await api.updatePrefs({ notifyEmail: !user.notifyEmail });
      onUserChange(updated);
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  };

  const changeInterval = async (e) => {
    const min = Number(e.target.value);
    if (busy || !Number.isFinite(min)) return;
    setBusy(true);
    try {
      const updated = await api.updatePrefs({ emailIntervalMin: min });
      onUserChange(updated);
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    try {
      await api.logout();
    } finally {
      onOpenChange(false);
      onLogout();
    }
  };

  const initial = (user.email || "?").slice(0, 1).toUpperCase();

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => onOpenChange(!open)}
        title={user.email}
        className="w-9 h-9 rounded-xl bg-gradient-to-br from-mint-400 to-emerald-500 text-white text-sm font-bold flex items-center justify-center shadow-soft cursor-pointer"
      >
        {initial}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-72 max-w-[calc(100vw-2rem)] panel rounded-2xl overflow-hidden shadow-lift z-50 animate-pop-in">
          <div className="px-4 py-3 border-b border-mint-100">
            <p className="text-[10px] text-slate-400 font-semibold">已登录</p>
            <p className="text-xs font-semibold text-slate-700 break-all mt-0.5">
              {user.email}
            </p>
          </div>

          <div className="px-4 py-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                <MailIcon width={13} height={13} className="text-mint-600" />
                邮件通知
              </p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {user.notifyEmail
                  ? "热点命中会发送到你的邮箱"
                  : "已关闭，不会收到邮件"}
              </p>
            </div>
            <button
              onClick={toggleNotify}
              disabled={busy}
              aria-label="切换邮件通知"
              className={cn(
                "relative shrink-0 w-11 h-6 rounded-full transition-colors cursor-pointer disabled:opacity-50",
                user.notifyEmail ? "bg-mint-500" : "bg-slate-300",
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all",
                  user.notifyEmail ? "left-[22px]" : "left-0.5",
                )}
              />
            </button>
          </div>

          {user.notifyEmail && (
            <div className="px-4 py-3 flex items-center justify-between gap-3 border-t border-mint-50">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-700">发送间隔</p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  间隔内的新热点打包成一封发送
                </p>
              </div>
              <select
                value={String(user.emailIntervalMin ?? 60)}
                onChange={changeInterval}
                disabled={busy}
                className="shrink-0 max-w-[42%] rounded-lg border border-mint-100 bg-white text-xs font-semibold text-slate-700 px-2 py-1.5 focus:border-mint-400 focus:outline-none cursor-pointer disabled:opacity-50"
              >
                {emailIntervalOptions(user.emailIntervalMin).map((o) => (
                  <option key={o.value} value={String(o.value)}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          <button
            onClick={logout}
            className="w-full text-left px-4 py-3 text-xs font-semibold text-rose-500 hover:bg-rose-50 transition-colors border-t border-mint-50 cursor-pointer"
          >
            退出登录
          </button>
        </div>
      )}
    </div>
  );
}

function TabBtn({ active, onClick, icon, label, layoutId }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-semibold whitespace-nowrap transition-colors cursor-pointer",
        active
          ? "text-white"
          : "text-slate-500 hover:text-mint-600 hover:bg-mint-50",
      )}
    >
      {active && (
        <motion.div
          layoutId={layoutId}
          transition={{ type: "spring", bounce: 0.25, duration: 0.5 }}
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

function StatusBadge({ ok, label, className = "" }) {
  return (
    <div
      className={`flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-semibold border transition-colors ${className} ${
        ok
          ? "bg-mint-50 border-mint-200 text-mint-700"
          : "bg-slate-50 border-slate-200 text-slate-400"
      }`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${ok ? "bg-mint-500" : "bg-slate-300"}`}
      />
      {label}
    </div>
  );
}
