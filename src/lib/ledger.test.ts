import { describe, expect, it } from 'vitest'
import type { Transaction } from '../types'
import { countActiveFilters, filterTransactions, getDateBounds, summarizeTransactions, type LedgerFilters } from './ledger'

const transaction = (patch: Partial<Transaction>): Transaction => ({
  id: crypto.randomUUID(),
  amount: 10,
  merchant: '测试商户',
  category: '其他',
  platform: '微信支付',
  expenseScope: '公司',
  occurredAt: '2026-07-13T10:00',
  note: '',
  addedAt: '2026-07-13T10:01:00.000Z',
  sourceHash: crypto.randomUUID(),
  sourceName: 'receipt.png',
  rawText: '',
  ...patch,
})

const emptyFilters: LedgerFilters = {
  search: '',
  category: '全部',
  scope: '全部',
  platform: '全部',
  datePreset: 'all',
  dateFrom: '',
  dateTo: '',
}

const transactions = [
  transaction({ id: 'july-company', amount: 300, merchant: '腾讯计算机', category: '订阅', occurredAt: '2026-07-13T16:18' }),
  transaction({ id: 'july-personal', amount: 47.44, merchant: '出租车', category: '交通', platform: '支付宝', expenseScope: '个人', occurredAt: '2026-07-07T11:33' }),
  transaction({ id: 'june-company', amount: 587.93, merchant: '春 DO 所有书签', category: '采购', occurredAt: '2026-06-16T14:12' }),
]

describe('filterTransactions', () => {
  it('combines scope, category, platform and search filters', () => {
    const result = filterTransactions(transactions, {
      ...emptyFilters,
      search: '出租',
      category: '交通',
      scope: '个人',
      platform: '支付宝',
    })

    expect(result.map((item) => item.id)).toEqual(['july-personal'])
  })

  it('filters preset months using local calendar dates', () => {
    const now = new Date(2026, 6, 13, 18, 0)

    expect(filterTransactions(transactions, { ...emptyFilters, datePreset: 'thisMonth' }, now).map((item) => item.id))
      .toEqual(['july-company', 'july-personal'])
    expect(filterTransactions(transactions, { ...emptyFilters, datePreset: 'lastMonth' }, now).map((item) => item.id))
      .toEqual(['june-company'])
  })

  it('supports inclusive custom date bounds', () => {
    const result = filterTransactions(transactions, {
      ...emptyFilters,
      datePreset: 'custom',
      dateFrom: '2026-07-07',
      dateTo: '2026-07-07',
    })

    expect(result.map((item) => item.id)).toEqual(['july-personal'])
  })
})

describe('ledger statistics', () => {
  it('summarizes the currently visible result set', () => {
    expect(summarizeTransactions(transactions)).toEqual({
      total: 935.37,
      companyTotal: 887.93,
      personalTotal: 47.44,
      count: 3,
      average: 311.79,
    })
  })

  it('counts applied filter groups and date presets', () => {
    expect(countActiveFilters({ ...emptyFilters, search: ' 腾讯 ', scope: '公司', datePreset: 'thisMonth' })).toBe(3)
    expect(countActiveFilters({ ...emptyFilters, datePreset: 'custom' })).toBe(0)
    expect(countActiveFilters({ ...emptyFilters, datePreset: 'custom', dateFrom: '2026-07-01' })).toBe(1)
  })
})

describe('getDateBounds', () => {
  it('covers the whole current calendar month', () => {
    expect(getDateBounds('thisMonth', new Date(2026, 6, 13))).toEqual({
      from: '2026-07-01',
      to: '2026-07-31',
    })
  })

  it('handles the year boundary for last month', () => {
    expect(getDateBounds('lastMonth', new Date(2026, 0, 8))).toEqual({
      from: '2025-12-01',
      to: '2025-12-31',
    })
  })
})
