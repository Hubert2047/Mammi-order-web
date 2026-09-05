"use client";

import {
  Fragment,
  useEffect,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { io } from "socket.io-client";
import { type Locale, t } from "@/lib/i18n";
import CartLineItem from "@/components/CartLineItem";
import CartPanelHeader from "@/components/CartPanelHeader";
import OnlineCartDrawer from "@/components/OnlineCartDrawer";
import MobileCategoryTabs from "@/components/MobileCategoryTabs";
import MobileMenuItemCard from "@/components/MobileMenuItemCard";
import MobileStoreFooter from "@/components/MobileStoreFooter";
import MenuLoadingState from "@/components/MenuLoadingState";
import { storeFooter } from "@/lib/storeFooter";

type Text = Record<Locale, string>;
type Choice = { id: string; names: Text };
type OptionGroup = {
  id: string;
  names: Text;
  selection: "single" | "multiple";
  required: boolean;
  defaultOptionId?: string;
  options: Choice[];
};
type Addon = Choice & {
  priceExtra: number;
  displayPrice?: number;
  unavailable?: boolean;
};
type Component = {
  componentId: string;
  itemId: string;
  quantity: number;
  names: Text;
  noteOptions: Choice[];
};
type ComponentSelection = {
  componentId: string;
  itemId: string;
  noteOptions: string[];
  note?: string;
};
type MenuItem = {
  id: string;
  type?: "product" | "combo";
  category: { id: string; names: Text; sortOrder?: number };
  names: Text;
  description: Text;
  imageUrl?: string;
  recommended?: boolean;
  popular?: boolean;
  new?: boolean;
  promotion?: boolean;
  price: number;
  displayPrice?: number;
  unavailable?: boolean;
  variants: Choice[];
  optionGroups: OptionGroup[];
  noteOptions: Choice[];
  addons: Addon[];
  components?: Component[];
};
type CartLine = {
  key: string;
  itemId: string;
  quantity: number;
  variant?: string;
  optionSelections?: { groupId: string; optionId: string }[];
  noteOptions: string[];
  addonIds: string[];
  note?: string;
  componentSelections?: ComponentSelection[];
};
type UnavailableCartItem = {
  kind: "item" | "addon";
  name: string;
  addonName: string;
};
type OrderType = "dine_in" | "takeaway";

declare global {
  interface Window {
    turnstile?: {
      render: (
        element: HTMLElement,
        options: {
          sitekey: string;
          action: string;
          callback: (token: string) => void;
          "expired-callback": () => void;
          "error-callback": () => void;
        },
      ) => string;
      remove: (widgetId: string) => void;
    };
  }
}

const localeStorageKey = "mammi-order-locale-v2";
const cartStorageKey = "mammi-online-cart-v1";
const cartTokenStorageKey = "mammi-online-cart-token-v1";
const onlineOrderingEnabled =
  process.env.NEXT_PUBLIC_ONLINE_ORDERING_ENABLED === "true";
const createKey = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
const detectLocale = (): Locale => {
  if (typeof navigator === "undefined") return "vi";
  const saved = window.localStorage.getItem(localeStorageKey);
  if (saved === "vi" || saved === "en" || saved === "zh-TW") return saved;
  const language = navigator.language.toLowerCase();
  if (language.startsWith("zh")) return "zh-TW";
  if (language.startsWith("en")) return "en";
  return "vi";
};
const formatPrice = (amount: number, locale: Locale) =>
  new Intl.NumberFormat(locale === "zh-TW" ? "zh-TW" : locale, {
    style: "currency",
    currency: "TWD",
    maximumFractionDigits: 0,
  }).format(amount);
const scrollTextareaIntoView = (element: HTMLTextAreaElement) => {
  let settled = false;
  let fallbackTimer: number | undefined;
  const viewport = window.visualViewport;
  const scroll = () => {
    if (settled) return;
    settled = true;
    viewport?.removeEventListener("resize", scroll);
    if (fallbackTimer !== undefined) window.clearTimeout(fallbackTimer);
    element.scrollIntoView({ behavior: "smooth", block: "center" });
  };
  viewport?.addEventListener("resize", scroll, { once: true });
  fallbackTimer = window.setTimeout(scroll, 450);
};
const taipeiInputValue = (date: Date) =>
  new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 16);

export default function OnlineOrder() {
  const [locale, setLocale] = useState<Locale>("vi");
  const [items, setItems] = useState<MenuItem[]>([]);
  const [storeName, setStoreName] = useState("");
  const [realtimeToken, setRealtimeToken] = useState("");
  const [category, setCategory] = useState("all");
  const [type, setType] = useState<OrderType>("dine_in");
  const [cartToken, setCartToken] = useState(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem(cartTokenStorageKey) || "";
  });
  const [cart, setCart] = useState<CartLine[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const saved = JSON.parse(
        window.localStorage.getItem(cartStorageKey) || "[]",
      );
      return Array.isArray(saved) ? saved : [];
    } catch {
      return [];
    }
  });
  const [promotionTotal, setPromotionTotal] = useState<number | null>(null);
  const [selected, setSelected] = useState<MenuItem | null>(null);
  const [customiseSheetFull, setCustomiseSheetFull] = useState(false);
  const [editingLineKey, setEditingLineKey] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [variant, setVariant] = useState("");
  const [optionSelections, setOptionSelections] = useState<
    { groupId: string; optionId: string }[]
  >([]);
  const [noteOptions, setNoteOptions] = useState<string[]>([]);
  const [addonIds, setAddonIds] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [componentSelections, setComponentSelections] = useState<
    ComponentSelection[]
  >([]);
  const [customer, setCustomer] = useState({
    phone: "",
    name: "",
    address: "",
  });
  const [pickupAt, setPickupAt] = useState(() =>
    taipeiInputValue(new Date(Date.now() + 60 * 60 * 1000)),
  );
  const [loading, setLoading] = useState(true);
  const [menuReady, setMenuReady] = useState(false);
  const [loadingScreenVisible, setLoadingScreenVisible] = useState(true);
  const [loadingScreenLeaving, setLoadingScreenLeaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [orderRateLimited, setOrderRateLimited] = useState(false);
  const [sending, setSending] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [pricingChanged, setPricingChanged] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [cartAvailabilityError, setCartAvailabilityError] = useState(false);
  const [turnstileReady, setTurnstileReady] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileError, setTurnstileError] = useState(false);
  const widgetId = useRef<string | null>(null);
  const customiseSheetRef = useRef<HTMLElement | null>(null);
  const menuGridRef = useRef<HTMLDivElement | null>(null);
  const cartLinesRef = useRef<HTMLDivElement | null>(null);
  const cartFocusKeyRef = useRef<string | null>(null);
  const restoreCartFocus = useCallback((panel: HTMLDivElement | null) => {
    cartLinesRef.current = panel;
    if (!panel || !cartFocusKeyRef.current) return;
    window.requestAnimationFrame(() => {
      const lineKey = cartFocusKeyRef.current;
      if (!lineKey || cartLinesRef.current !== panel) return;
      const target = Array.from(
        panel.querySelectorAll<HTMLElement>("[data-cart-line-key]"),
      ).find(
        (element) =>
          element.dataset.cartLineKey === lineKey &&
          element.getClientRects().length > 0,
      );
      if (!target) return;
      target.scrollIntoView({
        block: "center",
        inline: "nearest",
        behavior: "auto",
      });
      cartFocusKeyRef.current = null;
    });
  }, []);
  const quoteCache = useRef<{
    key: string;
    total: number;
    expiresAt: number;
    quoteToken: string;
  } | null>(null);
  const [completed, setCompleted] = useState<number | null>(null);
  const copy = t(locale);
  const base = "";
  useLayoutEffect(() => {
    const modalOpen = Boolean(selected || cartOpen || checkoutOpen);
    if (!modalOpen) return;
    // Desktop overlays keep their own scroll area. Preserve the page gutter
    // while locking the document so the storefront does not shift horizontally.
    if (selected)
      customiseSheetRef.current?.scrollTo({ top: 0, behavior: "auto" });
    const desktop = window.matchMedia("(min-width: 650px)").matches;
    if (desktop) {
      const previousBodyOverflow = document.body.style.overflow;
      const previousHtmlOverflow = document.documentElement.style.overflow;
      const previousScrollbarGutter =
        document.documentElement.style.scrollbarGutter;
      document.body.style.overflow = "hidden";
      document.documentElement.style.overflow = "hidden";
      document.documentElement.style.scrollbarGutter = "stable";
      return () => {
        document.body.style.overflow = previousBodyOverflow;
        document.documentElement.style.overflow = previousHtmlOverflow;
        document.documentElement.style.scrollbarGutter = previousScrollbarGutter;
      };
    }
    const previousOverflow = document.body.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPaddingRight;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, [selected, cartOpen, checkoutOpen]);
  useLayoutEffect(() => {
    if (!selected) {
      setCustomiseSheetFull(false);
      return;
    }
    const sheet = customiseSheetRef.current;
    if (!sheet) return;
    const updateHeightState = () => {
      setCustomiseSheetFull(
        sheet.getBoundingClientRect().height >= window.innerHeight - 1,
      );
    };
    updateHeightState();
    const observer = new ResizeObserver(updateHeightState);
    observer.observe(sheet);
    window.addEventListener("resize", updateHeightState);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateHeightState);
    };
  }, [selected]);
  useEffect(() => {
    if (
      !Boolean(selected || cartOpen || checkoutOpen) ||
      !window.matchMedia("(min-width: 650px)").matches
    )
      return;

    const isOverlayContent = (target: EventTarget | null) =>
      target instanceof Element &&
      Boolean(
        target.closest(
          ".customise-sheet, .checkout-card, .online-cart",
        ),
      );
    const preventOutsideScroll = (event: Event) => {
      if (!isOverlayContent(event.target)) event.preventDefault();
    };
    const preventOutsideScrollKeys = (event: KeyboardEvent) => {
      if (
        isOverlayContent(event.target) ||
        !["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End", " "].includes(
          event.key,
        )
      )
        return;
      event.preventDefault();
    };

    window.addEventListener("wheel", preventOutsideScroll, {
      capture: true,
      passive: false,
    });
    window.addEventListener("touchmove", preventOutsideScroll, {
      capture: true,
      passive: false,
    });
    window.addEventListener("keydown", preventOutsideScrollKeys, true);
    return () => {
      window.removeEventListener("wheel", preventOutsideScroll, true);
      window.removeEventListener("touchmove", preventOutsideScroll, true);
      window.removeEventListener("keydown", preventOutsideScrollKeys, true);
    };
  }, [selected, cartOpen, checkoutOpen]);
  const label = (value: Text) => value[locale] || value.vi;
  useEffect(() => {
    window.localStorage.setItem(cartStorageKey, JSON.stringify(cart));
  }, [cart]);
  useEffect(() => {
    if (cartToken) window.localStorage.setItem(cartTokenStorageKey, cartToken);
    else window.localStorage.removeItem(cartTokenStorageKey);
  }, [cartToken]);
  const smartCategories = [
    {
      id: "__recommended__",
      key: "recommended" as const,
      names: {
        vi: copy.recommended,
        en: copy.recommended,
        "zh-TW": copy.recommended,
      },
    },
    {
      id: "__popular__",
      key: "popular" as const,
      names: { vi: copy.popular, en: copy.popular, "zh-TW": copy.popular },
    },
    {
      id: "__new__",
      key: "new" as const,
      names: {
        vi: copy.newProduct,
        en: copy.newProduct,
        "zh-TW": copy.newProduct,
      },
    },
    {
      id: "__promotion__",
      key: "promotion" as const,
      names: {
        vi: copy.promotion,
        en: copy.promotion,
        "zh-TW": copy.promotion,
      },
    },
  ];
  const categories = useMemo(
    () => [
      ...smartCategories
        .filter((entry) => items.some((item) => item[entry.key] === true))
        .map((entry) => ({ id: entry.id, names: entry.names })),
      ...[
        ...new Map(
          items.map((item) => [item.category.id, item.category]),
        ).values(),
      ].sort(
        (left, right) =>
          (left.sortOrder ?? 0) - (right.sortOrder ?? 0) ||
          left.id.localeCompare(right.id),
      ),
    ],
    [items, locale],
  );
  useEffect(() => {
    if (category === "all" || categories.some((entry) => entry.id === category))
      return;
    setCategory("all");
  }, [categories, category]);
  useEffect(() => {
    menuGridRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [category]);
  const visibleItems =
    category === "all"
      ? items
      : category.startsWith("__")
        ? items.filter((item) => {
            const smart = smartCategories.find(
              (entry) => entry.id === category,
            );
            return smart ? item[smart.key] === true : false;
          })
        : items.filter((item) => item.category.id === category);
  const linePrice = (line: CartLine) => {
    const item = items.find((candidate) => candidate.id === line.itemId);
    return (
      (item?.displayPrice ?? item?.price ?? 0) +
      (item?.addons
        .filter((addon) => line.addonIds.includes(addon.id))
        .reduce(
          (sum, addon) => sum + (addon.displayPrice ?? addon.priceExtra),
          0,
        ) || 0)
    );
  };
  const lineOriginalPrice = (line: CartLine) => {
    const item = items.find((candidate) => candidate.id === line.itemId);
    return (
      (item?.price ?? 0) +
      (item?.addons
        .filter((addon) => line.addonIds.includes(addon.id))
        .reduce((sum, addon) => sum + addon.priceExtra, 0) || 0)
    );
  };
  const catalogTotal = useMemo(
    () => cart.reduce((sum, line) => sum + line.quantity * linePrice(line), 0),
    [cart, items],
  );
  const originalCatalogTotal = useMemo(
    () =>
      cart.reduce(
        (sum, line) => sum + line.quantity * lineOriginalPrice(line),
        0,
      ),
    [cart, items],
  );
  const currentQuoteKey = useMemo(
    () => JSON.stringify(cart.map(({ key, ...line }) => line)),
    [cart],
  );
  const total =
    quoteCache.current?.key === currentQuoteKey &&
    quoteCache.current.expiresAt > Date.now() &&
    promotionTotal !== null
      ? promotionTotal
      : catalogTotal;
  const originalTotal =
    originalCatalogTotal > total
      ? formatPrice(originalCatalogTotal, locale)
      : undefined;
  const count = cart.reduce((sum, line) => sum + line.quantity, 0);
  const unavailableCartItems: UnavailableCartItem[] = cart.flatMap(
    (line): UnavailableCartItem[] => {
      const item = items.find((candidate) => candidate.id === line.itemId);
      if (!item) return [];
      if (item.unavailable)
        return [
          { kind: "item" as const, name: label(item.names), addonName: "" },
        ];
      return item.addons
        .filter(
          (addon) => line.addonIds.includes(addon.id) && addon.unavailable,
        )
        .map((addon) => ({
          kind: "addon" as const,
          name: label(item.names),
          addonName: label(addon.names),
        }));
    },
  ).filter(
    (entry, index, entries) =>
      entries.findIndex(
        (candidate) =>
          candidate.kind === entry.kind &&
          candidate.name === entry.name &&
          candidate.addonName === entry.addonName,
      ) === index,
  );
  useEffect(() => {
    if (!unavailableCartItems.length) setCartAvailabilityError(false);
  }, [unavailableCartItems.length]);

  const openCart = async (nextCart = cart) => {
    if (!nextCart.length) {
      setCartOpen(true);
      return;
    }
    setCartOpen(true);
    if (!cartToken) return;

    const lines = nextCart.map(({ key, ...line }) => line);
    const quoteKey = JSON.stringify(lines);
    const cached = quoteCache.current;
    if (cached && cached.key === quoteKey && cached.expiresAt > Date.now()) {
      setPromotionTotal(cached.total);
      setQuoteLoading(false);
      setCartOpen(true);
      return;
    }

    setQuoteLoading(true);
    try {
      const response = await fetch(
        `${base}/api/public/carts/${cartToken}/preview`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lines }),
        },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        if (
          payload?.code === "ITEM_TEMPORARILY_UNAVAILABLE" ||
          payload?.code === "ADDON_TEMPORARILY_UNAVAILABLE"
        ) {
          setCartAvailabilityError(true);
          setCartOpen(true);
        }
        return;
      }
      const quoteTotal = payload?.data?.total;
      const expiresAt = Date.parse(payload?.data?.expiresAt || "");
      const quoteToken = payload?.data?.quoteToken;
      if (
        typeof quoteTotal !== "number" ||
        typeof quoteToken !== "string" ||
        !Number.isFinite(expiresAt)
      )
        return;

      quoteCache.current = {
        key: quoteKey,
        total: quoteTotal,
        expiresAt,
        quoteToken,
      };
      setPromotionTotal(quoteTotal);
      setCartOpen(true);
    } finally {
      setQuoteLoading(false);
    }
  };

  const load = async () => {
    try {
      const response = await fetch(`${base}/api/public/online`);
      if (!response.ok) throw new Error();
      const payload = (await response.json()).data;
      setItems(payload.items);
      setStoreName(payload.store.name);
      setRealtimeToken(payload.realtimeToken);
      let activeCartToken = cartToken;
      if (activeCartToken && onlineOrderingEnabled) {
        const saved = await fetch(`${base}/api/public/carts/${activeCartToken}`);
        const savedPayload = await saved.json().catch(() => null);
        if (!saved.ok || savedPayload?.data?.status !== "draft") {
          window.localStorage.removeItem(cartTokenStorageKey);
          setCartToken("");
          activeCartToken = "";
        }
      }
      if (!activeCartToken && onlineOrderingEnabled) {
        const created = await fetch(`${base}/api/public/online/carts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type }),
        });
        if (!created.ok) throw new Error();
        activeCartToken = (await created.json()).data.cartToken;
        setCartToken(activeCartToken);
      }
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLocale(detectLocale());
    void load();
  }, []);
  useEffect(() => {
    if (loading || failed) return;

    const frame = window.requestAnimationFrame(() => {
      setMenuReady(true);
      setLoadingScreenLeaving(true);
    });
    const timeout = window.setTimeout(
      () => setLoadingScreenVisible(false),
      300,
    );
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
    };
  }, [failed, loading]);
  useEffect(() => {
    if (!realtimeToken) return;
    const socket = io(window.location.origin, {
      transports: ["websocket"],
      auth: { publicToken: realtimeToken, clientType: "customer" },
    });
    const refresh = () => {
      quoteCache.current = null;
      setPromotionTotal(null);
      void load();
    };
    for (const event of [
      "catalog.item.updated",
      "catalog.store-item.price.updated",
      "catalog.store-item.availability.updated",
      "catalog.store-addon.updated",
      "catalog.store-addon.availability.updated",
      "catalog.promotion.updated",
      "catalog.changed",
    ])
      socket.on(event, refresh);
    return () => {
      socket.disconnect();
    };
  }, [realtimeToken]);
  useEffect(() => {
    if (!cartToken || loading || completed !== null || !checkoutOpen) return;
    const lines = cart.map(({ key, ...line }) => line);
    void fetch(`${base}/api/public/carts/${cartToken}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lines, type }),
    });
  }, [cart, cartToken, type, loading, completed, checkoutOpen]);
  useEffect(() => {
    if (!checkoutOpen) return;
    if (window.turnstile) {
      setTurnstileReady(true);
      return;
    }
    const timer = window.setInterval(() => {
      if (window.turnstile) {
        setTurnstileReady(true);
        window.clearInterval(timer);
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [checkoutOpen]);
  useEffect(() => {
    if (
      !checkoutOpen ||
      !turnstileReady ||
      !process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ||
      !window.turnstile
    )
      return;
    const host = document.createElement("div");
    host.className = "turnstile-host";
    document.querySelector(".turnstile-slot")?.append(host);
    if (!host.parentElement) return;
    widgetId.current = window.turnstile.render(host, {
      sitekey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
      action: "online_order",
      callback: setTurnstileToken,
      "expired-callback": () => setTurnstileToken(""),
      "error-callback": () => {
        setTurnstileToken("");
        setTurnstileError(true);
      },
    });
    return () => {
      if (widgetId.current && window.turnstile)
        window.turnstile.remove(widgetId.current);
      host.remove();
      widgetId.current = null;
      setTurnstileToken("");
      setTurnstileError(false);
    };
  }, [checkoutOpen, turnstileReady]);

  const openItem = (item: MenuItem, line?: CartLine) => {
    if (line) cartFocusKeyRef.current = line.key;
    setSelected(item);
    setEditingLineKey(line?.key || null);
    setQuantity(line?.quantity || 1);
    setVariant(line?.variant || item.variants[0]?.id || "");
    setOptionSelections(
      line?.optionSelections ||
        (item.optionGroups || []).flatMap((group) => {
          const optionId =
            group.defaultOptionId ||
            (group.required ? group.options[0]?.id : undefined);
          return optionId ? [{ groupId: group.id, optionId }] : [];
        }),
    );
    setNoteOptions(line?.noteOptions || []);
    setAddonIds(line?.addonIds || []);
    setNote(line?.note || "");
    setComponentSelections(
      line?.componentSelections ||
        (item.components || []).flatMap((component) =>
          Array.from({ length: component.quantity }, (_, index) => ({
            componentId: `${component.componentId}-${index}`,
            itemId: component.itemId,
            noteOptions: [],
            note: "",
          })),
        ),
    );
  };
  const closeItem = () => {
    const wasEditing = Boolean(editingLineKey);
    setSelected(null);
    setEditingLineKey(null);
    if (wasEditing) void openCart();
  };
  const addToCart = () => {
    if (!selected) return;
    const wasEditing = Boolean(editingLineKey);
    const nextLine: CartLine = {
      key: editingLineKey || createKey(),
      itemId: selected.id,
      quantity,
      variant: variant || undefined,
      optionSelections: selected.type === "combo" ? [] : optionSelections,
      noteOptions: selected.type === "combo" ? [] : noteOptions,
      addonIds: selected.type === "combo" ? [] : addonIds,
      note: note.trim() || undefined,
      componentSelections:
        selected.type === "combo" ? componentSelections : undefined,
    };
    const nextCart = editingLineKey
      ? cart.map((line) => (line.key === editingLineKey ? nextLine : line))
      : [...cart, nextLine];
    setCart(nextCart);
    setSelected(null);
    setEditingLineKey(null);
    if (wasEditing) void openCart(nextCart);
  };
  const updateQuantity = (key: string, next: number) => {
    const nextCart =
      next < 1
        ? cart.filter((line) => line.key !== key)
        : cart.map((line) =>
            line.key === key ? { ...line, quantity: next } : line,
          );
    setCart(nextCart);
    if (cartOpen) {
      void openCart(nextCart);
    }
  };
  const confirm = async () => {
    if (
      !cartToken ||
      !cart.length ||
      !customer.phone.trim() ||
      !turnstileToken ||
      sending
    )
      return;
    setSending(true);
    try {
      const lines = cart.map(({ key, ...line }) => line);
      const synced = await fetch(`${base}/api/public/carts/${cartToken}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lines, type }),
      });
      if (!synced.ok) throw new Error();
      const response = await fetch(
        `${base}/api/public/carts/${cartToken}/confirm`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            customer,
            turnstileToken,
            quoteToken:
              quoteCache.current?.key === JSON.stringify(lines) &&
              quoteCache.current.expiresAt > Date.now()
                ? quoteCache.current.quoteToken
                : "",
            pickupAt: new Date(`${pickupAt}:00+08:00`).toISOString(),
          }),
        },
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        if (payload?.code === "ONLINE_ORDER_RATE_LIMITED") {
          setOrderRateLimited(true);
          setFailed(true);
          return;
        }
        if (payload?.code === "ORDER_PRICING_CHANGED") {
          const pricing = payload?.data?.pricing;
          const quoteToken = payload?.data?.quoteToken;
          const expiresAt = Date.parse(payload?.data?.expiresAt || "");
          if (
            typeof pricing?.total === "number" &&
            typeof quoteToken === "string" &&
            Number.isFinite(expiresAt)
          ) {
            quoteCache.current = {
              key: JSON.stringify(lines),
              total: pricing.total,
              expiresAt,
              quoteToken,
            };
            setPromotionTotal(pricing.total);
          }
          setPricingChanged(true);
          void load();
          return;
        }
        throw new Error();
      }
      setCompleted((await response.json()).data.number);
      setCart([]);
      window.localStorage.removeItem(cartStorageKey);
      setCartToken("");
      window.localStorage.removeItem(cartTokenStorageKey);
      setCheckoutOpen(false);
    } catch {
      setFailed(true);
    } finally {
      setSending(false);
    }
  };

  if (failed)
    return (
      <MenuLoadingState
        title={failed ? copy.menuUnavailable : undefined}
        description={
          failed
            ? orderRateLimited
              ? copy.onlineOrderRateLimited
              : copy.menuUnavailableDescription
            : undefined
        }
      />
    );
  if (completed !== null)
    return (
      <main className="grid min-h-svh place-items-center bg-[#f8f6f1] p-6">
        <section className="w-full max-w-[440px] rounded-[28px] bg-white px-7 py-9 text-center shadow-[0_18px_50px_rgba(0,0,0,0.12)]">
          <div className="mx-auto mb-[17px] grid size-[60px] place-items-center rounded-full bg-green-100 text-[2rem] font-extrabold text-green-700">
            ✓
          </div>
          <p className="mb-2 text-sm font-bold uppercase tracking-[0.12em] text-[#5f8c25]">
            {copy.brand}
          </p>
          <h1 className="my-2 text-[clamp(1.7rem,7vw,2.35rem)] tracking-[-0.04em]">
            {copy.orderSent}
          </h1>
          <strong className="my-6 block text-[4.3rem] tracking-[-0.08em] text-[#8ac545]">
            #{completed}
          </strong>
          <p className="mb-6 text-base leading-[1.65] text-gray-600">
            {copy.onlineOrderSentDescription}
          </p>
          <button
            className="w-full rounded-xl bg-[#8ac545] px-5 py-3 font-bold text-white shadow-sm transition hover:bg-[#78b136] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5f8c25]"
            onClick={() => {
              setCompleted(null);
              void load();
            }}
          >
            {copy.newOrder}
          </button>
        </section>
      </main>
    );

  return (
    <>
      {loadingScreenVisible && (
        <MenuLoadingState
          className={`fixed inset-0 z-50 transition-opacity duration-300 ease-out ${loadingScreenLeaving ? "opacity-0" : "opacity-100"}`}
        />
      )}
      <main
        className={`online-shell fixed inset-0 mx-auto flex h-svh min-h-0 w-full flex-col overflow-hidden bg-white px-[18px] pb-0 transition-opacity duration-300 ease-out min-[650px]:!static min-[650px]:!block min-[650px]:!h-auto min-[650px]:!min-h-svh min-[650px]:!w-full min-[650px]:!max-w-[1160px] min-[650px]:!overflow-visible min-[650px]:!bg-transparent min-[650px]:!px-7 min-[650px]:!pb-[72px] ${menuReady ? "opacity-100" : "pointer-events-none opacity-0"}`}
      >
        <div className="online-menu-sticky flex-none max-[649px]:!-mx-[18px] max-[649px]:!w-[calc(100%+36px)] max-[649px]:!px-[18px] max-[649px]:!pt-2 min-[650px]:!static min-[650px]:!m-0 min-[650px]:!w-auto min-[650px]:!bg-transparent min-[650px]:!p-0">
          <header className="menu-header online-header online-menu-header grid min-w-0 w-full items-stretch gap-x-3 gap-y-2 max-[649px]:!grid-cols-[minmax(0,1fr)_auto] max-[649px]:!items-center min-[650px]:!grid-cols-[minmax(0,1fr)_auto] min-[650px]:!min-h-[82px] min-[650px]:!m-0 min-[650px]:!rounded-md min-[650px]:!border min-[650px]:!border-[#dcebd0] min-[650px]:!bg-white/85 min-[650px]:!p-[15px_18px] min-[650px]:!shadow-[0_12px_30px_rgba(61,75,55,0.1)]">
            <div className="brand-lockup flex items-center gap-2.5 max-[649px]:!col-start-1 max-[649px]:!row-start-1 max-[649px]:!justify-self-start min-[650px]:!col-start-1 min-[650px]:!row-start-1 min-[650px]:!gap-[13px]">
              <img
                className="max-[649px]:!col-auto max-[649px]:!row-auto max-[649px]:!h-[54px] max-[649px]:!w-[54px] min-[650px]:!h-16 min-[650px]:!w-16 min-[650px]:!rounded-none min-[650px]:!bg-transparent min-[650px]:!object-contain"
                src="/logo.png"
                alt=""
                width="64"
                height="64"
              />
              <strong className="block max-[649px]:!hidden min-[650px]:text-[1.8rem] min-[650px]:font-black min-[650px]:tracking-[-0.04em] min-[650px]:text-[#294b2d]">
                {copy.brand}
              </strong>
            </div>
            <div className="header-meta flex items-center gap-3 max-[649px]:!col-start-2 max-[649px]:!row-start-1 max-[649px]:!justify-self-end min-[650px]:!col-start-2 min-[650px]:!row-start-1 min-[650px]:!justify-self-end min-[650px]:!gap-2.5">
              {onlineOrderingEnabled && (
                <button
                  className="header-cart online-header-cart inline-flex items-center gap-1 rounded-xl border border-[#d8e9c3] bg-[#f7fbf2] px-[9px] py-[7px] text-[#5f8c25] min-[650px]:!hidden"
                  onClick={() => void openCart()}
                  aria-label={copy.cart}
                >
                  <span aria-hidden="true">🛒</span>
                  <strong>{count}</strong>
                </button>
              )}
              <label>
                <span className="sr-only">{copy.language}</span>
                <select
                  className="min-w-[58px] rounded-[99px] border border-gray-200 bg-white p-2 text-black min-[650px]:!rounded-lg min-[650px]:!border-[#dbe7d1] min-[650px]:!bg-[#f7fbf3] min-[650px]:!text-[#253228]"
                  value={locale}
                  onChange={(event) => {
                    const next = event.target.value as Locale;
                    setLocale(next);
                    window.localStorage.setItem(localeStorageKey, next);
                  }}
                >
                  <option value="vi">VI</option>
                  <option value="en">EN</option>
                  <option value="zh-TW">繁中</option>
                </select>
              </label>
            </div>
          </header>
          {!onlineOrderingEnabled && (
            <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 px-2 py-2 text-center text-xs font-bold text-[#526052] max-[649px]:!py-1 max-[649px]:!text-[0.82rem] min-[650px]:mt-3 min-[650px]:!rounded-md min-[650px]:border min-[650px]:border-[#dcebd0] min-[650px]:bg-[#f3f8ed]">
              <span className="text-[#315b34]">{copy.dineInOnlyNotice}</span>
              <span aria-hidden="true">·</span>
              <span className="max-[649px]:!text-[0.75rem] max-[649px]:!text-[#b42318] min-[650px]:!text-[#b42318]">
                {copy.onlineOrderingComingSoon}
              </span>
            </div>
          )}
          <MobileCategoryTabs
            tabs={[
              { id: "all", label: copy.all },
              ...categories.map((entry) => ({
                id: entry.id,
                label: label(entry.names),
              })),
            ]}
            selectedId={category}
            ariaLabel={copy.categories}
            className="max-[649px]:!mt-0 max-[649px]:!pt-1"
            onSelect={setCategory}
          />
        </div>
        <div className="hidden min-[650px]:!block min-[650px]:!sticky min-[650px]:!top-0 min-[650px]:!z-10 min-[650px]:!self-start min-[650px]:!mt-[22px] min-[650px]:!w-full">
          <nav
            className="category-tabs !hidden min-[650px]:!flex min-[650px]:!w-full min-[650px]:!flex-nowrap min-[650px]:!gap-3 min-[650px]:!overflow-visible min-[650px]:!rounded-md min-[650px]:!border min-[650px]:!border-[#c5d8b7] min-[650px]:!bg-[#edf4e9] min-[650px]:!p-3 min-[650px]:!shadow-[0_8px_22px_rgba(61,75,55,0.07)]"
          aria-label={copy.categories}
          >
          <button
            aria-pressed={category === "all"}
            className="min-[650px]:[&::after]:!hidden min-[650px]:!flex-none min-[650px]:!rounded-md min-[650px]:!border min-[650px]:!border-[#a9c294] min-[650px]:!bg-white min-[650px]:!px-5 min-[650px]:!py-2.5 min-[650px]:!font-extrabold min-[650px]:!text-[#294b2d] min-[650px]:!shadow-[0_3px_8px_rgba(41,75,45,0.1)] min-[650px]:hover:!bg-[#dcefd0] min-[650px]:aria-pressed:!border-[#315b34] min-[650px]:aria-pressed:!bg-[#315b34] min-[650px]:aria-pressed:!text-white"
            onClick={() => setCategory("all")}
          >
            {copy.all}
          </button>
          {categories.map((entry) => (
            <button
              key={entry.id}
              aria-pressed={category === entry.id}
              className="min-[650px]:[&::after]:!hidden min-[650px]:!flex-none min-[650px]:!rounded-md min-[650px]:!border min-[650px]:!border-[#a9c294] min-[650px]:!bg-white min-[650px]:!px-5 min-[650px]:!py-2.5 min-[650px]:!font-extrabold min-[650px]:!text-[#294b2d] min-[650px]:!shadow-[0_3px_8px_rgba(41,75,55,0.1)] min-[650px]:hover:!bg-[#dcefd0] min-[650px]:aria-pressed:!border-[#315b34] min-[650px]:aria-pressed:!bg-[#315b34] min-[650px]:aria-pressed:!text-white"
              onClick={() => setCategory(entry.id)}
            >
              {label(entry.names)}
            </button>
          ))}
          </nav>
        </div>
        <div className="online-layout flex min-h-0 flex-1 flex-col overflow-hidden min-[650px]:!block min-[650px]:!overflow-visible min-[650px]:!pt-[22px]">
          <section className="flex h-full min-h-0 flex-col">
            <div
              ref={menuGridRef}
              className="menu-grid grid min-h-0 flex-1 content-start gap-[18px] overflow-y-auto overscroll-contain px-1 pb-1 touch-auto max-[649px]:!touch-auto min-[650px]:!overflow-visible min-[650px]:!px-0 min-[650px]:!pb-6 min-[650px]:!grid-cols-2 min-[650px]:!gap-4"
            >
              {visibleItems.map((item) => {
                const displayPrice = item.displayPrice ?? item.price;
                return (
                  <Fragment key={item.id}>
                    <MobileMenuItemCard
                      name={label(item.names)}
                      description={label(item.description)}
                      imageUrl={item.imageUrl}
                      badge={
                        item.unavailable
                          ? copy.unavailable
                          : item.recommended
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
                      originalPrice={
                        displayPrice < item.price
                          ? formatPrice(item.price, locale)
                          : undefined
                      }
                      addLabel={
                        onlineOrderingEnabled ? copy.add : copy.dineInOnlyNotice
                      }
                      disabled={item.unavailable}
                      unavailable={item.unavailable}
                      showAction={onlineOrderingEnabled && !item.unavailable}
                      onAdd={() =>
                        onlineOrderingEnabled &&
                        !item.unavailable &&
                        openItem(item)
                      }
                    />
                    <article className="relative !hidden min-h-[154px] overflow-hidden rounded-[18px] border border-[#dbe7d1] bg-white shadow-[0_7px_20px_rgba(61,75,55,0.1)] transition-[box-shadow,border-color,background-color] duration-200 hover:shadow-[0_12px_26px_rgba(61,75,55,0.15)] min-[650px]:!flex min-[650px]:!flex-row">
                      <div
                        className="grid h-[154px] w-[154px] flex-[0_0_154px] place-items-center bg-[linear-gradient(140deg,#eef4e8,#d9e9cd)] text-[3.7rem]"
                        aria-hidden="true"
                      >
                        {item.imageUrl ? (
                          <img
                            className="h-full w-full object-contain"
                            src={item.imageUrl}
                            alt=""
                          />
                        ) : (
                          "🍽️"
                        )}
                      </div>
                      <div className="flex min-w-0 flex-1 flex-col p-[15px_16px_14px]">
                        {(item.unavailable ||
                          item.recommended ||
                          item.popular ||
                          item.new ||
                          item.promotion) && (
                          <span
                            className={`self-start rounded-full bg-[#f4dfaf] px-2 py-1 text-[0.68rem] font-extrabold leading-none ${item.unavailable ? "!text-[#dc2626]" : "text-[#70521b]"}`}
                          >
                            {item.unavailable
                              ? copy.unavailable
                              : item.recommended
                                ? copy.recommended
                                : item.popular
                                  ? copy.popular
                                  : item.new
                                    ? copy.newProduct
                                    : copy.promotion}
                          </span>
                        )}
                        <p className="mt-1.5 [overflow-wrap:anywhere] text-[1.08rem] font-bold leading-[1.25] tracking-[-0.012em] text-[#253228]">
                          {label(item.names)}
                        </p>
                        <p className="mt-[5px] line-clamp-2 overflow-hidden text-[0.83rem] text-[#718072]">
                          {label(item.description)}
                        </p>
                        <div className="mt-auto flex items-center justify-between gap-3 pt-2.5">
                          <strong className="text-[1.05rem] text-[#5b8c42]">
                            {displayPrice < item.price && (
                              <small className="mr-1 text-[0.75rem] line-through">
                                {formatPrice(item.price, locale)}
                              </small>
                            )}
                            {formatPrice(displayPrice, locale)}
                          </strong>
                          {onlineOrderingEnabled && !item.unavailable && (
                            <button
                              className="rounded-xl border-0 bg-[#2e4b2d] px-[13px] py-2 font-bold text-white transition-colors duration-200 hover:bg-[#42663a]"
                              onClick={() => openItem(item)}
                            >
                              <span>{copy.add}</span>
                            </button>
                          )}
                        </div>
                      </div>
                    </article>
                  </Fragment>
                );
              })}
            </div>
          </section>
          {onlineOrderingEnabled && cartOpen && (
            <div
              className="fixed inset-0 z-[55] bg-[rgba(24,36,26,0.36)] backdrop-blur-[3px]"
              onMouseDown={() => setCartOpen(false)}
              onWheel={(event) => event.preventDefault()}
            />
          )}
          {onlineOrderingEnabled && cartOpen && (
            <OnlineCartDrawer>
              <CartPanelHeader
                cartLabel={copy.cart}
                count={count}
                itemLabel={copy.item}
                total={formatPrice(total, locale)}
                originalTotal={originalTotal}
                isQuoteLoading={quoteLoading}
                unavailableMessage={
                  cartAvailabilityError || unavailableCartItems.length > 0
                    ? copy.removeUnavailableItemsToUpdateTotal
                    : undefined
                }
                closeLabel={copy.cancel}
                onClose={() => setCartOpen(false)}
                className="max-[649px]:!-mx-6 max-[649px]:!-mt-6 sm:!hidden"
              />
              <div className="!hidden items-center justify-between gap-3 bg-[linear-gradient(135deg,#eef6e8,#f8fbf5)] px-[21px] py-[21px_17px] sm:!flex">
                <div className="shrink-0">
                  <p className="eyebrow !m-0 !text-[1.1rem] !font-extrabold !normal-case !tracking-normal !text-[#253228]">{copy.cart}</p>
                  <span className="whitespace-nowrap !text-[1.05rem] !font-bold !text-[#526052]">
                    {count} {copy.item}
                  </span>
                </div>
                {!(cartAvailabilityError || unavailableCartItems.length > 0) && (
                  <strong className="!text-[1.22rem] !text-[#3d7130]">
                    {quoteLoading ? (
                    <span className="inline-block min-w-20 animate-pulse text-gray-300">
                      …
                    </span>
                    ) : (
                    <>
                      {originalTotal && (
                        <del className="mr-2 text-sm font-normal text-gray-400">
                          {originalTotal}
                        </del>
                      )}
                      {formatPrice(total, locale)}
                    </>
                    )}
                  </strong>
                )}
                <button
                  className="grid h-10 w-10 flex-none place-items-center rounded-full bg-[#eef3ea] p-0 text-2xl leading-none text-[#526052]"
                  onClick={() => setCartOpen(false)}
                  aria-label={copy.cancel}
                >
                  ×
                </button>
              </div>
              {(cartAvailabilityError || unavailableCartItems.length > 0) && (
                <div className="mb-3 mt-3 block rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm leading-snug text-red-700 max-[649px]:border-[#f0b429] max-[649px]:bg-[#fff8e6] max-[649px]:text-[#7a4a00] sm:ml-6 sm:mr-[39px]" role="alert">
                  <p className="font-bold">
                    {copy.removeUnavailableItemsToUpdateTotal}
                  </p>
                  <ul className="mt-1 list-disc pl-5 text-[0.82rem]">
                    {unavailableCartItems.map((entry, index) => (
                      <li key={`${entry.kind}-${entry.name}-${entry.addonName}-${index}`}>
                        {entry.kind === "item"
                          ? copy.unavailableItem
                          : copy.unavailableAddon}
                        : {entry.name}
                        {entry.addonName ? ` - ${entry.addonName}` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {cart.length === 0 ? (
            <p className="m-0 px-[22px] py-[22px] text-base leading-6 text-[#7d887c]">
              {copy.cartEmptyDescription}
            </p>
              ) : (
                <div ref={restoreCartFocus} className="cart-lines flex flex-1 flex-col gap-2 overflow-y-auto !px-0 min-[650px]:[scrollbar-gutter:stable]">
                  {cart.map((line) => {
                    const item = items.find(
                      (candidate) => candidate.id === line.itemId,
                    );
                    const lineUnavailable = Boolean(
                      item?.unavailable ||
                        item?.addons.some(
                          (addon) =>
                            line.addonIds.includes(addon.id) && addon.unavailable,
                        ),
                    );
                    return (
                      <Fragment key={line.key}>
                        <CartLineItem
                          lineKey={line.key}
                          name={item ? label(item.names) : ""}
                          price={formatPrice(
                            linePrice(line) * line.quantity,
                            locale,
                          )}
                          originalPrice={
                            lineOriginalPrice(line) > linePrice(line)
                              ? formatPrice(
                                  lineOriginalPrice(line) * line.quantity,
                                  locale,
                                )
                              : undefined
                          }
                          unavailable={lineUnavailable}
                          unavailableLabel={
                            lineUnavailable ? copy.unavailable : undefined
                          }
                          quantity={line.quantity}
                          decreaseLabel={copy.decreaseQuantity}
                          increaseLabel={copy.increaseQuantity}
                          customiseLabel={copy.customise}
                          removeLabel={copy.remove}
                          onDecrease={() =>
                            updateQuantity(line.key, line.quantity - 1)
                          }
                          onIncrease={() =>
                            updateQuantity(line.key, line.quantity + 1)
                          }
                          onCustomise={() => {
                            if (!item) return;
                            setCartOpen(false);
                            openItem(item, line);
                          }}
                          onRemove={() => updateQuantity(line.key, 0)}
                        />
                        <div
                          className={`hidden items-center justify-between gap-4 border-b border-[#e8eee2] px-1 py-3 font-['Segoe_UI','Helvetica_Neue',Arial,sans-serif] sm:flex min-[650px]:!px-6 ${lineUnavailable ? "rounded-xl !border !border-red-300 bg-red-50" : ""}`}
                        >
                          <div className="min-w-0 flex-1">
                            <strong className="block [overflow-wrap:anywhere] !text-[1rem] !leading-[1.25] !text-[#29382c]">
                              {item ? label(item.names) : ""}
                            </strong>
                            <small className="mt-[3px] block !text-[0.85rem] !font-bold !text-[#5f8c25]">
                              {lineOriginalPrice(line) > linePrice(line) && (
                                <del className="mr-1 font-normal text-gray-400">
                                  {formatPrice(
                                    lineOriginalPrice(line) * line.quantity,
                                    locale,
                                  )}
                                </del>
                              )}
                              {formatPrice(
                                linePrice(line) * line.quantity,
                                locale,
                              )}
                              {lineUnavailable && (
                                <span className="ml-2 text-[0.78rem] font-bold text-red-600">
                                  {copy.unavailable}
                                </span>
                              )}
                            </small>
                          </div>
                          <div className="ml-auto flex items-center gap-4">
                            <div className="flex items-center gap-2">
                              <button
                                className="inline-flex h-[27px] w-[27px] items-center justify-center rounded-full border border-[#d9e6d3] bg-white p-0 text-[1.2rem] leading-none text-[#426b38] min-[650px]:!h-8 min-[650px]:!w-8"
                                type="button"
                                aria-label={copy.decreaseQuantity}
                                onClick={() =>
                                  updateQuantity(line.key, line.quantity - 1)
                                }
                              >
                                <span className="quantity-symbol">−</span>
                              </button>
                              <span>{line.quantity}</span>
                              <button
                                className="inline-flex h-[27px] w-[27px] items-center justify-center rounded-full border border-[#d9e6d3] bg-white p-0 text-[1.2rem] leading-none text-[#426b38] min-[650px]:!h-8 min-[650px]:!w-8"
                                type="button"
                                aria-label={copy.increaseQuantity}
                                onClick={() =>
                                  updateQuantity(line.key, line.quantity + 1)
                                }
                              >
                                <span className="quantity-symbol">+</span>
                              </button>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <button
                                className="inline-flex h-[27px] w-[27px] items-center justify-center rounded-full border border-[#d9e6d3] bg-white p-0 text-[#426b38] min-[650px]:!h-8 min-[650px]:!w-8"
                                type="button"
                                aria-label={copy.customise}
                                onClick={() => {
                                  if (!item) return;
                                  setCartOpen(false);
                                  openItem(item, line);
                                }}
                              >
                                <svg className="h-[14px] w-[14px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                  <path d="m4 16.5-.8 4.3 4.3-.8L19.1 8.4l-3.5-3.5L4 16.5Z" />
                                  <path d="m13.8 6.7 3.5 3.5" />
                                </svg>
                              </button>
                              <button
                                className="inline-flex h-[27px] w-[27px] items-center justify-center rounded-full border border-red-200 bg-white p-0 text-red-600 min-[650px]:!h-8 min-[650px]:!w-8"
                                type="button"
                                aria-label={copy.remove}
                                onClick={() => updateQuantity(line.key, 0)}
                              >
                                <svg className="h-[14px] w-[14px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                  <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 10v6M14 10v6" />
                                </svg>
                              </button>
                            </div>
                          </div>
                        </div>
                      </Fragment>
                    );
                  })}
                </div>
              )}
              <button
                className="flex w-full items-center justify-center rounded-xl bg-[#315b34] px-4 py-3 font-bold text-white shadow-[0_10px_18px_rgba(54,90,49,0.2)] transition-colors hover:bg-[#48743f] disabled:cursor-not-allowed disabled:opacity-50 min-[650px]:!mx-auto min-[650px]:!my-4 min-[650px]:!w-[calc(100%-48px)] min-[650px]:!px-14 max-[649px]:mt-2 max-[649px]:mb-[calc(32px+env(safe-area-inset-bottom))] max-[649px]:shadow-none"
                disabled={
                  !cart.length ||
                  cartAvailabilityError ||
                  unavailableCartItems.length > 0
                }
                onClick={() => {
                  setCartOpen(false);
                  setCheckoutOpen(true);
                }}
              >
                {copy.continueOrder}
              </button>
              <button
                className="!hidden"
                onClick={() => setCartOpen(false)}
                aria-label={copy.cancel}
              >
                ×
              </button>
            </OnlineCartDrawer>
          )}
        </div>
        {selected && (
          <div
            className="modal-backdrop fixed inset-0 !z-[60] flex items-center justify-center bg-[rgba(24,36,26,0.48)] p-6 backdrop-blur-[6px] max-[649px]:items-end max-[649px]:p-0"
            onMouseDown={closeItem}
            onWheel={(event) => {
              if (event.target === event.currentTarget) event.preventDefault();
            }}
          >
            <section
              className={`customise-sheet relative z-[31] flex min-h-[320px] max-h-[min(88svh,760px)] w-full max-w-[560px] flex-col overflow-x-hidden overflow-y-auto rounded-[30px] border border-white/80 bg-[#fffdf9] p-8 text-[#24312a] shadow-[0_26px_80px_rgba(24,38,25,0.24)] min-[650px]:!max-w-[520px] min-[650px]:!rounded-none max-[649px]:fixed max-[649px]:inset-x-0 max-[649px]:bottom-0 max-[649px]:min-h-0 max-[649px]:max-h-[92svh] max-[649px]:max-w-none max-[649px]:rounded-t-[25px] max-[649px]:px-[18px] max-[649px]:pb-[calc(96px+env(safe-area-inset-bottom))]${customiseSheetFull ? " is-full-height" : ""}`}
              ref={customiseSheetRef}
              role="dialog"
              aria-modal="true"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div className="sheet-title !flex !items-start !justify-between !gap-3">
                <div>
                  <p className="eyebrow">{copy.customise}</p>
                  <h2 className="text-[clamp(1.4rem,4vw,1.8rem)] font-extrabold text-[#253228]">{label(selected.names)}</h2>
                </div>
                <button
                  className="icon-button !relative !grid !h-10 !w-10 !flex-none !place-items-center !rounded-full !border-0 !bg-[#eef3ea] !p-0 !text-[#526052] min-[650px]:!-top-1 max-[649px]:!h-12 max-[649px]:!w-12"
                  onClick={closeItem}
                  aria-label={copy.cancel}
                >
                  <span className="modal-close-symbol relative -top-0.5 text-2xl leading-none">×</span>
                </button>
              </div>
              <div className="quantity-row !flex !items-center !justify-between !gap-3 !border-y !border-[#edf0e9] !py-3 !font-bold !text-[#344535] !mb-2 !mt-0">
                <span>{copy.quantity}</span>
                <div className="stepper !flex !items-center !gap-2">
                  <button
                    className="!inline-flex !h-10 !w-10 !items-center !justify-center !rounded-full !border !border-[#dce7d7] !bg-white !p-0 !text-xl !leading-none !text-[#426b38]"
                    onClick={() =>
                      setQuantity((value) => Math.max(1, value - 1))
                    }
                  >
                    <span className="quantity-symbol">−</span>
                  </button>
                  <strong className="min-w-6 text-center text-xl font-bold text-[#29382c]">{quantity}</strong>
                  <button className="!inline-flex !h-10 !w-10 !items-center !justify-center !rounded-full !border !border-[#dce7d7] !bg-white !p-0 !text-xl !leading-none !text-[#426b38]" onClick={() => setQuantity((value) => value + 1)}>
                    <span className="quantity-symbol">+</span>
                  </button>
                </div>
              </div>
              {selected.variants.length > 0 && (
                <fieldset className="!my-0 !border-0 !p-0">
                  <legend className="!mb-3 !font-extrabold !text-[#344535]">{copy.variant}</legend>
                  <div className="choice-grid !flex !flex-wrap !gap-2">
                    {selected.variants.map((choice) => (
                      <button
                        key={choice.id}
                        className={`rounded-full border border-[#dce7d7] bg-white px-[13px] py-[9px] text-[#627060] transition-colors hover:border-[#88b477] hover:bg-[#eaf4e5] aria-pressed:border-[#88b477] aria-pressed:bg-[#eaf4e5] aria-pressed:font-bold aria-pressed:text-[#31552e] ${variant === choice.id ? "selected" : ""}`}
                        aria-pressed={variant === choice.id}
                        onClick={() => setVariant(choice.id)}
                      >
                        {label(choice.names)}
                      </button>
                    ))}
                  </div>
                </fieldset>
              )}
              {(selected.optionGroups || []).map((group) => {
                const selectedIds = optionSelections
                  .filter((selection) => selection.groupId === group.id)
                  .map((selection) => selection.optionId);
                const choose = (optionId: string) =>
                  setOptionSelections((current) => {
                    const others = current.filter(
                      (selection) => selection.groupId !== group.id,
                    );
                    const next =
                      group.selection === "single"
                        ? selectedIds[0] === optionId
                          ? group.required
                            ? [optionId]
                            : []
                          : [optionId]
                        : selectedIds.includes(optionId)
                          ? selectedIds.filter((id) => id !== optionId)
                          : [...selectedIds, optionId];
                    return [
                      ...others,
                      ...next.map((id) => ({
                        groupId: group.id,
                        optionId: id,
                      })),
                    ];
                  });
                return (
                  <fieldset key={group.id} className="!my-5 !border-0 !p-0">
                    <legend className="!mb-3 !font-extrabold !text-[#344535]">
                      {label(group.names)}
                      {group.required ? " *" : ""}
                    </legend>
                    <div className="choice-grid !flex !flex-wrap !gap-2">
                      {group.options.map((option) => (
                        <button
                          key={option.id}
                          className={`rounded-full border border-[#dce7d7] bg-white px-[13px] py-[9px] text-[#627060] transition-colors hover:border-[#88b477] hover:bg-[#eaf4e5] aria-pressed:border-[#88b477] aria-pressed:bg-[#eaf4e5] aria-pressed:font-bold aria-pressed:text-[#31552e] ${selectedIds.includes(option.id) ? "selected" : ""}`}
                          aria-pressed={selectedIds.includes(option.id)}
                          onClick={() => choose(option.id)}
                        >
                          {label(option.names)}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                );
              })}
              {selected.type === "combo" &&
                (selected.components?.length || 0) > 0 && (
                  <fieldset className="combo-components-fieldset !my-5 !border-0 !p-0">
                    <legend className="!mb-3 !font-extrabold !text-[#344535]">{copy.comboComponents}</legend>
                    <div className="grid gap-2.5">
                      {componentSelections.map((selection, index) => {
                        const component = selected.components?.find(
                          (entry) =>
                            selection.itemId === entry.itemId &&
                            selection.componentId.startsWith(entry.componentId),
                        );
                        if (!component) return null;
                        return (
                          <details
                            key={selection.componentId}
                            className="overflow-hidden rounded-xl border border-[#dce7d7] bg-white"
                            open={index === 0}
                          >
                            <summary className="!flex !cursor-pointer !items-center !justify-between !px-3 !py-2.5 !font-bold !text-[#344535]">
                              {label(component.names)}{" "}
                              {(selected.components?.filter(
                                (entry) => entry.itemId === component.itemId,
                              ).length || 0) > 1
                                ? index + 1
                                : ""}
                            </summary>
                            <div className="border-t border-[#edf2e9] p-3">
                              <div className="choice-grid !flex !flex-wrap !gap-2">
                                {component.noteOptions.map((choice) => (
                                  <button
                                    key={choice.id}
                                    className={`rounded-full border border-[#dce7d7] bg-white px-[13px] py-[9px] text-[#627060] aria-pressed:border-[#88b477] aria-pressed:bg-[#eaf4e5] aria-pressed:font-bold aria-pressed:text-[#31552e] ${selection.noteOptions.includes(choice.id) ? "selected" : ""}`}
                                    aria-pressed={selection.noteOptions.includes(choice.id)}
                                    onClick={() =>
                                      setComponentSelections((current) =>
                                        current.map((entry) =>
                                          entry.componentId ===
                                          selection.componentId
                                            ? {
                                                ...entry,
                                                noteOptions:
                                                  entry.noteOptions.includes(
                                                    choice.id,
                                                  )
                                                    ? entry.noteOptions.filter(
                                                        (id) =>
                                                          id !== choice.id,
                                                      )
                                                    : [
                                                        ...entry.noteOptions,
                                                        choice.id,
                                                      ],
                                              }
                                            : entry,
                                        ),
                                      )
                                    }
                                  >
                                    {label(choice.names)}
                                  </button>
                                ))}
                              </div>
                              <textarea
                                className="min-h-[64px] w-full resize-y rounded-lg border border-[#dce7d7] bg-white px-3 py-2 text-sm text-[#344535] focus:border-[#315b34] focus:outline-none focus:ring-2 focus:ring-[#8ac545]/30"
                                value={selection.note || ""}
                                maxLength={40}
                                placeholder={copy.notePlaceholder}
                                onChange={(event) =>
                                  setComponentSelections((current) =>
                                    current.map((entry) =>
                                      entry.componentId ===
                                      selection.componentId
                                        ? { ...entry, note: event.target.value }
                                        : entry,
                                    ),
                                  )
                                }
                              />
                            </div>
                          </details>
                        );
                      })}
                    </div>
                  </fieldset>
                )}
              {selected.type !== "combo" && selected.addons.length > 0 && (
                <fieldset className="!my-5 !border-0 !p-0">
                  <legend className="!mb-3 !font-extrabold !text-[#344535]">{copy.addons}</legend>
                  <div className="!grid !grid-cols-1 !gap-2.5">
                    {selected.addons.map((addon) => {
                      const displayPrice =
                        addon.displayPrice ?? addon.priceExtra;
                      return (
                        <button
                          key={addon.id}
                          disabled={addon.unavailable}
                          className={`flex items-center justify-between gap-2 rounded-xl border border-[#dce7d7] bg-white px-[11px] py-2.5 text-left text-[#344535] disabled:cursor-not-allowed disabled:opacity-[0.55] aria-pressed:border-[#88b477] aria-pressed:bg-[#eaf4e5] aria-pressed:font-bold aria-pressed:text-[#31552e] ${addonIds.includes(addon.id) ? "selected" : ""}`}
                          aria-pressed={addonIds.includes(addon.id)}
                          onClick={() =>
                            setAddonIds((old) =>
                              old.includes(addon.id)
                                ? old.filter((id) => id !== addon.id)
                                : [...old, addon.id],
                            )
                          }
                        >
                          <span>
                            {label(addon.names)}
                            {addon.unavailable ? (
                              <span className="unavailable-label">
                                {" "}
                                ({copy.unavailable})
                              </span>
                            ) : (
                              ""
                            )}
                          </span>
                          <strong>
                            {displayPrice < addon.priceExtra && (
                              <small className="mr-1 line-through">
                                +{formatPrice(addon.priceExtra, locale)}
                              </small>
                            )}
                            +{formatPrice(displayPrice, locale)}
                          </strong>
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              )}
              <label className="grid gap-2 min-[650px]:mt-5">
                <span className="mb-3 text-[0.9rem] font-bold tracking-[0.02em] text-[#344535]">{copy.note}</span>
                <textarea
                  className="min-h-[76px] resize-y rounded-xl border border-[#dce7d7] bg-white px-3 py-2.5 text-[0.95rem] text-[#344535] transition focus:border-[#315b34] focus:outline-none focus:ring-2 focus:ring-[#8ac545]/30"
                  value={note}
                  maxLength={40}
                  onFocus={(event) => scrollTextareaIntoView(event.currentTarget)}
                  onChange={(event) => setNote(event.target.value)}
                />
              </label>
              <div className="mt-3 flex items-center justify-between gap-3 max-[649px]:mb-1">
                <strong className="min-w-max !text-[1.25rem] !text-[#3d7130]">
                  {formatPrice(
                    quantity *
                      ((selected.displayPrice ?? selected.price) +
                        selected.addons
                          .filter((addon) => addonIds.includes(addon.id))
                          .reduce(
                            (sum, addon) =>
                              sum + (addon.displayPrice ?? addon.priceExtra),
                            0,
                          )),
                    locale,
                  )}
                </strong>
                <button
                  className="primary-button !flex-1 !rounded-xl !bg-[#315b34] px-4 py-3 font-bold text-white transition-colors hover:!bg-[#42663a]"
                  onClick={addToCart}
                >
                  {editingLineKey ? copy.updateItem : copy.addToCart}
                </button>
              </div>
            </section>
          </div>
        )}
        {checkoutOpen && (
          <div
            className="modal-backdrop fixed inset-0 !z-[60] flex items-center justify-center bg-black/45 p-6 max-[649px]:items-end max-[649px]:p-0"
            onMouseDown={() => setCheckoutOpen(false)}
            onWheel={(event) => {
              if (event.target === event.currentTarget) event.preventDefault();
            }}
          >
            <section
              className="checkout-card flex h-auto max-h-[min(88svh,760px)] w-full max-w-[560px] flex-col overflow-x-hidden overflow-y-auto bg-surface p-8 shadow-2xl max-[649px]:h-svh max-[649px]:max-h-svh max-[649px]:max-w-none max-[649px]:rounded-none max-[649px]:px-[18px] max-[649px]:pt-[22px] max-[649px]:pb-[calc(22px+env(safe-area-inset-bottom))]"
              role="dialog"
              aria-modal="true"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div className="sheet-title !flex !items-start !justify-between !gap-3 min-[650px]:!items-center min-[650px]:!mb-6 max-[649px]:!items-start max-[649px]:!mb-5">
                <div>
                  <h2 className="eyebrow !m-0 min-[650px]:!text-[1.6rem] min-[650px]:!font-extrabold min-[650px]:!normal-case min-[650px]:!tracking-normal min-[650px]:!leading-tight max-[649px]:!text-[1.75rem] max-[649px]:!font-extrabold max-[649px]:!normal-case max-[649px]:!tracking-normal max-[649px]:!leading-tight">
                    {copy.checkout}
                  </h2>
                </div>
                <button
                  className="icon-button !relative !grid !h-10 !w-10 !flex-none !place-items-center !rounded-full !border-0 !bg-[#eef3ea] !p-0 !text-[#526052] min-[650px]:!self-center"
                  onClick={() => setCheckoutOpen(false)}
                  aria-label={copy.cancel}
                >
                  <span className="checkout-close-symbol text-2xl leading-none">×</span>
                </button>
              </div>
              {pricingChanged && (
                <p className="my-3 rounded-[10px] border border-[#f0b429] bg-[#fff8e6] px-3 py-2.5 text-[0.9rem] font-semibold text-[#7a4a00]" role="alert">
                  {copy.orderPricingChanged}
                </p>
              )}
              <div className="mb-6 flex flex-wrap items-center gap-2">
                <span className="mr-auto font-bold text-[#344535]">{copy.orderType}</span>
                <button
                  type="button"
                  className="rounded-full border border-[#dce7d7] bg-white px-3 py-2 text-sm font-bold text-[#627060] transition-colors aria-pressed:border-[#315b34] aria-pressed:bg-[#eaf4e5] aria-pressed:text-[#31552e]"
                  aria-pressed={type === "dine_in"}
                  onClick={() => setType("dine_in")}
                >
                  {copy.dineIn}
                </button>
                <button
                  type="button"
                  className="rounded-full border border-[#dce7d7] bg-white px-3 py-2 text-sm font-bold text-[#627060] transition-colors aria-pressed:border-[#315b34] aria-pressed:bg-[#eaf4e5] aria-pressed:text-[#31552e]"
                  aria-pressed={type === "takeaway"}
                  onClick={() => setType("takeaway")}
                >
                  {copy.takeaway}
                </button>
              </div>
              <label className="max-[649px]:!grid max-[649px]:!gap-2 max-[649px]:!my-3 max-[649px]:!font-bold max-[649px]:!text-[#344535] min-[650px]:!grid min-[650px]:!gap-2 min-[650px]:!my-3 min-[650px]:!font-bold min-[650px]:!text-[#344535]">
                {copy.phone} *
                <input
                  className="max-[649px]:!w-full max-[649px]:!rounded-xl max-[649px]:!border max-[649px]:!border-[#dce7d7] max-[649px]:!bg-white max-[649px]:!px-3 max-[649px]:!py-2.5 max-[649px]:!text-base max-[649px]:!text-[#253228] min-[650px]:!w-full min-[650px]:!max-w-full min-[650px]:!rounded-xl min-[650px]:!border min-[650px]:!border-[#dce7d7] min-[650px]:!bg-white min-[650px]:!px-3 min-[650px]:!py-2.5 min-[650px]:!text-base min-[650px]:!text-[#253228] min-[650px]:focus:!border-[#315b34] focus:outline-none focus:ring-2 focus:ring-[#8ac545]/30"
                  value={customer.phone}
                  required
                  inputMode="tel"
                  onChange={(event) =>
                    setCustomer({ ...customer, phone: event.target.value })
                  }
                />
              </label>
              <label className="max-[649px]:!grid max-[649px]:!gap-2 max-[649px]:!my-3 max-[649px]:!font-bold max-[649px]:!text-[#344535] min-[650px]:!grid min-[650px]:!gap-2 min-[650px]:!my-3 min-[650px]:!font-bold min-[650px]:!text-[#344535]">
                {copy.customerName}
                <input
                  className="max-[649px]:!w-full max-[649px]:!rounded-xl max-[649px]:!border max-[649px]:!border-[#dce7d7] max-[649px]:!bg-white max-[649px]:!px-3 max-[649px]:!py-2.5 max-[649px]:!text-base max-[649px]:!text-[#253228] min-[650px]:!w-full min-[650px]:!max-w-full min-[650px]:!rounded-xl min-[650px]:!border min-[650px]:!border-[#dce7d7] min-[650px]:!bg-white min-[650px]:!px-3 min-[650px]:!py-2.5 min-[650px]:!text-base min-[650px]:!text-[#253228] min-[650px]:focus:!border-[#315b34] focus:outline-none focus:ring-2 focus:ring-[#8ac545]/30"
                  value={customer.name}
                  onChange={(event) =>
                    setCustomer({ ...customer, name: event.target.value })
                  }
                />
              </label>
              <label className="max-[649px]:!grid max-[649px]:!gap-2 max-[649px]:!my-3 max-[649px]:!font-bold max-[649px]:!text-[#344535] min-[650px]:!grid min-[650px]:!gap-2 min-[650px]:!my-3 min-[650px]:!font-bold min-[650px]:!text-[#344535]">
                {copy.address}
                <textarea
                  className="min-h-[92px] w-full resize-y rounded-xl border border-[#dce7d7] bg-white px-3 py-2.5 text-base text-[#253228] focus:border-[#315b34] focus:outline-none focus:ring-2 focus:ring-[#8ac545]/30"
                  value={customer.address}
                  onChange={(event) =>
                    setCustomer({ ...customer, address: event.target.value })
                  }
                />
              </label>
              <label className="max-[649px]:!grid max-[649px]:!gap-2 max-[649px]:!my-3 max-[649px]:!font-bold max-[649px]:!text-[#344535] min-[650px]:!grid min-[650px]:!gap-2 min-[650px]:!my-3 min-[650px]:!font-bold min-[650px]:!text-[#344535]">
                {copy.pickupTime}
                <input
                  className="max-[649px]:!w-full max-[649px]:!rounded-xl max-[649px]:!border max-[649px]:!border-[#dce7d7] max-[649px]:!bg-white max-[649px]:!px-3 max-[649px]:!py-2.5 max-[649px]:!text-base max-[649px]:!text-[#253228] min-[650px]:!w-full min-[650px]:!max-w-full min-[650px]:!rounded-xl min-[650px]:!border min-[650px]:!border-[#dce7d7] min-[650px]:!bg-white min-[650px]:!px-3 min-[650px]:!py-2.5 min-[650px]:!text-base min-[650px]:!text-[#253228] min-[650px]:focus:!border-[#315b34] focus:outline-none focus:ring-2 focus:ring-[#8ac545]/30"
                  type="datetime-local"
                  value={pickupAt}
                  min={taipeiInputValue(new Date())}
                  onChange={(event) => setPickupAt(event.target.value)}
                />
              </label>
              <div className="turnstile-slot flex min-h-[65px] items-center justify-center overflow-hidden" />
              <button
                className="mt-2 w-full rounded-xl bg-primary px-4 py-3 font-bold text-primary-foreground transition-colors hover:bg-[#48743f] disabled:cursor-not-allowed disabled:opacity-50 max-[649px]:!mb-12"
                disabled={
                  !cart.length ||
                  !customer.phone.trim() ||
                  !turnstileToken ||
                  turnstileError ||
                  sending
                }
                onClick={() => void confirm()}
              >
                {copy.sendOrder}
              </button>
            </section>
          </div>
        )}
      </main>
      {onlineOrderingEnabled && !cartOpen && !selected && !checkoutOpen && (
        <button
          className="fixed bottom-[22px] right-4 z-[50] hidden items-center justify-center rounded-full border-[3px] border-[#a9c294] bg-[#dcefd0] p-3.5 text-[#315b34] shadow-[0_10px_24px_rgba(61,75,55,0.2)] transition-[background,color] duration-200 hover:bg-white hover:text-[#315b34] min-[650px]:inline-flex min-[650px]:h-14 min-[650px]:w-14"
          onClick={() => void openCart()}
          aria-label={copy.cart}
        >
          <span className="relative -top-0.5 text-[1.15rem]" aria-hidden="true">🛒</span>
          {count > 0 && (
            <strong className="absolute right-[-5px] top-[-5px] grid h-[23px] min-w-[23px] place-items-center rounded-full bg-[#b42318] px-1 text-[0.75rem] leading-none text-white">
              {count}
            </strong>
          )}
        </button>
      )}
      <MobileStoreFooter
        name={storeFooter.name}
        hoursLabel={copy.businessHours}
        hours={storeFooter.hours}
        phone={storeFooter.phone}
        address={storeFooter.address}
        copyright={storeFooter.copyright}
        mobileClassName="max-[649px]:!p-0 max-[649px]:!px-2 max-[649px]:!text-[11px] max-[649px]:!leading-4"
      />
    </>
  );
}
