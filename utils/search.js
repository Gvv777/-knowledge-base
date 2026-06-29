const fs = require('fs');
const path = require('path');
const https = require('https');

const INDEX_PATH = path.join(__dirname, '..', 'data', 'index.json');
const CHUNK_PATH = path.join(__dirname, '..', 'data', 'chunks.json');

function loadIndex() {
  try { return JSON.parse(fs.readFileSync(INDEX_PATH, 'utf-8')); }
  catch { return { documents: [] }; }
}

function saveIndex(index) {
  const dir = path.dirname(INDEX_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2), 'utf-8');
}

function loadChunks() {
  try { return JSON.parse(fs.readFileSync(CHUNK_PATH, 'utf-8')); }
  catch { return []; }
}

function saveChunks(chunks) {
  const dir = path.dirname(CHUNK_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CHUNK_PATH, JSON.stringify(chunks, null, 2), 'utf-8');
}

// ==================== 文档分块 ====================

function chunkDocument(text, title, docId, docType) {
  const CHUNK_SIZE = 500;
  const CHUNK_OVERLAP = 50;
  const chunks = [];
  let start = 0;
  let seq = 0;

  while (start < text.length) {
    let end = Math.min(start + CHUNK_SIZE, text.length);
    let chunkText = text.slice(start, end);

    if (end < text.length) {
      const lastPara = chunkText.lastIndexOf('\n\n');
      const lastSentence = chunkText.lastIndexOf('。');
      const breakAt = Math.max(lastPara, lastSentence, -1);
      if (breakAt > CHUNK_SIZE * 0.3) {
        chunkText = chunkText.slice(0, breakAt);
        start += breakAt;
      } else {
        start = end;
      }
    } else {
      start = end;
    }

    chunks.push({
      id: docId + '_c' + seq,
      docId,
      docTitle: title,
      docType,
      seq,
      text: chunkText.trim()
    });
    seq++;
    start = Math.max(start - CHUNK_OVERLAP, start + 1);
  }

  return chunks;
}

function rebuildChunks(index) {
  const allChunks = [];
  index.documents.forEach(function (doc) {
    const content = doc.content || '';
    if (content.length > 0) {
      const docChunks = chunkDocument(content, doc.title, doc.id, doc.type);
      allChunks.push.apply(allChunks, docChunks);
    }
  });
  saveChunks(allChunks);
  return allChunks;
}

// ==================== 分词 ====================

function extractTerms(query) {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  const terms = new Set();
  q.split(/\s+/).forEach(function (p) { if (p.length > 0) terms.add(p); });

  const hasCJK = /[\u4e00-\u9fff\u3400-\u4dbf]/.test(q);
  if (hasCJK) {
    const chars = q.replace(/[\s\r\n]/g, '').split('');
    chars.forEach(function (c) {
      if (/[\u4e00-\u9fff\u3400-\u4dbfa-zA-Z0-9]/.test(c)) terms.add(c);
    });
    for (var n = 2; n <= Math.min(4, chars.length); n++) {
      for (var i = 0; i <= chars.length - n; i++) {
        var gram = chars.slice(i, i + n).join('');
        if (gram.length >= 2) terms.add(gram);
      }
    }
  }
  return Array.from(terms);
}

// ==================== chunk 搜索 ====================

function chunkSearch(query, chunks) {
  if (!query.trim() || !chunks || chunks.length === 0) return [];
  var terms = extractTerms(query);
  if (terms.length === 0) return [];

  var scored = [];

  chunks.forEach(function (chunk) {
    var text = chunk.text || '';
    var textLower = text.toLowerCase();
    var titleLower = (chunk.docTitle || '').toLowerCase();
    var score = 0;

    terms.forEach(function (term) {
      var pos = 0;
      while (pos < textLower.length) {
        var idx = textLower.indexOf(term, pos);
        if (idx === -1) break;
        score += Math.min(term.length, 5);
        pos = idx + 1;
      }
      if (titleLower.includes(term)) score += term.length * 3;
    });

    if (score > 0) {
      scored.push({ chunk: chunk, score: score, density: score / Math.max(text.length, 1) });
    }
  });

  scored.sort(function (a, b) {
    if (b.score !== a.score) return b.score - a.score;
    return b.density - a.density;
  });

  return scored.slice(0, 15);
}

function buildContext(scoredChunks) {
  var totalLen = 0;
  var parts = [];
  var maxLen = 4000;

  for (var i = 0; i < scoredChunks.length; i++) {
    var s = scoredChunks[i];
    var text = s.chunk.text;
    if (totalLen + text.length > maxLen && parts.length > 0) break;
    parts.push('【' + s.chunk.docTitle + ' - 第' + (s.chunk.seq + 1) + '段】\n' + text);
    totalLen += text.length;
  }
  return parts.join('\n\n---\n\n');
}

// ==================== 关键词搜索（对外 API）====================

function keywordSearch(query) {
  var chunks = loadChunks();
  var results = chunkSearch(query, chunks);
  var docMap = {};

  results.forEach(function (r) {
    var docId = r.chunk.docId;
    if (!docMap[docId]) {
      docMap[docId] = { id: docId, title: r.chunk.docTitle, type: r.chunk.docType, score: 0, snippets: [] };
    }
    docMap[docId].score += r.score;
    if (docMap[docId].snippets.length < 3) {
      docMap[docId].snippets.push(r.chunk.text.slice(0, 150));
    }
  });

  var arr = Object.values(docMap);
  arr.sort(function (a, b) { return b.score - a.score; });
  return arr;
}

// ==================== AI 搜索 ====================

function callDeepSeekAPI(payload) {
  return new Promise(function (resolve, reject) {
    var apiKey = process.env.DEEPSEEK_API_KEY || '';
    if (!apiKey) return reject(new Error('API 密钥未配置'));
    var data = JSON.stringify(payload);
    var options = {
      hostname: 'api.deepseek.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
        'Content-Length': Buffer.byteLength(data)
      },
      timeout: 30000
    };
    var req = https.request(options, function (res) {
      var body = '';
      res.on('data', function (chunk) { body += chunk; });
      res.on('end', function () {
        try {
          var parsed = JSON.parse(body);
          if (parsed.error) reject(new Error(parsed.error.message || parsed.error.code));
          else resolve(parsed);
        } catch (e) { reject(new Error('解析 API 响应失败')); }
      });
    });
    req.on('error', reject);
    req.on('timeout', function () { req.destroy(); reject(new Error('API 请求超时')); });
    req.write(data);
    req.end();
  });
}

async function aiSearch(query, index, history) {
  if (!query.trim()) return { answer: '请输入问题', sources: [] };
  if (!index.documents || index.documents.length === 0) {
    return { answer: '知识库为空，请先上传文档', sources: [] };
  }

  var chunks = loadChunks();
  var scoredChunks = chunkSearch(query, chunks);

  if (scoredChunks.length === 0) {
    index.documents.forEach(function (doc) {
      var content = doc.content || '';
      var firstChunk = content.slice(0, 500);
      if (firstChunk) {
        scoredChunks.push({
          chunk: { docId: doc.id, docTitle: doc.title, docType: doc.type, seq: 0, text: firstChunk },
          score: 0, density: 0
        });
      }
    });
    scoredChunks = scoredChunks.slice(0, 5);
  }

  var context = buildContext(scoredChunks);

  var seen = {};
  var sources = [];
  scoredChunks.forEach(function (s) {
    if (!seen[s.chunk.docId]) {
      seen[s.chunk.docId] = true;
      sources.push({ id: s.chunk.docId, title: s.chunk.docTitle, type: s.chunk.docType });
    }
  });

  var messages = [
    {
      role: 'system',
      content: '你是一个知识库智能助手。根据以下文档内容回答用户问题。\n'
        + '要求：\n'
        + '1. 严格基于提供的文档内容回答，不要编造信息\n'
        + '2. 如果文档中没有相关信息，如实说明"未在知识库中找到相关内容"\n'
        + '3. 引用时标注来源文档名称和段落编号，如「来源：xxx 第3段」\n'
        + '4. 用中文回答\n'
        + '5. 回答使用 Markdown 格式：**加粗**、- 列表、`代码` 等\n'
        + '6. 结合对话历史理解追问上下文'
    }
  ];

  if (history && Array.isArray(history)) {
    var recent = history.slice(-6);
    recent.forEach(function (h) {
      messages.push({ role: 'user', content: h.question });
      if (h.answer) messages.push({ role: 'assistant', content: h.answer });
    });
  }

  messages.push({
    role: 'user',
    content: '文档内容：\n' + context + '\n\n---\n\n问题：' + query
  });

  try {
    var result = await callDeepSeekAPI({
      model: 'deepseek-chat',
      messages: messages,
      temperature: 0.3,
      max_tokens: 3000
    });
    var answer = result.choices && result.choices[0]
      ? result.choices[0].message.content
      : 'AI 返回结果异常';
    return { answer: answer, sources: sources };
  } catch (err) {
    return { answer: 'AI 搜索失败：' + err.message, sources: [] };
  }
}

module.exports = { keywordSearch, aiSearch, loadIndex, saveIndex, rebuildChunks };
