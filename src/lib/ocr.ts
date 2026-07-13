import { createWorker, OEM, PSM, type Worker } from 'tesseract.js'

let activeProgress: ((progress: number) => void) | null = null
let workerPromise: Promise<Worker> | null = null

const makeAmountCrop = async (file: File): Promise<Blob | null> => {
  if (!globalThis.createImageBitmap) return null
  const bitmap = await createImageBitmap(file)
  try {
    const sourceX = Math.round(bitmap.width * 0.08)
    const sourceY = Math.round(bitmap.height * 0.18)
    const sourceWidth = Math.round(bitmap.width * 0.84)
    const sourceHeight = Math.round(bitmap.height * 0.2)
    const scale = Math.min(2.5, Math.max(1.5, 1800 / sourceWidth))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(sourceWidth * scale)
    canvas.height = Math.round(sourceHeight * scale)
    const context = canvas.getContext('2d')
    if (!context) return null
    context.filter = 'grayscale(1) contrast(1.8)'
    context.drawImage(bitmap, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height)
    return await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
  } finally {
    bitmap.close()
  }
}

const getWorker = () => {
  if (!workerPromise) {
    const langPath = new URL('tessdata', document.baseURI).href.replace(/\/$/, '')
    workerPromise = createWorker(['chi_sim', 'eng'], OEM.LSTM_ONLY, {
      langPath,
      logger: (message) => {
        if (typeof message.progress === 'number') activeProgress?.(message.progress)
      },
    }).then(async (worker) => {
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.AUTO,
        preserve_interword_spaces: '1',
      })
      return worker
    }).catch((error) => {
      workerPromise = null
      throw error
    })
  }
  return workerPromise
}

export const recognizePaymentScreenshot = async (file: File, onProgress: (progress: number) => void) => {
  let phase: 'page' | 'amount' = 'page'
  activeProgress = (progress) => onProgress(phase === 'page' ? progress * 0.8 : 0.8 + progress * 0.2)
  try {
    const worker = await getWorker()
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.AUTO,
      preserve_interword_spaces: '1',
      tessedit_char_whitelist: '',
    })
    const { data } = await worker.recognize(file)
    const amountCrop = await makeAmountCrop(file)
    if (!amountCrop) return data.text

    phase = 'amount'
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.SPARSE_TEXT,
      tessedit_char_whitelist: '0123456789.,-¥￥',
    })
    const amountResult = await worker.recognize(amountCrop)
    return `${data.text}\n金额区域\n${amountResult.data.text}`
  } finally {
    activeProgress = null
  }
}

export const stopOcr = async () => {
  if (!workerPromise) return
  const worker = await workerPromise
  await worker.terminate()
  workerPromise = null
}
