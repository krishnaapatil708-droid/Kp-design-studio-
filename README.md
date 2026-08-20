# KP Design Studio — Backend v1

This is the first real backend layer for the store.

## What it provides
- Admin session login
- Product database stored in `data/products.json`
- Preview image upload
- Digital ZIP/TIFF upload
- Add and delete products through API
- Digital files are NOT publicly exposed
- Protected admin download endpoint

## Run locally
1. Install Node.js 20+.
2. In this folder run:
   `npm install`
3. Set a strong admin password:
   Linux/macOS:
   `ADMIN_PASSWORD="your-strong-password" npm start`
   Windows PowerShell:
   `$env:ADMIN_PASSWORD="your-strong-password"; npm start`
4. Open `http://localhost:3000`

## Important before production
- Use a real database (PostgreSQL/Supabase, etc.) instead of JSON.
- Store files in private object storage, not local disk.
- Use HTTPS.
- Add CSRF/rate limiting and proper password hashing.
- Connect Razorpay server-side order creation + signature verification.
- Only release a download after verified payment.

This v1 is the backend foundation, not the final production payment system.