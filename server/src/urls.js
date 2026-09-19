import { config } from './config.js';

/**
 * 站点地址解析。
 * 优先级：APP_BASE_URL / CLIENT_ORIGIN（显式配置）> 当前请求来源 > 最近一次访问来源 > 本地默认。
 * 这样本地、局域网 IP、内网穿透、正式域名都不用改配置。
 */

let rememberedOrigin = '';

const trim = (s) => String(s || '').replace(/\/+$/, '');

/** 从请求推断来源：Origin 最可靠；其次 X-Forwarded-*；最后 Host */
export function requestOrigin(req) {
  if (!req?.get) return '';
  const origin = req.get('origin');
  if (origin) return trim(origin);
  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  const host = req.get('x-forwarded-host') || req.get('host');
  return host ? `${proto}://${host}` : '';
}

/** 记录一次实际访问来源，供后台任务（定时邮件等无请求上下文的场景）拼链接使用 */
export function rememberOrigin(req) {
  const o = requestOrigin(req);
  if (o) rememberedOrigin = o;
}

/**
 * 当前应使用的站点基地址（不带结尾斜杠）
 * @param {import('express').Request} [req]
 */
export function baseUrl(req) {
  return (
    trim(config.auth.appBaseUrl) ||
    trim(config.clientOrigin) ||
    (req ? requestOrigin(req) : '') ||
    rememberedOrigin ||
    `http://localhost:${config.port}`
  );
}
