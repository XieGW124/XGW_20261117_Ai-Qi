'use strict';

/**
 * 分词工具
 * 面向中文课程资料的轻量分词：
 * 1. 英文与数字按单词切分（保留 node.js 这类带符号的写法）；
 * 2. 中文按“二元组”（相邻两个字）切分，兼顾召回率与实现成本；
 * 3. 过滤常见停顿词，减少无意义的匹配。
 */

// 常见停顿词（中英文），参与检索时会带来大量噪声
const STOP_WORDS = new Set([
  // 中文单字
  '的', '地', '得', '了', '着', '是', '在', '和', '与', '及', '或', '而', '也', '就', '都', '很', '有', '无',
  '我', '你', '他', '她', '它', '们', '这', '那', '哪', '个', '些', '吗', '呢', '吧', '啊', '呀', '嘛',
  '请', '问', '说', '要', '会', '能', '可', '把', '被', '让', '给', '对', '从', '到', '用', '做',
  // 中文常见二元组
  '什么', '怎么', '怎样', '如何', '为何', '为什', '么是', '是什', '哪些', '哪个', '一下', '可以', '请问',
  '帮我', '告诉', '介绍', '解释', '为什么', '是否', '以及', '还有', '就是', '这个', '那个',
  // 英文停顿词
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'to', 'of', 'and', 'or', 'in', 'on', 'at',
  'for', 'with', 'by', 'as', 'it', 'this', 'that', 'these', 'those', 'what', 'how', 'why', 'which',
  'do', 'does', 'did', 'can', 'could', 'should', 'would', 'i', 'you', 'we', 'they', 'me', 'my'
]);

const WORD_PATTERN = /[a-z0-9]+(?:[._+-][a-z0-9]+)*/g;
const CJK_PATTERN = /[\u4e00-\u9fff]+/g;

/**
 * 把文本切分成检索用的词元数组（保留重复，用于统计词频）。
 * @param {string} text 原始文本
 * @returns {string[]} 词元数组
 */
function tokenize(text) {
  if (!text) return [];

  const input = String(text).toLowerCase();
  const tokens = [];

  // 英文、数字：按单词切分，单字母词元没有检索价值，直接丢弃
  WORD_PATTERN.lastIndex = 0;
  let wordMatch;
  while ((wordMatch = WORD_PATTERN.exec(input)) !== null) {
    const word = wordMatch[0];
    if (word.length >= 2 && !STOP_WORDS.has(word)) {
      tokens.push(word);
    }
  }

  // 中文：相邻两个字组成一个二元组；只有一个字时保留该字
  CJK_PATTERN.lastIndex = 0;
  let cjkMatch;
  while ((cjkMatch = CJK_PATTERN.exec(input)) !== null) {
    const segment = cjkMatch[0];
    if (segment.length === 1) {
      if (!STOP_WORDS.has(segment)) {
        tokens.push(segment);
      }
      continue;
    }
    for (let i = 0; i < segment.length - 1; i += 1) {
      const bigram = segment.slice(i, i + 2);
      if (!STOP_WORDS.has(bigram)) {
        tokens.push(bigram);
      }
    }
  }

  return tokens;
}

/**
 * 统计词元出现的次数，用于按词频加权计算相似度。
 * @param {string[]} tokens 词元数组
 * @returns {Map<string, number>} 词元 -> 出现次数
 */
function countTokens(tokens) {
  const counter = new Map();
  for (const token of tokens) {
    counter.set(token, (counter.get(token) || 0) + 1);
  }
  return counter;
}

module.exports = {
  tokenize,
  countTokens,
  STOP_WORDS
};
