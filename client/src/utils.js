// 时间格式化工具
export function formatRelativeTime(input) {
  if (!input) return '';
  const date = new Date(input);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  const day = Math.floor(hour / 24);
  if (day < 7) return `${day} 天前`;
  return date.toLocaleDateString('zh-CN');
}

export function formatDateTime(input) {
  if (!input) return '';
  return new Date(input).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// 数字压缩展示（12345 → 1.2万；1200 → 1.2k），用于点赞/浏览/star 等互动数据
export function formatCount(n) {
  if (n == null || n === '' || !Number.isFinite(Number(n))) return '';
  const v = Number(n);
  if (v >= 100000000) return trimZero(v / 100000000) + '亿';
  if (v >= 10000) return trimZero(v / 10000) + '万';
  if (v >= 1000) return trimZero(v / 1000) + 'k';
  return String(v);
}

function trimZero(n) {
  return (Math.round(n * 10) / 10).toString();
}
