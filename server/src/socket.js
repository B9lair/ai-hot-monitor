import { Server } from 'socket.io';
import { config } from './config.js';

let io = null;

/**
 * 初始化 Socket.io
 * 说明：登录是可选的 —— 未登录客户端同样可以连接，接收实时刷新与通知广播。
 */
export function initSocket(server) {
  io = new Server(server, {
    cors: {
      // CLIENT_ORIGIN 留空时反射请求来源
      origin: config.clientOrigin || ((_origin, cb) => cb(null, true)),
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  io.on('connection', (socket) => {
    console.log('[socket] 客户端已连接:', socket.id);
    socket.on('disconnect', () => {
      console.log('[socket] 客户端断开:', socket.id);
    });
  });

  return io;
}

/** 广播通知（所有客户端，含未登录） */
export function broadcastNotification(payload) {
  if (io) io.emit('notification', payload);
}

/** 广播关键词监控进度 */
export function broadcastMonitorProgress(payload) {
  if (io) io.emit('monitor_progress', payload);
}
