# StampMyMark Shopify Uploader

Production-oriented custom Shopify app for StampMyMark.com that replaces the Uploadify product-page upload button with a StampMyMark-controlled uploader.

The flow is:

```text
Product page
-> server-rendered Upload Picture app block
-> customer selects file
-> app creates upload_id and DB record
-> browser uploads original file to the app backend
-> backend stores the original file in Bunny.net Storage
-> upload_id is attached to the Shopify cart line
-> normal Shopify checkout
-> orders/create webhook links the upload to the order
```

Uploads that never become orders remain visible in the embedded admin dashboard until the configured retention period expires.

## Stack

- Shopify React Router app template structure
- Shopify Theme App Extension app block
- Shopify app proxy for storefront upload endpoints
- Shopify Admin GraphQL-compatible embedded admin surface
- Shopify webhooks for order linking
- Node.js and TypeScript
- PostgreSQL via Prisma
- Bunny.net Storage through the server-side HTTP Storage API

## Important Paths

- Requirements: `STAMPMYMARK_SHOPIFY_UPLOADER_REQUIREMENTS.md`
- Prisma schema: `prisma/schema.prisma`
- Upload service: `app/lib/uploads.server.ts`
- Bunny.net storage service: `app/lib/storage.server.ts`
- Webhook service: `app/lib/webhooks.server.ts`
- Admin dashboard: `app/routes/app.uploads.tsx`
- Storefront app proxy routes: `app/routes/apps.stamp-upload.*.tsx`
- Theme app block: `extensions/stamp-upload/blocks/upload-picture.liquid`
- Storefront JS enhancement: `extensions/stamp-upload/assets/stamp-upload.js`

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Copy environment variables:

```bash
cp .env.example .env
```

3. Fill in:

```text
SHOPIFY_API_KEY
SHOPIFY_API_SECRET
SHOPIFY_APP_URL
DATABASE_URL
BUNNY_STORAGE_ZONE
BUNNY_STORAGE_ACCESS_KEY
BUNNY_STORAGE_ENDPOINT
BUNNY_PULL_ZONE_URL
```

4. Generate Prisma client and run migrations:

```bash
npm run setup
```

5. Run the Shopify app locally:

```bash
npm run dev
```

## Shopify Configuration

The app is configured for:

- Embedded admin app
- App proxy at `/apps/stamp-upload`
- `orders/create` webhook
- `app/uninstalled` webhook
- Scopes:
  - `read_products`
  - `read_orders`

Before production deployment, replace placeholder values in `shopify.app.toml` or link the app with Shopify CLI:

```bash
npm run config:link
```

## Theme Installation

Deploy the app and extension:

```bash
npm run deploy
```

Then add the `Upload Picture` app block to the target product template in the Shopify theme editor.

The block renders the visible full-width blue Upload Picture button in Liquid. JavaScript only enhances the already-rendered button.

## Bunny.net Storage Requirements

Use a Bunny.net Storage Zone. The storage-zone password is kept server-side as `BUNNY_STORAGE_ACCESS_KEY` and is never exposed to the storefront.

Bunny upload requests are made by the app backend with the `AccessKey` header. Customers upload to the app through Shopify's app proxy, then the app forwards the original file to Bunny Storage.

Use the HTTP Storage endpoint for your Bunny region, for example:

```text
https://storage.bunnycdn.com
https://ny.storage.bunnycdn.com
https://sg.storage.bunnycdn.com
```

## Cleanup

Abandoned uploads expire after `UPLOAD_RETENTION_DAYS`, defaulting to 30.

Run cleanup on a schedule from your hosting provider:

```bash
npm run cleanup
```

If `UPLOAD_DELETE_EXPIRED_OBJECTS=true`, expired objects are deleted from Bunny Storage while metadata remains for audit.

## Verification Checklist

- Product page shows the server-rendered blue Upload Picture button without waiting for JS to create it.
- Valid file immediately creates a DB record and uploads to Bunny Storage.
- Invalid file type/size is rejected before upload.
- Progress and preview appear during upload.
- Add to Cart is disabled until upload completes.
- Cart line receives `_stampmymark_upload_id`.
- Order webhook marks the upload `ordered`.
- Non-checkout uploads remain visible as unordered/abandoned.
- Admin can filter, preview, and download files through authenticated app routes.
