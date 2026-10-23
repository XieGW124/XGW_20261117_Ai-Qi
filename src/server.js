'use strict';

/**
 * 服务启动入口
 * 使用 Node.js 原生 http 模块同时提供静态页面与 JSON 接口，不依赖任何第三方包。
 * 启动方式：node src/server.js
 */

const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { handleAsk, handleRecords, sendJson } = require('./routes/ask');
const { isDemoMode, getConfig } = require('./services/llm');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');

// 静态资源扩展名与 Content-Type 的对应关系
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
};

/**
 * 提供 public 目录下的静态文件，默认返回 index.html。
 * 通过 path.relative 校验真实路径，防止 ../ 目录穿越。
 * @param {import('node:http').IncomingMessage} req 请求对象
 * @param {import('node:http').ServerResponse} res 响应对象
 * @param {string} pathname 未解码的路径部分
 */
async function serveStatic(req, res, pathname) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch (err) {
    sendJson(res, 400, { code: 400, message: '请求路径不合法' });
    return;
  }

  const relativePath = decodedPath === '/' ? 'index.html' : decodedPath.replace(/^\/+/, '');
  let filePath = path.resolve(PUBLIC_DIR, relativePath);

  // 只允许访问 public 目录内部的文件
  const relativeToPublic = path.relative(PUBLIC_DIR, filePath);
  if (relativeToPublic.startsWith('..') || path.isAbsolute(relativeToPublic)) {
    sendJson(res, 403, { code: 403, message: '禁止访问该路径' });
    return;
  }

  // 访问目录时自动返回其中的 index.html
  try {
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }
  } catch (err) {
    sendJson(res, 404, { code: 404, message: '页面不存在' });
    return;
  }

  let content;
  try {
    content = await fs.readFile(filePath);
  } catch (err) {
    sendJson(res, 404, { code: 404, message: '页面不存在' });
    return;
  }

  const contentType = MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': content.length,
    'Cache-Control': 'no-cache'
  });

  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  res.end(content);
}

/**
 * 创建并返回 HTTP 服务实例。
 * @returns {import('node:http').Server} HTTP 服务
 */
function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    try {
      // 提问接口
      if (url.pathname === '/api/ask') {
        if (req.method !== 'POST') {
          sendJson(res, 405, { code: 405, message: '请使用 POST 请求' });
          return;
        }
        await handleAsk(req, res);
        return;
      }

      // 问答记录接口
      if (url.pathname === '/api/records') {
        await handleRecords(req, res, url);
        return;
      }

      // 健康检查接口，同时暴露当前回答模式，便于前端展示提示
      if (url.pathname === '/api/health') {
        sendJson(res, 200, {
          code: 0,
          data: {
            status: 'ok',
            mode: isDemoMode() ? 'demo' : 'live',
            model: getConfig().model
          }
        });
        return;
      }

      // 其余 GET/HEAD 请求交给静态资源处理
      if (req.method === 'GET' || req.method === 'HEAD') {
        await serveStatic(req, res, url.pathname);
        return;
      }

      sendJson(res, 405, { code: 405, message: '不支持的请求方法' });
    } catch (err) {
      console.error('[服务] 处理请求出错：', err);
      if (!res.headersSent) {
        sendJson(res, 500, { code: 500, message: '服务器内部错误' });
      } else {
        res.end();
      }
    }
  });
}

const server = createServer();

server.listen(PORT, HOST, () => {
  const config = getConfig();
  const modeText = config.apiKey ? `大模型模式（模型：${config.model}）` : '演示模式（未配置 LLM_API_KEY）';
  console.log('AI 答疑助手已启动');
  console.log(`访问地址：http://${HOST}:${PORT}`);
  console.log(`当前模式：${modeText}`);
});

server.on('error', (err) => {
  console.error('[服务] 启动失败：', err.message);
  process.exit(1);
});
