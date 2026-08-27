# MamMi Order Web

Standalone public Next.js application for QR dine-in ordering and future online ordering. It must never include admin, POS, staff authentication, or private backend routes.

## Deployment boundary

- Public domain: `order.mammi.tw`.
- QR entry: `/q/{qrToken}`.
- Future online-menu entry: `/s/{storeSlug}`.
- The application calls same-origin `/api/public/*` and `/socket.io/*`; the order-web server proxies those paths to the private backend network.

## Public API contract to implement in the backend

1. `GET /api/public/qr/{qrToken}` resolves an active QR token to an order context (`store`, `table`, active catalog and addons). It returns only sellable items/addons and their current store prices.
2. `POST /api/public/carts` creates an opaque guest-cart token for that context.
3. `PATCH /api/public/carts/{cartToken}` updates cart lines and notes. The backend owns price and availability validation.
4. `POST /api/public/carts/{cartToken}/confirm` creates a pending POS order with `source=qr`, table metadata and the existing order sequence/number.

Guest carts are editable, backed by MongoDB, and expire through a TTL index. Confirmation locks that cart and creates an immutable customer-facing order; additional QR scans create separate orders. Every public endpoint must be rate-limited and must accept only opaque QR/cart tokens, never staff credentials.

## Local Docker

`docker compose up -d` starts this app on `http://localhost:3001`. Development may set `INTERNAL_ORDER_API_BASE_URL=http://backend:8080`; this value is server-only and is never embedded in browser JavaScript. Production uses the same internal Docker hostname through `docker-compose.production.yml`.
