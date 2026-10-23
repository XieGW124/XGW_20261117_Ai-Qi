'use strict';

/**
 * 问答记录读写
 * 使用 JSON Lines 格式追加写入 data/records.jsonl，每行一条记录，
 * 读取时从文件末尾往前取最近的若干条。
 */

const fs = require('node:fs/promises');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const RECORD_FILE = path.join(DATA_DIR, 'records.jsonl');

/** 确保 data 目录存在 */
async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

/**
 * 生成记录唯一标识。
 * @returns {string} 形如 qa_1792754919000_ab12cd 的标识
 */
function createRecordId() {
  return `qa_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 保存一条问答记录。
 * @param {object} entry 记录内容
 * @param {string} entry.question 问题
 * @param {string} entry.answer 回答（失败时为空字符串）
 * @param {'demo'|'live'} entry.mode 回答模式
 * @param {string} [entry.model] 使用的模型
 * @param {Array<{title: string, score: number}>} [entry.sources] 引用的资料段落
 * @param {string} [entry.error] 失败原因，成功时为空
 * @param {number} [entry.durationMs] 本次回答耗时
 * @returns {Promise<object>} 写入后的完整记录（含 id 与 createdAt）
 */
async function saveRecord(entry) {
  await ensureDataDir();

  const record = {
    id: createRecordId(),
    createdAt: new Date().toISOString(),
    question: String(entry.question || ''),
    answer: String(entry.answer || ''),
    mode: entry.mode === 'live' ? 'live' : 'demo',
    model: String(entry.model || ''),
    sources: Array.isArray(entry.sources) ? entry.sources : [],
    error: String(entry.error || ''),
    durationMs: Number.isFinite(entry.durationMs) ? entry.durationMs : 0
  };

  await fs.appendFile(RECORD_FILE, `${JSON.stringify(record)}\n`, 'utf8');
  return record;
}

/**
 * 读取最近的问答记录（按时间倒序）。
 * @param {number} [limit=20] 最多返回条数
 * @returns {Promise<object[]>} 记录列表
 */
async function readRecords(limit = 20) {
  let raw;
  try {
    raw = await fs.readFile(RECORD_FILE, 'utf8');
  } catch (err) {
    // 还没有任何记录时，返回空列表即可
    if (err.code === 'ENOENT') return [];
    throw err;
  }

  const lines = raw.split('\n').filter((line) => line.trim() !== '');
  const records = [];

  for (let i = lines.length - 1; i >= 0 && records.length < limit; i -= 1) {
    try {
      records.push(JSON.parse(lines[i]));
    } catch (err) {
      // 跳过损坏的行，不影响其他记录读取
      console.warn('[问答记录] 跳过无法解析的记录行：', err.message);
    }
  }

  return records;
}

module.exports = {
  saveRecord,
  readRecords,
  RECORD_FILE
};
