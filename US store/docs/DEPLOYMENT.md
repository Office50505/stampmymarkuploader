# Deployment Guide

## Production Services

Provision:

- A public HTTPS app host compatible with Node.js 20+.
- PostgreSQL.
- A Bunny.net Storage Zone.
- A Shopify app configured in the Partner Dashboard.
- A scheduled job runner for `npm run cleanup`.

## Environment Variables

Set all values from `.env.example` in your production host.

Use production values for:

```text
SHOPIFY_API_KEY
SHOPIFY_API_SECRET
SHOPIFY_APP_URL
DATABASE_URL
BUNNY_STORAGE_ZONE
BUNNY_STORAGE_ACCESS_KEY
BUNNY_STORAGE_ENDPOINT
BUNNY_PULL_ZONE_URL
UPLOAD_MAX_BYTES
UPLOAD_RETENTION_DAYS
UPLOAD_DELETE_EXPIRED_OBJECTS
```

Do not expose the Bunny Storage Zone password to the storefront.

## Database

Run:

```bash
npm run setup
```

This generates Prisma client code and applies migrations.

## Shopify App URLs

Configure the app URL:

```text
https://your-app.example.com
```

Configure redirects:

```text
https://your-app.example.com/auth/callback
https://your-app.example.com/auth/shopify/callback
https://your-app.example.com/api/auth/callback
```

Configure app proxy:

```text
Prefix: apps
Subpath: stamp-upload
Proxy URL: https://your-app.example.com/apps/stamp-upload
```

Configure webhooks:

```text
orders/create -> /webhooks/orders/create
app/uninstalled -> /webhooks/app/uninstalled
```

## Deploy App And Extension

Use Shopify CLI:

```bash
npm run deploy
```

After deployment, add the `Upload Picture` app block to the selected product template.

## Bunny.net Storage

Bunny.net Storage uses the HTTP Storage API. Set:

```text
BUNNY_STORAGE_ZONE=your-zone-name
BUNNY_STORAGE_ACCESS_KEY=your-storage-zone-password
BUNNY_STORAGE_ENDPOINT=https://storage.bunnycdn.com
BUNNY_PULL_ZONE_URL=https://your-pull-zone.b-cdn.net
```

Use the endpoint shown in the Access tab of your Bunny Storage Zone. The backend uses the `AccessKey` header; customers never receive this secret.

## Scheduled Cleanup

Schedule:

```bash
npm run cleanup
```

Recommended cadence: daily.

## Operational Notes

- Keep the Bunny Storage Zone password private.
- Admin preview and download stream through authenticated app routes.
- Review uploads with `status = uploaded`, `cart`, or `abandoned` to find customers who uploaded but did not order.
- If webhook delivery is retried, duplicate webhook IDs are ignored.
- If an order references an unknown upload ID, inspect webhook/app logs.
