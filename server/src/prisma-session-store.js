import session from 'express-session';
import { prisma } from './db.js';

const FALLBACK_TTL = 24 * 3600 * 1000;

/**
 * 基于 Prisma + SQLite 的会话存储（避免原生 sqlite3 依赖）。
 * 实现 express-session 的 get/set/destroy/touch，并定期清理过期会话。
 */
export class PrismaSessionStore extends session.Store {
  constructor() {
    super();
    const timer = setInterval(() => this.cleanup(), 15 * 60 * 1000);
    timer.unref?.();
  }

  async get(sid, cb) {
    try {
      const row = await prisma.session.findUnique({ where: { id: sid } });
      if (!row) return cb(null, null);
      if (row.expiresAt < new Date()) {
        await prisma.session.delete({ where: { id: sid } }).catch(() => {});
        return cb(null, null);
      }
      cb(null, JSON.parse(row.data));
    } catch (err) {
      cb(err);
    }
  }

  async set(sid, sess, cb) {
    try {
      const expiresAt = sess.cookie?.expires
        ? new Date(sess.cookie.expires)
        : new Date(Date.now() + FALLBACK_TTL);
      const data = JSON.stringify(sess);
      await prisma.session.upsert({
        where: { id: sid },
        update: { data, expiresAt },
        create: { id: sid, data, expiresAt },
      });
      cb?.(null);
    } catch (err) {
      cb?.(err);
    }
  }

  async destroy(sid, cb) {
    try {
      await prisma.session.deleteMany({ where: { id: sid } });
      cb?.(null);
    } catch (err) {
      cb?.(err);
    }
  }

  async touch(sid, sess, cb) {
    try {
      const expiresAt = sess.cookie?.expires
        ? new Date(sess.cookie.expires)
        : new Date(Date.now() + FALLBACK_TTL);
      await prisma.session.updateMany({ where: { id: sid }, data: { expiresAt } });
      cb?.(null);
    } catch (err) {
      cb?.(err);
    }
  }

  async cleanup() {
    await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => {});
  }
}
