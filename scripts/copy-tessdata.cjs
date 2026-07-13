const fs = require('node:fs')
const path = require('node:path')

const targetDir = path.resolve(__dirname, '../public/tessdata')
const languages = ['chi_sim', 'eng']

fs.mkdirSync(targetDir, { recursive: true })

for (const language of languages) {
  const packageEntry = require.resolve(`@tesseract.js-data/${language}`)
  const source = path.join(path.dirname(packageEntry), '4.0.0', `${language}.traineddata.gz`)
  const target = path.join(targetDir, `${language}.traineddata.gz`)
  fs.copyFileSync(source, target)
}

console.log('OCR language data is ready.')
