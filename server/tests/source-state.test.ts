/**
 * 数据源运行时开关（state.js）回归测试
 *
 * 覆盖：
 *   1. 数据源清单完整（13 个源，字段齐全，国内/境外分组正确）
 *   2. 运行时切换 + 持久化（写入状态文件，重启后可恢复）
 *   3. 未知数据源抛错、非布尔值强转
 *
 * 运行：npm test（= node --test tests/）
 * 隔离：通过 SOURCE_STATE_FILE 指向临时文件，避免污染 server/.source-state.json。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// 必须在导入模块前设置，确保 state.js 的 STATE_FILE 指向临时目录
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ahm-sources-'));
process.env.SOURCE_STATE_FILE = path.join(tmp, 'state.json');

const { getSourceList, getSourceEnabled, setSourceEnabled, SOURCE_META } =
  await import('../src/sources/state.js');

test('数据源清单：共 13 个源，字段齐全', () => {
  assert.equal(SOURCE_META.length, 13);
  assert.equal(getSourceList().length, 13);

  for (const s of getSourceList()) {
    assert.equal(typeof s.key, 'string');
    assert.equal(typeof s.label, 'string');
    assert.ok(['domestic', 'foreign'].includes(s.region), `${s.key} 的 region 非法`);
    assert.ok(['key', 'cookie', null].includes(s.needs), `${s.key} 的 needs 非法`);
    assert.equal(typeof s.enabled, 'boolean');
    assert.equal(typeof s.available, 'boolean');
  }
});

test('数据源清单：国内源 9 个、境外源 4 个', () => {
  const list = getSourceList();
  const domestic = list.filter((s) => s.region === 'domestic');
  const foreign = list.filter((s) => s.region === 'foreign');
  assert.equal(domestic.length, 9);
  assert.equal(foreign.length, 4);
});

test('setSourceEnabled：切换 Twitter 关闭并持久化到状态文件', () => {
  setSourceEnabled('twitter', false);
  assert.equal(getSourceEnabled().twitter, false);
  assert.equal(getSourceList().find((s) => s.key === 'twitter').enabled, false);

  // 持久化文件里应已记录 twitter=false（重启后仍生效）
  const saved = JSON.parse(fs.readFileSync(process.env.SOURCE_STATE_FILE, 'utf8'));
  assert.equal(saved.twitter, false);
});

test('setSourceEnabled：重新开启可恢复', () => {
  setSourceEnabled('twitter', true);
  assert.equal(getSourceEnabled().twitter, true);
});

test('setSourceEnabled：未知数据源抛错，不污染状态', () => {
  assert.throws(() => setSourceEnabled('nope', true), /未知数据源/);
});

test('setSourceEnabled：非布尔值按布尔强转', () => {
  setSourceEnabled('bing', 1);
  assert.equal(getSourceEnabled().bing, true);
  setSourceEnabled('bing', '');
  assert.equal(getSourceEnabled().bing, false);
  setSourceEnabled('bing', true); // 恢复，避免影响其它断言
});

test('getSourceEnabled：返回副本，外部修改不影响内部状态', () => {
  const snapshot = getSourceEnabled();
  snapshot.twitter = !snapshot.twitter;
  assert.notEqual(getSourceEnabled().twitter, snapshot.twitter);
});
