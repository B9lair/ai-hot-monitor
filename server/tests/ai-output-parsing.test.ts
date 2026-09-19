/**
 * AI 输出解析与校验的回归测试
 *
 * 重点覆盖两类历史故障：
 *   1. Boolean('false') === true → 真实内容被误判为「疑似假冒」从而不发送通知
 *   2. relevance 返回非数字 → 静默兜底成 0 → 被静默判为「不相关」丢弃
 *
 * 这些函数均为纯函数，不需要调用大模型。
 * 运行：npm test（= node --test tests/）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseVerifyResult,
  parseJudgeResult,
  parseJSON,
  coerceBool,
  coerce01,
  isRelevantHit,
  mentionsKeyword,
} from '../src/ai/openrouter.ts';

/** 临时屏蔽告警输出（用于「故意非法」的用例） */
function quiet<T>(fn: () => T): T {
  const orig = console.warn;
  console.warn = () => {};
  try {
    return fn();
  } finally {
    console.warn = orig;
  }
}

test('coerceBool: 字符串布尔值按语义解析（核心 bug 回归）', () => {
  assert.equal(coerceBool('false'), false, "字符串 'false' 必须为 false");
  assert.equal(coerceBool('0'), false);
  assert.equal(coerceBool('否'), false);
  assert.equal(coerceBool(''), false);
  assert.equal(coerceBool('true'), true);
  assert.equal(coerceBool('1'), true);
  assert.equal(coerceBool('是'), true);
  assert.equal(coerceBool(true), true);
  assert.equal(coerceBool(false), false);
  assert.equal(coerceBool(0), false);
  assert.equal(coerceBool(1), true);
  // 无法识别时回退默认值
  assert.equal(coerceBool('maybe', true), true);
  assert.equal(coerceBool(undefined, true), true);
  assert.equal(coerceBool(null), false);
});

test('coerceBool: 对比原生 Boolean() 的差异（说明被修复的故障）', () => {
  // 原生写法会把 'false' 变成 true —— 这就是原 bug 的根因
  assert.equal(Boolean('false'), true);
  // 修复后
  assert.equal(coerceBool('false'), false);
});

test('coerce01: 严格数值解析与边界收敛', () => {
  assert.equal(coerce01(0.95), 0.95);
  assert.equal(coerce01('0.95'), 0.95, '数字字符串应被接受');
  assert.equal(coerce01(1.7), 1, '超过 1 应收敛');
  assert.equal(coerce01(-3), 0, '小于 0 应收敛');
  assert.equal(coerce01('', 0.5), 0.5, '空字符串视为非法');
  assert.equal(coerce01('   ', 0.5), 0.5);
  assert.equal(coerce01('高', 0.5), 0.5, '非数字文本回退默认值');
  assert.equal(coerce01(undefined, 0.5), 0.5);
  assert.equal(coerce01(NaN, 0.5), 0.5);
});

test('parseVerifyResult: isFake 字符串 "false" 不再被误判为假冒', () => {
  const r = parseVerifyResult({ relevance: 0.95, isFake: 'false', confidence: '0.9' });
  assert.equal(r.isFake, false, "isFake='false' 必须解析为 false（否则真实热点不会发通知）");
  assert.equal(r.relevance, 0.95);
  assert.equal(r.confidence, 0.9);
});

test('parseVerifyResult: isFake 为真值的各种写法均识别为 true', () => {
  assert.equal(parseVerifyResult({ relevance: 0.5, isFake: true }).isFake, true);
  assert.equal(parseVerifyResult({ relevance: 0.5, isFake: 'true' }).isFake, true);
  assert.equal(parseVerifyResult({ relevance: 0.5, isFake: '1' }).isFake, true);
  assert.equal(parseVerifyResult({ relevance: 0.5, isFake: 1 }).isFake, true);
});

test('parseVerifyResult: relevance 非法值回退 0 而非抛错', () => {
  const r = quiet(() => parseVerifyResult({ relevance: '高', isFake: false }));
  assert.equal(r.relevance, 0);
  assert.equal(Number.isFinite(r.relevance), true);
});

test('parseVerifyResult: 缺字段时返回安全默认值', () => {
  const r = parseVerifyResult({});
  assert.deepEqual(r, {
    relevance: 0,
    keywordMentioned: false,
    matchType: '',
    summary: '',
    relevanceReason: '',
    isFake: false,
    confidence: 0.5,
    fakeReason: '',
  });
});

test('parseVerifyResult: 模型返回非对象时兜底且不抛错', () => {
  for (const bad of ['oops', 42, null, undefined, ['a', 'b']]) {
    const r = quiet(() => parseVerifyResult(bad));
    assert.equal(r.relevance, 0);
    assert.equal(r.isFake, false);
  }
});

test('parseVerifyResult: 对象/数组类型字段被降级为字符串', () => {
  const r = quiet(() =>
    parseVerifyResult({ relevance: 0.5, summary: { text: 'x' }, fakeReason: 123, matchType: true }),
  );
  assert.equal(r.summary, '', '对象无法转文本，降级为空串');
  assert.equal(r.fakeReason, '123', '数字转字符串');
  assert.equal(r.matchType, 'true');
});

test('parseJudgeResult: 分数收敛到 1~5 且接受数字字符串', () => {
  assert.deepEqual(parseJudgeResult({ summaryScore: '4', reasonScore: 9, comment: 123 }), {
    summaryScore: 4,
    reasonScore: 5,
    comment: '123',
  });
  const r = quiet(() => parseJudgeResult({ summaryScore: '优秀', reasonScore: -10 }));
  assert.equal(r.summaryScore, 1, '非法值回退 1');
  assert.equal(r.reasonScore, 1, '越界收敛到下限');
});

test('parseJSON: 兼容代码块 / 裸换行 / 尾逗号 / 前后杂文', () => {
  assert.deepEqual(parseJSON('{"a":1}'), { a: 1 });
  assert.deepEqual(parseJSON('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJSON('好的，结果如下：{"a":1} 以上'), { a: 1 });
  // 字符串内裸换行（模型很常见的非法输出）
  assert.deepEqual(parseJSON('{"a":"第一行\n第二行"}'), { a: '第一行\n第二行' });
  // 尾逗号
  assert.deepEqual(parseJSON('{"a":1,}'), { a: 1 });
  assert.throws(() => parseJSON('完全不是 JSON'), /无法解析为 JSON/);
});

test('isRelevantHit: 以服务端阈值判定，非法值判为不相关', () => {
  assert.equal(isRelevantHit({ relevance: 0.6 }, 0.6), true);
  assert.equal(isRelevantHit({ relevance: 0.59 }, 0.6), false);
  assert.equal(isRelevantHit({ relevance: 0.95 }, 0.6), true);
  assert.equal(isRelevantHit({ relevance: '0.95' }, 0.6), true);
  assert.equal(isRelevantHit({ relevance: null }, 0.6), false);
  assert.equal(isRelevantHit({}, 0.6), false);
  assert.equal(isRelevantHit(null, 0.6), false);
});

test('mentionsKeyword: 纯数字 token 不放行（Claude Sonnet 4.6 vs 4.6）', () => {
  const item = { title: 'PyTorch 4.6 发布', snippet: '' };
  assert.equal(
    mentionsKeyword(item, 'Claude Sonnet 4.6', []),
    false,
    '仅命中 "4.6" 不应放行',
  );
  assert.equal(mentionsKeyword({ title: 'Claude Sonnet 4.6 实测' }, 'Claude Sonnet 4.6'), true);
  // 扩展词并入 token 池
  assert.equal(
    mentionsKeyword({ title: 'OpenAI 新模型发布' }, 'GPT-5', ['OpenAI GPT-5']),
    true,
  );
});
