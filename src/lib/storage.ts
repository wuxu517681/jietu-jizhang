import { guessCategory } from './parser'
import { CATEGORIES, EXPENSE_SCOPES, type Transaction } from '../types'

const STORAGE_KEY = 'screenshot-ledger.transactions.v1'

export const loadTransactions = (): Transaction[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item) =>
      item && typeof item.id === 'string' && typeof item.amount === 'number' && typeof item.occurredAt === 'string',
    ).map((item) => ({
      ...item,
      category: CATEGORIES.includes(item.category) ? item.category : guessCategory(item.merchant ?? ''),
      expenseScope: EXPENSE_SCOPES.includes(item.expenseScope) ? item.expenseScope : '公司',
    }))
  } catch {
    return []
  }
}

export const saveTransactions = (transactions: Transaction[]) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(transactions))
}

const escapeCell = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`

export const exportCsv = (transactions: Transaction[]) => {
  const header = ['日期', '时间', '金额', '归属', '商户/收款方', '分类', '支付方式', '备注', '来源截图']
  const rows = transactions.map((item) => {
    const [date, time = ''] = item.occurredAt.replace('T', ' ').split(' ')
    return [date, time, item.amount.toFixed(2), item.expenseScope, item.merchant, item.category, item.platform, item.note, item.sourceName]
  })
  const content = `\uFEFF${[header, ...rows].map((row) => row.map(escapeCell).join(',')).join('\n')}`
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `花费账本-${new Date().toISOString().slice(0, 10)}.csv`
  anchor.click()
  URL.revokeObjectURL(url)
}

export const hashFile = async (file: File) => {
  if (globalThis.crypto?.subtle) {
    const buffer = await file.arrayBuffer()
    const digest = await crypto.subtle.digest('SHA-256', buffer)
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  }
  return `${file.name}-${file.size}-${file.lastModified}`
}
