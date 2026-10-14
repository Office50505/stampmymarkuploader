# US Store Setup

Target Shopify store:

- Permanent domain: `9zgiqv-ug.myshopify.com`
- Customer-facing domain: `printmivo.com`
- Store owner account shown during setup: `niasheo974105@gmail.com`

This folder contains an isolated copy of the existing StampMyMark uploader. The application behavior and theme extension are unchanged, but the production resources must be separate.

## Required isolated resources

1. A new Shopify app named `stampmymark-uploader-us` with custom distribution restricted to `9zgiqv-ug.myshopify.com`.
2. A new Railway app service and public HTTPS domain.
3. A separate PostgreSQL database.
4. A separate Bunny.net Storage Zone and access key.

Never copy the original folder's `.env` into this folder. Start from `.env.example` and enter only the US store credentials.

## Setup order

1. Run `npm install` in this folder.
2. Create the new Shopify app in the Dev Dashboard.
3. Run `npm run config:link` and select the new US app.
4. Create the US Railway service and database.
5. Confirm `SHOPIFY_APP_URL` and the Shopify configuration use `https://stampmymarkuploader-us-production.up.railway.app`.
6. Create a separate Bunny.net Storage Zone and add its credentials to Railway.
7. Run `npm run deploy -- --config us-store`.
8. In the Shopify Dev Dashboard, select custom distribution, enter `9zgiqv-ug.myshopify.com`, and generate the installation link.
9. Open the installation link while signed in as `niasheo974105@gmail.com` and approve it.
10. In the Printmivo theme editor, add the `Upload Picture` app block to the intended product template.

## Verification

- Confirm the embedded dashboard opens from the Printmivo Shopify admin.
- Upload a test JPG and PDF from a Printmivo product page.
- Confirm both records appear only in the US database/dashboard.
- Add one upload to cart and place a test order.
- Confirm the `orders/create` webhook changes the upload status to `ordered`.
- Confirm the stored files exist only in the US Bunny.net Storage Zone.
