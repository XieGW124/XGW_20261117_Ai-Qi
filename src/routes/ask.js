'use strict';

/**
 * 问答接口
 * POST /api/ask      提问：检索课程资料 -> 调用大模型 -> 保存问答记录
 * GET  /api/records  读取最近的问答记录
 */

const retriever = require('../services/retriever');
const llm = require('../services/llm');
const qaRecord = require('../record/qaRecord');

const MAX_QUESTION_LENGTH = 500; // 问题最大字符数
const MAX_BODY_BYTES = 64 * 1024; // 请求体大小上限，防止超大请求

/**
 * 返回 JSON 响应。
 * @param {import('node:http').ServerResponse} res 响应对象
 * @param {number} statusCode 状态码
 * @param {object} payload 响应内容
 */
function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

/** 创建一个带状态码的请求参数错误 */
function createHttpError(message, statusCode) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

/**
 * 读取并解析 JSON 请求体，带大小限制。
 * @param {import('node:http').IncomingMessage} req 请求对象
 * @returns {Promise<object>} 解析后的请求体
 */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;

    req.on('data', (chunk) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        reject(createHttpError('请求体过大', 413));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (tooLarge) return;
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (raw === '') {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(createHttpError('请求体不是合法的 JSON', 400));
      }
    });

    req.on('error', () => {
      reject(createHttpError('读取请求体失败', 400));
    });
  });
}

/**
 * 保存记录；保存失败只记录日志，不影响本次回答返回给用户。
 * @param {object} entry 记录内容
 * @returns {Promise<object|null>} 保存成功返回记录，失败返回 null
 */
async function saveRecordQuietly(entry) {
  try {
    return await qaRecord.saveRecord(entry);
  } catch (err) {
    console.error('[问答记录] 保存失败：', err.message);
    return null;
  }
}

/**
 * 处理提问请求。
 * @param {import('node:http').IncomingMessage} req 请求对象
 * @param {import('node:http').ServerResponse} res 响应对象
 */
async function handleAsk(req, res) {
  const startedAt = Date.now();

  // 1. 校验请求体
  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    const statusCode = err.statusCode || 400;
    sendJson(res, statusCode, { code: statusCode, message: err.message });
    return;
  }

  const question = typeof body.question === 'string' ? body.question.trim() : '';
  if (question === '') {
    sendJson(res, 400, { code: 400, message: '问题不能为空' });
    return;
  }
  if (question.length > MAX_QUESTION_LENGTH) {
    sendJson(res, 400, { code: 400, message: `问题过长，最多 ${MAX_QUESTION_LENGTH} 个字符` });
    return;
  }

  // 2. 检索课程资料
  let retrieval;
  try {
    retrieval = retriever.retrieve(question);
  } catch (err) {
    console.error('[检索] 读取课程资料失败：', err.message);
    sendJson(res, 500, { code: 500, message: '读取课程资料失败，请检查 data/course-notes.md 是否存在' });
    return;
  }

  const sources = retrieval.sections.map((section) => ({
    title: section.title,
    score: section.score
  }));

  // 3. 调用大模型；失败时同样记录一条带错误信息的记录
  let result;
  try {
    result = await llm.answer({ question, context: retrieval.context });
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    console.error('[大模型] 调用失败：', err.message);
    await saveRecordQuietly({
      question,
      answer: '',
      mode: llm.isDemoMode() ? 'demo' : 'live',
      model: '',
      sources,
      error: err.message,
      durationMs
    });
    sendJson(res, 502, { code: 502, message: `大模型调用失败：${err.message}` });
    return;
  }

  // 4. 保存问答记录
  const durationMs = Date.now() - startedAt;
  const record = await saveRecordQuietly({
    question,
    answer: result.content,
    mode: result.mode,
    model: result.model,
    sources,
    error: '',
    durationMs
  });

  // 5. 返回结果
  sendJson(res, 200, {
    code: 0,
    data: {
      answer: result.content,
      mode: result.mode,
      model: result.model,
      sources,
      durationMs,
      recordId: record ? record.id : ''
    }
  });
}

/**
 * 处理问答记录查询。
 * @param {import('node:http').IncomingMessage} req 请求对象
 * @param {import('node:http').ServerResponse} res 响应对象
 * @param {URL} url 请求地址（含查询参数）
 */
async function handleRecords(req, res, url) {
  if (req.method !== 'GET') {
    sendJson(res, 405, { code: 405, message: '请使用 GET 请求' });
    return;
  }

  const rawLimit = Number(url.searchParams.get('limit') || 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), 50) : 10;

  try {
    const records = await qaRecord.readRecords(limit);
    sendJson(res, 200, { code: 0, data: records });
  } catch (err) {
    console.error('[问答记录] 读取失败：', err.message);
    sendJson(res, 500, { code: 500, message: '读取问答记录失败' });
  }
}

module.exports = {
  handleAsk,
  handleRecords,
  sendJson
};
