'use strict';

/**
 * 大模型调用服务
 * 走兼容 OpenAI 协议的 /chat/completions 接口。
 * 配置全部来自环境变量：
 *   LLM_API_KEY  接口密钥（未配置时进入演示模式）
 *   LLM_BASE_URL 接口地址，默认 https://api.openai.com/v1
 *   LLM_MODEL    模型名称，默认 gpt-4o-mini
 *   LLM_TIMEOUT_MS 可选，单次调用超时毫秒数，默认 20000
 */

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_TIMEOUT_MS = 20000;

// 演示模式下的固定等待时间，模拟大模型思考，让前端加载态可见
const DEMO_DELAY_MS = 400;

/** 大模型调用异常，携带错误码，便于接口层区分不同失败原因 */
class LLMError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'LLMError';
    this.code = code;
  }
}

/**
 * 读取环境变量并整理成调用配置。
 * @returns {{apiKey: string, baseUrl: string, model: string, timeoutMs: number}} 调用配置
 */
function getConfig() {
  const rawTimeout = Number(process.env.LLM_TIMEOUT_MS);
  return {
    apiKey: (process.env.LLM_API_KEY || '').trim(),
    baseUrl: (process.env.LLM_BASE_URL || DEFAULT_BASE_URL).trim().replace(/\/+$/, ''),
    model: (process.env.LLM_MODEL || DEFAULT_MODEL).trim(),
    timeoutMs: Number.isFinite(rawTimeout) && rawTimeout > 0 ? Math.trunc(rawTimeout) : DEFAULT_TIMEOUT_MS
  };
}

/**
 * 是否处于演示模式。
 * @returns {boolean} 未配置 LLM_API_KEY 时返回 true
 */
function isDemoMode() {
  return getConfig().apiKey === '';
}

/**
 * 构造发送给大模型的消息列表，把检索到的课程资料与问题一起交给模型。
 * @param {string} question 学生问题
 * @param {string} context 检索到的课程资料
 * @returns {Array<{role: string, content: string}>} messages 数组
 */
function buildMessages(question, context) {
  const systemPrompt =
    '你是一位耐心的课程答疑助手。回答时请优先依据“课程资料”中的内容；' +
    '如果资料不足以回答问题，可以补充通用知识，但要明确区分哪些内容来自课程资料、哪些属于补充说明。' +
    '请使用中文回答，条理清晰，必要时分点说明，不要编造课程资料中不存在的事实。';

  const materials = (context || '').trim() || '（未检索到与问题相关的课程资料）';
  const userPrompt = `课程资料：\n${materials}\n\n学生问题：${question}`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ];
}

/**
 * 演示模式的预设回答：说明当前未配置密钥，并把检索到的资料摘要展示出来。
 * @param {string} question 学生问题
 * @param {string} context 检索到的课程资料
 * @returns {string} 预设回答文本
 */
function buildDemoAnswer(question, context) {
  const excerpt = (context || '').trim();
  const materialPart = excerpt
    ? `课程资料中检索到的相关内容：\n\n${excerpt.slice(0, 600)}`
    : '课程资料中暂未检索到与该问题直接相关的段落，可以尝试换一种问法。';

  return [
    '【演示模式】当前未配置大模型密钥（LLM_API_KEY），以下是预设回答。',
    '',
    `关于「${question}」：`,
    '',
    materialPart,
    '',
    '配置环境变量 LLM_API_KEY（可选配置 LLM_BASE_URL、LLM_MODEL）后重启服务，即可获得大模型的完整回答。'
  ].join('\n');
}

/** 等待指定毫秒数 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 调用兼容 OpenAI 协议的对话接口。
 * 包含超时保护、HTTP 状态码检查、JSON 解析检查与空内容检查。
 * @param {{apiKey: string, baseUrl: string, model: string, timeoutMs: number}} config 调用配置
 * @param {Array<{role: string, content: string}>} messages 消息列表
 * @returns {Promise<{content: string, model: string, usage: object|null}>} 模型回答
 */
async function callChatCompletion(config, messages) {
  if (typeof fetch !== 'function') {
    throw new LLMError('当前 Node.js 版本不支持内置 fetch，请升级到 Node.js 18 及以上', 'LLM_UNSUPPORTED');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: 0.3,
        max_tokens: 1000
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 200);
      throw new LLMError(`接口返回 HTTP ${response.status}${detail ? `：${detail}` : ''}`, 'LLM_HTTP_ERROR');
    }

    let data;
    try {
      data = await response.json();
    } catch (err) {
      throw new LLMError('接口返回内容不是合法的 JSON', 'LLM_INVALID_RESPONSE');
    }

    const content = data?.choices?.[0]?.message?.content;
    // 返回内容为空时按调用失败处理，避免把空回答当成成功结果
    if (typeof content !== 'string' || content.trim() === '') {
      throw new LLMError('大模型返回内容为空', 'LLM_EMPTY_RESPONSE');
    }

    return {
      content: content.trim(),
      model: data.model || config.model,
      usage: data.usage || null
    };
  } catch (err) {
    if (err instanceof LLMError) throw err;
    if (err.name === 'AbortError') {
      throw new LLMError(`调用大模型超时（超过 ${config.timeoutMs} 毫秒）`, 'LLM_TIMEOUT');
    }
    throw new LLMError(`调用大模型失败：${err.message}`, 'LLM_REQUEST_ERROR');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 回答学生问题：已配置密钥时调用真实大模型，否则返回预设回答。
 * @param {{question: string, context: string}} options 问题与检索到的资料
 * @returns {Promise<{content: string, mode: 'demo'|'live', model: string, usage: object|null}>} 回答结果
 */
async function answer({ question, context }) {
  const config = getConfig();

  if (!config.apiKey) {
    await delay(DEMO_DELAY_MS);
    return {
      content: buildDemoAnswer(question, context),
      mode: 'demo',
      model: 'demo-preset',
      usage: null
    };
  }

  const result = await callChatCompletion(config, buildMessages(question, context));
  return {
    content: result.content,
    mode: 'live',
    model: result.model,
    usage: result.usage
  };
}

module.exports = {
  answer,
  isDemoMode,
  getConfig,
  LLMError
};
