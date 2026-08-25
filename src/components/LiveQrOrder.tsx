'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { io } from 'socket.io-client'
import { type Locale, t } from '@/lib/i18n'

type Text = Record<Locale, string>
type Choice = { id: string; names: Text }
type Addon = Choice & { priceExtra: number }
type MenuItem = { id: string; category: { id: string; names: Text }; names: Text; description: Text; price: number; variants: Choice[]; noteOptions: Choice[]; addons: Addon[] }
type CartLine = { key: string; itemId: string; quantity: number; variant?: string; noteOptions: string[]; addonIds: string[]; note?: string }
type CompletedOrder = { number: number; table: string; total: number; count: number }

const formatPrice = (amount: number, locale: Locale) => new Intl.NumberFormat(locale === 'zh-TW' ? 'zh-TW' : locale, { style: 'currency', currency: 'TWD', maximumFractionDigits: 0 }).format(amount)
const localeStorageKey = 'mammi-order-locale-v2'
const detectLocale = (): Locale => { if (typeof navigator === 'undefined') return 'zh-TW'; const saved = window.localStorage.getItem(localeStorageKey); if (saved === 'vi' || saved === 'en' || saved === 'zh-TW') return saved; const language = navigator.language.toLowerCase(); if (language.startsWith('zh')) return 'zh-TW'; if (language.startsWith('en')) return 'en'; if (language.startsWith('vi')) return 'vi'; return 'zh-TW' }
const createLineKey = () => typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`

export default function LiveQrOrder({ qrToken }: { qrToken: string }) {
  const [locale, setLocale] = useState<Locale>('zh-TW')
  const [localeReady, setLocaleReady] = useState(false)
  const [category, setCategory] = useState('all')
  const [items, setItems] = useState<MenuItem[]>([])
  const [table, setTable] = useState('')
  const [realtimeToken, setRealtimeToken] = useState('')
  const [cartToken, setCartToken] = useState('')
  const [cart, setCart] = useState<CartLine[]>([])
  const [selected, setSelected] = useState<MenuItem | null>(null)
  const [quantity, setQuantity] = useState(1)
  const [variant, setVariant] = useState('')
  const [noteOptions, setNoteOptions] = useState<string[]>([])
  const [addonIds, setAddonIds] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [sessionUnavailable, setSessionUnavailable] = useState(false)
  const [sending, setSending] = useState(false)
  const [completed, setCompleted] = useState<CompletedOrder | null>(null)
  const [cartOpen, setCartOpen] = useState(false)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const menuGridRef = useRef<HTMLElement>(null)

  useEffect(() => { setLocale(detectLocale()); setLocaleReady(true) }, [])
  useEffect(() => { document.body.style.overflow = cartOpen ? 'hidden' : ''; return () => { document.body.style.overflow = '' } }, [cartOpen])
  useEffect(() => {
    if (!sessionUnavailable) return
    const previousHtmlOverflow = document.documentElement.style.overflow
    const previousBodyOverflow = document.body.style.overflow
    document.documentElement.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'
    return () => {
      document.documentElement.style.overflow = previousHtmlOverflow
      document.body.style.overflow = previousBodyOverflow
    }
  }, [sessionUnavailable])

  const copy = t(locale)
  const base = (process.env.NEXT_PUBLIC_ORDER_API_BASE_URL || '').replace(/\/$/, '')
  const storageKey = `mammi-qr-cart:${qrToken}`
  const label = (value: Text) => value[locale] || value.vi

  const load = async () => {
    try {
      const response = await fetch(`${base}/api/public/qr/${encodeURIComponent(qrToken)}`)
      if (!response.ok) {
        const error = await response.json().catch(() => null)
        if (error?.code === 'SESSION_NOT_ACTIVE' || error?.code === 'SESSION_EXPIRED') { setSessionUnavailable(true); setFailed(false); return }
        throw new Error('QR menu unavailable')
      }
      const payload = (await response.json()).data
      setItems(payload.items)
      setTable(payload.table.code)
      setRealtimeToken(payload.realtimeToken)

      let savedCartToken = window.localStorage.getItem(storageKey)
      if (savedCartToken) {
        const saved = await fetch(`${base}/api/public/carts/${savedCartToken}`)
        if (saved.ok && (await saved.clone().json()).data.status === 'draft') {
          const savedData = (await saved.json()).data
          setCart(savedData.lines.map((line: Omit<CartLine, 'key'>) => ({ ...line, key: createLineKey() })))
        } else {
          window.localStorage.removeItem(storageKey)
          savedCartToken = null
        }
      }
      if (!savedCartToken) {
        const created = await fetch(`${base}/api/public/qr/${encodeURIComponent(qrToken)}/carts`, { method: 'POST' })
        if (!created.ok) throw new Error('Unable to create cart')
        savedCartToken = (await created.json()).data.cartToken as string
        window.localStorage.setItem(storageKey, savedCartToken)
      }
      setCartToken(savedCartToken)
      setSessionUnavailable(false)
      setFailed(false)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [qrToken])

  useEffect(() => {
    if (!realtimeToken) return
    const socket = io(base, { transports: ['websocket'], auth: { publicToken: realtimeToken, clientType: 'customer' } })
    const refresh = () => { void load() }
    for (const event of ['catalog.item.updated', 'catalog.store-item.price.updated', 'catalog.store-item.availability.updated', 'catalog.store-addon.updated', 'catalog.store-addon.availability.updated', 'catalog.changed']) socket.on(event, refresh)
    return () => { socket.disconnect() }
  }, [realtimeToken])

  useEffect(() => {
    if (!cartToken || loading || completed) return
    const lines = cart.map(({ key, ...line }) => line)
    void fetch(`${base}/api/public/carts/${cartToken}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lines }) })
  }, [cart, cartToken, completed, loading])

  const linePrice = (line: CartLine) => {
    const item = items.find((candidate) => candidate.id === line.itemId)
    return (item?.price || 0) + (item?.addons.filter((addon) => line.addonIds.includes(addon.id)).reduce((sum, addon) => sum + addon.priceExtra, 0) || 0)
  }
  const total = useMemo(() => cart.reduce((sum, line) => sum + line.quantity * linePrice(line), 0), [cart, items])
  const count = cart.reduce((sum, line) => sum + line.quantity, 0)
  const categories = useMemo(() => [...new Map(items.map((item) => [item.category.id, item.category])).values()], [items])
  const visibleItems = category === 'all' ? items : items.filter((item) => item.category.id === category)
  useEffect(() => { menuGridRef.current?.scrollTo({ top: 0, behavior: 'auto' }) }, [category])

  const openItem = (item: MenuItem, line?: CartLine) => { setSelected(item); setEditingKey(line?.key || null); setCartOpen(line ? false : cartOpen); setQuantity(line?.quantity || 1); setVariant(line?.variant || item.variants[0]?.id || ''); setNoteOptions(line?.noteOptions || []); setAddonIds(line?.addonIds || []); setNote(line?.note || '') }
  const toggle = (id: string, current: string[], setCurrent: (next: string[]) => void) => setCurrent(current.includes(id) ? current.filter((value) => value !== id) : [...current, id])
  const addToCart = () => {
    if (!selected) return
    const line = { key: editingKey || createLineKey(), itemId: selected.id, quantity, variant: variant || undefined, noteOptions: [...noteOptions], addonIds: [...addonIds], note: note.trim() || undefined }
    setCart((old) => editingKey ? old.map((current) => current.key === editingKey ? line : current) : [...old, line])
    setEditingKey(null)
    setSelected(null)
  }
  const updateQuantity = (key: string, nextQuantity: number) => setCart((old) => nextQuantity < 1 ? old.filter((line) => line.key !== key) : old.map((line) => line.key === key ? { ...line, quantity: nextQuantity } : line))
  const confirm = async () => {
    if (!cartToken || !cart.length || sending) return
    setSending(true)
    try {
      const response = await fetch(`${base}/api/public/carts/${cartToken}/confirm`, { method: 'POST' })
      if (!response.ok) {
        const error = await response.json().catch(() => null)
        if (error?.code === 'SESSION_NOT_ACTIVE' || error?.code === 'SESSION_EXPIRED') { setSessionUnavailable(true); return }
        throw new Error('Unable to confirm')
      }
      const data = (await response.json()).data
      window.localStorage.removeItem(storageKey)
      setCompleted({ number: data.number, table: data.table, total, count })
    } catch {
      setFailed(true)
    } finally {
      setSending(false)
    }
  }

  if (!localeReady) return <main className="page"><section className="card" aria-busy="true"><img className="error-logo" src="/logo.png" alt="" width="96" height="96" /></section></main>
  if (loading || failed || sessionUnavailable) return <main className={`page${sessionUnavailable ? ' session-unavailable' : ''}`}><section className="card" aria-live="polite"><img className="error-logo" src="/logo.png" alt="" width="96" height="96" /><h1>{sessionUnavailable ? copy.tableSessionUnavailable : failed ? copy.menuUnavailable : copy.qrMenuLoading}</h1><p>{sessionUnavailable ? copy.tableSessionUnavailableDescription : failed ? copy.menuUnavailableDescription : copy.qrMenuDescription}</p>{sessionUnavailable && <button className="retry-link" onClick={() => { setLoading(true); setFailed(false); setSessionUnavailable(false); void load() }}>{copy.retry}</button>}</section></main>
  if (completed) return <main className="order-shell"><section className="success-card"><div className="success-mark">✓</div><p className="eyebrow">{copy.brand}</p><h1>{copy.orderSent}</h1><strong className="order-number">#{completed.number}</strong><p>{copy.orderSummary}</p><p>{copy.table}: {completed.table} · {copy.totalItems}: {completed.count}</p><p>{copy.subtotal}: {formatPrice(completed.total, locale)}</p><p>{copy.orderSentDescription}</p></section></main>

  return <main className="order-shell"><div className="menu-sticky"><header className="menu-header"><div className="header-meta"><span className="table-badge">{copy.table} {table}</span><button className="header-cart" onClick={() => setCartOpen(true)} aria-label={copy.cart}><span aria-hidden="true">🛒</span><strong>{count}</strong></button><label className="locale-picker"><span className="sr-only">{copy.language}</span><select value={locale} onChange={(event) => { const nextLocale = event.target.value as Locale; setLocale(nextLocale); window.localStorage.setItem(localeStorageKey, nextLocale) }}><option value="vi">VI</option><option value="en">EN</option><option value="zh-TW">繁中</option></select></label></div><div className="brand-lockup"><img src="/logo.png" alt="" width="44" height="44" /><h1>{copy.brand}</h1></div><p className="header-copy">{copy.qrMenuDescription}</p></header><nav className="category-tabs" aria-label={copy.categories}><button className={category === 'all' ? 'active' : ''} onClick={() => setCategory('all')}>{copy.all}</button>{categories.map((entry) => <button key={entry.id} className={category === entry.id ? 'active' : ''} onClick={() => setCategory(entry.id)}>{label(entry.names)}</button>)}</nav></div><section ref={menuGridRef} className="menu-grid">{visibleItems.map((item) => <article className="menu-card" key={item.id}><div className="dish-art" aria-hidden="true">🍽️</div><div className="menu-card-copy"><p className="menu-name">{label(item.names)}</p><p className="menu-description">{label(item.description)}</p><div className="menu-card-footer"><strong>{formatPrice(item.price, locale)}</strong><button onClick={() => openItem(item)}>{copy.add}</button></div></div></article>)}</section><aside className="cart-dock"><button className="cart-summary" onClick={() => setCartOpen(true)}><div className="cart-heading"><div><p className="eyebrow">{copy.cart}</p><span>{count} {copy.item}</span></div><strong>{formatPrice(total, locale)}</strong></div></button>{cartOpen && <div className="cart-expanded"><div className="cart-panel-header"><div><strong>{copy.cart} · {count} {copy.item}</strong><small className="cart-total">{formatPrice(total, locale)}</small></div><button className="icon-button" onClick={() => setCartOpen(false)} aria-label={copy.cancel}>×</button></div>{cart.length === 0 ? <p className="cart-empty">{copy.cartEmptyDescription}</p> : <div className="cart-lines">{cart.map((line) => { const item = items.find((candidate) => candidate.id === line.itemId); return <div className="cart-line" key={line.key}><div><strong>{item ? label(item.names) : ''}</strong><small className="line-price">{formatPrice(linePrice(line) * line.quantity, locale)}</small><small>{[line.variant && label(item?.variants.find((choice) => choice.id === line.variant)?.names || { vi: '', en: '', 'zh-TW': '' }), ...(item?.addons.filter((addon) => line.addonIds.includes(addon.id)).map((addon) => label(addon.names)) || [])].filter(Boolean).join(' · ')}</small></div><div className="line-actions"><button className="icon-button" aria-label={copy.customise} onClick={() => item && openItem(item, line)}>✎</button><button aria-label={copy.decreaseQuantity} onClick={() => updateQuantity(line.key, line.quantity - 1)}>−</button><span>{line.quantity}</span><button aria-label={copy.increaseQuantity} onClick={() => updateQuantity(line.key, line.quantity + 1)}>+</button></div></div> })}</div>}<button className="primary-button send-button" disabled={!cart.length || sending} onClick={() => void confirm()}>{copy.sendOrder}</button></div>}</aside>{selected && <div className="modal-backdrop" onMouseDown={() => setSelected(null)}><section className="customise-sheet" role="dialog" aria-modal="true" aria-label={copy.customise} onMouseDown={(event) => event.stopPropagation()}><div className="sheet-title"><div><p className="eyebrow">{copy.customise}</p><h2>{label(selected.names)}</h2></div><button className="icon-button" onClick={() => setSelected(null)} aria-label={copy.cancel}>×</button></div><div className="quantity-row"><span>{copy.quantity}</span><div className="stepper"><button aria-label={copy.decreaseQuantity} onClick={() => setQuantity((value) => Math.max(1, value - 1))}>−</button><strong>{quantity}</strong><button aria-label={copy.increaseQuantity} onClick={() => setQuantity((value) => value + 1)}>+</button></div></div>{selected.variants.length > 0 && <fieldset><legend>{copy.variant}</legend><div className="choice-grid">{selected.variants.map((choice) => <button key={choice.id} className={variant === choice.id ? 'selected' : ''} onClick={() => setVariant(choice.id)}>{label(choice.names)}</button>)}</div></fieldset>}{selected.noteOptions.length > 0 && <fieldset><legend>{copy.noThanks}</legend><div className="choice-grid">{selected.noteOptions.map((choice) => <button key={choice.id} className={noteOptions.includes(choice.id) ? 'selected' : ''} onClick={() => toggle(choice.id, noteOptions, setNoteOptions)}>{label(choice.names)}</button>)}</div></fieldset>}{selected.addons.length > 0 && <fieldset><legend>{copy.addons}</legend><div className="addon-list">{selected.addons.map((addon) => <button key={addon.id} className={addonIds.includes(addon.id) ? 'selected' : ''} onClick={() => toggle(addon.id, addonIds, setAddonIds)}><span>{label(addon.names)}</span><strong>+{formatPrice(addon.priceExtra, locale)}</strong></button>)}</div></fieldset>}<label className="note-field"><span>{copy.note}</span><textarea value={note} maxLength={300} placeholder={copy.notePlaceholder} onChange={(event) => setNote(event.target.value)} /></label><div className="sheet-footer"><strong>{formatPrice(quantity * (selected.price + selected.addons.filter((addon) => addonIds.includes(addon.id)).reduce((sum, addon) => sum + addon.priceExtra, 0)), locale)}</strong><button className="primary-button" onClick={addToCart}>{editingKey ? copy.updateItem : copy.addToCart}</button></div></section></div>}</main>
}
