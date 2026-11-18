# Line Art Uploader Setup

Target Shopify store:

- Permanent domain: `9zgiqv-ug.myshopify.com`
- Customer-facing domain: `printmivo.com`
- Store owner account shown during setup: `niasheo974105@gmail.com`

This folder contains an isolated copy of the existing StampMyMark uploader with GPT Image line-art generation added. The sibling `US store` folder remains unchanged.

## Required isolated resources

1. A new Shopify app named `lineartuploader` with custom distribution restricted to `9zgiqv-ug.myshopify.com`.
2. The Railway project and service named `lineartuploader`.
3. The PostgreSQL service in that Railway project.
4. Bunny.net credentials for private original and generated files.
5. A server-only FAL master key stored as `FAL_KEY` in Railway.

Never reuse the US uploader's Shopify client ID or secret. Storage may use the existing private Bunny zone because objects remain separated by shop and upload ID.

## Setup order

1. Run `npm install` in this folder.
2. Link this folder to the new `lineartuploader` Shopify app.
3. Add `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, and `FAL_KEY` to Railway.
4. Deploy the web service from repository root `/line art`.
5. Deploy the Shopify app configuration and theme extension.
6. Set custom distribution to `9zgiqv-ug.myshopify.com` and install it on Printmivo.
7. In the theme editor, add the `Line Art Uploader` block only to the Permanent Logo Stamp product template.

## Verification

- Confirm the embedded dashboard opens from the Printmivo Shopify admin.
- Select each ink color and upload a test JPG, PNG, or WEBP.
- Confirm the transparent line-art preview uses the selected color.
- Confirm the original and generated records appear in the line-art dashboard.
- Add one upload to cart and place a test order.
- Confirm the `orders/create` webhook changes the upload status to `ordered`.
- Confirm both files remain private in Bunny.net and are available through signed app routes.
