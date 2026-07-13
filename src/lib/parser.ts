import type { Category, ParsedPayment, Platform } from '../types'

const FULL_WIDTH: Record<string, string> = {
  '０': '0', '１': '1', '２': '2', '３': '3', '４': '4',
  '５': '5', '６': '6', '７': '7', '８': '8', '９': '9',
  '．': '.', '，': ',', '：': ':', '￥': '¥',
}

const normalizeText = (input: string) => input
  .replace(/[０-９．，：￥]/g, (char) => FULL_WIDTH[char] ?? char)
  .replace(/[−–—﹣－]/g, '-')
  .replace(/(\d)\s+([.,])\s*(\d)/g, '$1$2$3')
  .replace(/([\u4e00-\u9fff])[ \t]+(?=[\u4e00-\u9fff])/g, '$1')
  .replace(/[ \t]+/g, ' ')

const parseAmount = (text: string): number | null => {
  const patterns = [
    /(?:实付|支付金额|付款金额|订单金额|交易金额|消费金额|金额合计|合计)[^\d¥-]{0,12}¥?\s*(-?\d{1,8}(?:[.,]\d{1,2})?)/gi,
    /¥\s*(-?\d{1,8}(?:[.,]\d{1,2})?)/g,
    /(?:^|\s)(-?\d{1,7}\.\d{2})(?:\s*元)?(?:\s|$)/gm,
  ]

  for (const pattern of patterns) {
    const matches = [...text.matchAll(pattern)]
    for (const match of matches) {
      const value = Math.abs(Number(match[1].replace(',', '.')))
      if (Number.isFinite(value) && value > 0 && value < 10_000_000) return value
    }
  }
  return null
}

const platformFrom = (text: string, fileName: string): Platform => {
  const haystack = `${text}\n${fileName}`.toLowerCase()
  if (/微信|wechat|财付通/.test(haystack)) return '微信支付'
  if (/支付宝|alipay|蚂蚁/.test(haystack)) return '支付宝'
  if (/银联|银行卡|储蓄卡|信用卡|云闪付/.test(haystack)) return '银行卡'
  return '其他'
}

const BOILERPLATE = /支付成功|交易成功|付款成功|账单详情|交易详情|订单详情|扫码付款|二维码付款|收付款|支付方式|交易单号|商户单号|当前状态|创建时间|付款时间|转账时间|账单分类|服务商|微信支付|支付宝|零钱|银行卡|备注|更多|完成|返回|详情/

const cleanMerchant = (value: string) => value
  .replace(/^[：:\s-]+|[：:\s-]+$/g, '')
  .replace(/[<>《》【】]/g, '')
  .slice(0, 40)

const parseMerchant = (text: string): string => {
  const labelled = [
    /(?:收款方|收款人|收单机构|商户名称|商户全称|交易对象|付款给|对方|商品说明|商品)[：:\s]*([^\n]{2,40})/i,
    /(?:向|给)\s*([^\n]{2,30})\s*(?:付款|转账)/i,
  ]
  for (const pattern of labelled) {
    const match = text.match(pattern)
    if (match) {
      const candidate = cleanMerchant(match[1])
      if (candidate && !BOILERPLATE.test(candidate)) return candidate
    }
  }

  const candidates = text.split('\n')
    .map((line) => cleanMerchant(line))
    .filter((line) => {
      if (line.length < 2 || line.length > 24) return false
      if (BOILERPLATE.test(line)) return false
      if (/^[¥￥\d\s:.,/\-]+$/.test(line)) return false
      if (/\d{4}[-/.年]\d{1,2}/.test(line)) return false
      if (!/[\u4e00-\u9fffA-Za-z]/.test(line)) return false
      return true
    })
    .sort((a, b) => {
      const score = (line: string) =>
        (/店|馆|餐|超市|便利|公司|中心|药房|咖啡|茶|科技|商贸|服务/.test(line) ? 4 : 0)
        + (/[\u4e00-\u9fff]{3,}/.test(line) ? 2 : 0)
        - (/^[a-z]+$/i.test(line) ? 2 : 0)
      return score(b) - score(a)
    })
  return candidates[0] ?? ''
}

const toLocalInputValue = (date: Date) => {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const parseOccurredAt = (text: string, fallback: Date): { value: string; exact: boolean } => {
  const normalized = text.replace(/[年/.]/g, '-').replace(/[月]/g, '-').replace(/[日]/g, ' ')
  const full = normalized.match(/(20\d{2})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})(?::\d{2})?/)
  if (full) {
    const date = new Date(Number(full[1]), Number(full[2]) - 1, Number(full[3]), Number(full[4]), Number(full[5]))
    if (!Number.isNaN(date.getTime())) return { value: toLocalInputValue(date), exact: true }
  }
  const short = normalized.match(/(?:^|\s)(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})/)
  if (short) {
    const date = new Date(fallback.getFullYear(), Number(short[1]) - 1, Number(short[2]), Number(short[3]), Number(short[4]))
    if (!Number.isNaN(date.getTime())) return { value: toLocalInputValue(date), exact: true }
  }
  return { value: toLocalInputValue(fallback), exact: false }
}

export const guessCategory = (merchant: string): Category => {
  const value = merchant.toLowerCase()
  if (/餐|饭|面|粉|食|咖啡|茶|奶|麦当劳|肯德基|饿了么|美团外卖|星巴克|瑞幸|酒|火锅|烧烤/.test(value)) return '餐饮'
  if (/地铁|公交|滴滴|出行|铁路|航空|机票|火车|加油|停车|车费|打车|高德|酒店|宾馆|民宿/.test(value)) return '交通'
  if (/超市|便利|商场|淘宝|天猫|京东|拼多多|商城|百货|旗舰店|购物|文具|办公|快递|打印|设备/.test(value)) return '采购'
  if (/软件|云服务|服务器|域名|主机|saas|github|figma|notion|openai|腾讯云|阿里云|华为云|会员/.test(value)) return '订阅'
  if (/房租|物业|水费|电费|燃气|宽带|话费|充值/.test(value)) return '日常'
  return '其他'
}

export const parsePaymentText = (rawText: string, fileName: string, fallback = new Date()): ParsedPayment => {
  const text = normalizeText(rawText)
  const amount = parseAmount(text)
  const merchant = parseMerchant(text)
  const platform = platformFrom(text, fileName)
  const occurred = parseOccurredAt(text, fallback)
  const confidence = Math.min(1,
    (amount !== null ? 0.55 : 0)
    + (merchant ? 0.2 : 0)
    + (occurred.exact ? 0.15 : 0)
    + (platform !== '其他' ? 0.1 : 0),
  )

  return {
    amount,
    merchant,
    category: guessCategory(merchant),
    platform,
    expenseScope: '公司',
    occurredAt: occurred.value,
    confidence,
  }
}
