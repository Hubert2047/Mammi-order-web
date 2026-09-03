'use client'

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
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
type OptionGroup = { id: string; names: Text; selection: 'single' | 'multiple'; required: boolean; defaultOptionId?: string; options: Choice[] }
type Addon = Choice & { priceExtra: number; displayPrice?: number; unavailable?: boolean }
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
    unavailable?: boolean
    variants: Choice[]
    optionGroups: OptionGroup[]
    noteOptions: Choice[]
    addons: Addon[]
    components?: Component[]
}
type CartLine = {
    key: string
    itemId: string
    quantity: number
    variant?: string
    optionSelections?: { groupId: string; optionId: string }[]
    noteOptions: string[]
    addonIds: string[]
    note?: string
    componentSelections?: ComponentSelection[]
}
type CompletedOrder = { number: number; table: string; total: number; count: number }

const formatPrice = (amount: number, locale: Locale) =>
    new Intl.NumberFormat(locale === 'zh-TW' ? 'zh-TW' : locale, {
        style: 'currency',
        currency: 'TWD',
        maximumFractionDigits: 0,
    }).format(amount)
const localeStorageKey = 'mammi-order-locale-v2'
const detectLocale = (): Locale => {
    if (typeof navigator === 'undefined') return 'zh-TW'
    const saved = window.localStorage.getItem(localeStorageKey)
    if (saved === 'vi' || saved === 'en' || saved === 'zh-TW') return saved
    const language = navigator.language.toLowerCase()
    if (language.startsWith('zh')) return 'zh-TW'
    if (language.startsWith('en')) return 'en'
    if (language.startsWith('vi')) return 'vi'
    return 'zh-TW'
}
const createLineKey = () =>
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`

export default function LiveQrOrder({ qrToken }: { qrToken: string }) {
    const [locale, setLocale] = useState<Locale>('zh-TW')
    const [localeReady, setLocaleReady] = useState(false)
    const [category, setCategory] = useState('all')
    const [items, setItems] = useState<MenuItem[]>([])
    const [table, setTable] = useState('')
    const [realtimeToken, setRealtimeToken] = useState('')
    const [cartToken, setCartToken] = useState('')
    const [cart, setCart] = useState<CartLine[]>([])
    const [promotionTotal, setPromotionTotal] = useState<number | null>(null)
    const [selected, setSelected] = useState<MenuItem | null>(null)
    const [quantity, setQuantity] = useState(1)
    const [variant, setVariant] = useState('')
    const [optionSelections, setOptionSelections] = useState<{ groupId: string; optionId: string }[]>([])
    const [noteOptions, setNoteOptions] = useState<string[]>([])
    const [addonIds, setAddonIds] = useState<string[]>([])
    const [note, setNote] = useState('')
    const [componentSelections, setComponentSelections] = useState<ComponentSelection[]>([])
    const [loading, setLoading] = useState(true)
    const [menuReady, setMenuReady] = useState(false)
    const [loadingScreenVisible, setLoadingScreenVisible] = useState(true)
    const [loadingScreenLeaving, setLoadingScreenLeaving] = useState(false)
    const [failed, setFailed] = useState(false)
    const [sessionUnavailable, setSessionUnavailable] = useState(false)
    const [sending, setSending] = useState(false)
    const [completed, setCompleted] = useState<CompletedOrder | null>(null)
    const [cartOpen, setCartOpen] = useState(false)
    const [openingCart, setOpeningCart] = useState(false)
    const [quoteLoading, setQuoteLoading] = useState(false)
    const [pricingChanged, setPricingChanged] = useState(false)
    const [editingKey, setEditingKey] = useState<string | null>(null)
    const menuGridRef = useRef<HTMLElement>(null)
    const quoteCache = useRef<{ key: string; total: number; expiresAt: number; quoteToken: string } | null>(null)

    useEffect(() => {
        setLocale(detectLocale())
        setLocaleReady(true)
    }, [])
    useEffect(() => {
        if (!localeReady || loading || failed || sessionUnavailable) return

        const frame = window.requestAnimationFrame(() => {
            setMenuReady(true)
            setLoadingScreenLeaving(true)
        })
        const timeout = window.setTimeout(() => setLoadingScreenVisible(false), 300)
        return () => {
            window.cancelAnimationFrame(frame)
            window.clearTimeout(timeout)
        }
    }, [failed, loading, localeReady, sessionUnavailable])
    useEffect(() => {
        document.body.style.overflow = cartOpen ? 'hidden' : ''
        return () => {
            document.body.style.overflow = ''
        }
    }, [cartOpen])
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
    const base = ''
    const storageKey = `mammi-qr-cart:${qrToken}`
    const label = (value: Text) => value[locale] || value.vi
    const smartCategories = [
        { id: '__recommended__', key: 'recommended' as const, names: { vi: copy.recommended, en: copy.recommended, 'zh-TW': copy.recommended } },
        { id: '__popular__', key: 'popular' as const, names: { vi: copy.popular, en: copy.popular, 'zh-TW': copy.popular } },
        { id: '__new__', key: 'new' as const, names: { vi: copy.newProduct, en: copy.newProduct, 'zh-TW': copy.newProduct } },
        { id: '__promotion__', key: 'promotion' as const, names: { vi: copy.promotion, en: copy.promotion, 'zh-TW': copy.promotion } },
    ]

    const load = async () => {
        try {
            const response = await fetch(`${base}/api/public/qr/${encodeURIComponent(qrToken)}`)
            if (!response.ok) {
                const error = await response.json().catch(() => null)
                if (error?.code === 'SESSION_NOT_ACTIVE' || error?.code === 'SESSION_EXPIRED') {
                    if (error.table?.code) setTable(error.table.code)
                    setSessionUnavailable(true)
                    setFailed(false)
                    return
                }
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
                const created = await fetch(`${base}/api/public/qr/${encodeURIComponent(qrToken)}/carts`, {
                    method: 'POST',
                })
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

    useEffect(() => {
        void load()
    }, [qrToken])

    useEffect(() => {
        if (!realtimeToken) return
        const socket = io(window.location.origin, {
            transports: ['websocket'],
            auth: { publicToken: realtimeToken, clientType: 'customer' },
        })
        const refresh = () => {
            quoteCache.current = null
            setPromotionTotal(null)
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

    // The menu refreshes after catalog events, but the customise sheet keeps its
    // own selected item. Refresh that copy too so a newly unavailable add-on is
    // immediately disabled while the customer has the sheet open.
    useEffect(() => {
        if (!selected) return
        const refreshed = items.find((item) => item.id === selected.id)
        if (!refreshed) {
            setSelected(null)
            setAddonIds([])
            return
        }
        setSelected(refreshed)
        setAddonIds((current) => current.filter((addonId) => refreshed.addons.some((addon) => addon.id === addonId && !addon.unavailable)))
    }, [items, selected?.id])

    useEffect(() => {
        if (!cartToken || loading || completed || !cartOpen) return
        const lines = cart.map(({ key, ...line }) => line)
        void fetch(`${base}/api/public/carts/${cartToken}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lines }),
        })
    }, [cart, cartToken, cartOpen, completed, loading])

    const linePrice = (line: CartLine) => {
        const item = items.find((candidate) => candidate.id === line.itemId)
        return (
            (item?.displayPrice ?? item?.price ?? 0) +
            (item?.addons
                .filter((addon) => line.addonIds.includes(addon.id))
                .reduce((sum, addon) => sum + (addon.displayPrice ?? addon.priceExtra), 0) || 0)
        )
    }
    const lineOriginalPrice = (line: CartLine) => {
        const item = items.find((candidate) => candidate.id === line.itemId)
        return (item?.price ?? 0) + (item?.addons.filter((addon) => line.addonIds.includes(addon.id)).reduce((sum, addon) => sum + addon.priceExtra, 0) || 0)
    }
    const catalogTotal = useMemo(
        () => cart.reduce((sum, line) => sum + line.quantity * linePrice(line), 0),
        [cart, items],
    )
    const originalCatalogTotal = useMemo(
        () => cart.reduce((sum, line) => sum + line.quantity * lineOriginalPrice(line), 0),
        [cart, items],
    )
    const currentQuoteKey = useMemo(
        () => JSON.stringify(cart.map(({ key, ...line }) => line)),
        [cart],
    )
    const hasCurrentQuote = quoteCache.current?.key === currentQuoteKey
        && quoteCache.current.expiresAt > Date.now()
        && promotionTotal !== null
    const total = hasCurrentQuote
        ? promotionTotal
        : catalogTotal
    const originalTotal = originalCatalogTotal > total ? formatPrice(originalCatalogTotal, locale) : undefined
    const count = cart.reduce((sum, line) => sum + line.quantity, 0)
    const categories = useMemo(
        () => [...smartCategories.filter((entry) => items.some((item) => item[entry.key] === true)).map((entry) => ({ id: entry.id, names: entry.names })), ...[...new Map(items.map((item) => [item.category.id, item.category])).values()].sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0) || left.id.localeCompare(right.id))],
        [items, locale],
    )
    useEffect(() => {
        if (category === 'all' || categories.some((entry) => entry.id === category)) return
        setCategory('all')
    }, [categories, category])
    const visibleItems = category === 'all' ? items : category.startsWith('__') ? items.filter((item) => { const smart = smartCategories.find((entry) => entry.id === category); return smart ? item[smart.key] === true : false }) : items.filter((item) => item.category.id === category)
    useEffect(() => {
        menuGridRef.current?.scrollTo({ top: 0, behavior: 'auto' })
    }, [category])

    const openItem = (item: MenuItem, line?: CartLine) => {
        setSelected(item)
        setEditingKey(line?.key || null)
        setCartOpen(line ? false : cartOpen)
        setQuantity(line?.quantity || 1)
        setVariant(line?.variant || item.variants[0]?.id || '')
        setOptionSelections(line?.optionSelections || (item.optionGroups || []).flatMap((group) => {
            const optionId = group.defaultOptionId || (group.required ? group.options[0]?.id : undefined)
            return optionId ? [{ groupId: group.id, optionId }] : []
        }))
        setNoteOptions(line?.noteOptions || [])
        setAddonIds(line?.addonIds || [])
        setNote(line?.note || '')
        setComponentSelections(
            line?.componentSelections ||
                (item.components || []).flatMap((component) =>
                    Array.from({ length: component.quantity }, (_, index) => ({
                        componentId: `${component.componentId}-${index}`,
                        itemId: component.itemId,
                        noteOptions: [],
                        note: '',
                    })),
                ),
        )
    }

    const openCart = async (nextCart = cart, fullPageLoading = true) => {
        if (!nextCart.length) {
            setCartOpen(true)
            return
        }
        if (!cartToken) return

        const lines = nextCart.map(({ key, ...line }) => line)
        const quoteKey = JSON.stringify(lines)
        const cached = quoteCache.current
        if (cached && cached.key === quoteKey && cached.expiresAt > Date.now()) {
            setPromotionTotal(cached.total)
            setQuoteLoading(false)
            setCartOpen(true)
            return
        }

        if (fullPageLoading) setOpeningCart(true)
        else setQuoteLoading(true)
        try {
            const response = await fetch(`${base}/api/public/carts/${cartToken}/preview`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ lines }),
            })
            const payload = response.ok ? await response.json() : null
            const quoteTotal = payload?.data?.total
            const expiresAt = Date.parse(payload?.data?.expiresAt || '')
            const quoteToken = payload?.data?.quoteToken
            if (typeof quoteTotal !== 'number' || typeof quoteToken !== 'string' || !Number.isFinite(expiresAt)) return

            quoteCache.current = { key: quoteKey, total: quoteTotal, expiresAt, quoteToken }
            setPromotionTotal(quoteTotal)
            setCartOpen(true)
        } finally {
            if (fullPageLoading) setOpeningCart(false)
            else setQuoteLoading(false)
        }
    }
    const toggle = (id: string, current: string[], setCurrent: (next: string[]) => void) =>
        setCurrent(current.includes(id) ? current.filter((value) => value !== id) : [...current, id])
    const addToCart = () => {
        if (!selected) return
        const line = {
            key: editingKey || createLineKey(),
            itemId: selected.id,
            quantity,
            variant: variant || undefined,
            optionSelections: selected.type === 'combo' ? [] : optionSelections,
            noteOptions: selected.type === 'combo' ? [] : [...noteOptions],
            addonIds: selected.type === 'combo' ? [] : [...addonIds],
            note: note.trim() || undefined,
            componentSelections: selected.type === 'combo' ? componentSelections : undefined,
        }
        setCart((old) =>
            editingKey ? old.map((current) => (current.key === editingKey ? line : current)) : [...old, line],
        )
        setEditingKey(null)
        setSelected(null)
    }
    const updateQuantity = (key: string, nextQuantity: number) => {
        const nextCart = nextQuantity < 1
            ? cart.filter((line) => line.key !== key)
            : cart.map((line) => (line.key === key ? { ...line, quantity: nextQuantity } : line))
        setCart(nextCart)
        if (cartOpen) {
            void openCart(nextCart, false)
        }
    }
    const confirm = async () => {
        if (!cartToken || !cart.length || sending) return
        setSending(true)
        try {
            const lines = cart.map(({ key, ...line }) => line)
            const synced = await fetch(`${base}/api/public/carts/${cartToken}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ lines }),
            })
            if (!synced.ok) throw new Error('Unable to save cart')
            const quoteKey = JSON.stringify(lines)
            const cached = quoteCache.current
            const quoteToken = cached?.key === quoteKey && cached.expiresAt > Date.now() ? cached.quoteToken : ''
            const response = await fetch(`${base}/api/public/carts/${cartToken}/confirm`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quoteToken }),
            })
            if (!response.ok) {
                const error = await response.json().catch(() => null)
                if (error?.code === 'SESSION_NOT_ACTIVE' || error?.code === 'SESSION_EXPIRED') {
                    setSessionUnavailable(true)
                    return
                }
                if (error?.code === 'ORDER_PRICING_CHANGED') {
                    const pricing = error?.data?.pricing
                    const quoteToken = error?.data?.quoteToken
                    const expiresAt = Date.parse(error?.data?.expiresAt || '')
                    if (typeof pricing?.total === 'number' && typeof quoteToken === 'string' && Number.isFinite(expiresAt)) {
                        quoteCache.current = { key: quoteKey, total: pricing.total, expiresAt, quoteToken }
                        setPromotionTotal(pricing.total)
                    }
                    setPricingChanged(true)
                    setCartOpen(true)
                    void load()
                    return
                }
                throw new Error('Unable to confirm')
            }
            const data = (await response.json()).data
            window.localStorage.removeItem(storageKey)
            setCompleted({ number: data.number, table: data.table, total: data.total, count })
        } catch {
            setFailed(true)
        } finally {
            setSending(false)
        }
    }

    if (!localeReady)
        return <MenuLoadingState />
    if (failed || sessionUnavailable)
        return (
            <MenuLoadingState
                className={sessionUnavailable ? 'session-unavailable' : ''}
                title={sessionUnavailable ? copy.tableSessionUnavailable : failed ? copy.menuUnavailable : copy.qrMenuLoading}
                description={
                    <span className={sessionUnavailable ? 'session-unavailable-message' : undefined}>
                        {sessionUnavailable ? copy.tableSessionUnavailableDescription : failed ? copy.menuUnavailableDescription : copy.qrMenuDescription}
                    </span>
                }>
                {sessionUnavailable && table && <strong className='session-table-number'>{copy.table} {table}</strong>}
                {sessionUnavailable && (
                    <button
                        className='retry-link'
                        onClick={() => {
                            setLoading(true)
                            setFailed(false)
                            setSessionUnavailable(false)
                            void load()
                        }}>
                        {copy.retry}
                    </button>
                )}
            </MenuLoadingState>
        )
    if (completed)
        return (
            <main className='order-shell'>
                <section className='success-card'>
                    <div className='success-mark'>✓</div>
                    <h1>{copy.orderSent}</h1>
                    <p className='payment-instruction !whitespace-normal break-words leading-relaxed'>
                        {copy.paymentInstructionStart}
                        <strong>{copy.paymentInstructionCounter}</strong>
                        {' '}
                        {copy.paymentInstructionMiddle}
                        <strong>{copy.paymentInstructionPay}</strong>
                    </p>
                    <strong className='order-number'>#{completed.number}</strong>
                    <p>{copy.orderSummary}</p>
                    <p>
                        {copy.table}: {completed.table} · {copy.totalItems}: {completed.count}
                    </p>
                    <p>
                        {copy.subtotal}: {formatPrice(completed.total, locale)}
                    </p>
                </section>
            </main>
        )

    return (
        <>
            {loadingScreenVisible && (
                <MenuLoadingState
                    className={`fixed inset-0 z-50 transition-opacity duration-300 ease-out ${loadingScreenLeaving ? 'opacity-0' : 'opacity-100'}`}
                />
            )}
            {openingCart && (
                <div className='fixed inset-0 z-[60] grid place-items-center bg-white/75 backdrop-blur-sm' role='status' aria-busy='true'>
                    <span className='h-12 w-12 animate-spin rounded-full border-4 border-[#8ac545] border-t-transparent' />
                </div>
            )}
        <main className={`order-shell transition-[opacity,transform] duration-300 ease-out ${menuReady ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-1 opacity-0'}`}>
            <div className='menu-sticky'>
                <header className='menu-header'>
                    <div className='header-meta'>
                        <span className='table-badge'>
                            {copy.table} {table}
                        </span>
                        <button className='header-cart' onClick={() => void openCart()} aria-label={copy.cart}>
                            <span aria-hidden='true'>🛒</span>
                            <strong>{count}</strong>
                        </button>
                        <label className='locale-picker'>
                            <span className='sr-only'>{copy.language}</span>
                            <select
                                value={locale}
                                onChange={(event) => {
                                    const nextLocale = event.target.value as Locale
                                    setLocale(nextLocale)
                                    window.localStorage.setItem(localeStorageKey, nextLocale)
                                }}>
                                <option value='vi'>VI</option>
                                <option value='en'>EN</option>
                                <option value='zh-TW'>繁中</option>
                            </select>
                        </label>
                    </div>
                    <div className='brand-lockup'>
                        <img src='/logo.png' alt='' width='44' height='44' />
                        <h1>{copy.brand}</h1>
                    </div>
                    <p className='header-copy'>{copy.qrMenuDescription}</p>
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
            <section ref={menuGridRef} className='menu-grid'>
                {visibleItems.map((item) => {
                    const displayPrice = item.displayPrice ?? item.price
                    return (
                        <Fragment key={item.id}>
                            <MobileMenuItemCard
                                name={label(item.names)}
                                description={label(item.description)}
                                imageUrl={item.imageUrl}
                                price={formatPrice(displayPrice, locale)}
                                originalPrice={displayPrice < item.price ? formatPrice(item.price, locale) : undefined}
                                addLabel={copy.add}
                                badge={item.unavailable ? copy.unavailable : undefined}
                                unavailable={item.unavailable}
                                disabled={item.unavailable}
                                onAdd={() => openItem(item)}
                            />
                        <article className='menu-card !hidden sm:!flex'>
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
                                    <button disabled={item.unavailable} onClick={() => openItem(item)}><span className={item.unavailable ? 'unavailable-label' : undefined}>{item.unavailable ? copy.unavailable : copy.add}</span></button>
                                </div>
                            </div>
                        </article>
                        </Fragment>
                    )
                })}
            </section>
            <MobileStoreFooter
                name={storeFooter.name}
                hoursLabel={copy.businessHours}
                hours={storeFooter.hours}
                phone={storeFooter.phone}
                address={storeFooter.address}
                copyright={storeFooter.copyright}
            />
            <aside className='cart-dock'>
                <button className='cart-summary' onClick={() => void openCart()}>
                    <div className='cart-heading'>
                        <div>
                            <p className='eyebrow'>{copy.cart}</p>
                            <span>
                                {count} {copy.item}
                            </span>
                        </div>
                        <strong>
                            {originalTotal && <del className='mr-2 text-sm font-normal text-gray-400'>{originalTotal}</del>}
                            {formatPrice(total, locale)}
                        </strong>
                    </div>
                </button>
                {cartOpen && (
                    <div className='cart-expanded'>
                        <CartPanelHeader
                            cartLabel={copy.cart}
                            count={count}
                            itemLabel={copy.item}
                            total={formatPrice(total, locale)}
                            originalTotal={originalTotal}
                            isQuoteLoading={quoteLoading}
                            closeLabel={copy.cancel}
                            onClose={() => setCartOpen(false)}
                            className='-mx-[max(18px,calc((100vw-680px)/2))] -mt-6 sm:!hidden'
                        />
                        <div className='cart-panel-header !hidden sm:!flex'>
                            <div>
                                <strong>{copy.cart} · {count} {copy.item}</strong>
                                <small className='cart-total'>
                                    {quoteLoading ? (
                                        <span className='inline-block min-w-20 animate-pulse text-gray-300'>…</span>
                                    ) : (
                                        <>
                                            {originalTotal && <del className='mr-2 text-sm font-normal text-gray-400'>{originalTotal}</del>}
                                            {formatPrice(total, locale)}
                                        </>
                                    )}
                                </small>
                            </div>
                            <button className='icon-button' onClick={() => setCartOpen(false)} aria-label={copy.cancel}>×</button>
                        </div>
                        {cart.length === 0 ? (
                            <p className='cart-empty'>{copy.cartEmptyDescription}</p>
                        ) : (
                            <div className='cart-lines'>
                                {cart.map((line) => {
                                    const item = items.find((candidate) => candidate.id === line.itemId)
                                    const details = [
                                        line.variant &&
                                            label(
                                                item?.variants.find((choice) => choice.id === line.variant)?.names || {
                                                    vi: '',
                                                    en: '',
                                                    'zh-TW': '',
                                                },
                                            ),
                                        ...(item?.addons
                                            .filter((addon) => line.addonIds.includes(addon.id))
                                            .map((addon) => label(addon.names)) || []),
                                    ]
                                        .filter(Boolean)
                                        .join(' · ')
                                    return (
                                        <Fragment key={line.key}>
                                            <CartLineItem
                                                name={item ? label(item.names) : ''}
                                                price={formatPrice(linePrice(line) * line.quantity, locale)}
                                                originalPrice={lineOriginalPrice(line) > linePrice(line) ? formatPrice(lineOriginalPrice(line) * line.quantity, locale) : undefined}
                                                details={details}
                                                quantity={line.quantity}
                                                decreaseLabel={copy.decreaseQuantity}
                                                increaseLabel={copy.increaseQuantity}
                                                customiseLabel={copy.customise}
                                                removeLabel={copy.remove}
                                                onDecrease={() => updateQuantity(line.key, line.quantity - 1)}
                                                onIncrease={() => updateQuantity(line.key, line.quantity + 1)}
                                                onCustomise={() => item && openItem(item, line)}
                                                onRemove={() => updateQuantity(line.key, 0)}
                                            />
                                        <div className='cart-line !hidden sm:!flex'>
                                            <div>
                                                <strong>{item ? label(item.names) : ''}</strong>
                                                <small className='line-price'>
                                                    {lineOriginalPrice(line) > linePrice(line) && <del className='mr-1 font-normal text-gray-400'>{formatPrice(lineOriginalPrice(line) * line.quantity, locale)}</del>}
                                                    {formatPrice(linePrice(line) * line.quantity, locale)}
                                                </small>
                                                <small>
                                                    {details}
                                                </small>
                                            </div>
                                            <div className='line-actions'>
                                                <div className='line-quantity-actions'>
                                                    <button
                                                        type='button'
                                                        aria-label={copy.decreaseQuantity}
                                                        onClick={() => updateQuantity(line.key, line.quantity - 1)}>
                                                        <span className='quantity-symbol'>−</span>
                                                    </button>
                                                    <span>{line.quantity}</span>
                                                    <button
                                                        type='button'
                                                        aria-label={copy.increaseQuantity}
                                                        onClick={() => updateQuantity(line.key, line.quantity + 1)}>
                                                        <span className='quantity-symbol'>+</span>
                                                    </button>
                                                </div>
                                                <div className='line-item-actions'>
                                                    <button
                                                        className='icon-button'
                                                        type='button'
                                                        aria-label={copy.customise}
                                                        onClick={() => item && openItem(item, line)}>
                                                        <svg viewBox='0 0 24 24' aria-hidden='true'>
                                                            <path d='m4 16.5-.8 4.3 4.3-.8L19.1 8.4l-3.5-3.5L4 16.5Z' />
                                                            <path d='m13.8 6.7 3.5 3.5' />
                                                        </svg>
                                                    </button>
                                                    <button
                                                        className='cart-remove-button'
                                                        type='button'
                                                        aria-label={copy.remove}
                                                        onClick={() => updateQuantity(line.key, 0)}>
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
                        {pricingChanged && <p className='order-pricing-notice' role='alert'>{copy.orderPricingChanged}</p>}
                        <button
                            className='primary-button send-button'
                            disabled={!cart.length || sending}
                            onClick={() => void confirm()}>
                            {copy.sendOrder}
                        </button>
                    </div>
                )}
            </aside>
            {selected && (
                <div className='modal-backdrop' onMouseDown={() => setSelected(null)}>
                    <section
                        className='customise-sheet'
                        role='dialog'
                        aria-modal='true'
                        aria-label={copy.customise}
                        onMouseDown={(event) => event.stopPropagation()}>
                        <div className='sheet-title'>
                            <div>
                                <p className='eyebrow'>{copy.customise}</p>
                                <h2>{label(selected.names)}</h2>
                            </div>
                            <button className='icon-button' onClick={() => setSelected(null)} aria-label={copy.cancel}>
                                <span className='modal-close-symbol'>×</span>
                            </button>
                        </div>
                        <div className='quantity-row'>
                            <span>{copy.quantity}</span>
                            <div className='stepper'>
                                <button
                                    aria-label={copy.decreaseQuantity}
                                    onClick={() => setQuantity((value) => Math.max(1, value - 1))}>
                                    <span className='quantity-symbol'>−</span>
                                </button>
                                <strong>{quantity}</strong>
                                <button
                                    aria-label={copy.increaseQuantity}
                                    onClick={() => setQuantity((value) => value + 1)}>
                                    <span className='quantity-symbol'>+</span>
                                </button>
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
                        {(selected.optionGroups || []).map((group) => {
                            const selectedIds = optionSelections.filter((selection) => selection.groupId === group.id).map((selection) => selection.optionId)
                            const choose = (optionId: string) => setOptionSelections((current) => {
                                const others = current.filter((selection) => selection.groupId !== group.id)
                                const next = group.selection === 'single'
                                    ? (selectedIds[0] === optionId ? (group.required ? [optionId] : []) : [optionId])
                                    : (selectedIds.includes(optionId) ? selectedIds.filter((id) => id !== optionId) : [...selectedIds, optionId])
                                return [...others, ...next.map((id) => ({ groupId: group.id, optionId: id }))]
                            })
                            return <fieldset key={group.id}>
                                <legend>{label(group.names)}{group.required ? ' *' : ''}</legend>
                                <div className='choice-grid'>
                                    {group.options.map((option) => <button key={option.id} className={selectedIds.includes(option.id) ? 'selected' : ''} onClick={() => choose(option.id)}>{label(option.names)}</button>)}
                                </div>
                            </fieldset>
                        })}
                        {selected.type === 'combo' && (selected.components?.length || 0) > 0 && (
                            <fieldset className='combo-components-fieldset'>
                                <legend>{copy.comboComponents}</legend>
                                <div className='component-list'>
                                    {componentSelections.map((selection, index) => {
                                        const component = selected.components?.find((entry) => selection.componentId.startsWith(entry.componentId))
                                        if (!component) return null
                                        return <details key={selection.componentId} className='component-card' open={index === 0}>
                                            <summary>{label(component.names)} {(selected.components?.filter((entry) => entry.itemId === component.itemId).length || 0) > 1 ? index + 1 : ''}</summary>
                                            <div className='component-options'>
                                                <div className='choice-grid'>{component.noteOptions.map((choice) => <button key={choice.id} className={selection.noteOptions.includes(choice.id) ? 'selected' : ''} onClick={() => setComponentSelections((current) => current.map((entry) => entry.componentId === selection.componentId ? { ...entry, noteOptions: entry.noteOptions.includes(choice.id) ? entry.noteOptions.filter((id) => id !== choice.id) : [...entry.noteOptions, choice.id] } : entry))}>{label(choice.names)}</button>)}</div>
                                                <textarea value={selection.note || ''} maxLength={40} placeholder={copy.notePlaceholder} onChange={(event) => setComponentSelections((current) => current.map((entry) => entry.componentId === selection.componentId ? { ...entry, note: event.target.value } : entry))} />
                                            </div>
                                        </details>
                                    })}
                                </div>
                            </fieldset>
                        )}
                        {selected.noteOptions.length > 0 && (
                            <fieldset>
                                <legend>{copy.noThanks}</legend>
                                <div className='choice-grid'>
                                    {selected.noteOptions.map((choice) => (
                                        <button
                                            key={choice.id}
                                            className={noteOptions.includes(choice.id) ? 'selected' : ''}
                                            onClick={() => toggle(choice.id, noteOptions, setNoteOptions)}>
                                            {label(choice.names)}
                                        </button>
                                    ))}
                                </div>
                            </fieldset>
                        )}
                        {selected.addons.length > 0 && (
                            <fieldset>
                                <legend>{copy.addons}</legend>
                                <div className='addon-list'>
                                    {selected.addons.map((addon) => {
                                        const displayPrice = addon.displayPrice ?? addon.priceExtra
                                        return (
                                            <button
                                                key={addon.id}
                                                disabled={addon.unavailable}
                                                className={addonIds.includes(addon.id) ? 'selected' : ''}
                                                onClick={() => toggle(addon.id, addonIds, setAddonIds)}>
                                                <span>{label(addon.names)}{addon.unavailable ? <span className='unavailable-label'> ({copy.unavailable})</span> : ''}</span>
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
                                        (selected.price +
                                            selected.addons
                                                .filter((addon) => addonIds.includes(addon.id))
                                                .reduce((sum, addon) => sum + addon.priceExtra, 0)),
                                    locale,
                                )}
                            </strong>
                            <button className='primary-button' onClick={addToCart}>
                                {editingKey ? copy.updateItem : copy.addToCart}
                            </button>
                        </div>
                    </section>
                </div>
            )}
        </main>
        </>
    )
}
