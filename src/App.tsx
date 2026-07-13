import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BarChart3,
  BookOpen,
  CalendarRange,
  CalendarDays,
  Check,
  ChevronDown,
  CircleAlert,
  ClipboardPaste,
  FileDown,
  FilterX,
  Images,
  Receipt,
  RotateCw,
  ScanLine,
  Search,
  ShieldCheck,
  Trash2,
  WalletCards,
  X,
} from 'lucide-react'
import { recognizePaymentScreenshot, stopOcr } from './lib/ocr'
import { parsePaymentText } from './lib/parser'
import { countActiveFilters, filterTransactions, summarizeTransactions, type DateFilterPreset, type LedgerFilters, type LedgerStats } from './lib/ledger'
import { clearReceiptImages, deleteReceiptImage, getReceiptImage, saveReceiptImage } from './lib/imageStore'
import { exportCsv, hashFile, loadTransactions, saveTransactions } from './lib/storage'
import { CATEGORIES, EXPENSE_SCOPES, PLATFORMS, type Category, type ExpenseScope, type ParsedPayment, type Platform, type QueueItem, type Transaction } from './types'

type Page = 'inbox' | 'ledger' | 'insights'

const money = (value: number) => new Intl.NumberFormat('zh-CN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}).format(value)

const shortDate = (value: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

const dateTime = (value: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

const todayText = () => {
  const now = new Date()
  return new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(now)
}

const emptyParsed = (file: File): ParsedPayment => parsePaymentText('', file.name, new Date(file.lastModified || Date.now()))

const clipboardFile = (blob: Blob, index: number) => {
  const extension = blob.type === 'image/jpeg' ? 'jpg' : blob.type.split('/')[1]?.replace('+xml', '') || 'png'
  const now = new Date()
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join('')
  return new File([blob], `粘贴截图-${stamp}-${index + 1}.${extension}`, {
    type: blob.type || 'image/png',
    lastModified: now.getTime(),
  })
}

const categoryTone: Record<Category, string> = {
  餐饮: '#d8583c',
  交通: '#2d6c64',
  采购: '#b17736',
  订阅: '#4b7391',
  日常: '#74804c',
  其他: '#8a867c',
}

function App() {
  const [page, setPage] = useState<Page>('inbox')
  const [transactions, setTransactions] = useState<Transaction[]>(loadTransactions)
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [dragging, setDragging] = useState(false)
  const [toast, setToast] = useState('')
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<Category | '全部'>('全部')
  const [scopeFilter, setScopeFilter] = useState<ExpenseScope | '全部'>('全部')
  const [platformFilter, setPlatformFilter] = useState<Platform | '全部'>('全部')
  const [dateFilter, setDateFilter] = useState<DateFilterPreset>('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [viewer, setViewer] = useState<{ transaction: Transaction; imageUrl: string } | null>(null)
  const processing = useRef(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const mainPanel = useRef<HTMLElement>(null)

  useEffect(() => saveTransactions(transactions), [transactions])

  useEffect(() => {
    mainPanel.current?.scrollTo({ top: 0, left: 0 })
    window.scrollTo({ top: 0, left: 0 })
  }, [page])

  useEffect(() => () => {
    if (viewer) URL.revokeObjectURL(viewer.imageUrl)
  }, [viewer])

  useEffect(() => {
    return () => {
      queue.forEach((item) => URL.revokeObjectURL(item.previewUrl))
      void stopOcr()
    }
    // Object URLs are intentionally cleaned only when the app closes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 2600)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    if (processing.current) return
    const next = queue.find((item) => item.status === 'queued')
    if (!next) return

    processing.current = true
    setQueue((items) => items.map((item) => item.id === next.id
      ? { ...item, status: 'scanning', progress: 0.02 }
      : item))

    recognizePaymentScreenshot(next.file, (progress) => {
      setQueue((items) => items.map((item) => item.id === next.id
        ? { ...item, progress: Math.max(0.04, progress) }
        : item))
    }).then((rawText) => {
      const parsed = parsePaymentText(rawText, next.file.name, new Date(next.file.lastModified || Date.now()))
      setQueue((items) => items.map((item) => item.id === next.id
        ? { ...item, status: 'ready', progress: 1, rawText, parsed }
        : item))
    }).catch((error) => {
      const timedOut = error instanceof Error && error.message === 'OCR_TIMEOUT'
      setQueue((items) => items.map((item) => item.id === next.id
        ? {
            ...item,
            status: 'error',
            progress: 0,
            error: timedOut
              ? '识别超过 75 秒，已停止；可以重试或直接手动填写'
              : '没有识别成功，可以重试或直接手动填写',
          }
        : item))
    }).finally(() => {
      processing.current = false
      setQueue((items) => [...items])
    })
  }, [queue])

  const notify = useCallback((message: string) => setToast(message), [])

  const addFiles = useCallback(async (fileList: FileList | File[]) => {
    const files = Array.from(fileList)
    const images = files.filter((file) => file.type.startsWith('image/'))
    if (!images.length) {
      notify('请选择 PNG、JPG 或 WebP 截图')
      return
    }

    const queuedHashes = new Set(queue.map((item) => item.sourceHash))
    const transactionByHash = new Map(transactions.map((item) => [item.sourceHash, item]))
    const additions: QueueItem[] = []
    let duplicateCount = 0
    let restoredCount = 0

    for (const file of images) {
      const sourceHash = await hashFile(file)
      if (queuedHashes.has(sourceHash)) {
        duplicateCount += 1
        continue
      }
      if (transactionByHash.has(sourceHash)) {
        duplicateCount += 1
        try {
          if (!await getReceiptImage(sourceHash)) {
            await saveReceiptImage(sourceHash, file)
            restoredCount += 1
          }
        } catch {
          // The existing bookkeeping record remains usable even if media recovery fails.
        }
        continue
      }
      queuedHashes.add(sourceHash)
      additions.push({
        id: crypto.randomUUID(),
        file,
        previewUrl: URL.createObjectURL(file),
        sourceHash,
        sourceName: file.name,
        status: 'queued',
        progress: 0,
        parsed: emptyParsed(file),
        rawText: '',
      })
    }

    if (additions.length) {
      setQueue((items) => [...items, ...additions])
      notify(`已接收 ${additions.length} 张截图，正在逐张识别${restoredCount ? `；另补存 ${restoredCount} 张旧账原图` : ''}`)
    } else if (restoredCount) {
      notify(`已为 ${restoredCount} 笔旧账补存原图，现在可以点击查看`)
    } else if (duplicateCount) {
      notify('这些截图已经入账或正在识别')
    }
  }, [notify, queue, transactions])

  const readClipboard = useCallback(async () => {
    if (!navigator.clipboard?.read) {
      notify('请直接按 ⌘V 粘贴截图')
      return
    }
    try {
      const items = await navigator.clipboard.read()
      const images: File[] = []
      for (const item of items) {
        const imageType = item.types.find((type) => type.startsWith('image/'))
        if (!imageType) continue
        images.push(clipboardFile(await item.getType(imageType), images.length))
      }
      if (!images.length) {
        notify('剪贴板里没有图片，先复制一张付款截图')
        return
      }
      await addFiles(images)
    } catch {
      notify('读取被系统拦截了，请直接按 ⌘V 粘贴')
    }
  }, [addFiles, notify])

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const imageBlobs = Array.from(event.clipboardData?.items ?? [])
        .filter((item) => item.type.startsWith('image/'))
        .map((item) => item.getAsFile())
        .filter((file): file is File => file !== null)
      if (!imageBlobs.length) return
      event.preventDefault()
      void addFiles(imageBlobs.map((blob, index) => clipboardFile(blob, index)))
    }
    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [addFiles])

  const patchQueueItem = (id: string, patch: Partial<QueueItem>) => {
    setQueue((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item))
  }

  const patchParsed = (id: string, patch: Partial<ParsedPayment>) => {
    setQueue((items) => items.map((item) => item.id === id
      ? { ...item, parsed: { ...item.parsed, ...patch } }
      : item))
  }

  const removeQueueItem = (id: string) => {
    setQueue((items) => {
      const target = items.find((item) => item.id === id)
      if (target) URL.revokeObjectURL(target.previewUrl)
      return items.filter((item) => item.id !== id)
    })
  }

  const retryItem = (id: string) => {
    patchQueueItem(id, { status: 'queued', error: undefined, progress: 0 })
  }

  const itemIsValid = (item: QueueItem) =>
    item.status === 'ready' && item.parsed.amount !== null && item.parsed.amount > 0 && item.parsed.merchant.trim().length > 0

  const commitItems = async (items: QueueItem[]) => {
    const valid = items.filter(itemIsValid)
    if (!valid.length) {
      notify('请先补全金额和商户名称')
      return
    }
    try {
      await Promise.all(valid.map((item) => saveReceiptImage(item.sourceHash, item.file)))
    } catch {
      notify('原截图保存失败，这批账暂未入账，请重试')
      return
    }
    const now = new Date().toISOString()
    const additions: Transaction[] = valid.map((item) => ({
      id: crypto.randomUUID(),
      amount: item.parsed.amount!,
      merchant: item.parsed.merchant.trim(),
      category: item.parsed.category,
      platform: item.parsed.platform,
      expenseScope: item.parsed.expenseScope,
      occurredAt: item.parsed.occurredAt,
      note: '',
      addedAt: now,
      sourceHash: item.sourceHash,
      sourceName: item.sourceName,
      rawText: item.rawText,
    }))
    setTransactions((current) => [...additions, ...current])
    valid.forEach((item) => URL.revokeObjectURL(item.previewUrl))
    const ids = new Set(valid.map((item) => item.id))
    setQueue((current) => current.filter((item) => !ids.has(item.id)))
    notify(`已入账 ${valid.length} 笔，共 ¥${money(additions.reduce((sum, item) => sum + item.amount, 0))}`)
  }

  const ledgerFilters: LedgerFilters = useMemo(() => ({
    search,
    category: categoryFilter,
    scope: scopeFilter,
    platform: platformFilter,
    datePreset: dateFilter,
    dateFrom,
    dateTo,
  }), [categoryFilter, dateFilter, dateFrom, dateTo, platformFilter, scopeFilter, search])

  const filteredTransactions = useMemo(
    () => filterTransactions(transactions, ledgerFilters),
    [ledgerFilters, transactions],
  )
  const filteredStats = useMemo(() => summarizeTransactions(filteredTransactions), [filteredTransactions])
  const activeFilterCount = useMemo(() => countActiveFilters(ledgerFilters), [ledgerFilters])

  const resetLedgerFilters = () => {
    setSearch('')
    setCategoryFilter('全部')
    setScopeFilter('全部')
    setPlatformFilter('全部')
    setDateFilter('all')
    setDateFrom('')
    setDateTo('')
  }

  const monthStats = useMemo(() => {
    const now = new Date()
    const current = transactions.filter((item) => {
      const date = new Date(item.occurredAt)
      return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth()
    })
    const byCategory = new Map<Category, number>()
    current.forEach((item) => byCategory.set(item.category, (byCategory.get(item.category) ?? 0) + item.amount))
    const top = [...byCategory.entries()].sort((a, b) => b[1] - a[1])[0]
    return {
      total: current.reduce((sum, item) => sum + item.amount, 0),
      companyTotal: current.filter((item) => item.expenseScope === '公司').reduce((sum, item) => sum + item.amount, 0),
      personalTotal: current.filter((item) => item.expenseScope === '个人').reduce((sum, item) => sum + item.amount, 0),
      count: current.length,
      topCategory: top?.[0] ?? '—',
      topAmount: top?.[1] ?? 0,
    }
  }, [transactions])

  const readyCount = queue.filter(itemIsValid).length

  const openReceiptImage = async (transaction: Transaction) => {
    try {
      const image = await getReceiptImage(transaction.sourceHash)
      if (!image) {
        notify('这笔旧账没有留存原图；重新粘贴同一张截图即可补存')
        return
      }
      setViewer((current) => {
        if (current) URL.revokeObjectURL(current.imageUrl)
        return { transaction, imageUrl: URL.createObjectURL(image) }
      })
    } catch {
      notify('原图读取失败，请稍后再试')
    }
  }

  const deleteTransaction = async (id: string) => {
    const target = transactions.find((item) => item.id === id)
    if (!target) return
    try {
      await deleteReceiptImage(target.sourceHash)
    } catch {
      // Still allow deleting the bookkeeping record if its image is already unavailable.
    }
    if (viewer?.transaction.id === id) setViewer(null)
    setTransactions((items) => items.filter((item) => item.id !== id))
  }

  const clearAllTransactions = async () => {
    if (!transactions.length || !window.confirm('确定清空全部账目和本地原图吗？此操作不能撤销。')) return
    try {
      await clearReceiptImages()
    } finally {
      setViewer(null)
      setTransactions([])
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="window-drag" />
        <div className="brand-mark" aria-label="截图记账">
          <span>账</span>
          <div><strong>截图记账</strong><small>本地账簿</small></div>
        </div>

        <nav className="nav-list" aria-label="主导航">
          <button className={page === 'inbox' ? 'active' : ''} onClick={() => setPage('inbox')}>
            <Receipt size={19} /><span>截图入账</span>{queue.length > 0 && <em>{queue.length}</em>}
          </button>
          <button className={page === 'ledger' ? 'active' : ''} onClick={() => setPage('ledger')}>
            <BookOpen size={19} /><span>全部账目</span>
          </button>
          <button className={page === 'insights' ? 'active' : ''} onClick={() => setPage('insights')}>
            <BarChart3 size={19} /><span>花费小结</span>
          </button>
        </nav>

        <div className="privacy-note">
          <ShieldCheck size={18} />
          <div><strong>截图保存在本机</strong><span>原图与账目都不会上传</span></div>
        </div>

        <div className="month-tally">
          <span>本月总花费</span>
          <strong><small>¥</small>{money(monthStats.total)}</strong>
          <i>公司 ¥{money(monthStats.companyTotal)} · 个人 ¥{money(monthStats.personalTotal)}</i>
        </div>
      </aside>

      <main ref={mainPanel} className="main-panel">
        <header className="topbar window-drag">
          <span><CalendarDays size={16} />{todayText()}</span>
          <div className="top-actions no-drag">
            <button className="paste-top-button" onClick={() => void readClipboard()}><ClipboardPaste size={16} />粘贴截图 <kbd>⌘V</kbd></button>
            <button className="mobile-upload-button" onClick={() => fileInput.current?.click()}><Images size={16} />选择截图</button>
            <button className="icon-button" onClick={() => transactions.length ? exportCsv(transactions) : notify('还没有账目可导出')} title="导出 CSV">
              <FileDown size={18} />
            </button>
          </div>
        </header>

        <input
          ref={fileInput}
          className="visually-hidden"
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp"
          onChange={(event) => {
            if (event.target.files) void addFiles(event.target.files)
            event.target.value = ''
          }}
        />

        {page === 'inbox' && (
          <InboxPage
            queue={queue}
            readyCount={readyCount}
            monthStats={monthStats}
            dragging={dragging}
            setDragging={setDragging}
            onFiles={addFiles}
            readClipboard={readClipboard}
            openPicker={() => fileInput.current?.click()}
            patchParsed={patchParsed}
            removeItem={removeQueueItem}
            retryItem={retryItem}
            manualItem={(id) => patchQueueItem(id, { status: 'ready', error: undefined })}
            commitItems={commitItems}
          />
        )}
        {page === 'ledger' && (
          <LedgerPage
            transactions={transactions}
            filtered={filteredTransactions}
            search={search}
            setSearch={setSearch}
            categoryFilter={categoryFilter}
            setCategoryFilter={setCategoryFilter}
            scopeFilter={scopeFilter}
            setScopeFilter={setScopeFilter}
            platformFilter={platformFilter}
            setPlatformFilter={setPlatformFilter}
            dateFilter={dateFilter}
            setDateFilter={setDateFilter}
            dateFrom={dateFrom}
            setDateFrom={setDateFrom}
            dateTo={dateTo}
            setDateTo={setDateTo}
            stats={filteredStats}
            activeFilterCount={activeFilterCount}
            resetFilters={resetLedgerFilters}
            onView={(item) => void openReceiptImage(item)}
            onDelete={(id) => void deleteTransaction(id)}
            onExport={() => filteredTransactions.length ? exportCsv(filteredTransactions) : notify('当前筛选结果为空')}
            onClear={() => void clearAllTransactions()}
            goUpload={() => setPage('inbox')}
          />
        )}
        {page === 'insights' && <InsightsPage transactions={transactions} monthStats={monthStats} goUpload={() => setPage('inbox')} />}
      </main>

      {viewer && <ReceiptViewer viewer={viewer} onClose={() => setViewer(null)} />}
      {toast && <div className="toast"><Check size={17} />{toast}</div>}
    </div>
  )
}

type MonthStats = { total: number; companyTotal: number; personalTotal: number; count: number; topCategory: Category | '—'; topAmount: number }

type InboxProps = {
  queue: QueueItem[]
  readyCount: number
  monthStats: MonthStats
  dragging: boolean
  setDragging: (value: boolean) => void
  onFiles: (files: FileList | File[]) => Promise<void>
  readClipboard: () => Promise<void>
  openPicker: () => void
  patchParsed: (id: string, patch: Partial<ParsedPayment>) => void
  removeItem: (id: string) => void
  retryItem: (id: string) => void
  manualItem: (id: string) => void
  commitItems: (items: QueueItem[]) => Promise<void>
}

function InboxPage(props: InboxProps) {
  const { queue, readyCount, monthStats, dragging, setDragging, onFiles, readClipboard, openPicker, patchParsed, removeItem, retryItem, manualItem, commitItems } = props
  return (
    <div className="page-content inbox-page">
      <section className="hero-row">
        <div>
          <span className="eyebrow">粘贴截图，分清公司与个人</span>
          <h1>截图粘进来，<br />点一下归属就好。</h1>
        </div>
        <div className="quick-stats">
          <div><span>本月合计</span><strong>¥{money(monthStats.total)}</strong><small>{monthStats.count} 笔</small></div>
          <div><span>公司花费</span><strong>¥{money(monthStats.companyTotal)}</strong></div>
          <div><span>个人花费</span><strong>¥{money(monthStats.personalTotal)}</strong></div>
        </div>
      </section>

      <section
        className={`drop-zone ${dragging ? 'dragging' : ''} ${queue.length ? 'compact' : ''}`}
        onDragEnter={(event) => { event.preventDefault(); setDragging(true) }}
        onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
        onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false) }}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          void onFiles(event.dataTransfer.files)
        }}
      >
        <div className="drop-illustration" aria-hidden="true">
          <div className="receipt-sheet back" />
          <div className="receipt-sheet front"><span>¥</span><i /><i /><i /></div>
          <div className="scan-corners"><b /><b /><b /><b /></div>
        </div>
        <div className="drop-copy">
          <span className="drop-kicker"><ScanLine size={17} /><span className="desktop-only"> 不用保存文件 · 复制后直接粘贴</span><span className="mobile-only">从相册选择 · 本机识别</span></span>
          <h2><span className="desktop-only">{queue.length ? '继续按 ⌘V，想贴几张都可以' : '直接按 ⌘V，粘贴付款截图'}</span><span className="mobile-only">{queue.length ? '继续选择截图' : '从相册选择付款截图'}</span></h2>
          <p>自动识别内容，你只要确认“公司”或“个人”</p>
          <div className="drop-actions">
            <button className="paste-button" onClick={() => void readClipboard()}><ClipboardPaste size={18} />粘贴剪贴板 <kbd>⌘V</kbd></button>
            <button className="file-fallback" onClick={openPicker}><Images size={16} />选择截图</button>
          </div>
        </div>
        <div className="local-stamp"><ShieldCheck size={14} /><span className="desktop-only">剪贴板直达 · 本地识别</span><span className="mobile-only">原图和账目只保存在这台设备</span></div>
      </section>

      {queue.length > 0 && (
        <section className="review-section">
          <div className="section-heading">
            <div><span>待确认归属</span><h2>{queue.length} 张截图</h2></div>
            <div className="review-actions">
              <span>{queue.some((item) => item.status === 'scanning' || item.status === 'queued') ? '正在识别，请稍候…' : `${readyCount} 笔可以入账`}</span>
              <button disabled={!readyCount} onClick={() => void commitItems(queue)}><Check size={17} />全部确认入账</button>
            </div>
          </div>
          <div className="review-list">
            {queue.map((item, index) => (
              <ReviewCard
                key={item.id}
                item={item}
                index={index}
                patchParsed={patchParsed}
                removeItem={removeItem}
                retryItem={retryItem}
                manualItem={manualItem}
                commit={() => void commitItems([item])}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function ReviewCard({ item, index, patchParsed, removeItem, retryItem, manualItem, commit }: {
  item: QueueItem
  index: number
  patchParsed: (id: string, patch: Partial<ParsedPayment>) => void
  removeItem: (id: string) => void
  retryItem: (id: string) => void
  manualItem: (id: string) => void
  commit: () => void
}) {
  const isScanning = item.status === 'queued' || item.status === 'scanning'
  const valid = item.status === 'ready' && item.parsed.amount !== null && item.parsed.amount > 0 && item.parsed.merchant.trim()
  return (
    <article className={`review-card ${isScanning ? 'is-scanning' : ''}`} style={{ animationDelay: `${index * 55}ms` }}>
      <div className="screenshot-preview">
        <img src={item.previewUrl} alt={`${item.sourceName} 预览`} />
        {isScanning && <div className="scan-line" />}
        <span>{item.status === 'ready' ? `${Math.round(item.parsed.confidence * 100)}%` : `${Math.round(item.progress * 100)}%`}</span>
      </div>
      <div className="review-body">
        <div className="review-meta">
          <span className={`status-pill ${item.status}`}>
            {item.status === 'queued' && '等待识别'}
            {item.status === 'scanning' && '正在读图'}
            {item.status === 'ready' && (item.parsed.confidence >= 0.75 ? '识别完成' : '请检查标红项')}
            {item.status === 'error' && '识别失败'}
          </span>
          <small title={item.sourceName}>{item.sourceName}</small>
          <div className="scope-switch" aria-label="花费归属">
            {EXPENSE_SCOPES.map((scope) => (
              <button
                key={scope}
                className={item.parsed.expenseScope === scope ? 'active' : ''}
                onClick={() => patchParsed(item.id, { expenseScope: scope })}
              >{scope}</button>
            ))}
          </div>
        </div>
        {item.status === 'error' ? (
          <div className="error-state">
            <CircleAlert size={20} /><div><strong>{item.error}</strong><span>也可以删除后换一张更清晰的截图</span></div>
            <div className="error-buttons">
              <button className="manual-button" onClick={() => manualItem(item.id)}>手动填写</button>
              <button onClick={() => retryItem(item.id)}><RotateCw size={15} />重试</button>
            </div>
          </div>
        ) : (
          <div className="field-grid">
            <label className={!isScanning && !item.parsed.merchant ? 'needs-attention' : ''}>
              <span>商户 / 收款方</span>
              <input
                value={item.parsed.merchant}
                disabled={isScanning}
                placeholder={isScanning ? '正在识别…' : '请填写商户名称'}
                onChange={(event) => patchParsed(item.id, { merchant: event.target.value })}
              />
            </label>
            <label className={!isScanning && !item.parsed.amount ? 'needs-attention' : ''}>
              <span>支付金额</span>
              <div className="amount-input"><b>¥</b><input
                value={item.parsed.amount ?? ''}
                disabled={isScanning}
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                onChange={(event) => patchParsed(item.id, { amount: event.target.value === '' ? null : Number(event.target.value) })}
              /></div>
            </label>
            <label>
              <span>分类</span>
              <div className="select-wrap"><select disabled={isScanning} value={item.parsed.category} onChange={(event) => patchParsed(item.id, { category: event.target.value as Category })}>
                {CATEGORIES.map((category) => <option key={category}>{category}</option>)}
              </select><ChevronDown size={15} /></div>
            </label>
            <label>
              <span>支付方式</span>
              <div className="select-wrap"><select disabled={isScanning} value={item.parsed.platform} onChange={(event) => patchParsed(item.id, { platform: event.target.value as Platform })}>
                {PLATFORMS.map((platform) => <option key={platform}>{platform}</option>)}
              </select><ChevronDown size={15} /></div>
            </label>
            <label className="date-field">
              <span>付款时间</span>
              <input disabled={isScanning} type="datetime-local" value={item.parsed.occurredAt} onChange={(event) => patchParsed(item.id, { occurredAt: event.target.value })} />
            </label>
          </div>
        )}
        {isScanning && <div className="progress-track"><i style={{ width: `${Math.max(4, item.progress * 100)}%` }} /></div>}
      </div>
      <div className="card-actions">
        <button className="remove-button" onClick={() => removeItem(item.id)} title="移除"><X size={18} /></button>
        <button className="commit-button" disabled={!valid} onClick={commit}><Check size={17} />入账</button>
      </div>
    </article>
  )
}

function LedgerPage({
  transactions,
  filtered,
  search,
  setSearch,
  categoryFilter,
  setCategoryFilter,
  scopeFilter,
  setScopeFilter,
  platformFilter,
  setPlatformFilter,
  dateFilter,
  setDateFilter,
  dateFrom,
  setDateFrom,
  dateTo,
  setDateTo,
  stats,
  activeFilterCount,
  resetFilters,
  onView,
  onDelete,
  onExport,
  onClear,
  goUpload,
}: {
  transactions: Transaction[]
  filtered: Transaction[]
  search: string
  setSearch: (value: string) => void
  categoryFilter: Category | '全部'
  setCategoryFilter: (value: Category | '全部') => void
  scopeFilter: ExpenseScope | '全部'
  setScopeFilter: (value: ExpenseScope | '全部') => void
  platformFilter: Platform | '全部'
  setPlatformFilter: (value: Platform | '全部') => void
  dateFilter: DateFilterPreset
  setDateFilter: (value: DateFilterPreset) => void
  dateFrom: string
  setDateFrom: (value: string) => void
  dateTo: string
  setDateTo: (value: string) => void
  stats: LedgerStats
  activeFilterCount: number
  resetFilters: () => void
  onView: (transaction: Transaction) => void
  onDelete: (id: string) => void
  onExport: () => void
  onClear: () => void
  goUpload: () => void
}) {
  const dateOptions: Array<{ value: DateFilterPreset; label: string }> = [
    { value: 'all', label: '全部时间' },
    { value: 'thisMonth', label: '本月' },
    { value: 'lastMonth', label: '上月' },
    { value: 'last30Days', label: '近 30 天' },
    { value: 'custom', label: '自定义' },
  ]

  return (
    <div className="page-content ledger-page">
      <section className="page-title-row">
        <div><span className="eyebrow">清楚，每一笔</span><h1>全部账目</h1><p>每笔都标清公司或个人，点击账目可以查看本机原图。</p></div>
        <div className="title-actions"><button onClick={onExport}><FileDown size={17} />导出{filtered.length ? ` ${filtered.length} 笔` : ''}</button><button className="danger-ghost" onClick={onClear}><Trash2 size={17} />清空</button></div>
      </section>

      <section className="ledger-card">
        <div className="ledger-stats" aria-live="polite">
          <div className="ledger-total">
            <span>{activeFilterCount ? '筛选支出' : '全部支出'}</span>
            <strong><small>¥</small>{money(stats.total)}</strong>
          </div>
          <div><span>账目笔数</span><strong>{stats.count}<small> 笔</small></strong></div>
          <div><span>公司支出</span><strong>¥{money(stats.companyTotal)}</strong></div>
          <div><span>个人支出</span><strong>¥{money(stats.personalTotal)}</strong></div>
          <div><span>平均每笔</span><strong>¥{money(stats.average)}</strong></div>
        </div>
        <div className="ledger-toolbar">
          <div className="ledger-primary-filters">
            <div className="scope-filter" aria-label="按归属筛选">
              {(['全部', ...EXPENSE_SCOPES] as const).map((scope) => (
                <button key={scope} aria-pressed={scopeFilter === scope} className={scopeFilter === scope ? 'active' : ''} onClick={() => setScopeFilter(scope)}>{scope}</button>
              ))}
            </div>
            <label className="search-box"><Search size={17} /><span className="visually-hidden">搜索账目</span><input value={search} placeholder="搜索商户、分类或支付方式" onChange={(event) => setSearch(event.target.value)} />{search && <button type="button" onClick={() => setSearch('')} aria-label="清空搜索"><X size={14} /></button>}</label>
          </div>
          <div className="detail-filters">
            <div className="date-filter-group">
              <span><CalendarRange size={15} />时间</span>
              <div className="date-preset-tabs">
                {dateOptions.map((option) => (
                  <button key={option.value} aria-pressed={dateFilter === option.value} className={dateFilter === option.value ? 'active' : ''} onClick={() => setDateFilter(option.value)}>{option.label}</button>
                ))}
              </div>
            </div>
            <label className="platform-filter">
              <span>支付方式</span>
              <div className="select-wrap"><select value={platformFilter} onChange={(event) => setPlatformFilter(event.target.value as Platform | '全部')}>
                <option value="全部">全部方式</option>
                {PLATFORMS.map((platform) => <option key={platform} value={platform}>{platform}</option>)}
              </select><ChevronDown size={15} /></div>
            </label>
            {activeFilterCount > 0 && filtered.length > 0 && <button className="reset-filters" onClick={resetFilters}><FilterX size={15} />重置 {activeFilterCount} 项</button>}
          </div>
          {dateFilter === 'custom' && (
            <div className="custom-date-range">
              <label><span>开始日期</span><input type="date" value={dateFrom} max={dateTo || undefined} onChange={(event) => setDateFrom(event.target.value)} /></label>
              <i>至</i>
              <label><span>结束日期</span><input type="date" value={dateTo} min={dateFrom || undefined} onChange={(event) => setDateTo(event.target.value)} /></label>
            </div>
          )}
          <div className="category-tabs">
            {(['全部', ...CATEGORIES] as const).map((category) => (
              <button key={category} aria-pressed={categoryFilter === category} className={categoryFilter === category ? 'active' : ''} onClick={() => setCategoryFilter(category)}>{category}</button>
            ))}
          </div>
        </div>
        {filtered.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>日期</th><th>商户 / 收款方</th><th>归属</th><th>分类</th><th>支付方式</th><th className="amount-cell">支出</th><th /></tr></thead>
              <tbody>{filtered.map((item) => (
                <tr
                  key={item.id}
                  className="receipt-row"
                  tabIndex={0}
                  onClick={() => onView(item)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      onView(item)
                    }
                  }}
                >
                  <td><strong>{shortDate(item.occurredAt)}</strong><small>{item.occurredAt.slice(11, 16)}</small></td>
                  <td><span className="merchant-avatar" style={{ backgroundColor: categoryTone[item.category] }}>{item.merchant.slice(0, 1)}</span><div><strong>{item.merchant}</strong><small className="view-receipt-hint" title={item.sourceName}><Images size={11} />点击查看原截图</small></div></td>
                  <td><span className={`scope-badge ${item.expenseScope === '公司' ? 'company' : 'personal'}`}>{item.expenseScope}</span></td>
                  <td><span className="category-dot" style={{ backgroundColor: categoryTone[item.category] }} />{item.category}</td>
                  <td>{item.platform}</td>
                  <td className="amount-cell"><strong>− ¥{money(item.amount)}</strong></td>
                  <td><button className="row-delete" onClick={(event) => { event.stopPropagation(); onDelete(item.id) }} title="删除这笔及原图"><Trash2 size={16} /></button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : (
          <EmptyLedger hasTransactions={transactions.length > 0} goUpload={goUpload} resetFilters={resetFilters} />
        )}
      </section>
    </div>
  )
}

function ReceiptViewer({ viewer, onClose }: {
  viewer: { transaction: Transaction; imageUrl: string }
  onClose: () => void
}) {
  const { transaction, imageUrl } = viewer
  return (
    <div className="receipt-viewer-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose() }}>
      <section className="receipt-viewer" role="dialog" aria-modal="true" aria-label={`${transaction.merchant} 原截图`}>
        <header>
          <div>
            <span className={`scope-badge ${transaction.expenseScope === '公司' ? 'company' : 'personal'}`}>{transaction.expenseScope}</span>
            <h2>{transaction.merchant}</h2>
            <p>{dateTime(transaction.occurredAt)} · {transaction.platform}</p>
          </div>
          <strong>¥{money(transaction.amount)}</strong>
          <button onClick={onClose} aria-label="关闭原图"><X size={20} /></button>
        </header>
        <div className="receipt-image-stage">
          <img src={imageUrl} alt={`${transaction.merchant} 付款原截图`} />
        </div>
        <footer><ShieldCheck size={14} />原图保存在这台电脑上，没有上传到网络</footer>
      </section>
    </div>
  )
}

function EmptyLedger({ hasTransactions, goUpload, resetFilters }: { hasTransactions: boolean; goUpload: () => void; resetFilters: () => void }) {
  return (
    <div className="empty-ledger">
      <div className="empty-book"><i /><i /><span>账</span></div>
      <h2>{hasTransactions ? '没有符合条件的账目' : '账簿还是空的'}</h2>
      <p>{hasTransactions ? '换个关键词、归属或分类试试看。' : '选择第一张付款截图，再点一下公司或个人。'}</p>
      {hasTransactions
        ? <button onClick={resetFilters}><FilterX size={17} />重置筛选</button>
        : <button onClick={goUpload}><Images size={17} />去选择截图</button>}
    </div>
  )
}

function InsightsPage({ transactions, monthStats, goUpload }: {
  transactions: Transaction[]
  monthStats: MonthStats
  goUpload: () => void
}) {
  const now = new Date()
  const monthItems = transactions.filter((item) => {
    const date = new Date(item.occurredAt)
    return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth()
  })
  const categories = CATEGORIES.map((category) => ({
    category,
    amount: monthItems.filter((item) => item.category === category).reduce((sum, item) => sum + item.amount, 0),
  })).filter((item) => item.amount > 0).sort((a, b) => b.amount - a.amount)
  const maxCategory = Math.max(...categories.map((item) => item.amount), 1)

  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date()
    date.setHours(0, 0, 0, 0)
    date.setDate(date.getDate() - (6 - index))
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    return {
      key,
      label: index === 6 ? '今天' : `${date.getMonth() + 1}/${date.getDate()}`,
      amount: transactions.filter((item) => item.occurredAt.startsWith(key)).reduce((sum, item) => sum + item.amount, 0),
    }
  })
  const maxDay = Math.max(...days.map((day) => day.amount), 1)
  const average = monthStats.count ? monthStats.total / monthStats.count : 0

  return (
    <div className="page-content insights-page">
      <section className="page-title-row">
        <div><span className="eyebrow">公司与个人，分开看</span><h1>花费小结</h1><p>{now.getFullYear()} 年 {now.getMonth() + 1} 月</p></div>
      </section>
      {transactions.length ? (
        <>
          <section className="insight-summary">
            <div className="big-number"><span>本月总支出</span><strong><small>¥</small>{money(monthStats.total)}</strong><p>共 {monthStats.count} 笔 · 平均每笔 ¥{money(average)}</p></div>
            <div className="summary-note"><WalletCards size={22} /><span>花费归属</span><strong>公司 ¥{money(monthStats.companyTotal)}</strong><small>个人 ¥{money(monthStats.personalTotal)}</small></div>
          </section>
          <div className="insight-grid">
            <section className="chart-card category-chart">
              <div className="chart-heading"><div><span>分类构成</span><h2>这个月的钱花在哪</h2></div><em>{categories.length} 个分类</em></div>
              <div className="category-bars">
                {categories.length ? categories.map((item) => (
                  <div className="category-bar" key={item.category}>
                    <div><span><i style={{ backgroundColor: categoryTone[item.category] }} />{item.category}</span><strong>¥{money(item.amount)}</strong></div>
                    <div className="bar-track"><i style={{ width: `${(item.amount / maxCategory) * 100}%`, backgroundColor: categoryTone[item.category] }} /></div>
                  </div>
                )) : <p className="chart-empty">本月还没有消费记录</p>}
              </div>
            </section>
            <section className="chart-card week-chart">
              <div className="chart-heading"><div><span>最近 7 天</span><h2>每日支出</h2></div></div>
              <div className="vertical-bars">
                {days.map((day) => (
                  <div key={day.key} className="vertical-bar">
                    <span>{day.amount > 0 ? `¥${Math.round(day.amount)}` : ''}</span>
                    <div><i style={{ height: `${Math.max(day.amount ? 10 : 2, (day.amount / maxDay) * 100)}%` }} /></div>
                    <small>{day.label}</small>
                  </div>
                ))}
              </div>
            </section>
          </div>
          <section className="latest-card">
            <div className="chart-heading"><div><span>最近记录</span><h2>刚刚记下的账</h2></div></div>
            <div className="latest-list">{[...transactions].sort((a, b) => b.addedAt.localeCompare(a.addedAt)).slice(0, 4).map((item) => (
              <div key={item.id}><span className="merchant-avatar" style={{ backgroundColor: categoryTone[item.category] }}>{item.merchant.slice(0, 1)}</span><div><strong>{item.merchant}</strong><small>{item.expenseScope} · {dateTime(item.occurredAt)} · {item.category}</small></div><b>− ¥{money(item.amount)}</b></div>
            ))}</div>
          </section>
        </>
      ) : (
        <section className="empty-insights"><BarChart3 size={34} /><h2>记几笔账后，这里会长出图表</h2><p>明天把付款截图直接粘进来，就能看见消费分类和每日趋势。</p><button onClick={goUpload}><ClipboardPaste size={17} />去粘贴截图</button></section>
      )}
    </div>
  )
}

export default App
