import { useEffect, useState, useCallback, useRef } from 'react';
import { api } from '../api.js';
import AlertCard from '../components/AlertCard.jsx';
import EmptyState from '../components/EmptyState.jsx';
import {
  BookmarkIcon,
  PlusIcon,
  TrashIcon,
  EditIcon,
  LoaderIcon,
  CheckIcon,
  XIcon,
} from '../components/Icons.jsx';

export default function FavoritesView({ tick }) {
  const [favorites, setFavorites] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const inputRef = useRef(null);

  const loadFavorites = useCallback(async () => {
    const list = await api.getFavorites();
    setFavorites(list);
    setActiveId((cur) => cur || (list.length ? list[0].id : null));
  }, []);

  const loadAlerts = useCallback(async () => {
    if (!activeId) {
      setAlerts([]);
      return;
    }
    const res = await api.getAlerts({ favoriteId: activeId, sort: 'favoritedAt', order: 'desc', pageSize: 100 });
    setAlerts(res.list);
  }, [activeId]);

  useEffect(() => {
    loadFavorites().catch(console.error);
  }, [loadFavorites, tick]);

  useEffect(() => {
    setLoading(true);
    loadAlerts().catch(console.error).finally(() => setLoading(false));
  }, [loadAlerts, tick]);

  const activeFav = favorites.find((f) => f.id === activeId);
  const totalFavs = favorites.reduce((sum, f) => sum + (f._count?.alerts || 0), 0);

  const addFav = async () => {
    const name = newName.trim();
    if (!name) {
      // 未输入名称时，聚焦输入框并给出提示，避免「点了没反应」
      inputRef.current?.focus();
      return;
    }
    try {
      await api.addFavorite(name);
      setNewName('');
      await loadFavorites();
      inputRef.current?.focus();
    } catch (err) {
      console.error(err);
      alert('新建收藏夹失败：' + (err.message || '未知错误'));
    }
  };

  const renameFav = async (id) => {
    if (!editName.trim()) return;
    try {
      await api.renameFavorite(id, editName.trim());
      setEditingId(null);
      await loadFavorites();
    } catch (err) {
      console.error(err);
      alert('改名失败：' + (err.message || '未知错误'));
    }
  };

  const deleteFav = async (id) => {
    if (!window.confirm('删除该收藏夹？其下内容会自动取消收藏（不会被删除）。')) return;
    try {
      await api.deleteFavorite(id);
      if (id === activeId) setActiveId(null);
      await loadFavorites();
    } catch (err) {
      console.error(err);
      alert('删除失败：' + (err.message || '未知错误'));
    }
  };

  return (
    <div className="space-y-5">
      {/* 页头：标题 + 统计 */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-display font-extrabold text-xl text-slate-800 flex items-center gap-2">
            <BookmarkIcon width={20} height={20} className="text-mint-600" />
            收藏夹
          </h2>
          <p className="text-xs text-slate-400 mt-1">收藏即保命——超过保留期的内容，只要收藏了就永久保留</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white border border-mint-100 px-3 py-1.5 text-xs text-slate-500">
            <BookmarkIcon width={13} height={13} className="text-mint-500" />
            <span className="font-semibold text-slate-700">{favorites.length}</span> 个收藏夹
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white border border-mint-100 px-3 py-1.5 text-xs text-slate-500">
            <span className="font-semibold text-slate-700">{totalFavs}</span> 条收藏
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-4 items-start">
        {/* 左侧：收藏夹管理 */}
        <div className="panel rounded-2xl p-3 flex flex-col gap-3 md:sticky md:top-20 md:max-h-[calc(100vh-6rem)]">
          {/* 新建收藏夹 */}
          <div className="flex items-center gap-2 shrink-0">
            <input
              ref={inputRef}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addFav()}
              placeholder="输入名称后点 + 新建"
              aria-label="新建收藏夹名称"
              className="flex-1 min-w-0 h-9 rounded-xl border border-mint-100 bg-white px-3 text-xs text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-mint-400/60 focus:border-mint-300 transition"
            />
            <button
              onClick={addFav}
              title="新建收藏夹"
              className="flex items-center justify-center w-9 h-9 shrink-0 rounded-xl bg-gradient-to-r from-mint-500 to-emerald-500 text-white shadow-soft hover:opacity-90 transition cursor-pointer"
            >
              <PlusIcon width={15} height={15} />
            </button>
          </div>

          {/* 收藏夹列表：移动端横向滚动，桌面垂直 */}
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 md:flex-col md:overflow-y-auto md:overflow-x-hidden md:gap-1.5 md:p-0 md:pb-0 md:flex-1 md:min-h-0">
            {favorites.map((f) =>
              editingId === f.id ? (
                <div
                  key={f.id}
                  className="flex shrink-0 md:shrink items-center gap-1 rounded-xl px-2 py-1.5 border border-mint-200 bg-white shadow-soft"
                >
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && renameFav(f.id)}
                    autoFocus
                    aria-label="收藏夹名称"
                    className="min-w-0 w-28 h-7 rounded-lg bg-white px-2 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-mint-400/60"
                  />
                  <button
                    onClick={() => renameFav(f.id)}
                    title="确认"
                    className="p-1 text-mint-600 hover:text-mint-700 cursor-pointer"
                  >
                    <CheckIcon width={14} height={14} />
                  </button>
                  <button
                    onClick={() => setEditingId(null)}
                    title="取消"
                    className="p-1 text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    <XIcon width={14} height={14} />
                  </button>
                </div>
              ) : (
                <div
                  key={f.id}
                  onClick={() => setActiveId(f.id)}
                  className={`group flex shrink-0 md:shrink items-center gap-2 rounded-xl px-3 py-2.5 cursor-pointer transition-colors duration-200 ${
                    f.id === activeId
                      ? 'bg-gradient-to-r from-mint-50 to-emerald-50 border border-mint-200'
                      : 'bg-white border border-transparent hover:bg-mint-50/50 hover:border-mint-100'
                  }`}
                >
                  <span
                    className={`shrink-0 w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${
                      f.id === activeId ? 'bg-mint-100 text-mint-600' : 'bg-slate-50 text-slate-400 group-hover:text-mint-500'
                    }`}
                  >
                    <BookmarkIcon width={14} height={14} />
                  </span>

                  <span className="min-w-0 flex-1 flex items-center gap-1.5">
                    <span className="truncate text-xs font-semibold text-slate-700">{f.name}</span>
                    {f.isDefault && (
                      <span className="shrink-0 text-[9px] font-semibold text-mint-600 bg-mint-50 border border-mint-100 rounded-full px-1.5 py-px">
                        默认
                      </span>
                    )}
                  </span>

                  <span className="shrink-0 min-w-[20px] h-5 px-1.5 rounded-full bg-mint-50 text-mint-700 text-[10px] font-mono font-semibold flex items-center justify-center">
                    {f._count?.alerts ?? 0}
                  </span>

                  {!f.isDefault && (
                    <span className="shrink-0 flex items-center gap-0.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingId(f.id);
                          setEditName(f.name);
                        }}
                        title="改名"
                        className="p-1 text-slate-400 hover:text-mint-600 cursor-pointer"
                      >
                        <EditIcon width={14} height={14} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteFav(f.id);
                        }}
                        title="删除"
                        className="p-1 text-slate-400 hover:text-rose-500 cursor-pointer"
                      >
                        <TrashIcon width={14} height={14} />
                      </button>
                    </span>
                  )}
                </div>
              ),
            )}
          </div>
        </div>

        {/* 右侧：收藏内容 */}
        <div className="min-w-0">
          {activeFav && (
            <div className="mb-3 flex items-center gap-2 px-1">
              <h3 className="font-display font-bold text-sm text-slate-700">{activeFav.name}</h3>
              <span className="text-xs text-slate-400">{alerts.length} 条</span>
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-16 text-mint-500">
              <LoaderIcon width={22} height={22} />
              <span className="ml-2 text-sm">加载中…</span>
            </div>
          ) : alerts.length === 0 ? (
            <EmptyState
              icon={<BookmarkIcon width={36} height={36} />}
              text="这个收藏夹还没有内容"
              hint="去「热点流」给感兴趣的内容点收藏"
            />
          ) : (
            <div className="space-y-3">
              {alerts.map((a) => (
                <AlertCard key={a.id} alert={a} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
