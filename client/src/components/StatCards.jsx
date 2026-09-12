export default function StatCards({ stats }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {stats.map((s) => (
        <div
          key={s.label}
          className="panel panel-hover rounded-2xl p-4 flex items-center gap-3"
        >
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${s.iconBg} ${s.iconColor}`}
          >
            {s.icon}
          </div>
          <div className="min-w-0">
            <p className="text-[11px] text-slate-400 font-medium">{s.label}</p>
            <p className="font-display font-extrabold text-xl text-slate-800 leading-tight">
              {s.value}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
