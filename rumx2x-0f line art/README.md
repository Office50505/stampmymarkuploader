# Line Art Uploader

An isolated Shopify app for Printmivo's Permanent Logo Stamp product. It keeps the proven StampMyMark upload, storage, order-linking, and admin flow, then adds a customer-facing line-art generation step.

## V1 flow

```text
Customer chooses an ink color
-> uploads JPG, PNG, or WEBP artwork
-> original is stored privately in Bunny.net
-> server submits the artwork to GPT Image through FAL
-> GPT Image returns one-color transparent PNG line art
-> customer sees the generated preview in the selected ink color
-> original and generated artwork links are attached to the cart line
-> orders/create links both files to the Shopify order
```

The Add to Cart button stays unavailable until the generated line art is ready. Changing the selected ink color regenerates the preview in that color.

## Generation settings

- FAL endpoint: `openai/gpt-image-2.6/flare/edit`
- Image quality: `medium`
- Reasoning effort: `medium`
- Output: one transparent PNG
- Supported product colors: black, blue, green, purple, red, and white
- The prompt preserves the customer's logo, layout, and text while removing gradients, photos, shadows, texture, and background.

`FAL_KEY` is server-side only. It is never added to Liquid, storefront JavaScript, or a cart property.

## Stack

- Shopify React Router app
- Shopify Theme App Extension
- Shopify app proxy for storefront endpoints
- PostgreSQL via Prisma
- Bunny.net private object storage
- FAL queue API and GPT Image
- Railway hosting

## Local checks

```bash
npm install
npm run postinstall
npm run typecheck
npm run build
```

Copy `.env.example` to `.env` and fill the server-side secrets before running `npm run dev`.

## Important paths

- Line-art service and production prompt: `app/lib/line-art.server.ts`
- Storefront flow: `extensions/stamp-upload/assets/stamp-upload-core.js`
- Storefront block: `extensions/stamp-upload/blocks/upload-picture.liquid`
- Database schema: `prisma/schema.prisma`
- Railway config: `railway.json`
- Setup guide: `LINE_ART_SETUP.md`

Only this `line art` folder belongs to the new app. The sibling `US store` app is a separate production service and must not be modified or deployed while working here.
