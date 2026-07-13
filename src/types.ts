export const CATEGORIES = ['餐饮', '交通', '采购', '订阅', '日常', '其他'] as const
export const PLATFORMS = ['微信支付', '支付宝', '银行卡', '其他'] as const
export const EXPENSE_SCOPES = ['公司', '个人'] as const

export type Category = (typeof CATEGORIES)[number]
export type Platform = (typeof PLATFORMS)[number]
export type ExpenseScope = (typeof EXPENSE_SCOPES)[number]

export type Transaction = {
  id: string
  amount: number
  merchant: string
  category: Category
  platform: Platform
  expenseScope: ExpenseScope
  occurredAt: string
  note: string
  addedAt: string
  sourceHash: string
  sourceName: string
  rawText: string
}

export type ParsedPayment = {
  amount: number | null
  merchant: string
  category: Category
  platform: Platform
  expenseScope: ExpenseScope
  occurredAt: string
  confidence: number
}

export type QueueStatus = 'queued' | 'scanning' | 'ready' | 'error'

export type QueueItem = {
  id: string
  file: File
  previewUrl: string
  sourceHash: string
  sourceName: string
  status: QueueStatus
  progress: number
  parsed: ParsedPayment
  rawText: string
  error?: string
}
