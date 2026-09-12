/**
 * 数据源抓取测试：验证各数据源能否返回数据（无 API key 的源会自动跳过）
 */
import { searchHackerNews } from '../src/sources/hackernews.js';
import { searchBilibili } from '../src/sources/bilibili.js';
import { searchWeb } from '../src/sources/websearch.js';
import { getWeiboHot } from '../src/sources/weibo.js';

async function test() {
  console.log('== 数据源测试 ==\n');

  const t1 = Date.now();
  try {
    const hn = await searchHackerNews('AI', 5);
    console.log(`[HackerNews] ✅ ${hn.length} 条 (${Date.now() - t1}ms)`);
    if (hn[0]) console.log(`  示例: ${hn[0].title}`);
  } catch (e) {
    console.log(`[HackerNews] ❌ ${e.message}`);
  }

  const t2 = Date.now();
  try {
    const bb = await searchBilibili('AI', 5);
    console.log(`[B站搜索] ✅ ${bb.length} 条 (${Date.now() - t2}ms)`);
  } catch (e) {
    console.log(`[B站搜索] ❌ ${e.message}`);
  }

  const t3 = Date.now();
  try {
    const wb = await getWeiboHot(5);
    console.log(`[微博热搜] ✅ ${wb.length} 条 (${Date.now() - t3}ms)`);
    if (wb[0]) console.log(`  示例: ${wb[0].title}`);
  } catch (e) {
    console.log(`[微博热搜] ❌ ${e.message}`);
  }

  const t4 = Date.now();
  try {
    const bing = await searchWeb('bing', 'AI 大模型', 5);
    console.log(`[Bing搜索] ✅ ${bing.length} 条 (${Date.now() - t4}ms)`);
  } catch (e) {
    console.log(`[Bing搜索] ❌ ${e.message}`);
  }

  console.log('\n== 完成 ==');
  process.exit(0);
}

test();
