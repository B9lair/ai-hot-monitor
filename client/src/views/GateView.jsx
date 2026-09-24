import { useState } from 'react';
import { api } from '../api.js';
import { LeafIcon, ShieldCheckIcon, LoaderIcon } from '../components/Icons.jsx';

/**
 * 全站访问口令门禁页（未通过口令前替代整个应用界面）。
 * 输对口令后由父组件切换为正常界面。
 */
export default function GateView({ onOk }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e?.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError('');
    try {
      await api.gateVerify(password);
      onOk();
    } catch (err) {
      setError(err.message || '口令错误');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative min-h-screen bg-[#f4f9f6] flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <form onSubmit={submit} className="panel rounded-2xl p-6 sm:p-8 shadow-lift">
          {/* 品牌 */}
          <div className="flex flex-col items-center mb-6">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-mint-400 to-emerald-500 flex items-center justify-center text-white shadow-soft mb-2.5">
              <LeafIcon width={22} height={22} />
            </div>
            <p className="text-[11px] text-slate-400 font-medium">AI Hot Monitor</p>
          </div>

          <div className="flex items-center gap-2 mb-1.5">
            <ShieldCheckIcon width={16} height={16} className="text-mint-600" />
            <h2 className="font-display font-bold text-base text-slate-800">访问口令</h2>
          </div>
          <p className="text-xs text-slate-500 mb-5 leading-relaxed">本站需要口令才能访问，请输入后进入。</p>

          <label className="block text-xs font-semibold text-slate-600 mb-1.5">口令</label>
          <input
            type="password"
            required
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="请输入访问口令"
            className="w-full rounded-xl border border-mint-100 bg-white px-3 py-2.5 text-sm text-slate-700 placeholder:text-slate-300 focus:border-mint-400 focus:outline-none transition-colors"
          />

          {error && (
            <p className="mt-3 text-xs text-rose-500 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">{error}</p>
          )}

          <button
            type="submit"
            disabled={busy || !password}
            className="mt-5 w-full rounded-xl bg-gradient-to-r from-mint-500 to-emerald-500 text-white text-sm font-bold py-2.5 shadow-soft hover:opacity-95 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-2"
          >
            {busy ? <LoaderIcon width={15} height={15} /> : null}
            {busy ? '验证中…' : '进入'}
          </button>
        </form>

        <p className="text-center text-[11px] text-slate-400 mt-4">AI Hot Monitor · 热点雷达</p>
      </div>
    </div>
  );
}
