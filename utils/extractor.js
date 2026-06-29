const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');

function extractText(filePath, mimetype) {
  return new Promise((resolve, reject) => {
    if (mimetype === 'application/pdf') {
      const buffer = fs.readFileSync(filePath);
      pdfParse(buffer).then(data => {
        resolve(data.text);
      }).catch(reject);
    } else {
      const content = fs.readFileSync(filePath, 'utf-8');
      resolve(content);
    }
  });
}

module.exports = { extractText };
