# Railway Deployment

The production project and app service are both named `lineartuploader`. The service deploys the `main` branch of `Office50505/stampmymarkuploader` with root directory `/line art`.

## Services

- `lineartuploader`: Node web service, public HTTPS domain, port 8080
- `Postgres`: isolated app database

The repository includes `railway.json`, which runs:

```text
build: npm run build
start: npm run setup && npm run start
healthcheck: /healthcheck
```

## Required variables

```text
SHOPIFY_API_KEY
SHOPIFY_API_SECRET
SHOPIFY_APP_URL
SCOPES=read_products,read_orders
DATABASE_URL=${{Postgres.DATABASE_URL}}
FAL_KEY
FAL_LINE_ART_MODEL=openai/gpt-image-2.6/flare/edit
BUNNY_STORAGE_ENDPOINT
BUNNY_STORAGE_ZONE
BUNNY_STORAGE_ACCESS_KEY
SHOP_CUSTOM_DOMAIN=printmivo.com
UPLOAD_MAX_BYTES=26214400
UPLOAD_RETENTION_DAYS=30
UPLOAD_DELETE_EXPIRED_OBJECTS=false
```

Keep the Shopify secret, FAL key, Bunny access key, and location-provider key server-side. Do not put them in Shopify Liquid, theme JavaScript, Git, or cart attributes.

After Railway provides the public URL, use the same HTTPS origin for `SHOPIFY_APP_URL`, Shopify redirect URLs, and the app proxy target.
