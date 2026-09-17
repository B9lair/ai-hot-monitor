import { Server } from 'socket.io';
import { config } from './config.js';

let io = null;

export function initSocket(server) {
  io = new Server(server, {
    cors: { origin: config.clientOrigin, methods: ['GET', 'POST'] },
  });

  io.on('connection', (socket) => {
    console.log('[socket] 客户端已连接:', socket.id);
    socket.on('disconnect', () => {
      console.log('[socket] 客户端断开:', socket.id);
    });
  });

  return io;
}

/** 向所有浏览器客户端广播一条通知 */
export function broadcastNotification(payload) {
  if (io) {
    io.emit('notification', payload);
  }
}

/** 广播关键词监控进度（前端显示「AI 校验中 x/y」） */
export function broadcastMonitorProgress(payload) {
  if (io) {
    io.emit('monitor_progress', payload);
  }
}
