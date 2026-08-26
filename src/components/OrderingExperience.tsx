'use client'

import { useEffect, useMemo, useState } from 'react'
import { io } from 'socket.io-client'
import { type Locale, t } from '@/lib/i18n'

type Text = Record<Locale, string>
type Choice = { id: string; names: Text }
type Addon = Choice & { priceExtra: number; unavailable?: boolean }
type MenuItem = {
    id: string
    category: Text
    names: Text
    description: Text
    price: number
    variants: Choice[]
    noteOptions: Choice[]
    addons: Addon[]
    unavailable?: boolean
    art: string
}
type CartItem = {
    key: string
    product: MenuItem
    quantity: number
    variant: string
    noteOptions: string[]
    addons: Addon[]
    note: string
}

const text = (vi: string, en: string, zh: string): Text => ({ vi, en, 'zh-TW': zh })
const sampleMenu: MenuItem[] = [
    {
        id: 'beef-pho',
        category: text('Món nước', 'Noodle soup', '湯麵'),
        names: text('Phở bò đặc biệt', 'Special beef pho', '特製牛肉河粉'),
        description: text(
            'Nước dùng ninh chậm, bò tái và gầu.',
            'Slow-simmered broth with rare beef and brisket.',
            '慢燉高湯，搭配生牛肉與牛腩。',
        ),
        price: 150,
        variants: [
            { id: 'regular', names: text('Thường', 'Regular', '一般') },
            { id: 'large', names: text('Tô lớn', 'Large', '大碗') },
        ],
        noteOptions: [
            { id: 'no-onion', names: text('Không hành', 'No onion', '不要洋蔥') },
            { id: 'no-cilantro', names: text('Không ngò', 'No cilantro', '不要香菜') },
        ],
        addons: [
            { id: 'beef', names: text('Thêm bò', 'Extra beef', '加牛肉'), priceExtra: 50 },
            { id: 'egg', names: text('Trứng lòng đào', 'Soft egg', '溏心蛋'), priceExtra: 25 },
        ],
        art: '🍜',
    },
    {
        id: 'chicken-rice',
        category: text('Cơm', 'Rice', '飯類'),
        names: text('Cơm gà xối mỡ', 'Crispy chicken rice', '脆皮雞肉飯'),
        description: text(
            'Gà giòn, cơm thơm và nước sốt nhà làm.',
            'Crispy chicken, fragrant rice and house sauce.',
            '酥脆雞肉、香米與自製醬汁。',
        ),
        price: 135,
        variants: [],
        noteOptions: [{ id: 'no-cucumber', names: text('Không dưa leo', 'No cucumber', '不要小黃瓜') }],
        addons: [
            { id: 'rice', names: text('Thêm cơm', 'Extra rice', '加飯'), priceExtra: 20 },
            { id: 'fried-egg', names: text('Trứng ốp la', 'Fried egg', '煎蛋'), priceExtra: 20 },
        ],
        art: '🍗',
    },
    {
        id: 'spring-rolls',
        category: text('Món ăn kèm', 'Sides', '小菜'),
        names: text('Chả giò tôm thịt', 'Prawn spring rolls', '鮮蝦春捲'),
        description: text(
            'Cuốn tươi, rau thơm và sốt đậu phộng.',
            'Fresh rolls with herbs and peanut sauce.',
            '新鮮春捲、香草與花生醬。',
        ),
        price: 85,
        variants: [],
        noteOptions: [],
        addons: [],
        art: '🥢',
    },
    {
        id: 'lemongrass-tea',
        category: text('Đồ uống', 'Drinks', '飲品'),
        names: text('Trà sả tắc', 'Lemongrass citrus tea', '香茅柑橘茶'),
        description: text(
            'Mát lạnh, thơm sả tươi.',
            'Iced and fragrant with fresh lemongrass.',
            '冰涼清新，帶有新鮮香茅香氣。',
        ),
        price: 55,
        variants: [
            { id: 'less-sweet', names: text('Ít ngọt', 'Less sweet', '少糖') },
            { id: 'normal', names: text('Bình thường', 'Regular', '正常甜') },
        ],
        noteOptions: [{ id: 'no-ice', names: text('Không đá', 'No ice', '去冰') }],
        addons: [],
        art: '🧋',
    },
]

export default function OrderingExperience({ qrToken }: { qrToken: string }) {
    const [locale, setLocale] = useState<Locale>('vi')
    const [category, setCategory] = useState('all')
    const [selected, setSelected] = useState<MenuItem | null>(null)
    const [quantity, setQuantity] = useState(1)
    const [variant, setVariant] = useState('')
    const [notes, setNotes] = useState<string[]>([])
    const [addons, setAddons] = useState<Addon[]>([])
    const [note, setNote] = useState('')
    const [cart, setCart] = useState<CartItem[]>([])
    const [sentNumber, setSentNumber] = useState<number | null>(null)
    const [menu, setMenu] = useState<MenuItem[]>([])
    const [tableCode, setTableCode] = useState('')
    const [realtimeToken, setRealtimeToken] = useState('')
    const [refreshVersion, setRefreshVersion] = useState(0)
    const [loading, setLoading] = useState(true)
    const [loadFailed, setLoadFailed] = useState(false)
    const [sending, setSending] = useState(false)
    const copy = t(locale)
    const label = (value: Text) => value[locale] || value.vi
    const price = (amount: number) =>
        new Intl.NumberFormat(locale === 'zh-TW' ? 'zh-TW' : locale, {
            style: 'currency',
            currency: 'TWD',
            maximumFractionDigits: 0,
        }).format(amount)
    const categories = useMemo(
        () => [...new Map(menu.map((item) => [item.category.vi, item.category])).values()],
        [menu],
    )
    const visible = category === 'all' ? menu : menu.filter((item) => item.category.vi === category)
    const total = cart.reduce(
        (sum, line) =>
            sum +
            line.quantity * (line.product.price + line.addons.reduce((extra, addon) => extra + addon.priceExtra, 0)),
        0,
    )
    useEffect(() => {
        let active = true
        const endpoint = `${(process.env.NEXT_PUBLIC_ORDER_API_BASE_URL || '').replace(/\/$/, '')}/api/public/qr/${encodeURIComponent(qrToken)}`
        void fetch(endpoint)
            .then(async (response) => {
                if (!response.ok) throw new Error('menu request failed')
                return response.json()
            })
            .then((payload) => {
                if (!active) return
                setMenu(payload.data.items)
                setTableCode(payload.data.table.code)
                setRealtimeToken(payload.data.realtimeToken)
                setLoadFailed(false)
            })
            .catch(() => {
                if (active) setLoadFailed(true)
            })
            .finally(() => {
                if (active) setLoading(false)
            })
        return () => {
            active = false
        }
    }, [qrToken, refreshVersion])
    useEffect(() => {
        if (!realtimeToken) return
        const socket = io(process.env.NEXT_PUBLIC_ORDER_API_BASE_URL || undefined, {
            transports: ['websocket'],
            auth: { publicToken: realtimeToken, clientType: 'customer' },
        })
        const refresh = () => setRefreshVersion((value) => value + 1)
        for (const event of [
            'catalog.item.updated',
            'catalog.store-item.price.updated',
            'catalog.store-item.availability.updated',
            'catalog.store-addon.updated',
            'catalog.store-addon.availability.updated',
            'catalog.changed',
        ])
            socket.on(event, refresh)
        socket.on('connect_error', refresh)
        return () => {
            socket.removeAllListeners()
            socket.disconnect()
        }
    }, [realtimeToken])
    const open = (item: MenuItem) => {
        setSelected(item)
        setQuantity(1)
        setVariant(item.variants[0]?.id ?? '')
        setNotes([])
        setAddons([])
        setNote('')
    }
    const toggle = (id: string) =>
        setNotes((old) => (old.includes(id) ? old.filter((value) => value !== id) : [...old, id]))
    const toggleAddon = (addon: Addon) =>
        !addon.unavailable &&
        setAddons((old) =>
            old.some((value) => value.id === addon.id) ? old.filter((value) => value.id !== addon.id) : [...old, addon],
        )
    const add = () => {
        if (!selected) return
        setCart((old) => [
            ...old,
            { key: crypto.randomUUID(), product: selected, quantity, variant, noteOptions: notes, addons, note },
        ])
        setSelected(null)
    }
    const update = (key: string, next: number) =>
        setCart((old) =>
            next < 1
                ? old.filter((line) => line.key !== key)
                : old.map((line) => (line.key === key ? { ...line, quantity: next } : line)),
        )
    const send = () => {
        if (cart.length) {
            setSentNumber(Math.floor(10 + Math.random() * 90))
            setCart([])
        }
    }
    const sendOrder = async () => {
        if (!cart.length || sending) return
        setSending(true)
        try {
            const base = (process.env.NEXT_PUBLIC_ORDER_API_BASE_URL || '').replace(/\/$/, '')
            const created = await fetch(`${base}/api/public/qr/${encodeURIComponent(qrToken)}/carts`, {
                method: 'POST',
            })
            if (!created.ok) throw new Error()
            const cartToken = (await created.json()).data.cartToken
            const lines = cart.map((line) => ({
                itemId: line.product.id,
                quantity: line.quantity,
                variant: line.variant || undefined,
                noteOptions: line.noteOptions,
                addonIds: line.addons.map((addon) => addon.id),
                note: line.note,
            }))
            const updated = await fetch(`${base}/api/public/carts/${cartToken}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ lines }),
            })
            if (!updated.ok) throw new Error()
            const confirmed = await fetch(`${base}/api/public/carts/${cartToken}/confirm`, { method: 'POST' })
            if (!confirmed.ok) throw new Error()
            setSentNumber((await confirmed.json()).data.number)
            setCart([])
        } finally {
            setSending(false)
        }
    }
    if (loading || loadFailed)
        return (
            <main className='page'>
                <section className='card' aria-live='polite'>
                    <div className='brand'>{copy.brand}</div>
                    <h1>{loadFailed ? copy.menuUnavailable : copy.qrMenuLoading}</h1>
                    <p>{loadFailed ? copy.menuUnavailableDescription : copy.qrMenuDescription}</p>
                </section>
            </main>
        )
    if (sentNumber !== null)
        return (
            <main className='order-shell'>
                <section className='success-card'>
                    <div className='success-mark'>✓</div>
                    <p className='eyebrow'>{copy.brand}</p>
                    <h1>{copy.orderSent}</h1>
                    <p>{copy.orderSentDescription}</p>
                    <strong className='order-number'>#{sentNumber}</strong>
                    <button className='primary-button' onClick={() => setSentNumber(null)}>
                        {copy.newOrder}
                    </button>
                </section>
            </main>
        )
    return (
        <main className='order-shell'>
            <header className='menu-header'>
                <div>
                    <p className='eyebrow'>{copy.brand}</p>
                    <h1>{copy.brand}</h1>
                    <p className='header-copy'>{copy.qrMenuDescription}</p>
                </div>
                <div className='header-tools'>
                    <span className='table-badge'>
                        {copy.table} <strong>{tableCode}</strong>
                    </span>
                    <label className='locale-picker'>
                        <span className='sr-only'>{copy.language}</span>
                        <select value={locale} onChange={(event) => setLocale(event.target.value as Locale)}>
                            <option value='vi'>VI</option>
                            <option value='en'>EN</option>
                            <option value='zh-TW'>繁中</option>
                        </select>
                    </label>
                </div>
            </header>
            <nav className='category-tabs' aria-label={copy.categories}>
                <button className={category === 'all' ? 'active' : ''} onClick={() => setCategory('all')}>
                    {copy.all}
                </button>
                {categories.map((value) => (
                    <button
                        key={value.vi}
                        className={category === value.vi ? 'active' : ''}
                        onClick={() => setCategory(value.vi)}>
                        {label(value)}
                    </button>
                ))}
            </nav>
            <section className='menu-grid'>
                {visible.map((item) => (
                    <article className='menu-card' key={item.id}>
                        <div className='dish-art' aria-hidden='true'>
                            🍽️
                        </div>
                        <div className='menu-card-copy'>
                            <p className='menu-name'>{label(item.names)}</p>
                            <p className='menu-description'>{label(item.description)}</p>
                            <div className='menu-card-footer'>
                                <strong>{price(item.price)}</strong>
                                <button disabled={item.unavailable} onClick={() => open(item)}>
                                    {item.unavailable ? copy.unavailable : copy.add}
                                </button>
                            </div>
                        </div>
                    </article>
                ))}
            </section>
            <aside className='cart-dock'>
                <div className='cart-heading'>
                    <div>
                        <p className='eyebrow'>{copy.cart}</p>
                        <span>
                            {cart.reduce((count, line) => count + line.quantity, 0)} {copy.item}
                        </span>
                    </div>
                    <strong>{price(total)}</strong>
                </div>
                {cart.length === 0 ? (
                    <p className='cart-empty'>{copy.cartEmptyDescription}</p>
                ) : (
                    <div className='cart-lines'>
                        {cart.map((line) => (
                            <div className='cart-line' key={line.key}>
                                <div>
                                    <strong>{label(line.product.names)}</strong>
                                    <small>
                                        {[
                                            line.variant &&
                                                label(
                                                    line.product.variants.find((item) => item.id === line.variant)
                                                        ?.names ?? text('', '', ''),
                                                ),
                                            ...line.addons.map((item) => label(item.names)),
                                        ]
                                            .filter(Boolean)
                                            .join(' · ')}
                                    </small>
                                </div>
                                <div className='line-actions'>
                                    <button
                                        aria-label={copy.decreaseQuantity}
                                        onClick={() => update(line.key, line.quantity - 1)}>
                                        −
                                    </button>
                                    <span>{line.quantity}</span>
                                    <button
                                        aria-label={copy.increaseQuantity}
                                        onClick={() => update(line.key, line.quantity + 1)}>
                                        +
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
                <button className='primary-button send-button' disabled={!cart.length} onClick={send}>
                    {copy.sendOrder}
                    <span>→</span>
                </button>
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
                                ×
                            </button>
                        </div>
                        <div className='quantity-row'>
                            <span>{copy.quantity}</span>
                            <div className='stepper'>
                                <button
                                    aria-label={copy.decreaseQuantity}
                                    onClick={() => setQuantity((value) => Math.max(1, value - 1))}>
                                    −
                                </button>
                                <strong>{quantity}</strong>
                                <button
                                    aria-label={copy.increaseQuantity}
                                    onClick={() => setQuantity((value) => value + 1)}>
                                    +
                                </button>
                            </div>
                        </div>
                        {selected.variants.length > 0 && (
                            <fieldset>
                                <legend>{copy.variant}</legend>
                                <div className='choice-grid'>
                                    {selected.variants.map((item) => (
                                        <button
                                            key={item.id}
                                            className={variant === item.id ? 'selected' : ''}
                                            onClick={() => setVariant(item.id)}>
                                            {label(item.names)}
                                        </button>
                                    ))}
                                </div>
                            </fieldset>
                        )}
                        {selected.noteOptions.length > 0 && (
                            <fieldset>
                                <legend>{copy.noThanks}</legend>
                                <div className='choice-grid'>
                                    {selected.noteOptions.map((item) => (
                                        <button
                                            key={item.id}
                                            className={notes.includes(item.id) ? 'selected' : ''}
                                            onClick={() => toggle(item.id)}>
                                            {label(item.names)}
                                        </button>
                                    ))}
                                </div>
                            </fieldset>
                        )}
                        {selected.addons.length > 0 && (
                            <fieldset>
                                <legend>{copy.addons}</legend>
                                <div className='addon-list'>
                                    {selected.addons.map((item) => (
                                        <button
                                            key={item.id}
                                            disabled={item.unavailable}
                                            className={addons.some((value) => value.id === item.id) ? 'selected' : ''}
                                            onClick={() => toggleAddon(item)}>
                                            <span>{label(item.names)}</span>
                                            <strong>+{price(item.priceExtra)}</strong>
                                        </button>
                                    ))}
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
                                {price(
                                    quantity *
                                        (selected.price + addons.reduce((sum, item) => sum + item.priceExtra, 0)),
                                )}
                            </strong>
                            <button className='primary-button' onClick={add}>
                                {copy.addToCart}
                            </button>
                        </div>
                    </section>
                </div>
            )}
        </main>
    )
}
