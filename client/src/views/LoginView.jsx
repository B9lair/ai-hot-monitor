import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { LeafIcon, MailIcon, CheckIcon, XIcon } from '../components/Icons.jsx';

const RESEND_COOLDOWN = 60;

/**
 * 登录弹层（可选功能）：登录后即可接收邮件通知。
 * 不登录也能正常使用本站。
 */
export default function LoginView({ initialError = '', onClose }) {
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(initialError);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  // Esc 关闭
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async (e) => {
    e?.preventDefault();
    const value = email.trim();
    if (!value || sending || cooldown > 0) return;
    setSending(true);
    setError('');
    try {
      await api.login(value);
      setSent(true);
      setCooldown(RESEND_COOLDOWN);
    } catch (err) {
      setError(err.message || '发送失败，请稍后重试。');
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-slate-900/30 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div className="w-full max-w-md animate-pop-in">
        <div className="panel rounded-2xl p-6 sm:p-7 relative">
          <button
            onClick={onClose}
            aria-label="关闭"
            className="absolute right-4 top-4 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
          >
            <XIcon width={16} height={16} />
          </button>

          {/* 品牌 */}
          <div className="flex flex-col items-center mb-5">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-mint-400 to-emerald-500 flex items-center justify-center text-white shadow-soft mb-2.5">
              <LeafIcon width={22} height={22} />
            </div>
            <p className="text-[11px] text-slate-400 font-medium">AI Hot Monitor</p>
          </div>

          {sent ? (
            <div className="text-center">
              <div className="w-12 h-12 rounded-2xl bg-mint-50 text-mint-600 flex items-center justify-center mx-auto mb-4">
                <CheckIcon width={22} height={22} />
              </div>
              <h2 className="font-display font-bold text-base text-slate-800 mb-2">登录链接已发送</h2>
              <p className="text-sm text-slate-500 leading-relaxed">
                已向 <span className="font-semibold text-slate-700">{email.trim()}</span> 发送登录邮件，
                请在 10 分钟内点击邮件中的链接完成登录。
              </p>
              <p className="text-xs text-slate-400 mt-3">
                本页面会自动检测登录状态；也可直接在新标签页打开邮件链接。没收到请检查垃圾邮件。
              </p>

              <button
                onClick={submit}
                disabled={cooldown > 0 || sending}
                className="mt-5 w-full rounded-xl border border-mint-200 bg-white text-mint-700 text-sm font-semibold py-2.5 hover:bg-mint-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {cooldown > 0 ? `重新发送（${cooldown}s）` : '重新发送'}
              </button>
              <button
                onClick={() => {
                  setSent(false);
                  setEmail('');
                }}
                className="mt-2 w-full text-xs text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
              >
                更换邮箱
              </button>
            </div>
          ) : (
            <form onSubmit={submit}>
              <h2 className="font-display font-bold text-base text-slate-800 mb-1.5">登录以接收邮件通知</h2>
              <p className="text-xs text-slate-500 mb-5 leading-relaxed">
                输入邮箱，我们会发送一封登录邮件，点击链接即可登录。无需密码。
              </p>

              <label className="block text-xs font-semibold text-slate-600 mb-1.5">邮箱</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300">
                  <MailIcon width={15} height={15} />
                </span>
                <input
                  type="email"
                  required
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full rounded-xl border border-mint-100 bg-white pl-9 pr-3 py-2.5 text-sm text-slate-700 placeholder:text-slate-300 focus:border-mint-400 focus:outline-none transition-colors"
                />
              </div>

              {error && (
                <p className="mt-3 text-xs text-rose-500 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={sending || !email.trim()}
                className="mt-5 w-full rounded-xl bg-gradient-to-r from-mint-500 to-emerald-500 text-white text-sm font-bold py-2.5 shadow-soft hover:opacity-95 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {sending ? '发送中…' : '发送登录链接'}
              </button>
            </form>
          )}
        </div>

        <p className="text-center text-[11px] text-slate-400 mt-4">不登录也能正常使用，登录后额外收到邮件通知</p>
      </div>
    </div>
  );
}
