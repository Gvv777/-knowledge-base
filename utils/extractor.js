const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const { ocrImage } = require('./ocr');

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg'];

function extractText(filePath, mimetype) {
  return new Promise((resolve, reject) => {
    const ext = path.extname(filePath).toLowerCase();

    if (IMAGE_EXTS.includes(ext)) {
      ocrImage(filePath).then(text => {
        const meaningful = (text || '').replace(/[\s\r\n]/g, '');
        if (meaningful.length < 10) {
          reject(new Error('OCR 未能识别出有效文字，请确认图片清晰'));
        } else {
          resolve(text);
        }
      }).catch(err => {
        reject(new Error('OCR 识别失败: ' + err.message));
      });
      return;
    }

    if (mimetype === 'application/pdf') {
      const buffer = fs.readFileSync(filePath);
      pdfParse(buffer).then(data => {
        const text = data.text || '';
        const meaningful = text.replace(/[\s\r\n\u0000-\u001f]/g, '');
        if (meaningful.length < 30) {
          reject(new Error('PDF 无可提取文本（可能是扫描件）。请将 PDF 页面导出为 PNG/JPG 图片后上传'));
        } else {
          resolve(text);
        }
      }).catch(reject);
    } else {
      let content;
      try {
        content = fs.readFileSync(filePath, 'utf-8');
      } catch (e) {
        try {
          content = fs.readFileSync(filePath, 'gbk');
        } catch (e2) {
          content = fs.readFileSync(filePath, 'latin1');
        }
      }
      const meaningful = content.replace(/[\s\r\n]/g, '');
      if (meaningful.length < 10) {
        reject(new Error('文件内容为空或无法解析'));
      } else {
        resolve(content);
      }
    }
  });
}

module.exports = { extractText };
