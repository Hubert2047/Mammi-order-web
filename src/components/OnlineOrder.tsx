'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { io } from 'socket.io-client'
import { type Locale, t } from '@/lib/i18n'

type Text = Record<Locale, string>
type Choice = { id: string; names: Text }
type Addon = Choice & { priceExtra: number; displayPrice?: number }
type Component = { componentId: string; itemId: string; quantity: number; names: Text; noteOptions: Choice[] }
type ComponentSelection = { componentId: string; itemId: string; noteOptions: string[]; note?: string }
type MenuItem = {
    id: string
    type?: 'product' | 'combo'
    category: { id: string; names: Text; sortOrder?: number }
    names: Text
    description: Text
    imageUrl?: string
    recommended?: boolean
    popular?: boolean
    new?: boolean
    promotion?: boolean
    price: number
    displayPrice?: number
    variants: Choice[]
    noteOptions: Choice[]
    addons: Addon[]
    components?: Component[]
}
type CartLine = {
    key: string
    itemId: string
    quantity: number
    variant?: string
    noteOptions: string[]
    addonIds: string[]
    note?: string
    componentSelections?: ComponentSelection[]
}
type OrderType = 'dine_in' | 'takeaway'

declare global {
    interface Window {
        turnstile?: {
            render: (
                element: HTMLElement,
                options: {
                    sitekey: string
                    action: string
                    callback: (token: string) => void
                    'expired-callback': () => void
                    'error-callback': () => void
                },
            ) => string
            remove: (widgetId: string) => void
        }
    }
}

const localeStorageKey = 'mammi-order-locale-v2'
const createKey = () =>
    typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`
const detectLocale = (): Locale => {
    if (typeof navigator === 'undefined') return 'vi'
    const saved = window.localStorage.getItem(localeStorageKey)
    if (saved === 'vi' || saved === 'en' || saved === 'zh-TW') return saved
    const language = navigator.language.toLowerCase()
    if (language.startsWith('zh')) return 'zh-TW'
    if (language.startsWith('en')) return 'en'
    return 'vi'
}
const formatPrice = (amount: number, locale: Locale) =>
    new Intl.NumberFormat(locale === 'zh-TW' ? 'zh-TW' : locale, {
        style: 'currency',
        currency: 'TWD',
        maximumFractionDigits: 0,
    }).format(amount)

export default function OnlineOrder() {
    const [locale, setLocale] = useState<Locale>('vi')
    const [items, setItems] = useState<MenuItem[]>([])
    const [storeName, setStoreName] = useState('')
    const [realtimeToken, setRealtimeToken] = useState('')
    const [category, setCategory] = useState('all')
    const [type, setType] = useState<OrderType>('dine_in')
    const [cartToken, setCartToken] = useState('')
    const [cart, setCart] = useState<CartLine[]>([])
    const [promotionTotal, setPromotionTotal] = useState<number | null>(null)
    const [selected, setSelected] = useState<MenuItem | null>(null)
    const [quantity, setQuantity] = useState(1)
    const [variant, setVariant] = useState('')
    const [noteOptions, setNoteOptions] = useState<string[]>([])
    const [addonIds, setAddonIds] = useState<string[]>([])
    const [note, setNote] = useState('')
    const [componentSelections, setComponentSelections] = useState<ComponentSelection[]>([])
    const [customer, setCustomer] = useState({ phone: '', name: '', address: '' })
    const [loading, setLoading] = useState(true)
    const [failed, setFailed] = useState(false)
    const [orderRateLimited, setOrderRateLimited] = useState(false)
    const [sending, setSending] = useState(false)
    const [checkoutOpen, setCheckoutOpen] = useState(false)
    const [turnstileReady, setTurnstileReady] = useState(false)
    const [turnstileToken, setTurnstileToken] = useState('')
    const [turnstileError, setTurnstileError] = useState(false)
    const widgetId = useRef<string | null>(null)
    const quoteCache = useRef<{ key: string; total: number; expiresAt: number } | null>(null)
    const [completed, setCompleted] = useState<number | null>(null)
    const copy = t(locale)
    const base = ''
    const label = (value: Text) => value[locale] || value.vi
    const smartCategories = [
        { id: '__recommended__', key: 'recommended' as const, names: { vi: copy.recommended, en: copy.recommended, 'zh-TW': copy.recommended } },
        { id: '__popular__', key: 'popular' as const, names: { vi: copy.popular, en: copy.popular, 'zh-TW': copy.popular } },
        { id: '__new__', key: 'new' as const, names: { vi: copy.newProduct, en: copy.newProduct, 'zh-TW': copy.newProduct } },
        { id: '__promotion__', key: 'promotion' as const, names: { vi: copy.promotion, en: copy.promotion, 'zh-TW': copy.promotion } },
    ]
    const categories = useMemo(
        () => [...smartCategories.filter((entry) => items.some((item) => item[entry.key] === true)).map((entry) => ({ id: entry.id, names: entry.names })), ...[...new Map(items.map((item) => [item.category.id, item.category])).values()].sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0) || left.id.localeCompare(right.id))],
        [items, locale],
    )
    useEffect(() => {
        if (category === 'all' || categories.some((entry) => entry.id === category)) return
        setCategory('all')
    }, [categories, category])
    const visibleItems = category === 'all' ? items : category.startsWith('__') ? items.filter((item) => { const smart = smartCategories.find((entry) => entry.id === category); return smart ? item[smart.key] === true : false }) : items.filter((item) => item.category.id === category)
    const linePrice = (line: CartLine) => {
        const item = items.find((candidate) => candidate.id === line.itemId)
        return (
            (item?.displayPrice ?? item?.price ?? 0) +
            (item?.addons
                .filter((addon) => line.addonIds.includes(addon.id))
                .reduce((sum, addon) => sum + (addon.displayPrice ?? addon.priceExtra), 0) || 0)
        )
    }
    const catalogTotal = useMemo(
        () => cart.reduce((sum, line) => sum + line.quantity * linePrice(line), 0),
        [cart, items],
    )
    const total = promotionTotal ?? catalogTotal
    const count = cart.reduce((sum, line) => sum + line.quantity, 0)

    const load = async () => {
        try {
            const response = await fetch(`${base}/api/public/online`)
            if (!response.ok) throw new Error()
            const payload = (await response.json()).data
            setItems(payload.items)
            setStoreName(payload.store.name)
            setRealtimeToken(payload.realtimeToken)
            if (!cartToken) {
                const created = await fetch(`${base}/api/public/online/carts`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ type }),
                })
                if (!created.ok) throw new Error()
                setCartToken((await created.json()).data.cartToken)
            }
            setFailed(false)
        } catch {
            setFailed(true)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        setLocale(detectLocale())
        void load()
    }, [])
    useEffect(() => {
        if (!realtimeToken) return
        const socket = io(window.location.origin, {
            transports: ['websocket'],
            auth: { publicToken: realtimeToken, clientType: 'customer' },
        })
        const refresh = () => {
            void load()
        }
        for (const event of [
            'catalog.item.updated',
            'catalog.store-item.price.updated',
            'catalog.store-item.availability.updated',
            'catalog.store-addon.updated',
            'catalog.store-addon.availability.updated',
            'catalog.promotion.updated',
            'catalog.changed',
        ])
            socket.on(event, refresh)
        return () => {
            socket.disconnect()
        }
    }, [realtimeToken])
    useEffect(() => {
        if (!cartToken || loading || completed !== null || !checkoutOpen) return
        const lines = cart.map(({ key, ...line }) => line)
        void fetch(`${base}/api/public/carts/${cartToken}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lines, type }),
        })
    }, [cart, cartToken, type, loading, completed, checkoutOpen])
    useEffect(() => {
        if (!cartToken || loading || completed !== null || !checkoutOpen || !cart.length) return
        const lines = cart.map(({ key, ...line }) => line)
        const quoteKey = JSON.stringify(lines)
        const cached = quoteCache.current
        if (cached && cached.key === quoteKey && cached.expiresAt > Date.now()) {
            setPromotionTotal(cached.total)
            return
        }
        const timer = window.setTimeout(() => {
            void fetch(`${base}/api/public/carts/${cartToken}/preview`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ lines }),
            })
                .then((response) => (response.ok ? response.json() : null))
                .then((payload) => {
                    const total = payload?.data?.total
                    const expiresAt = Date.parse(payload?.data?.expiresAt || '')
                    if (typeof total !== 'number' || !Number.isFinite(expiresAt)) {
                        setPromotionTotal(null)
                        return
                    }
                    quoteCache.current = { key: quoteKey, total, expiresAt }
                    setPromotionTotal(total)
                })
                .catch(() => setPromotionTotal(null))
        }, 300)
        return () => window.clearTimeout(timer)
    }, [base, cart, cartToken, checkoutOpen, completed, loading])
    useEffect(() => {
        if (!checkoutOpen) return
        if (window.turnstile) {
            setTurnstileReady(true)
            return
        }
        const timer = window.setInterval(() => {
            if (window.turnstile) {
                setTurnstileReady(true)
                window.clearInterval(timer)
            }
        }, 100)
        return () => window.clearInterval(timer)
    }, [checkoutOpen])
    useEffect(() => {
        if (!checkoutOpen || !turnstileReady || !process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || !window.turnstile) return
        const host = document.createElement('div')
        host.className = 'turnstile-host'
        document.querySelector('.checkout-card')?.append(host)
        if (!host.parentElement) return
        widgetId.current = window.turnstile.render(host, {
            sitekey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
            action: 'online_order',
            callback: setTurnstileToken,
            'expired-callback': () => setTurnstileToken(''),
            'error-callback': () => {
                setTurnstileToken('')
                setTurnstileError(true)
            },
        })
        return () => {
            if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current)
            host.remove()
            widgetId.current = null
            setTurnstileToken('')
            setTurnstileError(false)
        }
    }, [checkoutOpen, turnstileReady])

    const openItem = (item: MenuItem, line?: CartLine) => {
        setSelected(item)
        setQuantity(line?.quantity || 1)
        setVariant(line?.variant || item.variants[0]?.id || '')
        setNoteOptions(line?.noteOptions || [])
        setAddonIds(line?.addonIds || [])
        setNote(line?.note || '')
        setComponentSelections(line?.componentSelections || (item.components || []).flatMap((component) => Array.from({ length: component.quantity }, (_, index) => ({ componentId: `${component.componentId}-${index}`, itemId: component.itemId, noteOptions: [], note: '' }))))
    }
    const addToCart = () => {
        if (!selected) return
        setCart((old) => [
            ...old,
            {
                key: createKey(),
                itemId: selected.id,
                quantity,
                variant: variant || undefined,
                noteOptions: selected.type === 'combo' ? [] : noteOptions,
                addonIds: selected.type === 'combo' ? [] : addonIds,
                note: note.trim() || undefined,
                componentSelections: selected.type === 'combo' ? componentSelections : undefined,
            },
        ])
        setSelected(null)
    }
    const updateQuantity = (key: string, next: number) =>
        setCart((old) =>
            next < 1
                ? old.filter((line) => line.key !== key)
                : old.map((line) => (line.key === key ? { ...line, quantity: next } : line)),
        )
    const confirm = async () => {
        if (!cartToken || !cart.length || !customer.phone.trim() || !turnstileToken || sending) return
        setSending(true)
        try {
            const lines = cart.map(({ key, ...line }) => line)
            const synced = await fetch(`${base}/api/public/carts/${cartToken}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ lines, type }),
            })
            if (!synced.ok) throw new Error()
            const response = await fetch(`${base}/api/public/carts/${cartToken}/confirm`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ customer, turnstileToken }),
            })
            if (!response.ok) {
                const payload = await response.json().catch(() => null)
                if (payload?.code === 'ONLINE_ORDER_RATE_LIMITED') {
                    setOrderRateLimited(true)
                    setFailed(true)
                    return
                }
                throw new Error()
            }
            setCompleted((await response.json()).data.number)
            setCart([])
            setCheckoutOpen(false)
        } catch {
            setFailed(true)
        } finally {
            setSending(false)
        }
    }

    if (loading || failed)
        return (
            <main className='page'>
                <section className='card' aria-live='polite'>
                    <img className='error-logo' src='/logo.png' alt='' width='96' height='96' />
                    <h1>{failed ? copy.menuUnavailable : copy.qrMenuLoading}</h1>
                    <p>
                        {orderRateLimited
                            ? copy.onlineOrderRateLimited
                            : failed
                              ? copy.menuUnavailableDescription
                              : copy.qrMenuDescription}
                    </p>
                </section>
            </main>
        )
    if (completed !== null)
        return (
            <main className='page'>
                <section className='success-card'>
                    <div className='success-mark'>✓</div>
                    <p className='eyebrow'>{storeName || copy.brand}</p>
                    <h1>{copy.orderSent}</h1>
                    <strong className='order-number'>#{completed}</strong>
                    <p>{copy.onlineOrderSentDescription}</p>
                    <button
                        className='primary-button'
                        onClick={() => {
                            setCompleted(null)
                            void load()
                        }}>
                        {copy.newOrder}
                    </button>
                </section>
            </main>
        )

    return (
        <main className='online-shell'>
            <header className='online-header'>
                <div>
                    <p className='eyebrow'>{copy.brand}</p>
                    <h1>{storeName || copy.brand}</h1>
                    <p>{copy.onlineMenuDescription}</p>
                </div>
                <label className='locale-picker'>
                    <span className='sr-only'>{copy.language}</span>
                    <select
                        value={locale}
                        onChange={(event) => {
                            const next = event.target.value as Locale
                            setLocale(next)
                            window.localStorage.setItem(localeStorageKey, next)
                        }}>
                        <option value='vi'>VI</option>
                        <option value='en'>EN</option>
                        <option value='zh-TW'>繁中</option>
                    </select>
                </label>
            </header>
            <div className='online-layout'>
                <section>
                    <div className='online-type'>
                        <span>{copy.orderType}</span>
                        <button className={type === 'dine_in' ? 'selected' : ''} onClick={() => setType('dine_in')}>
                            {copy.dineIn}
                        </button>
                        <button className={type === 'takeaway' ? 'selected' : ''} onClick={() => setType('takeaway')}>
                            {copy.takeaway}
                        </button>
                    </div>
                    <nav className='category-tabs' aria-label={copy.categories}>
                        <button className={category === 'all' ? 'active' : ''} onClick={() => setCategory('all')}>
                            {copy.all}
                        </button>
                        {categories.map((entry) => (
                            <button
                                key={entry.id}
                                className={category === entry.id ? 'active' : ''}
                                onClick={() => setCategory(entry.id)}>
                                {label(entry.names)}
                            </button>
                        ))}
                    </nav>
                    <div className='menu-grid'>
                        {visibleItems.map((item) => {
                            const displayPrice = item.displayPrice ?? item.price
                            return (
                                <article className='menu-card' key={item.id}>
                                    <div className='dish-art' aria-hidden='true'>
                                        {item.imageUrl ? <img src={item.imageUrl} alt='' /> : '🍽️'}
                                    </div>
                                    <div className='menu-card-copy'>
                                        <p className='menu-name'>{label(item.names)}</p>
                                        <p className='menu-description'>{label(item.description)}</p>
                                        <div className='menu-card-footer'>
                                            <strong>
                                                {displayPrice < item.price && (
                                                    <small className='mr-1 line-through'>
                                                        {formatPrice(item.price, locale)}
                                                    </small>
                                                )}
                                                {formatPrice(displayPrice, locale)}
                                            </strong>
                                            <button onClick={() => openItem(item)}>{copy.add}</button>
                                        </div>
                                    </div>
                                </article>
                            )
                        })}
                    </div>
                </section>
                <aside className='online-cart'>
                    <div className='cart-heading'>
                        <div>
                            <p className='eyebrow'>{copy.cart}</p>
                            <span>
                                {count} {copy.item}
                            </span>
                        </div>
                        <strong>{formatPrice(total, locale)}</strong>
                    </div>
                    {cart.length === 0 ? (
                        <p className='cart-empty'>{copy.cartEmptyDescription}</p>
                    ) : (
                        <div className='cart-lines'>
                            {cart.map((line) => {
                                const item = items.find((candidate) => candidate.id === line.itemId)
                                return (
                                    <div className='cart-line' key={line.key}>
                                        <div>
                                            <strong>{item ? label(item.names) : ''}</strong>
                                            <small>{formatPrice(linePrice(line) * line.quantity, locale)}</small>
                                        </div>
                                        <div className='line-actions'>
                                            <button onClick={() => updateQuantity(line.key, line.quantity - 1)}>
                                                −
                                            </button>
                                            <span>{line.quantity}</span>
                                            <button onClick={() => updateQuantity(line.key, line.quantity + 1)}>
                                                +
                                            </button>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                    <button
                        className='primary-button send-button'
                        disabled={!cart.length}
                        onClick={() => setCheckoutOpen(true)}>
                        {copy.continueOrder}
                    </button>
                </aside>
            </div>
            {selected && (
                <div className='modal-backdrop' onMouseDown={() => setSelected(null)}>
                    <section
                        className='customise-sheet'
                        role='dialog'
                        aria-modal='true'
                        onMouseDown={(event) => event.stopPropagation()}>
                        <div className='sheet-title'>
                            <div>
                                <p className='eyebrow'>{copy.customise}</p>
                                <h2>{label(selected.names)}</h2>
                            </div>
                            <button className='icon-button' onClick={() => setSelected(null)} aria-label={copy.cancel}>
                                ×
                            </button>
                        </div>
                        <div className='quantity-row'>
                            <span>{copy.quantity}</span>
                            <div className='stepper'>
                                <button onClick={() => setQuantity((value) => Math.max(1, value - 1))}>−</button>
                                <strong>{quantity}</strong>
                                <button onClick={() => setQuantity((value) => value + 1)}>+</button>
                            </div>
                        </div>
                        {selected.variants.length > 0 && (
                            <fieldset>
                                <legend>{copy.variant}</legend>
                                <div className='choice-grid'>
                                    {selected.variants.map((choice) => (
                                        <button
                                            key={choice.id}
                                            className={variant === choice.id ? 'selected' : ''}
                                            onClick={() => setVariant(choice.id)}>
                                            {label(choice.names)}
                                        </button>
                                    ))}
                                </div>
                            </fieldset>
                        )}
                        {selected.type === 'combo' && (selected.components?.length || 0) > 0 && (
                            <fieldset className='combo-components-fieldset'>
                                <legend>{copy.comboComponents}</legend>
                                <div className='component-list'>{componentSelections.map((selection, index) => { const component = selected.components?.find((entry) => selection.itemId === entry.itemId && selection.componentId.startsWith(entry.componentId)); if (!component) return null; return <details key={selection.componentId} className='component-card' open={index === 0}><summary>{label(component.names)} {(selected.components?.filter((entry) => entry.itemId === component.itemId).length || 0) > 1 ? index + 1 : ''}</summary><div className='component-options'><div className='choice-grid'>{component.noteOptions.map((choice) => <button key={choice.id} className={selection.noteOptions.includes(choice.id) ? 'selected' : ''} onClick={() => setComponentSelections((current) => current.map((entry) => entry.componentId === selection.componentId ? { ...entry, noteOptions: entry.noteOptions.includes(choice.id) ? entry.noteOptions.filter((id) => id !== choice.id) : [...entry.noteOptions, choice.id] } : entry))}>{label(choice.names)}</button>)}</div><textarea value={selection.note || ''} maxLength={300} placeholder={copy.notePlaceholder} onChange={(event) => setComponentSelections((current) => current.map((entry) => entry.componentId === selection.componentId ? { ...entry, note: event.target.value } : entry))} /></div></details> })}</div>
                            </fieldset>
                        )}
                        {selected.type !== 'combo' && selected.addons.length > 0 && (
                            <fieldset>
                                <legend>{copy.addons}</legend>
                                <div className='addon-list'>
                                    {selected.addons.map((addon) => {
                                        const displayPrice = addon.displayPrice ?? addon.priceExtra
                                        return (
                                            <button
                                                key={addon.id}
                                                className={addonIds.includes(addon.id) ? 'selected' : ''}
                                                onClick={() =>
                                                    setAddonIds((old) =>
                                                        old.includes(addon.id)
                                                            ? old.filter((id) => id !== addon.id)
                                                            : [...old, addon.id],
                                                    )
                                                }>
                                                <span>{label(addon.names)}</span>
                                                <strong>
                                                    {displayPrice < addon.priceExtra && (
                                                        <small className='mr-1 line-through'>
                                                            +{formatPrice(addon.priceExtra, locale)}
                                                        </small>
                                                    )}
                                                    +{formatPrice(displayPrice, locale)}
                                                </strong>
                                            </button>
                                        )
                                    })}
                                </div>
                            </fieldset>
                        )}
                        <label className='note-field'>
                            <span>{copy.note}</span>
                            <textarea
                                value={note}
                                maxLength={300}
                                placeholder={copy.notePlaceholder}
                                onChange={(event) => setNote(event.target.value)}
                            />
                        </label>
                        <div className='sheet-footer'>
                            <strong>
                                {formatPrice(
                                    quantity *
                                        ((selected.displayPrice ?? selected.price) +
                                            selected.addons
                                                .filter((addon) => addonIds.includes(addon.id))
                                                .reduce(
                                                    (sum, addon) => sum + (addon.displayPrice ?? addon.priceExtra),
                                                    0,
                                                )),
                                    locale,
                                )}
                            </strong>
                            <button className='primary-button' onClick={addToCart}>
                                {copy.addToCart}
                            </button>
                        </div>
                    </section>
                </div>
            )}
            {checkoutOpen && (
                <div className='modal-backdrop' onMouseDown={() => setCheckoutOpen(false)}>
                    <section
                        className='checkout-card'
                        role='dialog'
                        aria-modal='true'
                        onMouseDown={(event) => event.stopPropagation()}>
                        <div className='sheet-title'>
                            <div>
                                <p className='eyebrow'>{copy.checkout}</p>
                                <h2>{type === 'dine_in' ? copy.dineIn : copy.takeaway}</h2>
                            </div>
                            <button
                                className='icon-button'
                                onClick={() => setCheckoutOpen(false)}
                                aria-label={copy.cancel}>
                                ×
                            </button>
                        </div>
                        <label>
                            {copy.phone} *
                            <input
                                value={customer.phone}
                                required
                                inputMode='tel'
                                onChange={(event) => setCustomer({ ...customer, phone: event.target.value })}
                            />
                        </label>
                        <label>
                            {copy.customerName}
                            <input
                                value={customer.name}
                                onChange={(event) => setCustomer({ ...customer, name: event.target.value })}
                            />
                        </label>
                        <label>
                            {copy.address}
                            <textarea
                                value={customer.address}
                                onChange={(event) => setCustomer({ ...customer, address: event.target.value })}
                            />
                        </label>
                        <button
                            className='primary-button'
                            disabled={!customer.phone.trim() || sending}
                            onClick={() => void confirm()}>
                            {copy.sendOrder}
                        </button>
                    </section>
                </div>
            )}
        </main>
    )
}
