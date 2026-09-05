"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { io } from "socket.io-client";
import { type Locale, t } from "@/lib/i18n";
import CartLineItem from "@/components/CartLineItem";
import CartPanelHeader from "@/components/CartPanelHeader";
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
type PublicPromotion = {
  id: string;
  names: Text;
  descriptions: Text;
  imageUrl?: string;
  minSubtotal?: number;
  startsAt?: string;
  endsAt?: string;
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
type CompletedOrder = {
  number: number;
  table: string;
  total: number;
  count: number;
};

const formatPrice = (amount: number, locale: Locale) =>
  new Intl.NumberFormat(locale === "zh-TW" ? "zh-TW" : locale, {
    style: "currency",
    currency: "TWD",
    maximumFractionDigits: 0,
  }).format(amount);
const formatPromotionDate = (value: string | undefined, locale: Locale) =>
  value
    ? new Intl.DateTimeFormat(locale === "zh-TW" ? "zh-TW" : locale, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(value))
    : "";
const promotionDescriptionParts = (description: string) =>
  description.split(/(\d+(?:[.,]\d+)?%|\d+(?:[.,]\d+)?\s*NT\$|NT\$\s*\d+(?:[.,]\d+)?|\d+(?:[.,]\d+)?\s*折)/g);
const categoryIconFor = (category: { id: string; names: Text }) => {
  const key = Object.values(category.names)
    .join(" ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (key.includes("pho")) return "pho";
  if (key.includes("com")) return "rice";
  if (key.includes("bun")) return "bun";
  if (key.includes("banh mi") || key.includes("banhmi")) return "🥖";
  if (key.includes("nuoc") || key.includes("drink") || key.includes("beverage")) return "🥤";
  if (key.includes("them") || key.includes("addon")) return "side";
  if (key.includes("ngot") || key.includes("dessert")) return "dessert";
  const fallbackIcons = ["🍜", "🍚", "🥗", "🥖", "🥤", "🍳", "🍰"];
  const hash = [...category.id].reduce((total, character) => total + character.charCodeAt(0), 0);
  return fallbackIcons[hash % fallbackIcons.length];
};
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
const localeStorageKey = "mammi-order-locale-v2";
const detectLocale = (): Locale => {
  if (typeof navigator === "undefined") return "zh-TW";
  const saved = window.localStorage.getItem(localeStorageKey);
  if (saved === "vi" || saved === "en" || saved === "zh-TW") return saved;
  const language = navigator.language.toLowerCase();
  if (language.startsWith("zh")) return "zh-TW";
  if (language.startsWith("en")) return "en";
  if (language.startsWith("vi")) return "vi";
  return "zh-TW";
};
const createLineKey = () =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export default function LiveQrOrder({ qrToken }: { qrToken: string }) {
  const [locale, setLocale] = useState<Locale>("zh-TW");
  const [localeReady, setLocaleReady] = useState(false);
  const [category, setCategory] = useState("all");
  const [items, setItems] = useState<MenuItem[]>([]);
  const [promotions, setPromotions] = useState<PublicPromotion[]>([]);
  const [table, setTable] = useState("");
  const [realtimeToken, setRealtimeToken] = useState("");
  const [cartToken, setCartToken] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [promotionTotal, setPromotionTotal] = useState<number | null>(null);
  const [selected, setSelected] = useState<MenuItem | null>(null);
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
  const [loading, setLoading] = useState(true);
  const [menuReady, setMenuReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [sessionUnavailable, setSessionUnavailable] = useState(false);
  const [sending, setSending] = useState(false);
  const [completed, setCompleted] = useState<CompletedOrder | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [promotionOpen, setPromotionOpen] = useState(false);
  const [openingCart, setOpeningCart] = useState(false);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [pricingChanged, setPricingChanged] = useState(false);
  const [cartAvailabilityError, setCartAvailabilityError] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const menuGridRef = useRef<HTMLElement>(null);
  const quoteCache = useRef<{
    key: string;
    total: number;
    expiresAt: number;
    quoteToken: string;
  } | null>(null);
  const cartHydratedRef = useRef(false);
  const cartPanelRef = useRef<HTMLDivElement>(null);
  const cartFocusKeyRef = useRef<string | null>(null);
  const restoreCartFocus = useCallback((panel: HTMLDivElement | null) => {
    cartPanelRef.current = panel;
    if (!panel || !cartFocusKeyRef.current) return;
    window.requestAnimationFrame(() => {
      const lineKey = cartFocusKeyRef.current;
      if (!lineKey || cartPanelRef.current !== panel) return;
      const target = Array.from(
        panel.querySelectorAll<HTMLElement>("[data-cart-line-key]"),
      ).find(
        (element) =>
          element.dataset.cartLineKey === lineKey &&
          element.getClientRects().length > 0,
      );
      if (!target) return;
      target.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
      cartFocusKeyRef.current = null;
    });
  }, []);

  useEffect(() => {
    setLocale(detectLocale());
    setLocaleReady(true);
  }, []);
  useEffect(() => {
    if (!localeReady || loading || failed || sessionUnavailable) return;

    const frame = window.requestAnimationFrame(() => {
      setMenuReady(true);
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [failed, loading, localeReady, sessionUnavailable]);
  useLayoutEffect(() => {
    const modalOpen = Boolean(selected || cartOpen);
    if (!modalOpen) return;
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, [selected, cartOpen]);
  useEffect(() => {
    if (!sessionUnavailable) return;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousBodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.body.style.overflow = previousBodyOverflow;
    };
  }, [sessionUnavailable]);

  const copy = t(locale);
  const base = "";
  const storageKey = `mammi-qr-cart:${qrToken}`;
  const label = (value: Text) => value[locale] || value.vi;
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

  const load = async () => {
    try {
      const response = await fetch(
        `${base}/api/public/qr/${encodeURIComponent(qrToken)}`,
      );
      if (!response.ok) {
        const error = await response.json().catch(() => null);
        if (
          error?.code === "SESSION_NOT_ACTIVE" ||
          error?.code === "SESSION_EXPIRED"
        ) {
          if (error.table?.code) setTable(error.table.code);
          setSessionUnavailable(true);
          setFailed(false);
          return;
        }
        throw new Error("QR menu unavailable");
      }
      const payload = (await response.json()).data;
      setItems(payload.items);
      setPromotions(payload.promotions || []);
      setTable(payload.table.code);
      setRealtimeToken(payload.realtimeToken);

      let savedCartToken = window.localStorage.getItem(storageKey);
      if (savedCartToken) {
        const saved = await fetch(`${base}/api/public/carts/${savedCartToken}`);
        if (saved.ok && (await saved.clone().json()).data.status === "draft") {
          const savedData = (await saved.json()).data;
          if (!cartHydratedRef.current) {
            setCart(
              savedData.lines.map((line: Omit<CartLine, "key">) => ({
                ...line,
                key: createLineKey(),
              })),
            );
          }
        } else {
          window.localStorage.removeItem(storageKey);
          savedCartToken = null;
        }
      }
      if (!savedCartToken) {
        const created = await fetch(
          `${base}/api/public/qr/${encodeURIComponent(qrToken)}/carts`,
          {
            method: "POST",
          },
        );
        if (!created.ok) throw new Error("Unable to create cart");
        savedCartToken = (await created.json()).data.cartToken as string;
        window.localStorage.setItem(storageKey, savedCartToken);
      }
      setCartToken(savedCartToken);
      cartHydratedRef.current = true;
      setSessionUnavailable(false);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [qrToken]);

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

  // The menu refreshes after catalog events, but the customise sheet keeps its
  // own selected item. Refresh that copy too so a newly unavailable add-on is
  // immediately disabled while the customer has the sheet open.
  useEffect(() => {
    if (!selected) return;
    const refreshed = items.find((item) => item.id === selected.id);
    if (!refreshed) {
      setSelected(null);
      setAddonIds([]);
      return;
    }
    setSelected(refreshed);
    setAddonIds((current) =>
      current.filter((addonId) =>
        refreshed.addons.some(
          (addon) => addon.id === addonId && !addon.unavailable,
        ),
      ),
    );
  }, [items, selected?.id]);

  useEffect(() => {
    if (!cartToken || loading || completed || !cartOpen) return;
    const lines = cart.map(({ key, ...line }) => line);
    void fetch(`${base}/api/public/carts/${cartToken}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lines }),
    });
  }, [cart, cartToken, cartOpen, completed, loading]);

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
  const hasCurrentQuote =
    quoteCache.current?.key === currentQuoteKey &&
    quoteCache.current.expiresAt > Date.now() &&
    promotionTotal !== null;
  const total = hasCurrentQuote ? promotionTotal : catalogTotal;
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
  useEffect(() => {
    menuGridRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [category]);

  const openItem = (item: MenuItem, line?: CartLine) => {
    if (line) {
      cartFocusKeyRef.current = line.key;
    }
    setSelected(item);
    setEditingKey(line?.key || null);
    setCartOpen(line ? false : cartOpen);
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
    const returnToCart = Boolean(editingKey);
    setEditingKey(null);
    setSelected(null);
    if (returnToCart) setCartOpen(true);
  };

  const openCart = async (nextCart = cart, fullPageLoading = true) => {
    if (!nextCart.length) {
      setCartOpen(true);
      return;
    }
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

    if (fullPageLoading) setOpeningCart(true);
    else setQuoteLoading(true);
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
      if (fullPageLoading) setOpeningCart(false);
      else setQuoteLoading(false);
    }
  };
  const toggle = (
    id: string,
    current: string[],
    setCurrent: (next: string[]) => void,
  ) =>
    setCurrent(
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id],
    );
  const addToCart = () => {
    if (!selected) return;
    const returnToCart = Boolean(editingKey);
    const line = {
      key: editingKey || createLineKey(),
      itemId: selected.id,
      quantity,
      variant: variant || undefined,
      optionSelections: selected.type === "combo" ? [] : optionSelections,
      noteOptions: selected.type === "combo" ? [] : [...noteOptions],
      addonIds: selected.type === "combo" ? [] : [...addonIds],
      note: note.trim() || undefined,
      componentSelections:
        selected.type === "combo" ? componentSelections : undefined,
    };
    const nextCart = editingKey
      ? cart.map((current) => (current.key === editingKey ? line : current))
      : [...cart, line];
    setCart(nextCart);
    setEditingKey(null);
    setSelected(null);
    if (returnToCart) void openCart(nextCart, false);
  };
  const updateQuantity = (key: string, nextQuantity: number) => {
    const nextCart =
      nextQuantity < 1
        ? cart.filter((line) => line.key !== key)
        : cart.map((line) =>
            line.key === key ? { ...line, quantity: nextQuantity } : line,
          );
    setCart(nextCart);
    if (cartOpen) {
      void openCart(nextCart, false);
    }
  };
  const confirm = async () => {
    if (!cartToken || !cart.length || sending) return;
    setSending(true);
    try {
      const lines = cart.map(({ key, ...line }) => line);
      const synced = await fetch(`${base}/api/public/carts/${cartToken}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lines }),
      });
      if (!synced.ok) throw new Error("Unable to save cart");
      const quoteKey = JSON.stringify(lines);
      const cached = quoteCache.current;
      const quoteToken =
        cached?.key === quoteKey && cached.expiresAt > Date.now()
          ? cached.quoteToken
          : "";
      const response = await fetch(
        `${base}/api/public/carts/${cartToken}/confirm`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ quoteToken }),
        },
      );
      if (!response.ok) {
        const error = await response.json().catch(() => null);
        if (
          error?.code === "SESSION_NOT_ACTIVE" ||
          error?.code === "SESSION_EXPIRED"
        ) {
          setSessionUnavailable(true);
          return;
        }
        if (error?.code === "ORDER_PRICING_CHANGED") {
          const pricing = error?.data?.pricing;
          const quoteToken = error?.data?.quoteToken;
          const expiresAt = Date.parse(error?.data?.expiresAt || "");
          if (
            typeof pricing?.total === "number" &&
            typeof quoteToken === "string" &&
            Number.isFinite(expiresAt)
          ) {
            quoteCache.current = {
              key: quoteKey,
              total: pricing.total,
              expiresAt,
              quoteToken,
            };
            setPromotionTotal(pricing.total);
          }
          setPricingChanged(true);
          setCartOpen(true);
          void load();
          return;
        }
        throw new Error("Unable to confirm");
      }
      const data = (await response.json()).data;
      window.localStorage.removeItem(storageKey);
      setCompleted({
        number: data.number,
        table: data.table,
        total: data.total,
        count,
      });
    } catch {
      setFailed(true);
    } finally {
      setSending(false);
    }
  };

  if (!localeReady)
    return (
      <MenuLoadingState className="fixed inset-0 !h-auto !min-h-0 overflow-hidden" />
    );
  if (failed || sessionUnavailable)
    return (
      <MenuLoadingState
        sessionUnavailable={sessionUnavailable}
        title={
          sessionUnavailable
            ? copy.tableSessionUnavailable
            : failed
              ? copy.menuUnavailable
              : copy.qrMenuLoading
        }
        description={
          <span
            className={
              sessionUnavailable
                ? "mt-[14px] text-[clamp(1.1rem,4.5vw,1.45rem)]"
                : undefined
            }
          >
            {sessionUnavailable
              ? copy.tableSessionUnavailableDescription
              : failed
                ? copy.menuUnavailableDescription
                : copy.qrMenuDescription}
          </span>
        }
      >
        {sessionUnavailable && table && (
          <strong className="mt-[18px] block text-[clamp(1.6rem,7vw,2.4rem)] text-[#5f8c25]">
            {copy.table} {table}
          </strong>
        )}
        {sessionUnavailable && (
          <button
            className="mt-[18px] block ml-auto border-0 bg-transparent text-[#5f8c25] font-bold underline"
            onClick={() => {
              setLoading(true);
              setFailed(false);
              setSessionUnavailable(false);
              void load();
            }}
          >
            {copy.retry}
          </button>
        )}
      </MenuLoadingState>
    );
  if (completed)
    return (
      <main className="mx-auto flex h-svh min-h-0 w-full max-w-[720px] flex-col overflow-hidden bg-white px-[18px] sm:px-[30px]">
        <section className="m-auto w-full max-w-[440px] rounded-[28px] bg-white px-[14px] py-6 text-center shadow-[0_18px_50px_rgba(0,0,0,0.12)] sm:px-[30px] sm:py-[38px]">
          <div className="mx-auto mb-[17px] grid size-[60px] place-items-center rounded-full bg-green-100 text-[2rem] font-extrabold text-green-700">
            ✓
          </div>
          <h1 className="my-2 text-[clamp(1.7rem,7vw,2.35rem)] tracking-[-0.04em]">
            {copy.orderSent}
          </h1>
          <p className="whitespace-normal break-words text-base leading-[1.65] tracking-[-0.02em]">
            {copy.paymentInstructionStart}
            <strong className="text-[1.45em] text-red-600">
              {copy.paymentInstructionCounter}
            </strong>{" "}
            {copy.paymentInstructionMiddle}
            <strong className="text-[1.45em] text-red-600">
              {copy.paymentInstructionPay}
            </strong>
          </p>
          <strong className="my-6 block text-[4.3rem] tracking-[-0.08em] text-[#8ac545]">
            #{completed.number}
          </strong>
          <p className="mt-2 text-[1.05rem]">{copy.orderSummary}</p>
          <p className="mt-2 text-[1.05rem]">
            {copy.table}: {completed.table} · {copy.totalItems}: {" "}
            {completed.count}
          </p>
          <p className="mt-2 text-[1.05rem]">
            {copy.subtotal}: {formatPrice(completed.total, locale)}
          </p>
        </section>
      </main>
    );

  return (
    <>
      {!menuReady && (
        <MenuLoadingState className="fixed inset-0 z-50 !h-auto !min-h-0 overflow-hidden" />
      )}
      {openingCart && (
        <div
          className="fixed inset-0 z-[60] grid place-items-center bg-white/75 backdrop-blur-sm"
          role="status"
          aria-busy="true"
        >
          <span className="h-12 w-12 animate-spin rounded-full border-4 border-[#8ac545] border-t-transparent" />
        </div>
      )}
      <main
        className={`qr-order-shell fixed inset-0 mx-auto flex h-auto min-h-0 w-full max-w-[720px] flex-col overscroll-none overflow-hidden bg-white px-[18px] sm:px-[30px] ${menuReady ? "" : "pointer-events-none opacity-0"}`}
      >
        <div className="sticky top-0 z-[5] -mx-[18px] w-[calc(100%+36px)] bg-white px-[18px] pt-2 sm:-mx-[30px] sm:w-[calc(100%+60px)] sm:px-[30px]">
          <header className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-stretch gap-x-3 gap-y-2">
            <div className="col-start-2 row-start-1 flex min-h-8 flex-nowrap items-center justify-end gap-3 max-[380px]:gap-1">
              <span className="max-w-[70px] truncate whitespace-nowrap text-[0.85rem] text-gray-500 max-[380px]:max-w-[48px] max-[380px]:text-[0.75rem]">
                {copy.table} {table}
              </span>
              {promotions.length > 0 && (
                <button
                  className="relative inline-flex h-9 items-center justify-center gap-1 rounded-xl border-2 border-[#f0b429] bg-[#fff8e6] px-1.5 text-[#a16207] shadow-[0_0_0_3px_rgba(240,180,41,0.16)] transition-colors hover:bg-[#ffefc2]"
                  onClick={() => setPromotionOpen(true)}
                  aria-label={copy.viewPromotions}
                  title={copy.viewPromotions}
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="m20.6 13.4-7.2 7.2a2 2 0 0 1-2.8 0l-7.2-7.2a2 2 0 0 1 0-2.8l6.6-6.6h6.8l5.8 5.8a2 2 0 0 1 0 3.6Z" />
                    <circle cx="14.5" cy="8.5" r="1.2" />
                  </svg>
                  <span className="text-[0.72rem] font-extrabold leading-none max-[380px]:hidden">{copy.promotionShort}</span>
                  <span className="absolute -right-2 -top-2 grid min-h-5 min-w-5 place-items-center rounded-full bg-[#c62828] px-1 text-[0.68rem] font-extrabold leading-none text-white">
                    {promotions.length}
                  </span>
                </button>
              )}
              <button
                className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-[#d8e9c3] bg-[#f7fbf2] px-[9px] py-[7px] text-[#5f8c25] max-[380px]:px-1.5"
                onClick={() => void openCart()}
                aria-label={copy.cart}
              >
                <span aria-hidden="true">🛒</span>
                <strong>{count}</strong>
              </button>
              <label>
                <span className="sr-only">{copy.language}</span>
                <select
                  className="min-w-[58px] shrink-0 rounded-[99px] border border-gray-200 bg-white p-2 text-black max-[380px]:min-w-[48px] max-[380px]:p-1.5"
                  value={locale}
                  onChange={(event) => {
                    const nextLocale = event.target.value as Locale;
                    setLocale(nextLocale);
                    window.localStorage.setItem(localeStorageKey, nextLocale);
                  }}
                >
                  <option value="vi">VI</option>
                  <option value="en">EN</option>
                  <option value="zh-TW">繁中</option>
                </select>
              </label>
            </div>
            <div className="col-start-1 row-start-1 flex w-auto items-center gap-2.5">
              <img
                className="h-[54px] w-[54px] rounded-xl object-contain"
                src="/logo.png"
                alt=""
                width="44"
                height="44"
              />
              <h1 className="hidden">{copy.brand}</h1>
            </div>
            <p className="col-span-full row-start-2 mb-0 w-full text-sm leading-6 text-gray-500">
              {copy.qrMenuDescription}
            </p>
          </header>
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
            onSelect={setCategory}
          />
          <nav
            className="!hidden border-b border-[#edf0e9] bg-white px-0 pb-2 pt-[18px] font-['Segoe_UI','Helvetica_Neue',Arial,sans-serif] sm:!flex sm:flex-wrap sm:gap-x-5 sm:gap-y-1"
            aria-label={copy.categories}
          >
            <button
              className={`relative border-0 bg-transparent px-0 py-2 text-[0.95rem] font-bold ${category === "all" ? "text-[#315b34] after:absolute after:inset-x-0 after:bottom-[3px] after:h-0.5 after:bg-[#315b34] after:content-['']" : "text-[#6b7280]"}`}
              onClick={() => setCategory("all")}
            >
              {copy.all}
            </button>
            {categories.map((entry) => (
              <button
                key={entry.id}
                className={`relative border-0 bg-transparent px-0 py-2 text-[0.95rem] font-bold ${category === entry.id ? "text-[#315b34] after:absolute after:inset-x-0 after:bottom-[3px] after:h-0.5 after:bg-[#315b34] after:content-['']" : "text-[#6b7280]"}`}
                onClick={() => setCategory(entry.id)}
              >
                {label(entry.names)}
              </button>
            ))}
          </nav>
        </div>
        <section
          ref={menuGridRef}
          className="grid min-h-0 flex-1 touch-manipulation content-start gap-3 overflow-y-auto overscroll-contain px-0.5 pb-[52px] sm:grid-cols-2"
        >
          {visibleItems.map((item) => {
            const displayPrice = item.displayPrice ?? item.price;
            return (
              <Fragment key={item.id}>
                <MobileMenuItemCard
                  name={label(item.names)}
                  description={label(item.description)}
                  imageUrl={item.imageUrl}
                  fallbackIcon={categoryIconFor(item.category)}
                  price={formatPrice(displayPrice, locale)}
                  originalPrice={
                    displayPrice < item.price
                      ? formatPrice(item.price, locale)
                      : undefined
                  }
                  addLabel={copy.add}
                  badge={item.unavailable ? copy.unavailable : undefined}
                  unavailable={item.unavailable}
                  disabled={item.unavailable}
                  showAction={!item.unavailable}
                  onAdd={() => openItem(item)}
                />
                <article className="hidden min-h-[164px] flex-col overflow-hidden rounded-[20px] border border-[#edf0e9] bg-white sm:flex">
                  <div
                    className="grid h-[104px] w-full place-items-center bg-gradient-to-br from-[#e8f5d6] to-[#cfe9a8] text-[3.7rem]"
                    aria-hidden="true"
                  >
                    {item.imageUrl ? (
                      <img
                        className="h-full w-full object-contain"
                        src={item.imageUrl}
                        alt=""
                      />
                    ) : categoryIconFor(item.category) === "dessert" ? (
                      <svg className="h-16 w-16 text-[#7b9b68]" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M16 39h32c-1 8-7 13-16 13s-15-5-16-13Z" fill="#f8fff1" strokeWidth="2.5" />
                        <path d="M22 24h20v12c0 4-4 6-10 6s-10-2-10-6V24Z" fill="#e7a9bd" strokeWidth="2.5" />
                        <ellipse cx="32" cy="24" rx="10" ry="3.5" fill="#f6bfd1" strokeWidth="2" />
                        <path d="M27 28v8M32 27v10M37 28v8" stroke="#fff1f5" strokeWidth="1.4" />
                        <path d="M49 12c3 0 4 2 4 4 0 3-2 5-4 5v26" strokeWidth="2" />
                      </svg>
                    ) : categoryIconFor(item.category) === "side" ? (
                      <svg className="h-16 w-16 text-[#7b9b68]" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <circle cx="32" cy="34" r="18" fill="#f8fff1" strokeWidth="2.5" />
                        <circle cx="32" cy="34" r="12" fill="#fffdf3" strokeWidth="1.8" />
                        <path d="M14 13v14M11 13v7M17 13v7M14 20v7M50 13v14M47 13v14M53 13v14M50 27v24" strokeWidth="2" />
                      </svg>
                    ) : categoryIconFor(item.category) === "bun" ? (
                      <svg className="h-16 w-16 text-[#7b9b68]" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M11 31h42c-1 14-9 22-21 22S12 45 11 31Z" fill="#f8fff1" strokeWidth="2.5" />
                        <ellipse cx="32" cy="31" rx="21" ry="8" fill="#fffdf3" strokeWidth="2.5" />
                        <path d="M18 30c4-5 7 5 11 0s7 5 11 0 5 3 7 0" strokeWidth="2" />
                        <path d="M24 27c2-3 4-3 6 0M34 27c2-3 4-3 6 0" strokeWidth="1.5" />
                        <path d="m20 34 7-3M22 37l7-3M37 34l7-3M39 37l6-3" stroke="#c87555" strokeWidth="2.5" />
                        <circle cx="28" cy="34" r="2.5" fill="#9fcf78" strokeWidth="1.2" />
                        <circle cx="34" cy="36" r="2.5" fill="#b4d987" strokeWidth="1.2" />
                      </svg>
                    ) : categoryIconFor(item.category) === "rice" ? (
                      <svg className="h-16 w-16 text-[#7b9b68]" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <ellipse cx="32" cy="42" rx="22" ry="8" fill="#f8fff1" strokeWidth="2.5" />
                        <path d="M18 38c2-9 8-14 14-14s12 5 14 14" fill="#fffdf3" strokeWidth="2.5" />
                        <path d="M22 31c4-3 12-3 18 0M24 28c3-3 5-3 8-1M28 25c2-2 5-2 7 0" strokeWidth="1.8" />
                        <path d="M24 33c1-1 2-1 3 0M29 30c1-1 2-1 3 0M35 32c1-1 2-1 3 0M31 35c1-1 2-1 3 0" strokeWidth="1.2" />
                        <path d="M36 35c2-4 8-4 10 0l-2 5H35l1-5Z" fill="#c87555" strokeWidth="2" />
                        <circle cx="20" cy="37" r="3" fill="#9fcf78" strokeWidth="1.5" />
                        <circle cx="25" cy="35" r="2.5" fill="#b4d987" strokeWidth="1.5" />
                      </svg>
                    ) : categoryIconFor(item.category) === "pho" ? (
                      <svg className="h-16 w-16 text-[#7b9b68]" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M39 12 53 25M43 11l10 10" strokeWidth="3" />
                        <path d="M12 30h40c-1 13-9 22-20 22S13 43 12 30Z" fill="#f8fff1" strokeWidth="2.5" />
                        <path d="M17 35c5 4 25 4 30 0M20 41c6 3 18 3 24 0" strokeWidth="2" />
                        <path d="M25 26c-2-4 3-5 1-9M34 26c-2-4 3-5 1-9" strokeWidth="2" />
                      </svg>
                    ) : (
                      categoryIconFor(item.category)
                    )}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col p-[15px]">
                    <p className="text-[1.05rem] font-extrabold text-black">
                      {label(item.names)}
                    </p>
                    <p className="mt-[5px] line-clamp-2 overflow-hidden text-[0.83rem] text-gray-500">
                      {label(item.description)}
                    </p>
                    <div className="mt-auto flex items-center justify-between gap-3 pt-2.5">
                      <strong className="text-[#8ac545]">
                        {displayPrice < item.price && (
                          <small className="mr-1 line-through">
                            {formatPrice(item.price, locale)}
                          </small>
                        )}
                        {formatPrice(displayPrice, locale)}
                      </strong>
                      {!item.unavailable && (
                        <button
                          className="rounded-[11px] border-0 bg-[#315b34] px-3 py-2 text-sm font-bold text-white transition-colors hover:bg-[#48743f] disabled:bg-gray-300"
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
        </section>
        <aside
          className="fixed inset-x-0 bottom-4 z-10 bg-transparent"
        >
          {cartOpen && <div className="fixed inset-0 z-0 bg-black/30" onMouseDown={() => setCartOpen(false)} />}
          {cartOpen && (
            <div
              ref={restoreCartFocus}
              className="fixed inset-0 z-[12] flex max-h-none flex-col overflow-auto border-0 bg-white px-6 py-6 text-base shadow-none sm:px-[max(18px,calc((100vw-680px)/2))]"
            >
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
                className="-mx-[max(18px,calc((100vw-680px)/2))] -mt-6 sm:!hidden"
              />
              <div className="!hidden items-center justify-between gap-3 border-b border-gray-100 pb-[10px] text-[1.05rem] sm:!mb-3 sm:!flex">
                <div className="grid gap-[3px]">
                  <strong className="text-[1.4rem]">
                    {copy.cart} · {count} {copy.item}
                  </strong>
                  <small className="text-[1.4rem] font-extrabold leading-[1.3] text-[#8ac545]">
                    {cartAvailabilityError || unavailableCartItems.length > 0 ? (
                      <span className="text-[0.9rem] font-bold leading-snug text-red-600">
                        {copy.removeUnavailableItemsToUpdateTotal}
                      </span>
                    ) : quoteLoading ? (
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
                  </small>
                </div>
                <button
                  className="grid size-[27px] flex-none place-items-center rounded-full border border-gray-200 bg-white text-[1.2rem] text-[#5f8c25]"
                  onClick={() => setCartOpen(false)}
                  aria-label={copy.cancel}
                >
                  ×
                </button>
              </div>
              {cart.length === 0 ? (
                <p className="my-2 text-[0.86rem]">{copy.cartEmptyDescription}</p>
              ) : (
                <div className="cart-lines flex flex-1 flex-col gap-2 overflow-y-auto">
                  {cart.map((line) => {
                    const item = items.find(
                      (candidate) => candidate.id === line.itemId,
                    );
                    const details = [
                      line.variant &&
                        label(
                          item?.variants.find(
                            (choice) => choice.id === line.variant,
                          )?.names || {
                            vi: "",
                            en: "",
                            "zh-TW": "",
                          },
                        ),
                      ...(item?.addons
                        .filter((addon) => line.addonIds.includes(addon.id))
                        .map((addon) => label(addon.names)) || []),
                    ]
                      .filter(Boolean)
                      .join(" · ");
                    const lineUnavailable =
                      Boolean(item?.unavailable) ||
                      Boolean(
                        item?.addons.some(
                          (addon) =>
                            line.addonIds.includes(addon.id) &&
                            addon.unavailable,
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
                          details={details}
                          unavailable={lineUnavailable}
                          unavailableLabel={lineUnavailable ? copy.unavailable : undefined}
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
                          onCustomise={() => item && openItem(item, line)}
                          onRemove={() => updateQuantity(line.key, 0)}
                        />
                        <div
                          data-cart-line-key={line.key}
                          className={`hidden items-center justify-between gap-4 border-b border-gray-100 px-2 py-3 font-['Segoe_UI','Helvetica_Neue',Arial,sans-serif] sm:flex ${lineUnavailable ? "rounded-xl !border !border-red-300 bg-red-50" : ""}`}
                        >
                          <div className="min-w-0 flex-1">
                            <strong className="block text-[1rem] leading-tight text-[#29382c]">{item ? label(item.names) : ""}</strong>
                            <small className="mt-[3px] block max-w-[230px] overflow-hidden text-[0.85rem] font-bold text-[#5f8c25]">
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
                              {lineUnavailable ? (
                                <span className="ml-2 text-[0.78rem] font-bold text-red-600">
                                  {copy.unavailable}
                                </span>
                              ) : null}
                            </small>
                            <small className="mt-1 block max-w-[230px] truncate text-[0.78rem] text-gray-500">{details}</small>
                          </div>
                          <div className="ml-auto flex items-center gap-4">
                            <div className="flex items-center gap-2">
                              <button
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
                                className="inline-flex h-[27px] w-[27px] items-center justify-center rounded-full border border-[#d9e6d3] bg-white p-0 text-[#426b38]"
                                type="button"
                                aria-label={copy.customise}
                                onClick={() => item && openItem(item, line)}
                              >
                                <svg className="h-[14px] w-[14px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                  <path d="m4 16.5-.8 4.3 4.3-.8L19.1 8.4l-3.5-3.5L4 16.5Z" />
                                  <path d="m13.8 6.7 3.5 3.5" />
                                </svg>
                              </button>
                              <button
                                className="inline-flex h-[27px] w-[27px] items-center justify-center rounded-full border border-red-200 bg-white p-0 text-red-600 hover:bg-red-50"
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
              {pricingChanged && (
                <p className="my-3 rounded-[10px] border border-[#f0b429] bg-[#fff8e6] px-3 py-2.5 text-[0.9rem] font-semibold text-[#7a4a00]" role="alert">
                  {copy.orderPricingChanged}
                </p>
              )}
              {(cartAvailabilityError || unavailableCartItems.length > 0) && (
                <div className="my-3 rounded-[10px] border border-[#f0b429] bg-[#fff8e6] px-3 py-2.5 text-[0.9rem] font-semibold text-[#7a4a00]" role="alert">
                  <p>{copy.cartUnavailable}</p>
                  <ul>
                    {unavailableCartItems.map((entry, index) => (
                      <li
                        key={`${entry.kind}-${entry.name}-${entry.addonName}-${index}`}
                      >
                        <span>
                          {entry.kind === "item"
                            ? copy.unavailableItem
                            : copy.unavailableAddon}
                          :{" "}
                        </span>
                        <strong className="font-extrabold text-red-700">
                          {entry.name}
                          {entry.addonName ? ` - ${entry.addonName}` : ""}
                        </strong>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <button
                className="mt-auto mb-[calc(32px+env(safe-area-inset-bottom))] w-full rounded-xl bg-[#315b34] px-4 py-3 font-bold text-white transition-colors hover:bg-[#48743f] disabled:cursor-not-allowed disabled:opacity-50 max-[649px]:!mt-2"
                disabled={
                  !cart.length ||
                  sending ||
                  cartAvailabilityError ||
                  unavailableCartItems.length > 0
                }
                onClick={() => void confirm()}
              >
                {copy.sendOrder}
              </button>
            </div>
          )}
        </aside>
        {promotionOpen && (
          <div
            className="fixed inset-0 z-[50] flex items-start justify-center overflow-y-auto bg-[rgba(0,0,0,0.46)] p-5"
            onMouseDown={() => setPromotionOpen(false)}
          >
            <section
              className="relative mt-2 flex max-h-[min(82svh,680px)] w-[min(100%,560px)] flex-col overflow-y-auto rounded-[26px] bg-[#fffdf9] p-5 text-[#24312a] shadow-[0_26px_80px_rgba(24,38,25,0.24)] sm:mt-3 sm:p-7"
              role="dialog"
              aria-modal="true"
              aria-label={copy.promotions}
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div className="mb-5 flex items-start justify-between gap-3 border-b border-[#edf0e9] pb-4">
                <div>
                  <h2 className="text-2xl font-extrabold text-[#253228]">{copy.promotions}</h2>
                </div>
                <button
                  className="grid h-9 w-9 flex-none place-items-center rounded-full bg-[#eef3ea] text-2xl leading-none text-[#526052]"
                  onClick={() => setPromotionOpen(false)}
                  aria-label={copy.cancel}
                >
                  <span className="relative -top-px">×</span>
                </button>
              </div>
              <div className="grid gap-3">
                {promotions.map((promotion) => (
                  <article key={promotion.id} className="overflow-hidden rounded-2xl border border-[#dce9d5] bg-white">
                    {promotion.imageUrl && (
                      <img className="h-36 w-full object-cover" src={promotion.imageUrl} alt="" />
                    )}
                    <div className="grid gap-2 p-4">
                      <h3 className="text-lg font-extrabold text-[#315b34]">{label(promotion.names)}</h3>
                      <p className="text-[0.95rem] font-semibold leading-6 text-[#526052]">
                        {promotionDescriptionParts(label(promotion.descriptions)).map((part, index) =>
                          /^(\d+(?:[.,]\d+)?%|\d+(?:[.,]\d+)?\s*NT\$|NT\$\s*\d+(?:[.,]\d+)?|\d+(?:[.,]\d+)?\s*折)$/.test(part) ? (
                            <strong key={`${part}-${index}`} className="mx-0.5 text-[1.18rem] font-extrabold text-red-600">
                              {part}
                            </strong>
                          ) : (
                            <Fragment key={`${part}-${index}`}>{part}</Fragment>
                          ),
                        )}
                      </p>
                      {(promotion.startsAt || promotion.endsAt) && (
                        <p className="text-sm text-[#718072]">
                          {copy.promotionValidity}: {formatPromotionDate(promotion.startsAt, locale)}
                          {promotion.endsAt ? ` ${copy.promotionTo} ${formatPromotionDate(promotion.endsAt, locale)}` : ""}
                        </p>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </div>
        )}
        {selected && (
          <div
            className="fixed inset-0 z-[9] flex items-center justify-center bg-[rgba(0,0,0,0.46)] p-6 max-[649px]:items-end max-[649px]:p-0"
            onMouseDown={closeItem}
          >
            <section
              className="customise-sheet relative z-[31] flex min-h-[320px] max-h-[91svh] w-[min(100%,720px)] flex-col overflow-y-auto rounded-[30px] bg-[#fffdf9] p-8 text-[#24312a] shadow-[0_26px_80px_rgba(24,38,25,0.24)] max-[649px]:fixed max-[649px]:inset-x-0 max-[649px]:bottom-0 max-[649px]:min-h-0 max-[649px]:max-h-[92svh] max-[649px]:w-full max-[649px]:rounded-t-[25px] max-[649px]:px-[18px] max-[649px]:pb-[calc(96px+env(safe-area-inset-bottom))]"
              role="dialog"
              aria-modal="true"
              aria-label={copy.customise}
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3 border-b border-[#edf0e9] pb-4">
                <div>
                  <p className="text-[0.825rem] font-extrabold text-[#526f47]">{copy.customise}</p>
                  <h2 className="text-[clamp(1.5rem,4vw,1.9rem)] font-extrabold text-[#253228]">{label(selected.names)}</h2>
                </div>
                <button
                  className="relative top-1 -left-px grid h-[38px] w-[38px] flex-none place-items-center rounded-full border-0 bg-[#eef3ea] p-0 text-[#526052]"
                  onClick={closeItem}
                  aria-label={copy.cancel}
                >
                  <span className="modal-close-symbol relative -top-px text-2xl leading-none">×</span>
                </button>
              </div>
              <div className="mb-2 flex items-center justify-between gap-3 border-y border-[#edf0e9] py-3 font-bold text-[#344535]">
                <span>{copy.quantity}</span>
                <div className="flex items-center gap-2">
                  <button
                    className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[#dce7d7] bg-white p-0 text-xl leading-none text-[#426b38]"
                    aria-label={copy.decreaseQuantity}
                    onClick={() =>
                      setQuantity((value) => Math.max(1, value - 1))
                    }
                  >
                    <span className="quantity-symbol relative -top-px">−</span>
                  </button>
                  <strong>{quantity}</strong>
                  <button
                    className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[#dce7d7] bg-white p-0 text-xl leading-none text-[#426b38]"
                    aria-label={copy.increaseQuantity}
                    onClick={() => setQuantity((value) => value + 1)}
                  >
                    <span className="quantity-symbol relative -top-px">+</span>
                  </button>
                </div>
              </div>
              {selected.variants.length > 0 && (
                <fieldset className="mt-3">
                  <legend className="mb-1">{copy.variant}</legend>
                  <div className="flex flex-wrap gap-2">
                    {selected.variants.map((choice) => (
                      <button
                        key={choice.id}
                        className={`rounded-full border border-[#dce7d7] bg-white px-[13px] py-[9px] text-[#627060] ${variant === choice.id ? "border-[#88b477] bg-[#eaf4e5] font-bold text-[#31552e]" : ""}`}
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
                  <fieldset key={group.id} className="mt-3 border-0 p-0">
                    <legend className="mb-1 font-extrabold text-[#344535]">
                      {label(group.names)}
                      {group.required ? " *" : ""}
                    </legend>
                    <div className="flex flex-wrap gap-2">
                      {group.options.map((option) => (
                        <button
                          key={option.id}
                          className={`rounded-full border border-[#dce7d7] bg-white px-[13px] py-[9px] text-[#627060] ${selectedIds.includes(option.id) ? "border-[#88b477] bg-[#eaf4e5] font-bold text-[#31552e]" : ""}`}
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
                  <fieldset className="mt-3 border-0 p-0">
                    <legend className="mb-1 font-extrabold text-[#344535]">{copy.comboComponents}</legend>
                    <div className="grid gap-2.5">
                      {componentSelections.map((selection, index) => {
                        const component = selected.components?.find((entry) =>
                          selection.componentId.startsWith(entry.componentId),
                        );
                        if (!component) return null;
                        return (
                          <details
                            key={selection.componentId}
                            className="overflow-hidden rounded-xl border border-[#dce7d7] bg-white"
                            open={index === 0}
                          >
                            <summary className="flex cursor-pointer items-center justify-between px-3 py-2.5 font-bold text-[#344535]">
                              {label(component.names)}{" "}
                              {(selected.components?.filter(
                                (entry) => entry.itemId === component.itemId,
                              ).length || 0) > 1
                                ? index + 1
                                : ""}
                            </summary>
                            <div className="border-t border-[#edf2e9] p-3">
                              <div className="flex flex-wrap gap-2">
                                {component.noteOptions.map((choice) => (
                                  <button
                                    key={choice.id}
                                    className={`rounded-full border border-[#dce7d7] bg-white px-[13px] py-[9px] text-[#627060] aria-pressed:border-[#88b477] aria-pressed:bg-[#eaf4e5] aria-pressed:font-bold aria-pressed:text-[#31552e] ${selection.noteOptions.includes(choice.id) ? "border-[#88b477] bg-[#eaf4e5] font-bold text-[#31552e]" : ""}`}
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
                                className="mt-2 min-h-[64px] w-full resize-y rounded-lg border border-[#dce7d7] bg-white px-3 py-2 text-sm text-[#344535] focus:border-[#315b34] focus:outline-none focus:ring-2 focus:ring-[#8ac545]/30"
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
              {selected.noteOptions.length > 0 && (
                <fieldset className="mt-3">
                  <legend className="mb-1">{copy.noThanks}</legend>
                  <div className="flex flex-wrap gap-2">
                    {selected.noteOptions.map((choice) => (
                      <button
                        key={choice.id}
                        className={`rounded-full border border-[#dce7d7] bg-white px-[13px] py-[9px] text-[#627060] aria-pressed:border-[#88b477] aria-pressed:bg-[#eaf4e5] aria-pressed:font-bold aria-pressed:text-[#31552e] ${noteOptions.includes(choice.id) ? "border-[#88b477] bg-[#eaf4e5] font-bold text-[#31552e]" : ""}`}
                        aria-pressed={noteOptions.includes(choice.id)}
                        onClick={() =>
                          toggle(choice.id, noteOptions, setNoteOptions)
                        }
                      >
                        {label(choice.names)}
                      </button>
                    ))}
                  </div>
                </fieldset>
              )}
              {selected.addons.length > 0 && (
                <fieldset className="mt-3">
                  <legend className="mb-1">{copy.addons}</legend>
                  <div className="grid grid-cols-1 gap-2">
                    {selected.addons.map((addon) => {
                      const displayPrice =
                        addon.displayPrice ?? addon.priceExtra;
                      return (
                        <button
                          key={addon.id}
                          disabled={addon.unavailable}
                          className={`flex items-center justify-between gap-2 rounded-xl border border-[#dce7d7] bg-white px-3 py-2.5 text-left text-[#344535] transition-colors disabled:cursor-not-allowed disabled:opacity-55 aria-pressed:border-[#88b477] aria-pressed:bg-[#eaf4e5] ${addonIds.includes(addon.id) ? "border-[#88b477] bg-[#eaf4e5] font-bold text-[#31552e]" : ""}`}
                          aria-pressed={addonIds.includes(addon.id)}
                          onClick={() =>
                            toggle(addon.id, addonIds, setAddonIds)
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
              <label className="mt-3 grid gap-2">
                <span className="mb-1 font-extrabold text-[#344535]">{copy.note}</span>
                <textarea
                  className="min-h-[82px] resize-y rounded-xl border border-[#dce7d7] bg-white px-3 py-2.5 focus:border-[#315b34] focus:outline-none focus:ring-2 focus:ring-[#8ac545]/30"
                  value={note}
                  maxLength={40}
                  onFocus={(event) => scrollTextareaIntoView(event.currentTarget)}
                  onChange={(event) => setNote(event.target.value)}
                />
              </label>
              <div className="mt-6 flex items-center justify-between gap-3 max-[649px]:mb-1">
                <strong className="min-w-max text-[1.25rem]">
                  {formatPrice(
                    quantity *
                      (selected.price +
                        selected.addons
                          .filter((addon) => addonIds.includes(addon.id))
                          .reduce((sum, addon) => sum + addon.priceExtra, 0)),
                    locale,
                  )}
                </strong>
                <button className="flex-1 rounded-xl bg-[#315b34] px-4 py-3 font-bold text-white transition-colors hover:bg-[#48743f]" onClick={addToCart}>
                  {editingKey ? copy.updateItem : copy.addToCart}
                </button>
              </div>
            </section>
          </div>
        )}
      </main>
      <MobileStoreFooter
        name={storeFooter.name}
        hoursLabel={copy.businessHours}
        hours={storeFooter.hours}
        phone={storeFooter.phone}
        address={storeFooter.address}
        copyright={storeFooter.copyright}
      />
    </>
  );
}
