import { describe, expect, it } from 'vitest'
import { guessCategory, parsePaymentText } from './parser'

describe('parsePaymentText', () => {
  it('parses a WeChat payment receipt', () => {
    const result = parsePaymentText(`微信支付\n支付成功\n¥ 28.50\n收款方：山野咖啡店\n付款时间 2026-07-14 08:31:20`, 'wx.png')
    expect(result.amount).toBe(28.5)
    expect(result.merchant).toBe('山野咖啡店')
    expect(result.platform).toBe('微信支付')
    expect(result.category).toBe('餐饮')
    expect(result.occurredAt).toBe('2026-07-14T08:31')
  })

  it('parses full-width Alipay text', () => {
    const result = parsePaymentText(`支付宝\n交易成功\n实付 ￥１２．８０\n商户名称：全家便利店\n2026年7月14日 12:05`, 'receipt.png')
    expect(result.amount).toBe(12.8)
    expect(result.merchant).toBe('全家便利店')
    expect(result.platform).toBe('支付宝')
    expect(result.category).toBe('采购')
  })

  it('falls back to the image timestamp', () => {
    const fallback = new Date(2026, 6, 14, 19, 22)
    const result = parsePaymentText('付款金额 18.00\n收款方：某某小店', 'pay.jpg', fallback)
    expect(result.occurredAt).toBe('2026-07-14T19:22')
  })

  it('handles character spacing produced by Chinese OCR', () => {
    const result = parsePaymentText(`微 信 支 付\n支 付 成 功\n28.50\n收 款 方 : 山 野 咖 啡 店\n付 款 时 间 : 2026-07-14 08:31`, 'scan.png')
    expect(result.amount).toBe(28.5)
    expect(result.merchant).toBe('山野咖啡店')
    expect(result.platform).toBe('微信支付')
  })

  it('treats a negative payment display as a positive expense', () => {
    const result = parsePaymentText(`支付成功\n金额区域\n−6.00\n收单机构 财付通支付科技有限公司`, 'wechat.jpg')
    expect(result.amount).toBe(6)
    expect(result.merchant).toBe('财付通支付科技有限公司')
  })
})

describe('guessCategory', () => {
  it('covers common merchants', () => {
    expect(guessCategory('上海地铁')).toBe('交通')
    expect(guessCategory('腾讯云计算')).toBe('订阅')
    expect(guessCategory('某某网络科技')).toBe('其他')
  })
})
