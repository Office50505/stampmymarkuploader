# Railway Deployment Steps

Use this flow to deploy the app to Railway and install it on the live Shopify store.

## 1. Prepare GitHub

Make sure secrets are not committed.

```bash
git status
```

The real `.env` file must not appear in staged files. `.env.example` should contain placeholders only.

Create and push the repo:

```bash
git init
git add .
git commit -m "Initial StampMyMark Shopify uploader app"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

## 2. Create Railway App Service

In Railway:

1. Open the same project that has Postgres.
2. Add a new service.
3. Choose GitHub repo.
4. Select this app repo.
5. Let Railway detect Node/Nixpacks.

This repo includes `railway.json`:

- Build command: `npm run build`
- Start command: `npm run setup && npm run start`
- Healthcheck: `/healthcheck`

## 3. Add Railway Environment Variables

In the new app service, add:

```env
DATABASE_URL=${{Postgres.DATABASE_URL}}

SHOPIFY_API_KEY=your_shopify_client_id
SHOPIFY_API_SECRET=your_shopify_client_secret
SHOPIFY_APP_URL=https://your-app.up.railway.app
SCOPES=read_products,read_orders
SHOPIFY_SHOP_DOMAIN=hijr3v-kf.myshopify.com
SHOP_CUSTOM_DOMAIN=stampmymark.com

BUNNY_STORAGE_ZONE=stamptrial
BUNNY_STORAGE_ACCESS_KEY=your_bunny_storage_zone_password
BUNNY_STORAGE_ENDPOINT=https://sg.storage.bunnycdn.com
BUNNY_PULL_ZONE_URL=https://your-pull-zone.b-cdn.net

UPLOAD_MAX_BYTES=26214400
UPLOAD_RETENTION_DAYS=30
UPLOAD_DELETE_EXPIRED_OBJECTS=true
NODE_ENV=production
```

Use the private Railway Postgres URL reference for the deployed app. Use the public Railway URL only for local commands from your Mac.

## 4. Generate Railway Domain

In the Railway app service:

1. Go to Settings.
2. Generate a public domain.
3. Copy the HTTPS URL.

Example:

```text
https://stampmymark-uploader-production.up.railway.app
```

Set `SHOPIFY_APP_URL` to that exact URL.

## 5. Update Shopify Config URLs

Update `shopify.app.stampmymark-uploader.toml`:

```toml
application_url = "https://your-app.up.railway.app"

[auth]
redirect_urls = [
  "https://your-app.up.railway.app/auth/callback",
  "https://your-app.up.railway.app/auth/shopify/callback",
  "https://your-app.up.railway.app/api/auth/callback"
]

[app_proxy]
url = "https://your-app.up.railway.app/apps/stamp-upload"
```

Then deploy the Shopify app config and extension:

```bash
npm run deploy -- --config stampmymark-uploader
```

## 6. Custom Distribution Install

In Shopify Partner Dashboard:

1. Open the `stampmymark-uploader` app.
2. Go to App distribution.
3. Choose Custom distribution.
4. Enter:

```text
hijr3v-kf.myshopify.com
```

5. Generate the install link.
6. Open the link and install the app on the store.

## 7. Add Theme App Extension Block

In Shopify Admin:

1. Online Store -> Themes.
2. Open the draft theme first.
3. Customize.
4. Open the product template.
5. Add the `Upload Picture` app block.
6. Place it where the current Uploadify/Uploadly button appears.
7. Test a file upload.

## 8. End-To-End Test

Test this flow:

```text
Product page
-> Upload Picture
-> file stored in Bunny.net
-> upload row visible in app admin
-> Add to cart
-> line item property contains upload_id
-> test checkout
-> orders/create webhook marks upload ordered
```
