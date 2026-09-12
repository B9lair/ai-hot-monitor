export default function EmptyState({ icon, text, hint }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-16 h-16 rounded-2xl bg-mint-50 border border-mint-100 flex items-center justify-center text-mint-300">
        {icon}
      </div>
      <p className="mt-3 text-sm font-medium text-slate-500">{text}</p>
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}
