import type { Category, ExpenseScope, Platform, Transaction } from '../types'

export type DateFilterPreset = 'all' | 'thisMonth' | 'lastMonth' | 'last30Days' | 'custom'

export type LedgerFilters = {
  search: string
  category: Category | '全部'
  scope: ExpenseScope | '全部'
  platform: Platform | '全部'
  datePreset: DateFilterPreset
  dateFrom: string
  dateTo: string
}

export type LedgerStats = {
  total: number
  companyTotal: number
  personalTotal: number
  count: number
  average: number
}

const toDateKey = (date: Date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export const getDateBounds = (preset: DateFilterPreset, now = new Date()) => {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  if (preset === 'thisMonth') {
    return {
      from: toDateKey(new Date(today.getFullYear(), today.getMonth(), 1)),
      to: toDateKey(new Date(today.getFullYear(), today.getMonth() + 1, 0)),
    }
  }

  if (preset === 'lastMonth') {
    return {
      from: toDateKey(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
      to: toDateKey(new Date(today.getFullYear(), today.getMonth(), 0)),
    }
  }

  if (preset === 'last30Days') {
    const from = new Date(today)
    from.setDate(from.getDate() - 29)
    return { from: toDateKey(from), to: toDateKey(today) }
  }

  return { from: '', to: '' }
}

export const filterTransactions = (
  transactions: Transaction[],
  filters: LedgerFilters,
  now = new Date(),
) => {
  const query = filters.search.trim().toLocaleLowerCase('zh-CN')
  const presetBounds = getDateBounds(filters.datePreset, now)
  const from = filters.datePreset === 'custom' ? filters.dateFrom : presetBounds.from
  const to = filters.datePreset === 'custom' ? filters.dateTo : presetBounds.to

  return [...transactions]
    .filter((item) => filters.scope === '全部' || item.expenseScope === filters.scope)
    .filter((item) => filters.category === '全部' || item.category === filters.category)
    .filter((item) => filters.platform === '全部' || item.platform === filters.platform)
    .filter((item) => {
      const date = item.occurredAt.slice(0, 10)
      return (!from || date >= from) && (!to || date <= to)
    })
    .filter((item) => {
      if (!query) return true
      const searchable = [
        item.merchant,
        item.expenseScope,
        item.category,
        item.platform,
        item.note,
        item.sourceName,
      ].join(' ').toLocaleLowerCase('zh-CN')
      return searchable.includes(query)
    })
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
}

export const summarizeTransactions = (transactions: Transaction[]): LedgerStats => {
  const toCents = (amount: number) => Math.round(amount * 100)
  const totalCents = transactions.reduce((sum, item) => sum + toCents(item.amount), 0)
  const companyCents = transactions
    .filter((item) => item.expenseScope === '公司')
    .reduce((sum, item) => sum + toCents(item.amount), 0)
  const personalCents = transactions
    .filter((item) => item.expenseScope === '个人')
    .reduce((sum, item) => sum + toCents(item.amount), 0)

  return {
    total: totalCents / 100,
    companyTotal: companyCents / 100,
    personalTotal: personalCents / 100,
    count: transactions.length,
    average: transactions.length ? Math.round(totalCents / transactions.length) / 100 : 0,
  }
}

export const countActiveFilters = (filters: LedgerFilters) => {
  let count = 0
  if (filters.search.trim()) count += 1
  if (filters.scope !== '全部') count += 1
  if (filters.category !== '全部') count += 1
  if (filters.platform !== '全部') count += 1
  if (
    (filters.datePreset !== 'all' && filters.datePreset !== 'custom')
    || (filters.datePreset === 'custom' && Boolean(filters.dateFrom || filters.dateTo))
  ) count += 1
  return count
}
