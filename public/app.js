'use strict';

/**
 * AI 答疑助手前端逻辑
 * 负责提交问题、渲染回答与引用资料、展示最近问答记录。
 */

const form = document.getElementById('ask-form');
const questionInput = document.getElementById('question');
const submitBtn = document.getElementById('submit-btn');
const submitLabel = submitBtn.querySelector('.btn-label');
const statusBox = document.getElementById('status');
const loadingBox = document.getElementById('loading');
const answerBox = document.getElementById('answer');
const answerContent = document.getElementById('answer-content');
const answerMode = document.getElementById('answer-mode');
const answerTime = document.getElementById('answer-time');
const sourcesBox = document.getElementById('sources');
const historyList = document.getElementById('history');
const historyEmpty = document.getElementById('history-empty');
const refreshBtn = document.getElementById('refresh-btn');
const modeBadge = document.getElementById('mode-badge');
const charCount = document.getElementById('char-count');
const examplesBox = document.getElementById('examples');

let historyRecords = [];
let asking = false;

/** 显示状态提示；传入空字符串时隐藏 */
function setStatus(message, isError = false) {
  if (!message) {
    statusBox.hidden = true;
    statusBox.textContent = '';
    statusBox.classList.remove('is-error');
    return;
  }
  statusBox.hidden = false;
  statusBox.textContent = message;
  statusBox.classList.toggle('is-error', isError);
}

/** 切换提交中的状态：按钮、骨架屏一起联动 */
function setLoading(loading) {
  asking = loading;
  submitBtn.disabled = loading;
  submitLabel.textContent = loading ? '思考中' : '提问';
  loadingBox.hidden = !loading;
}

/** 更新时间字数统计 */
function updateCharCount() {
  charCount.textContent = `${questionInput.value.length} / 500`;
}

/** 格式化时间，例如 10-23 18:30 */
function formatTime(isoText) {
  const date = new Date(isoText);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

/** 返回模式对应的中文名称 */
function modeLabel(mode) {
  return mode === 'demo' ? '演示模式' : '大模型模式';
}

/** 转义 HTML 特殊字符，避免模型输出被当作页面结构执行 */
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  };
  return String(text).replace(/[&<>"']/g, (char) => map[char]);
}

/** 渲染行内格式：行内代码与加粗（入参必须是已转义的文本） */
function renderInline(escapedText) {
  return escapedText
    .replace(/`([^`\n]+)`/g, '<code class="inline-code">$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
}

/** 渲染代码块，带语言标签与复制按钮 */
function renderCodeBlock(code, lang) {
  const label = lang ? escapeHtml(lang) : '代码';
  return [
    '<div class="code-block">',
    `<div class="code-head"><span class="code-lang">${label}</span>`,
    `<button type="button" class="copy-btn" data-code="${encodeURIComponent(code)}">复制</button></div>`,
    `<pre><code>${escapeHtml(code)}</code></pre>`,
    '</div>'
  ].join('');
}

/**
 * 轻量 Markdown 渲染：支持代码块、行内代码、加粗、标题和列表。
 * 先对原文转义，再生成 HTML，避免大模型输出中的标签被执行。
 * @param {string} source Markdown 原文
 * @returns {string} 可直接写入页面的 HTML
 */
function renderMarkdown(source) {
  const text = String(source || '').replace(/\r\n/g, '\n');
  if (text.trim() === '') return '<p>暂无回答内容。</p>';

  const html = [];
  let paragraph = [];
  let listType = '';
  let inCode = false;
  let codeLines = [];
  let codeLang = '';

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    html.push(`<p>${renderInline(paragraph.join(' '))}</p>`);
    paragraph = [];
  };

  const closeList = () => {
    if (!listType) return;
    html.push(`</${listType}>`);
    listType = '';
  };

  const flushCode = () => {
    html.push(renderCodeBlock(codeLines.join('\n'), codeLang));
    codeLines = [];
    codeLang = '';
  };

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();

    const fence = /^```([\w-]*)\s*$/.exec(line);
    if (fence) {
      if (inCode) {
        flushCode();
        inCode = false;
      } else {
        flushParagraph();
        closeList();
        inCode = true;
        codeLang = fence[1];
      }
      continue;
    }

    if (inCode) {
      codeLines.push(rawLine);
      continue;
    }

    if (line === '') {
      flushParagraph();
      closeList();
      continue;
    }

    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) {
      flushParagraph();
      closeList();
      const level = Math.min(heading[1].length + 2, 5);
      html.push(`<h${level}>${renderInline(escapeHtml(heading[2]))}</h${level}>`);
      continue;
    }

    const bullet = /^[-*•]\s+(.+)$/.exec(line);
    const ordered = /^\d{1,2}[.)]\s+(.+)$/.exec(line) || /^\d{1,2}、\s*(.+)$/.exec(line);
    if (bullet || ordered) {
      flushParagraph();
      const type = bullet ? 'ul' : 'ol';
      if (listType !== type) {
        closeList();
        html.push(`<${type}>`);
        listType = type;
      }
      const content = escapeHtml((bullet || ordered)[1]);
      html.push(`<li>${renderInline(content)}</li>`);
      continue;
    }

    paragraph.push(escapeHtml(line));
  }

  if (inCode) flushCode();
  flushParagraph();
  closeList();

  return html.join('\n');
}

/**
 * 渲染回答内容、模式、耗时与引用资料。
 * @param {{answer: string, mode: string, sources: Array<{title: string, score: number}>, durationMs: number}} data 接口返回的数据
 */
function renderAnswer(data) {
  answerContent.innerHTML = renderMarkdown(data.answer || '');
  answerMode.textContent = modeLabel(data.mode);
  answerMode.className = `badge ${data.mode === 'demo' ? 'badge-demo' : 'badge-live'}`;
  answerTime.textContent = Number.isFinite(data.durationMs) ? `耗时 ${(data.durationMs / 1000).toFixed(1)} 秒` : '';

  // 引用资料
  sourcesBox.textContent = '';
  if (Array.isArray(data.sources) && data.sources.length > 0) {
    const label = document.createElement('p');
    label.className = 'sources-label';
    label.textContent = '引用课程资料';
    sourcesBox.appendChild(label);

    const chips = document.createElement('div');
    chips.className = 'source-chips';
    for (const source of data.sources) {
      const chip = document.createElement('span');
      chip.className = 'source-chip';
      chip.textContent = source.title;
      chip.title = `相关度：${source.score}`;
      chips.appendChild(chip);
    }
    sourcesBox.appendChild(chips);
  } else {
    const empty = document.createElement('p');
    empty.className = 'sources-label';
    empty.textContent = '本次未命中课程资料段落，回答主要来自模型自身知识。';
    sourcesBox.appendChild(empty);
  }

  answerBox.hidden = false;
}

/** 提交问题并渲染结果 */
async function askQuestion(question) {
  setLoading(true);
  setStatus('');
  answerBox.hidden = true;

  try {
    const response = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question })
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch (err) {
      payload = null;
    }

    if (!response.ok || !payload || payload.code !== 0) {
      const message = (payload && payload.message) || `请求失败（HTTP ${response.status}）`;
      throw new Error(message);
    }

    renderAnswer(payload.data);
    await loadHistory();
  } catch (err) {
    setStatus(`提问失败：${err.message}`, true);
  } finally {
    setLoading(false);
  }
}

/** 点击历史记录时，把该条问答重新渲染出来 */
function showRecord(record) {
  if (asking) return;

  questionInput.value = record.question || '';
  updateCharCount();

  // 只有失败信息、没有回答时，仅展示错误提示
  if (record.error && !record.answer) {
    setStatus(`该次提问失败：${record.error}`, true);
    answerBox.hidden = true;
    return;
  }

  setStatus('');
  renderAnswer({
    answer: record.answer || '',
    mode: record.mode,
    sources: record.sources || [],
    durationMs: record.durationMs
  });
  answerBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/** 渲染最近提问列表 */
function renderHistory() {
  historyList.textContent = '';
  historyEmpty.hidden = historyRecords.length > 0;

  for (const record of historyRecords) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'history-item';

    const question = document.createElement('span');
    question.className = 'history-question';
    question.textContent = record.question;

    const meta = document.createElement('span');
    meta.className = 'history-meta';
    const stateText = record.error ? '调用失败' : modeLabel(record.mode);
    meta.textContent = `${formatTime(record.createdAt)} · ${stateText}`;

    button.appendChild(question);
    button.appendChild(meta);
    button.addEventListener('click', () => showRecord(record));

    item.appendChild(button);
    historyList.appendChild(item);
  }
}

/** 加载最近的问答记录 */
async function loadHistory() {
  try {
    const response = await fetch('/api/records?limit=8');
    const payload = await response.json();
    if (!response.ok || payload.code !== 0) {
      throw new Error(payload.message || `请求失败（HTTP ${response.status}）`);
    }
    historyRecords = Array.isArray(payload.data) ? payload.data : [];
    renderHistory();
  } catch (err) {
    console.warn('加载问答记录失败：', err.message);
  }
}

/** 读取服务状态，更新顶部模式标签 */
async function loadHealth() {
  try {
    const response = await fetch('/api/health');
    const payload = await response.json();
    if (!response.ok || payload.code !== 0) {
      throw new Error('服务状态异常');
    }
    const { mode, model } = payload.data;
    modeBadge.hidden = false;
    modeBadge.textContent = mode === 'demo' ? '演示模式（未配置密钥）' : `大模型模式 · ${model}`;
    modeBadge.className = `badge ${mode === 'demo' ? 'badge-demo' : 'badge-live'}`;
  } catch (err) {
    modeBadge.hidden = false;
    modeBadge.textContent = '服务未连接';
  }
}

// 提交表单
form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (asking) return;

  const question = questionInput.value.trim();
  if (!question) {
    setStatus('请先输入问题', true);
    questionInput.focus();
    return;
  }
  askQuestion(question);
});

// 实时更新字数统计
questionInput.addEventListener('input', updateCharCount);

// Ctrl + Enter / Command + Enter 快速提交
questionInput.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    form.requestSubmit();
  }
});

// 点击示例问题：填入并直接提问
examplesBox.addEventListener('click', (event) => {
  const chip = event.target.closest('.example-chip');
  if (!chip || asking) return;

  questionInput.value = chip.dataset.question || '';
  updateCharCount();
  form.requestSubmit();
});

// 代码块复制按钮（事件委托）
answerContent.addEventListener('click', async (event) => {
  const button = event.target.closest('.copy-btn');
  if (!button) return;

  const code = decodeURIComponent(button.dataset.code || '');
  try {
    await navigator.clipboard.writeText(code);
    button.textContent = '已复制';
  } catch (err) {
    button.textContent = '复制失败';
  }
  setTimeout(() => {
    button.textContent = '复制';
  }, 1600);
});

// 手动刷新历史记录
refreshBtn.addEventListener('click', loadHistory);

// 页面初始化
updateCharCount();
loadHealth();
loadHistory();
