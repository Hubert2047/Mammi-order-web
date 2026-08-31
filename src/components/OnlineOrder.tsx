'use client'

import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { io } from 'socket.io-client'
import { type Locale, t } from '@/lib/i18n'
import CartLineItem from '@/components/CartLineItem'
import CartPanelHeader from '@/components/CartPanelHeader'
import MobileCategoryTabs from '@/components/MobileCategoryTabs'
import MobileMenuItemCard from '@/components/MobileMenuItemCard'
import MobileStoreFooter from '@/components/MobileStoreFooter'
import MenuLoadingState from '@/components/MenuLoadingState'
import { storeFooter } from '@/lib/storeFooter'

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
const cartStorageKey = 'mammi-online-cart-v1'
const cartTokenStorageKey = 'mammi-online-cart-token-v1'
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
const taipeiInputValue = (date: Date) => new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 16)

export default function OnlineOrder() {
    const [locale, setLocale] = useState<Locale>('vi')
    const [items, setItems] = useState<MenuItem[]>([])
    const [storeName, setStoreName] = useState('')
    const [realtimeToken, setRealtimeToken] = useState('')
    const [category, setCategory] = useState('all')
    const [type, setType] = useState<OrderType>('dine_in')
    const [cartToken, setCartToken] = useState(() => {
        if (typeof window === 'undefined') return ''
        return window.localStorage.getItem(cartTokenStorageKey) || ''
    })
    const [cart, setCart] = useState<CartLine[]>(() => {
        if (typeof window === 'undefined') return []
        try {
            const saved = JSON.parse(window.localStorage.getItem(cartStorageKey) || '[]')
            return Array.isArray(saved) ? saved : []
        } catch {
            return []
        }
    })
    const [promotionTotal, setPromotionTotal] = useState<number | null>(null)
    const [selected, setSelected] = useState<MenuItem | null>(null)
    const [customiseSheetFull, setCustomiseSheetFull] = useState(false)
    const [editingLineKey, setEditingLineKey] = useState<string | null>(null)
    const [quantity, setQuantity] = useState(1)
    const [variant, setVariant] = useState('')
    const [noteOptions, setNoteOptions] = useState<string[]>([])
    const [addonIds, setAddonIds] = useState<string[]>([])
    const [note, setNote] = useState('')
    const [componentSelections, setComponentSelections] = useState<ComponentSelection[]>([])
    const [customer, setCustomer] = useState({ phone: '', name: '', address: '' })
    const [pickupAt, setPickupAt] = useState(() => taipeiInputValue(new Date(Date.now() + 60 * 60 * 1000)))
    const [loading, setLoading] = useState(true)
    const [failed, setFailed] = useState(false)
    const [orderRateLimited, setOrderRateLimited] = useState(false)
    const [sending, setSending] = useState(false)
    const [checkoutOpen, setCheckoutOpen] = useState(false)
    const [cartOpen, setCartOpen] = useState(false)
    const [turnstileReady, setTurnstileReady] = useState(false)
    const [turnstileToken, setTurnstileToken] = useState('')
    const [turnstileError, setTurnstileError] = useState(false)
    const widgetId = useRef<string | null>(null)
    const customiseSheetRef = useRef<HTMLElement | null>(null)
    const quoteCache = useRef<{ key: string; total: number; expiresAt: number } | null>(null)
    const [completed, setCompleted] = useState<number | null>(null)
    const copy = t(locale)
    const base = ''
    useLayoutEffect(() => {
        const modalOpen = Boolean(selected || cartOpen || checkoutOpen)
        if (!modalOpen) return
        const previousOverflow = document.body.style.overflow
        const previousPaddingRight = document.body.style.paddingRight
        const previousHtmlOverflow = document.documentElement.style.overflow
        const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth
        document.body.style.overflow = 'hidden'
        document.documentElement.style.overflow = 'hidden'
        if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`
        if (selected) customiseSheetRef.current?.scrollTo({ top: 0, behavior: 'auto' })
        return () => {
            document.body.style.overflow = previousOverflow
            document.body.style.paddingRight = previousPaddingRight
            document.documentElement.style.overflow = previousHtmlOverflow
        }
    }, [selected, cartOpen, checkoutOpen])
    useLayoutEffect(() => {
        if (!selected) {
            setCustomiseSheetFull(false)
            return
        }
        const sheet = customiseSheetRef.current
        if (!sheet) return
        const updateHeightState = () => {
            setCustomiseSheetFull(sheet.getBoundingClientRect().height >= window.innerHeight - 1)
        }
        updateHeightState()
        const observer = new ResizeObserver(updateHeightState)
        observer.observe(sheet)
        window.addEventListener('resize', updateHeightState)
        return () => {
            observer.disconnect()
            window.removeEventListener('resize', updateHeightState)
        }
    }, [selected])
    const label = (value: Text) => value[locale] || value.vi
    useEffect(() => {
        window.localStorage.setItem(cartStorageKey, JSON.stringify(cart))
    }, [cart])
    useEffect(() => {
        if (cartToken) window.localStorage.setItem(cartTokenStorageKey, cartToken)
        else window.localStorage.removeItem(cartTokenStorageKey)
    }, [cartToken])
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
        document.querySelector('.turnstile-slot')?.append(host)
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
        setEditingLineKey(line?.key || null)
        setQuantity(line?.quantity || 1)
        setVariant(line?.variant || item.variants[0]?.id || '')
        setNoteOptions(line?.noteOptions || [])
        setAddonIds(line?.addonIds || [])
        setNote(line?.note || '')
        setComponentSelections(line?.componentSelections || (item.components || []).flatMap((component) => Array.from({ length: component.quantity }, (_, index) => ({ componentId: `${component.componentId}-${index}`, itemId: component.itemId, noteOptions: [], note: '' }))))
    }
    const closeItem = () => {
        const wasEditing = Boolean(editingLineKey)
        setSelected(null)
        setEditingLineKey(null)
        if (wasEditing) setCartOpen(true)
    }
    const addToCart = () => {
        if (!selected) return
        const wasEditing = Boolean(editingLineKey)
        const nextLine: CartLine = {
            key: editingLineKey || createKey(),
            itemId: selected.id,
            quantity,
            variant: variant || undefined,
            noteOptions: selected.type === 'combo' ? [] : noteOptions,
            addonIds: selected.type === 'combo' ? [] : addonIds,
            note: note.trim() || undefined,
            componentSelections: selected.type === 'combo' ? componentSelections : undefined,
        }
        setCart((old) =>
            editingLineKey ? old.map((line) => (line.key === editingLineKey ? nextLine : line)) : [...old, nextLine],
        )
        setSelected(null)
        setEditingLineKey(null)
        if (wasEditing) setCartOpen(true)
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
                body: JSON.stringify({ customer, turnstileToken, pickupAt: new Date(`${pickupAt}:00+08:00`).toISOString() }),
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
            window.localStorage.removeItem(cartStorageKey)
            setCartToken('')
            window.localStorage.removeItem(cartTokenStorageKey)
            setCheckoutOpen(false)
        } catch {
            setFailed(true)
        } finally {
            setSending(false)
        }
    }

    if (loading || failed)
        return (
            <MenuLoadingState
                title={failed ? copy.menuUnavailable : undefined}
                description={failed ? (orderRateLimited ? copy.onlineOrderRateLimited : copy.menuUnavailableDescription) : undefined}
            />
        )
    if (completed !== null)
        return (
            <main className='page'>
                <section className='success-card'>
                    <div className='success-mark'>✓</div>
                    <p className='eyebrow'>{copy.brand}</p>
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
            <div className='online-menu-sticky'>
            <header className='menu-header online-header online-menu-header'>
                <div className='brand-lockup'>
                    <img src='/logo.png' alt='' width='72' height='72' />
                </div>
                <div className='header-meta'>
                    <button className='header-cart online-header-cart' onClick={() => setCartOpen(true)} aria-label={copy.cart}>
                        <span aria-hidden='true'>🛒</span>
                        <strong>{count}</strong>
                    </button>
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
                </div>
            </header>
            <MobileCategoryTabs
                tabs={[{ id: 'all', label: copy.all }, ...categories.map((entry) => ({ id: entry.id, label: label(entry.names) }))]}
                selectedId={category}
                ariaLabel={copy.categories}
                onSelect={setCategory}
            />
            <nav className='category-tabs !hidden sm:!flex' aria-label={copy.categories}>
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
            </div>
            <div className='online-layout'>
                <section>
                    <div className='menu-grid'>
                        {visibleItems.map((item) => {
                            const displayPrice = item.displayPrice ?? item.price
                            return (
                                <Fragment key={item.id}>
                                    <MobileMenuItemCard
                                        name={label(item.names)}
                                        description={label(item.description)}
                                        imageUrl={item.imageUrl}
                                        badge={
                                            item.recommended
                                                ? copy.recommended
                                                : item.popular
                                                  ? copy.popular
                                                  : item.new
                                                    ? copy.newProduct
                                                    : item.promotion
                                                      ? copy.promotion
                                                      : undefined
                                        }
                                        price={formatPrice(displayPrice, locale)}
                                        originalPrice={displayPrice < item.price ? formatPrice(item.price, locale) : undefined}
                                        addLabel={copy.add}
                                        onAdd={() => openItem(item)}
                                    />
                                <article className='menu-card online-menu-card !hidden sm:!flex'>
                                    <div className='dish-art' aria-hidden='true'>
                                        {item.imageUrl ? <img src={item.imageUrl} alt='' /> : '🍽️'}
                                    </div>
                                    <div className='menu-card-copy'>
                                        {(item.recommended || item.popular || item.new || item.promotion) && (
                                            <span className='menu-badge'>
                                                {item.recommended
                                                    ? copy.recommended
                                                    : item.popular
                                                      ? copy.popular
                                                      : item.new
                                                        ? copy.newProduct
                                                        : copy.promotion}
                                            </span>
                                        )}
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
                                </Fragment>
                            )
                        })}
                    </div>
                </section>
                <button className='cart-fab' onClick={() => setCartOpen(true)} aria-label={copy.cart}>
                    <span aria-hidden='true'>🛒</span>
                    <span>{copy.cart}</span>
                    {count > 0 && <strong>{count}</strong>}
                </button>
                {cartOpen && <div className='cart-drawer-backdrop' onMouseDown={() => setCartOpen(false)} />}
                {cartOpen && <aside className='online-cart'>
                    <CartPanelHeader
                        cartLabel={copy.cart}
                        count={count}
                        itemLabel={copy.item}
                        total={formatPrice(total, locale)}
                        closeLabel={copy.cancel}
                        onClose={() => setCartOpen(false)}
                        className='sm:!hidden'
                    />
                    <div className='cart-heading !hidden sm:!flex'>
                        <div>
                            <p className='eyebrow'>{copy.cart}</p>
                            <span>{count} {copy.item}</span>
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
                                    <Fragment key={line.key}>
                                        <CartLineItem
                                            name={item ? label(item.names) : ''}
                                            price={formatPrice(linePrice(line) * line.quantity, locale)}
                                            quantity={line.quantity}
                                            decreaseLabel={copy.decreaseQuantity}
                                            increaseLabel={copy.increaseQuantity}
                                            customiseLabel={copy.customise}
                                            removeLabel={copy.remove}
                                            onDecrease={() => updateQuantity(line.key, line.quantity - 1)}
                                            onIncrease={() => updateQuantity(line.key, line.quantity + 1)}
                                            onCustomise={() => {
                                                if (!item) return
                                                setCartOpen(false)
                                                openItem(item, line)
                                            }}
                                            onRemove={() => updateQuantity(line.key, 0)}
                                        />
                                    <div className='cart-line !hidden sm:!flex'>
                                        <div>
                                            <strong>{item ? label(item.names) : ''}</strong>
                                            <small className='line-price'>{formatPrice(linePrice(line) * line.quantity, locale)}</small>
                                        </div>
                                        <div className='line-actions'>
                                            <div className='line-quantity-actions'>
                                                <button type='button' aria-label={copy.decreaseQuantity} onClick={() => updateQuantity(line.key, line.quantity - 1)}>
                                                    <span className='quantity-symbol'>−</span>
                                                </button>
                                                <span>{line.quantity}</span>
                                                <button type='button' aria-label={copy.increaseQuantity} onClick={() => updateQuantity(line.key, line.quantity + 1)}>
                                                    <span className='quantity-symbol'>+</span>
                                                </button>
                                            </div>
                                            <div className='line-item-actions'>
                                                <button
                                                    className='icon-button'
                                                    type='button'
                                                    aria-label={copy.customise}
                                                    onClick={() => {
                                                        if (!item) return
                                                        setCartOpen(false)
                                                        openItem(item, line)
                                                    }}>
                                                    <svg viewBox='0 0 24 24' aria-hidden='true'>
                                                        <path d='m4 16.5-.8 4.3 4.3-.8L19.1 8.4l-3.5-3.5L4 16.5Z' />
                                                        <path d='m13.8 6.7 3.5 3.5' />
                                                    </svg>
                                                </button>
                                                <button className='cart-remove-button' type='button' aria-label={copy.remove} onClick={() => updateQuantity(line.key, 0)}>
                                                    <svg viewBox='0 0 24 24' aria-hidden='true'>
                                                        <path d='M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 10v6M14 10v6' />
                                                    </svg>
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                    </Fragment>
                                )
                            })}
                        </div>
                    )}
                    <button
                        className='primary-button send-button'
                        disabled={!cart.length}
                        onClick={() => {
                            setCartOpen(false)
                            setCheckoutOpen(true)
                        }}>
                        {copy.continueOrder}
                    </button>
                    <button className='cart-close !hidden sm:!grid' onClick={() => setCartOpen(false)} aria-label={copy.cancel}>×</button>
                </aside>}
            </div>
            <MobileStoreFooter
                name={storeFooter.name}
                hoursLabel={copy.businessHours}
                hours={storeFooter.hours}
                phone={storeFooter.phone}
                address={storeFooter.address}
                copyright={storeFooter.copyright}
            />
            {selected && (
                <div className='modal-backdrop' onMouseDown={closeItem}>
                    <section
                        className={`customise-sheet${customiseSheetFull ? ' is-full-height' : ''}`}
                        ref={customiseSheetRef}
                        role='dialog'
                        aria-modal='true'
                        onMouseDown={(event) => event.stopPropagation()}>
                        <div className='sheet-title'>
                            <div>
                                <p className='eyebrow'>{copy.customise}</p>
                                <h2>{label(selected.names)}</h2>
                            </div>
                            <button className='icon-button' onClick={closeItem} aria-label={copy.cancel}>
                                <span className='modal-close-symbol'>×</span>
                            </button>
                        </div>
                        <div className='quantity-row'>
                            <span>{copy.quantity}</span>
                            <div className='stepper'>
                                <button onClick={() => setQuantity((value) => Math.max(1, value - 1))}><span className='quantity-symbol'>−</span></button>
                                <strong>{quantity}</strong>
                                <button onClick={() => setQuantity((value) => value + 1)}><span className='quantity-symbol'>+</span></button>
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
                                <div className='component-list'>{componentSelections.map((selection, index) => { const component = selected.components?.find((entry) => selection.itemId === entry.itemId && selection.componentId.startsWith(entry.componentId)); if (!component) return null; return <details key={selection.componentId} className='component-card' open={index === 0}><summary>{label(component.names)} {(selected.components?.filter((entry) => entry.itemId === component.itemId).length || 0) > 1 ? index + 1 : ''}</summary><div className='component-options'><div className='choice-grid'>{component.noteOptions.map((choice) => <button key={choice.id} className={selection.noteOptions.includes(choice.id) ? 'selected' : ''} onClick={() => setComponentSelections((current) => current.map((entry) => entry.componentId === selection.componentId ? { ...entry, noteOptions: entry.noteOptions.includes(choice.id) ? entry.noteOptions.filter((id) => id !== choice.id) : [...entry.noteOptions, choice.id] } : entry))}>{label(choice.names)}</button>)}</div><textarea value={selection.note || ''} maxLength={40} placeholder={copy.notePlaceholder} onChange={(event) => setComponentSelections((current) => current.map((entry) => entry.componentId === selection.componentId ? { ...entry, note: event.target.value } : entry))} /></div></details> })}</div>
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
                                maxLength={40}
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
                                {editingLineKey ? copy.updateItem : copy.addToCart}
                            </button>
                        </div>
                    </section>
                </div>
            )}
            {checkoutOpen && (
                <div className='modal-backdrop fixed inset-0 z-30 flex items-center justify-center bg-black/45 p-6 max-[649px]:items-end max-[649px]:p-0' onMouseDown={() => setCheckoutOpen(false)}>
                    <section
                        className='checkout-card flex h-auto max-h-[min(88svh,760px)] w-full max-w-[560px] flex-col overflow-x-hidden overflow-y-auto bg-surface p-8 shadow-2xl max-[649px]:h-svh max-[649px]:max-h-svh max-[649px]:max-w-none max-[649px]:rounded-none max-[649px]:px-[18px] max-[649px]:pt-[22px] max-[649px]:pb-[calc(22px+env(safe-area-inset-bottom))]'
                        role='dialog'
                        aria-modal='true'
                        onMouseDown={(event) => event.stopPropagation()}>
                        <div className='sheet-title'>
                            <div>
                                <p className='eyebrow'>{copy.checkout}</p>
                            </div>
                            <button
                                className='icon-button'
                                onClick={() => setCheckoutOpen(false)}
                                aria-label={copy.cancel}>
                                <span className='checkout-close-symbol'>×</span>
                            </button>
                        </div>
                        <div className='online-type checkout-order-type'>
                            <span>{copy.orderType}</span>
                            <button type='button' className={type === 'dine_in' ? 'selected' : ''} onClick={() => setType('dine_in')}>
                                {copy.dineIn}
                            </button>
                            <button type='button' className={type === 'takeaway' ? 'selected' : ''} onClick={() => setType('takeaway')}>
                                {copy.takeaway}
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
                        <label>
                            {copy.pickupTime}
                            <input type='datetime-local' value={pickupAt} min={taipeiInputValue(new Date())} onChange={(event) => setPickupAt(event.target.value)} />
                        </label>
                        <div className='turnstile-slot' />
                        <button
                            className='primary-button !bg-primary !text-primary-foreground'
                            disabled={!cart.length || !customer.phone.trim() || !turnstileToken || turnstileError || sending}
                            onClick={() => void confirm()}>
                            {copy.sendOrder}
                        </button>
                    </section>
                </div>
            )}
        </main>
    )
}
