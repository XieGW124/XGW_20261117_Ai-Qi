'use strict';

/**
 * 课程资料检索服务
 * 读取 data/course-notes.md，按标题切分段落，再根据问题词元与段落词元的重合度排序，
 * 返回最相关的若干段落作为大模型回答时的参考资料。
 */

const fs = require('node:fs');
const path = require('node:path');
const { tokenize, countTokens } = require('../utils/text');

const NOTES_FILE = path.join(__dirname, '..', '..', 'data', 'course-notes.md');
const TOP_SECTION_COUNT = 3; // 最多返回 3 个资料段落
const MAX_CONTEXT_CHARS = 3200; // 拼给大模型的资料总长度上限

// 缓存课程资料，避免每次提问都重新读取、重新分词
let cache = { mtimeMs: 0, sections: [] };

/**
 * 按 Markdown 标题（#、##、###）把资料切分成段落。
 * 每个段落带上标题、正文和词元列表。
 * @param {string} raw 资料全文
 * @returns {Array<{title: string, content: string, tokens: string[]}>} 段落列表
 */
function parseSections(raw) {
  const sections = [];
  let current = null;

  for (const line of raw.split(/\r?\n/)) {
    const heading = /^(#{1,3})\s+(.+)$/.exec(line.trim());
    if (heading) {
      current = { title: heading[2].trim(), lines: [] };
      sections.push(current);
      continue;
    }
    if (current) current.lines.push(line);
  }

  return sections
    .map((section) => {
      const content = section.lines.join('\n').trim();
      return {
        title: section.title,
        content,
        tokens: tokenize(`${section.title}\n${content}`)
      };
    })
    // 只有标题、没有正文的段落（例如大类标题）不参与检索
    .filter((section) => section.content.length > 0);
}

/**
 * 读取并缓存课程资料；文件修改后会自动重新加载。
 * @returns {Array<{title: string, content: string, tokens: string[]}>} 段落列表
 */
function loadSections() {
  let stat;
  try {
    stat = fs.statSync(NOTES_FILE);
  } catch (err) {
    throw new Error(`课程资料文件不存在或不可读：${NOTES_FILE}`);
  }

  if (cache.mtimeMs === stat.mtimeMs && cache.sections.length > 0) {
    return cache.sections;
  }

  const raw = fs.readFileSync(NOTES_FILE, 'utf8');
  cache = { mtimeMs: stat.mtimeMs, sections: parseSections(raw) };
  return cache.sections;
}

/**
 * 计算问题与某个资料段落的相关度得分。
 * 命中词元越多得分越高；命中段落标题额外加权；长段落做轻微惩罚，避免长文占优。
 * @param {{title: string, content: string, tokens: string[]}} section 资料段落
 * @param {string[]} questionTokens 问题词元
 * @returns {number} 相关度得分，0 表示不相关
 */
function scoreSection(section, questionTokens) {
  if (questionTokens.length === 0) return 0;

  // 段落词元计数（标题中的词额外计一次，形成标题加权）
  const tokenCounts = countTokens(section.tokens);
  for (const token of tokenize(section.title)) {
    tokenCounts.set(token, (tokenCounts.get(token) || 0) + 2);
  }

  let score = 0;
  for (const token of questionTokens) {
    const count = tokenCounts.get(token);
    if (count) {
      // 词频取对数，命中次数再多也不会无限放大
      score += 1 + Math.log(count);
    }
  }

  if (score === 0) return 0;

  // 长段落轻微归一化
  return score / Math.sqrt(Math.max(tokenCounts.size, 1));
}

/**
 * 把选中的资料段落拼成一段文本，控制总长度，避免提示词过长。
 * @param {Array<{title: string, content: string}>} sections 资料段落
 * @returns {string} 拼接后的资料文本
 */
function buildContext(sections) {
  if (sections.length === 0) return '';

  const pieces = [];
  let used = 0;

  for (const section of sections) {
    const remaining = MAX_CONTEXT_CHARS - used;
    if (remaining <= 0) break;

    const text = `【资料段落】${section.title}\n${section.content}`;
    if (text.length > remaining) {
      pieces.push(text.slice(0, remaining));
      break;
    }
    pieces.push(text);
    used += text.length;
  }

  return pieces.join('\n\n');
}

/**
 * 检索与问题最相关的课程资料。
 * @param {string} question 学生问题
 * @returns {{sections: Array<{title: string, content: string, score: number}>, context: string}}
 *          sections 为命中段落（含得分），context 为拼好的资料文本
 */
function retrieve(question) {
  const questionTokens = tokenize(question);
  const sections = loadSections();

  const ranked = sections
    .map((section) => ({ section, score: scoreSection(section, questionTokens) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_SECTION_COUNT)
    .map((item) => ({
      title: item.section.title,
      content: item.section.content,
      score: Number(item.score.toFixed(4))
    }));

  return {
    sections: ranked,
    context: buildContext(ranked)
  };
}

module.exports = {
  retrieve
};
