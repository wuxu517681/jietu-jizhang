const fs = require('node:fs')
const path = require('node:path')

const legacyTargetDir = path.resolve(__dirname, '../public/tessdata')
const targetDir = path.resolve(__dirname, '../public/tessdata-fast')
const ocrTargetDir = path.resolve(__dirname, '../public/ocr')
const languages = ['chi_sim', 'eng']

fs.rmSync(legacyTargetDir, { recursive: true, force: true })
fs.mkdirSync(targetDir, { recursive: true })
fs.mkdirSync(ocrTargetDir, { recursive: true })

for (const language of languages) {
  const packageEntry = require.resolve(`@tesseract.js-data/${language}`)
  const source = path.join(path.dirname(packageEntry), '4.0.0_best_int', `${language}.traineddata.gz`)
  const target = path.join(targetDir, `${language}.traineddata.gz`)
  fs.copyFileSync(source, target)
}

const tesseractEntry = require.resolve('tesseract.js')
const tesseractRoot = path.resolve(path.dirname(tesseractEntry), '..')
const coreRoot = path.resolve(tesseractRoot, '..', 'tesseract.js-core')

fs.copyFileSync(
  path.join(tesseractRoot, 'dist', 'worker.min.js'),
  path.join(ocrTargetDir, 'worker.min.js'),
)
fs.copyFileSync(
  path.join(coreRoot, 'tesseract-core-lstm.wasm.js'),
  path.join(ocrTargetDir, 'tesseract-core-lstm.wasm.js'),
)

console.log('Lightweight OCR assets are ready.')
