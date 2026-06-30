const { createWorker } = require('tesseract.js');

async function ocrImage(imagePath) {
  const worker = await createWorker('chi_sim+eng');
  const { data } = await worker.recognize(imagePath);
  await worker.terminate();
  return data.text;
}

module.exports = { ocrImage };
