import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();
try {
  const kc = await p.keyword.count();
  const tc = await p.topic.count();
  console.log(`数据库就绪: keyword表=${kc}条, topic表=${tc}条`);
} catch (e) {
  console.log('数据库未就绪:', e.message.split('\n')[0]);
  console.log('请运行: npx prisma db push');
} finally {
  await p.$disconnect();
}
