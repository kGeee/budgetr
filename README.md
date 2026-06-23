This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Switching to real data (production)

The app ships pointed at Plaid **Sandbox** (fake institutions, `user_good` / `pass_good`).
Plaid access tokens are **environment-scoped** — a sandbox token is not valid in
production and vice versa — so moving to real accounts means re-linking, not just
flipping a flag.

1. **Get production access** in the [Plaid Dashboard](https://dashboard.plaid.com)
   and copy your **production** secret from
   [Developers → Keys](https://dashboard.plaid.com/developers/keys).
2. **Update `.env.local`:**
   ```bash
   PLAID_ENV=production
   PLAID_SECRET=<your production secret>   # the client ID stays the same
   ```
3. **Clear the stale sandbox links** (preserves your categories, budgets, tags,
   and rules — only Plaid-owned data is removed):
   ```bash
   npm run db:reset-items
   ```
4. **Restart the dev server** and click **Connect** to link your real Amex,
   brokerage, and bank accounts.

If you forget step 3, the app is defensive: each item records the Plaid
environment it was linked under, and **Sync will refuse a stale item with a clear
"re-link" message** instead of failing with an opaque Plaid error.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
