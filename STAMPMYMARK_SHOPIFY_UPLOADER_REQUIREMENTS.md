# StampMyMark Shopify Uploader App Requirements

## Project Goal

Build a production-ready custom Shopify app for StampMyMark.com that replaces the current Uploadify "Upload Picture" behavior on product pages with a custom uploader controlled by StampMyMark.

The complete required flow is:

```text
Product Page
-> Upload Picture
-> original file immediately saved to StampMyMark-controlled Bunny.net storage
-> upload metadata record created with unique upload_id
-> upload_id attached to the Shopify cart line
-> normal Shopify checkout
-> order creation webhook
-> upload automatically linked to the Shopify order
```

Uploads from customers who never add to cart or never checkout must still remain visible in the admin dashboard as unordered/abandoned uploads until the configured retention period expires.

## Platform And Architecture Requirements

- Build a Shopify app using Node.js and TypeScript.
- Use Shopify's current recommended app framework for a production Shopify app.
- Use Shopify Admin GraphQL API where Shopify Admin data access is required.
- Use a Shopify Theme App Extension/app block for storefront integration.
- Do not permanently modify Shopify theme code.
- The app block must be placeable on selected product templates.
- Use PostgreSQL for upload metadata and app data.
- Use Bunny.net Storage for original file storage.
- Upload files through the app backend so the Bunny.net Storage AccessKey remains server-side.
- Keep Bunny.net credentials, Shopify secrets, and other sensitive credentials server-side only.
- Include a clean project structure with separate modules for:
  - Upload logic
  - Bunny.net storage logic
  - Shopify/cart integration
  - Webhooks
  - Database access and migrations
  - Admin dashboard
  - Cleanup/retention jobs
- Include database migrations/schema.
- Include `.env.example`.
- Include Shopify scopes/configuration.
- Include installation instructions.
- Include deployment instructions.

## Storefront UI Requirements

- Replace the existing Uploadify "Upload Picture" functionality with the custom uploader.
- Keep the button visually almost identical to the existing full-width blue Upload Picture button shown in the reference screenshots.
- Preserve the current product page placement, width, spacing, and overall appearance.
- Do not redesign or modify the rest of the product page.
- The Upload Picture button itself must be server-rendered by the Theme App Extension Liquid app block and visible by default.
- JavaScript must progressively enhance the server-rendered button.
- JavaScript must not determine whether the Upload Picture button exists.
- If JavaScript fails to load, the button should still exist visually in the HTML, although upload functionality may require JavaScript.
- The uploader must be responsive on desktop and mobile.

## Storefront Upload Requirements

- Supported file types:
  - JPG
  - JPEG
  - PNG
  - WEBP
  - PDF
- Validate file type before upload.
- Validate file size before upload.
- Maximum file size must be configurable.
- Show upload progress.
- Display an image preview for image uploads where applicable.
- Show a suitable non-image/PDF state for PDF uploads.
- Provide a Replace option after an upload.
- Provide a Remove option after an upload.
- Do not allow Add to Cart until a required image/file has successfully uploaded.
- The original selected file must upload immediately after selection.
- The upload must happen even if the customer never adds the product to cart.
- The upload must happen even if the customer never completes checkout.
- Shopify must not receive the original large image file.
- Shopify should only receive the upload reference.

## Upload Identity And Metadata Requirements

- Generate a unique `upload_id` for every upload.
- Create a database record for every upload.
- Store the following upload metadata:
  - `upload_id`
  - Storage bucket/key and/or secure internal storage URL
  - Original filename
  - File type/content type
  - File size
  - Upload timestamp
  - Shopify product ID
  - Shopify variant ID
  - Selected size
  - Quantity, where available
  - Session/cart identifier
  - Status
- Supported upload statuses:
  - `uploaded`
  - `cart`
  - `ordered`
  - `abandoned`
  - `expired`
- When available, also store:
  - Shopify shop domain
  - Customer ID
  - Cart token
  - Shopify order ID
  - Shopify order number/name
  - Ordered timestamp
  - Expiration timestamp

## Cart And Checkout Requirements

- When Add to Cart is clicked, attach the `upload_id` to that specific Shopify cart line.
- Use Shopify line-item properties to attach the upload reference.
- Multiple products and multiple uploads must remain correctly associated.
- Each cart line must receive the correct unique upload reference.
- The cart/checkout flow must remain the normal Shopify checkout flow.
- Large files must not be added to Shopify cart properties.
- Only the upload reference should be sent to Shopify.

## Shopify Webhook Requirements

- Create Shopify webhooks, especially order creation.
- Verify Shopify webhook HMAC signatures.
- Handle webhook idempotency to avoid duplicate processing.
- On order creation:
  - Read each line item's upload property.
  - Find the matching upload by `upload_id`.
  - Link the upload to the Shopify order ID.
  - Link the upload to the Shopify order number/name.
  - Change the upload status to `ordered`.
- If a line item references an unknown upload ID, record/log it for investigation.
- If an upload exists but no order is created, it must remain visible as unordered/abandoned until expiration.

## Admin Dashboard Requirements

- Build an embedded Shopify Admin dashboard for staff.
- Protect admin routes with Shopify authentication.
- Staff must be able to view upload records by status:
  - All
  - Ordered
  - Unordered/Abandoned
  - Expired
- Dashboard rows/cards must show:
  - Thumbnail for image uploads
  - PDF/file indicator for PDF uploads
  - Original filename
  - Product
  - Variant
  - Selected size
  - Quantity, where available
  - Upload time
  - Upload status
  - Associated order, where available
- Staff must be able to securely view the original file.
- Staff must be able to securely download the original file.
- View/download links must be protected and short-lived.
- Customers must not be able to access other customers' uploads.

## Storage Requirements

- Store original uploaded files in StampMyMark-controlled Bunny.net Storage.
- Use backend-mediated uploads to Bunny.net Storage.
- Do not expose Bunny.net credentials to the browser.
- Use server-generated object keys.
- Object keys should not rely on the original filename alone.
- Store files under a predictable but non-guessable structure, such as:

```text
shops/{shop}/uploads/{upload_id}/{sanitized_filename}
```

- Validate upload completion server-side.
- Stream admin preview/download through authenticated app routes.
- Prevent public file access unless there is a deliberate, documented reason.

## Security Requirements

- Keep credentials and secrets server-side.
- Verify Shopify app proxy requests from the storefront.
- Verify Shopify webhooks.
- Protect admin routes with Shopify authentication.
- Validate file type and size on the server, not only in the browser.
- Prevent customers from accessing uploads owned by another session/customer/cart.
- Use non-guessable upload IDs.
- Avoid exposing raw internal storage paths where possible.
- Do not trust client-provided product, variant, size, quantity, or cart data without reasonable validation.
- Sanitize original filenames before using them in storage keys or UI.
- Use a dedicated Bunny.net Storage Zone password with the minimum practical access for this app.
- Record important security-relevant events where useful, including failed validation and unmatched webhook upload IDs.

## Cleanup And Retention Requirements

- Add automatic cleanup for abandoned uploads.
- Retention period must be configurable.
- Default retention period should be 30 days.
- Uploads that are not ordered after the retention period should become `expired`.
- Expired uploads may have their Bunny.net files deleted according to the configured cleanup policy.
- Metadata should remain available for audit unless the business explicitly chooses hard deletion.
- Cleanup should be safe, repeatable, and logged.

## Suggested Database Model

Primary `uploads` table:

```text
id
upload_id
shop
storage_bucket
storage_key
storage_url
original_filename
content_type
file_size
uploaded_at
product_id
variant_id
selected_size
quantity
session_id
cart_token
customer_id
status
order_id
order_name
ordered_at
expires_at
created_at
updated_at
```

Suggested supporting tables:

```text
shopify_sessions
webhook_deliveries
cleanup_runs
```

## Suggested API Endpoints

Storefront/app proxy endpoints:

```text
POST /apps/stamp-upload/uploads/init
POST /apps/stamp-upload/uploads/complete
POST /apps/stamp-upload/uploads/cart
POST /apps/stamp-upload/uploads/remove
GET  /apps/stamp-upload/uploads/:upload_id/status
```

Admin endpoints:

```text
GET /app/uploads
GET /app/uploads/:upload_id
POST /app/uploads/:upload_id/download-url
```

Webhook endpoints:

```text
POST /webhooks/orders/create
POST /webhooks/app/uninstalled
```

## Acceptance Criteria

- The product page displays a server-rendered full-width blue Upload Picture button from the Theme App Extension.
- Selecting a valid file immediately uploads the original file to Bunny.net Storage through the app backend.
- A unique `upload_id` is created for each upload.
- A PostgreSQL upload record is created even if the customer leaves before cart or checkout.
- Add to Cart is blocked until the required upload succeeds.
- Add to Cart attaches the correct `upload_id` to the specific Shopify cart line.
- Shopify checkout proceeds normally.
- Order creation webhook links uploads to orders and marks them `ordered`.
- Uploads without completed orders remain visible as unordered/abandoned.
- Staff can view, filter, preview, and download uploads from the embedded Admin dashboard.
- Abandoned uploads expire according to the configurable retention period.
- Credentials remain server-side.
- Webhooks, admin routes, storefront proxy requests, and file access are secured.
