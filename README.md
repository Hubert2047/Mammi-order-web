# MamMi Order Web

Standalone public Next.js application for QR dine-in ordering and future online ordering. It must never include admin, POS, staff authentication, or private backend routes.

## Deployment boundary

- Public domain: `order.mammi.tw`.
- QR entry: `/q/{qrToken}`.
- Future online-menu entry: `/s/{storeSlug}`.
- The application only calls the backend's `/api/public/*` namespace through `NEXT_PUBLIC_ORDER_API_BASE_URL`.

## Public API contract to implement in the backend

1. `GET /api/public/qr/{qrToken}` resolves an active QR token to an order context (`store`, `table`, active catalog and addons). It returns only sellable items/addons and their current store prices.
2. `POST /api/public/carts` creates an opaque guest-cart token for that context.
3. `PATCH /api/public/carts/{cartToken}` updates cart lines and notes. The backend owns price and availability validation.
4. `POST /api/public/carts/{cartToken}/confirm` creates a pending POS order with `source=qr`, table metadata and the existing order sequence/number.

Guest carts are editable, backed by MongoDB, and expire through a TTL index. Confirmation locks that cart and creates an immutable customer-facing order; additional QR scans create separate orders. Every public endpoint must be rate-limited and must accept only opaque QR/cart tokens, never staff credentials.

## Local Docker

`docker compose up -d` starts this app on `http://localhost:3001`. Set `NEXT_PUBLIC_ORDER_API_BASE_URL=http://localhost:8080` for a browser on the same machine; this value is built into the production image. The backend permits this origin through `ORDER_WEB_URL`.
