const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');

function extractText(filePath, mimetype) {
  return new Promise((resolve, reject) => {
    if (mimetype === 'application/pdf') {
      const buffer = fs.readFileSync(filePath);
      pdfParse(buffer).then(data => {
        const text = data.text || '';
        const meaningful = text.replace(/[\s\r\n\u0000-\u001f]/g, '');
        if (meaningful.length < 30) {
          reject(new Error('PDF 无可提取文本（可能是扫描件，请使用 .txt 或 .md 格式）'));
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
