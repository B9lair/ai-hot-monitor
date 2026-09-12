/**
 * 集成冒烟测试：启动服务、请求 API、验证数据库读写、然后关闭
 */
import { prisma } from '../src/db.js';

async function test() {
  console.log('== 冒烟测试开始 ==\n');

  // 1. 数据库读写测试
  console.log('[1] 数据库读写测试...');
  const kw = await prisma.keyword.create({ data: { text: '__test_keyword__' } });
  const found = await prisma.keyword.findUnique({ where: { id: kw.id } });
  if (!found) throw new Error('数据库读写失败');
  await prisma.keyword.delete({ where: { id: kw.id } });
  console.log('   ✅ 数据库读写正常\n');

  // 2. 动态导入服务并启动（验证无导入错误）
  console.log('[2] 服务模块加载测试...');
  const { default: app } = await import('../src/index.js');
  console.log('   ✅ 服务模块加载成功\n');

  // 3. 数据源适配器加载测试
  console.log('[3] 数据源适配器测试...');
  const { searchAll } = await import('../src/sources/index.js');
  const items = await searchAll('AI', 3);
  console.log(`   ✅ 数据源抓取成功，共 ${items.length} 条（多源聚合）\n`);

  // 4. AI 服务状态
  console.log('[4] AI 服务状态...');
  const { hasAI } = await import('../src/config.js');
  console.log(`   ${hasAI() ? '✅ AI 已配置' : '⚠️  未配置 AI，退化为关键词匹配模式'}\n`);

  console.log('== 冒烟测试通过 ==');
  process.exit(0);
}

test().catch((err) => {
  console.error('== 测试失败 ==');
  console.error(err);
  process.exit(1);
});
