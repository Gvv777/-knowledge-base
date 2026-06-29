const fs = require('fs');
const path = require('path');
const https = require('https');

const INDEX_PATH = path.join(__dirname, '..', 'data', 'index.json');

function loadIndex() {
  try {
    return JSON.parse(fs.readFileSync(INDEX_PATH, 'utf-8'));
  } catch {
    return { documents: [] };
  }
}

function saveIndex(index) {
  const dir = path.dirname(INDEX_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2), 'utf-8');
}

// ==================== 分词工具 ====================

function extractNGrams(text, minN, maxN) {
  const chars = text.replace(/[\s\r\n]+/g, '').split('');
  const ngrams = new Set();
  for (let n = minN; n <= maxN; n++) {
    for (let i = 0; i <= chars.length - n; i++) {
      ngrams.add(chars.slice(i, i + n).join('').toLowerCase());
    }
  }
  return [...ngrams];
}

function extractTerms(query) {
  const q = query.toLowerCase().trim();
  if (!q) return [];

  const terms = new Set();

  // 按空白分割
  const parts = q.split(/\s+/);
  parts.forEach(p => {
    if (p.length > 0) terms.add(p);
  });

  // 对于英文单词，保持原样
  // 对于中文/混合内容，提取字符 n-gram
  const hasCJK = /[\u4e00-\u9fff\u3400-\u4dbf]/.test(q);
  if (hasCJK) {
    // 单字符（跳过纯空白/符号）
    const chars = q.replace(/[\s\r\n]/g, '').split('');
    chars.forEach(c => {
      if (/[\u4e00-\u9fff\u3400-\u4dbfa-zA-Z0-9]/.test(c)) {
        terms.add(c);
      }
    });

    // 2-gram 和 3-gram
    for (let n = 2; n <= Math.min(4, chars.length); n++) {
      for (let i = 0; i <= chars.length - n; i++) {
        const gram = chars.slice(i, i + n).join('');
        if (gram.length >= 2) terms.add(gram);
      }
    }
  }

  return [...terms];
}

// ==================== 关键词搜索 ====================

function keywordSearch(query, index) {
  if (!query.trim()) return [];
  const terms = extractTerms(query);
  if (terms.length === 0) return [];

  const results = [];

  index.documents.forEach(doc => {
    const content = (doc.content || '');
    const contentLower = content.toLowerCase();
    const title = (doc.title || '');
    const titleLower = title.toLowerCase();

    let score = 0;
    const matchSet = new Set();

    terms.forEach(term => {
      let pos = 0;
      let found = false;
      while (pos < contentLower.length) {
        const idx = contentLower.indexOf(term, pos);
        if (idx === -1) break;
        found = true;
        // 长词匹配得分更高
        const termWeight = Math.min(term.length, 5);
        score += termWeight;
        matchSet.add(idx);
        pos = idx + 1;
      }
      // 标题匹配：加权
      if (titleLower.includes(term)) {
        score += term.length * 3;
      }
    });

    if (score > 0) {
      // 按匹配密度归一化
      const density = score / Math.max(content.length, 1) * 10000;
      results.push({
        id: doc.id,
        title: doc.title,
        type: doc.type,
        score: Math.round(score * 100 + density),
        // 取前 4 个匹配位置生成片段
        snippets: [...matchSet].slice(0, 4).map(idx => {
          const start = Math.max(0, idx - 20);
          const end = Math.min(content.length, idx + 80);
          let snippet = content.slice(start, end);
          // 高亮匹配词
          terms.forEach(t => {
            snippet = snippet.replace(
              new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
              m => '🔍' + m + '🔍'
            );
          });
          return snippet;
        })
      });
    }
  });

  results.sort((a, b) => b.score - a.score);
  return results;
}

// ==================== AI 搜索（DeepSeek API）====================

function callDeepSeekAPI(payload) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.DEEPSEEK_API_KEY || '';
    if (!apiKey) {
      return reject(new Error('API 密钥未配置'));
    }
    const data = JSON.stringify(payload);
    const options = {
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

    const req = https.request(options, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (parsed.error) {
            reject(new Error(parsed.error.message || parsed.error.code));
          } else {
            resolve(parsed);
          }
        } catch {
          reject(new Error('解析 API 响应失败'));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('API 请求超时')); });
    req.write(data);
    req.end();
  });
}

async function aiSearch(query, index) {
  if (!query.trim()) return { answer: '请输入问题', sources: [] };

  const docs = index.documents;
  if (docs.length === 0) return { answer: '知识库为空，请先上传文档', sources: [] };

  // 关键词粗筛：使用同样的 terms 提取
  const terms = extractTerms(query);
  const docScores = [];

  docs.forEach(doc => {
    const contentLower = (doc.content || '').toLowerCase();
    const titleLower = (doc.title || '').toLowerCase();
    let score = 0;

    terms.forEach(term => {
      let pos = 0;
      while ((pos = contentLower.indexOf(term, pos)) !== -1) {
        score += Math.min(term.length, 5);
        pos++;
      }
      if (titleLower.includes(term)) {
        score += term.length * 5;
      }
    });

    // 标题本身与查询的相似度加分
    const titleWords = query.split(/\s+/);
    titleWords.forEach(w => {
      if (w.length > 1 && titleLower.includes(w)) {
        score += 10;
      }
    });

    docScores.push({ doc, score });
  });

  // 取匹配分数最高的文档，放宽条件：只要有分数就纳入
  docScores.sort((a, b) => b.score - a.score);
  const candidates = docScores.filter(d => d.score > 0);

  // 如果关键词筛选不到文档，仍取所有文档的前 N 篇按长度降序作为后备
  let relevant;
  if (candidates.length === 0) {
    relevant = docs
      .sort((a, b) => (b.content || '').length - (a.content || '').length)
      .slice(0, 5);
  } else {
    relevant = candidates.slice(0, 5).map(c => c.doc);
  }

  // 构建上下文
  const context = relevant.map(d => {
    const content = (d.content || '');
    // 截取前 2000 字符，但保留匹配附近的内容
    let excerpt = content.slice(0, 2000);
    // 如果 doc 有分数说明有关键词匹配，尝试找到匹配段
    const score = docScores.find(s => s.doc.id === d.id)?.score || 0;
    if (score > 0 && content.length > 2000) {
      // 找到第一个匹配位置，取周围内容
      const matchedTerm = terms.find(t => content.toLowerCase().includes(t));
      if (matchedTerm) {
        const idx = content.toLowerCase().indexOf(matchedTerm);
        const start = Math.max(0, idx - 200);
        excerpt = content.slice(start, start + 2000);
      }
    }
    return `【${d.title}】\n${excerpt}`;
  }).join('\n\n---\n\n');

  const systemPrompt = '你是一个知识库智能助手。根据以下文档内容回答用户问题。要求：\n'
    + '1. 基于提供的文档内容回答，不要编造信息\n'
    + '2. 如果文档中没有相关信息，如实说明"未在知识库中找到相关内容"\n'
    + '3. 引用来源时标注文档名称\n'
    + '4. 用中文回答';

  const userPrompt = `文档内容：\n${context}\n\n---\n\n问题：${query}`;

  try {
    const result = await callDeepSeekAPI({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.3,
      max_tokens: 2000
    });

    const answer = result.choices && result.choices[0]
      ? result.choices[0].message.content
      : 'AI 返回结果异常';

    return {
      answer,
      sources: relevant.map(d => ({ id: d.id, title: d.title, type: d.type }))
    };
  } catch (err) {
    return { answer: 'AI 搜索失败：' + err.message, sources: [] };
  }
}

module.exports = { keywordSearch, aiSearch, loadIndex, saveIndex };
