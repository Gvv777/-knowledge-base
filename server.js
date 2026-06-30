require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { extractText } = require('./utils/extractor');
const { keywordSearch, aiSearch, loadIndex, saveIndex, rebuildChunks } = require('./utils/search');

const app = express();
const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const INDEX_PATH = path.join(__dirname, 'data', 'index.json');

// 确保目录存在
[UPLOAD_DIR, path.join(__dirname, 'data')].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ==================== 文件上传配置 ====================
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const unique = Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    cb(null, unique + '_' + file.originalname);
  }
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowed = ['.txt', '.md', '.pdf', '.png', '.jpg', '.jpeg'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) return cb(null, true);
    cb(new Error('不支持的文件类型，仅支持 .txt .md .pdf .png .jpg .jpeg'));
  },
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB
});

// ==================== API 路由 ====================

// 上传文档
app.post('/api/upload', upload.array('files'), async (req, res) => {
  try {
    const files = req.files;
    if (!files || files.length === 0) return res.status(400).json({ error: '请选择文件' });

    const index = loadIndex();
    const results = [];

    for (const file of files) {
      const ext = path.extname(file.originalname).toLowerCase();
      const imageExts = ['.png', '.jpg', '.jpeg'];
      let mimetype = 'text/plain';
      if (ext === '.pdf') mimetype = 'application/pdf';
      else if (imageExts.includes(ext)) mimetype = 'image/' + ext.slice(1);

      try {
        const content = await extractText(file.path, mimetype);
        const doc = {
          id: Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
          title: file.originalname,
          type: ext.slice(1),
          size: file.size,
          date: new Date().toISOString(),
          filename: file.filename,
          content: content || '(内容为空)'
        };
        index.documents.push(doc);
        results.push({ id: doc.id, title: doc.title, type: doc.type, size: doc.size, date: doc.date });
      } catch (err) {
        results.push({ title: file.originalname, error: err.message });
      }
    }

    saveIndex(index);
    rebuildChunks(index);
    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 获取文档列表
app.get('/api/documents', (req, res) => {
  const index = loadIndex();
  const list = index.documents.map(d => ({
    id: d.id, title: d.title, type: d.type, size: d.size, date: d.date
  }));
  res.json({ documents: list, total: list.length });
});

// 获取单篇文档（含全文）
app.get('/api/documents/:id', (req, res) => {
  const index = loadIndex();
  const doc = index.documents.find(d => d.id === req.params.id);
  if (!doc) return res.status(404).json({ error: '文档不存在' });
  res.json({ document: doc });
});

// 删除文档
app.delete('/api/documents/:id', (req, res) => {
  const index = loadIndex();
  const idx = index.documents.findIndex(d => d.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '文档不存在' });

  const doc = index.documents[idx];

  // 删除原始文件
  const filePath = path.join(UPLOAD_DIR, doc.filename);
  try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch {}

  index.documents.splice(idx, 1);
  saveIndex(index);
  res.json({ success: true });
});

// 关键词搜索
app.get('/api/search', (req, res) => {
  const query = req.query.q || '';
  const index = loadIndex();
  const results = keywordSearch(query, index);
  res.json({ query, results, total: results.length });
});

// AI 语义搜索
app.post('/api/search/ai', async (req, res) => {
  const query = req.body.q || '';
  const history = req.body.history || [];
  const index = loadIndex();
  const result = await aiSearch(query, index, history);
  res.json(result);
});

// ==================== 错误处理 ====================
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? '文件大小超过 50MB 限制' : err.message });
  }
  console.error(err);
  res.status(500).json({ error: err.message || '服务器内部错误' });
});

app.listen(PORT, () => {
  rebuildChunks(loadIndex());
  console.log('知识库系统已启动');
  console.log('访问地址: http://localhost:' + PORT);
  console.log('API 密钥: ' + (process.env.DEEPSEEK_API_KEY ? '已配置' : '未配置'));
});
