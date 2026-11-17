'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { tokenize, countTokens } = require('../src/utils/text');
const { retrieve } = require('../src/services/retriever');
const { answer } = require('../src/services/llm');

test('分词保留 Node.js 并过滤常见停顿词', () => {
  assert.deepEqual(tokenize('Node.js 和 Node.js'), ['node.js', 'node.js']);

  const tokens = tokenize('什么是闭包？');
  assert.ok(tokens.includes('闭包'));
  assert.ok(!tokens.includes('什么'));
});

test('countTokens 统计词元出现次数', () => {
  const counts = countTokens(['node.js', '闭包', 'node.js']);

  assert.equal(counts.get('node.js'), 2);
  assert.equal(counts.get('闭包'), 1);
});

test('检索闭包问题时返回对应课程段落', () => {
  const result = retrieve('什么是闭包？');

  assert.ok(result.sections.length > 0);
  assert.equal(result.sections[0].title, '1.2 闭包');
  assert.match(result.context, /闭包是指函数与其词法作用域的组合/);
});

test('未配置 API 密钥时返回演示回答', async (t) => {
  const originalApiKey = process.env.LLM_API_KEY;
  delete process.env.LLM_API_KEY;
  t.after(() => {
    if (originalApiKey === undefined) {
      delete process.env.LLM_API_KEY;
    } else {
      process.env.LLM_API_KEY = originalApiKey;
    }
  });

  const result = await answer({
    question: '什么是闭包？',
    context: '闭包是指函数与其词法作用域的组合。'
  });

  assert.equal(result.mode, 'demo');
  assert.equal(result.model, 'demo-preset');
  assert.match(result.content, /【演示模式】/);
  assert.match(result.content, /闭包是指函数与其词法作用域的组合/);
});
