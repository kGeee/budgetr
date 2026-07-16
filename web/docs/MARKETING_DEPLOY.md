# Marketing site deployment + Lemon Squeezy

The public marketing site (landing, `/pricing`, `/getting-started`, `/thanks`)
is the **same Next.js app** built in "marketing-only" mode. Purchases run through
a **hosted Lemon Squeezy checkout** — the app itself has no license server and
never phones home (data stays on the user's Mac). Lemon Squeezy takes payment,
emails the license key + receipt, and redirects the buyer to `/thanks`.

So there are two setup tracks, both mostly configuration:

1. **Lemon Squeezy** — create the product, get the checkout URL, point its
   redirect at `/thanks`.
2. **Vercel** — deploy this repo in marketing mode with the right env vars.

---

## How marketing mode works

Setting **`MARKETING_ONLY=1`** flips the same build into the public site:

- `app/page.tsx` — `/` serves the marketing landing (instead of redirecting to
  `/overview`).
- `app/(app)/layout.tsx` and `app/(onboarding)/layout.tsx` — the private
  dashboard + onboarding routes `notFound()` (they touch the local SQLite DB,
  which doesn't exist on a serverless host).

> ⚠️ **`MARKETING_ONLY` must be set at RUNTIME, not just at build time.** If it's
> unset when a function runs, `/` redirects to `/overview`, which tries to open
> the local DB and 500s. On Vercel, add it as a normal **Environment Variable**
> (applies to build *and* runtime) — not only in `build.env`.

The purchase/download CTA is driven entirely by env (`lib/site.ts`): with a
checkout URL set the button is "Buy · $29"; with none it falls back to the free
GitHub download, so the page is never a dead end.

---

## Environment variables

| Variable | Required | Purpose | Example |
| --- | --- | --- | --- |
| `MARKETING_ONLY` | ✅ | Enables marketing mode (build + runtime). | `1` |
| `NEXT_PUBLIC_CHECKOUT_URL` | ✅ (to sell) | Lemon Squeezy hosted checkout URL — the "Buy" CTA. Unset ⇒ free-download fallback. | `https://budgetr.lemonsqueezy.com/buy/xxxxxxxx-xxxx-...` |
| `NEXT_PUBLIC_SITE_URL` | ✅ | Canonical origin for OpenGraph / `metadataBase`. | `https://budgetr.app` |
| `NEXT_PUBLIC_PRICE` | optional | Display price (default `$29`). | `$29` |
| `NEXT_PUBLIC_DOWNLOAD_URL` | optional | Free-download target (default: latest GitHub Release). | `https://github.com/kGeee/budgetr/releases/latest` |

`NEXT_PUBLIC_*` values are **inlined at build time** — after changing any of
them you must redeploy (a rebuild), not just restart.

---

## Part A — Lemon Squeezy

1. Create a **store** at <https://app.lemonsqueezy.com> (Settings → Stores).
2. **Products → New product** → *Single payment* (one-time). Set the price
   (match `NEXT_PUBLIC_PRICE`), name ("budgetr — lifetime license"), and a
   description.
3. Enable **License keys** on the product (Product → License keys) so each order
   issues a key and emails it to the buyer. (Honor-system — the app doesn't
   validate the key; it's the buyer's proof of purchase.)
4. **Share → Checkout** to get the hosted checkout URL → this is
   `NEXT_PUBLIC_CHECKOUT_URL`.
5. Set the **redirect / "Thank you" URL** to `https://<your-domain>/thanks` so
   buyers land on our page (which mirrors the DMG download + setup steps).
6. Add the DMG download + "your key is emailed" note to the Lemon Squeezy order
   confirmation email as well (the app is delivered by public GitHub Release, so
   no digital-file upload is needed — just link the DMG).
7. Go **live**: switch the store out of test mode and generate a live checkout
   URL (test-mode URLs only accept test cards).

_No webhook is required for the honor-system model._ If you later want to record
orders or gate downloads, add a `/api/webhooks/lemonsqueezy` route that verifies
the `X-Signature` HMAC against a `LEMONSQUEEZY_WEBHOOK_SECRET` — ask and we'll
wire it.

---

## Part B — Vercel (git-connected — recommended)

Deploy straight from the GitHub repo so pushes to `main` auto-deploy; no local
CLI needed.

1. <https://vercel.com/new> → **Import** `kGeee/budgetr`.
2. **Root Directory → `web`** (that's where `package.json` / `next.config.ts`
   live). Framework auto-detects as **Next.js**.
3. **Environment Variables** (add to Production + Preview):
   | Name | Value |
   | --- | --- |
   | `MARKETING_ONLY` | `1` |
   | `NEXT_PUBLIC_SITE_URL` | `https://budgetr.dev` |
   | `NEXT_PUBLIC_PRICE` | `$29` (optional) |
   | `NEXT_PUBLIC_CHECKOUT_URL` | _(add once Lemon Squeezy is live)_ |
4. **Deploy.**
5. **Domain** → Project → Settings → **Domains** → add `budgetr.dev` (and
   `www.budgetr.dev` → redirect to apex). Vercel shows the DNS records to set at
   your registrar:
   - Apex `budgetr.dev` → `A 76.76.21.21` (or the ALIAS/ANAME Vercel gives), and
   - `www` → `CNAME cname.vercel-dns.com`.
   DNS + SSL propagate in a few minutes. Because `budgetr.dev` is no longer in
   `/etc/hosts` (see teardown below), it now resolves to Vercel everywhere.

### CLI alternative

Prereqs: `npm i -g vercel && vercel login`, then from the repo root
`vercel link` (Root Directory → `web`), `vercel env add …` for the vars above,
and `vercel --prod`.

## Local teardown — freeing `budgetr.dev` for public use

`budgetr.dev` used to be a local-only hostname (an `/etc/hosts` → `127.0.0.1`
entry served by Caddy). Now that it's the public marketing domain, remove the
local mapping so it resolves to Vercel; the local dashboard moves to
`budgetr.localhost` (or just `http://localhost:3000`).

```bash
# 1. Remove budgetr.dev from /etc/hosts (keeps budgetr.localhost):
sudo sed -i '' '/budgetr\.dev/d' /etc/hosts

# 2. desktop/Caddyfile now serves budgetr.localhost (already updated in-repo).
#    Caddy for local https is optional — localhost:3000 works without it.
```

---

## Gotchas

- **Private app routes on the marketing domain 500 instead of 404.** They're
  unlinked, but `db/index.ts` opens SQLite at import, so a direct hit (or
  crawler) to `/overview` errors. To make them 404 cleanly, add a middleware
  that short-circuits private paths when `MARKETING_ONLY` is set (before the
  route module — and its DB import — loads). Not blocking for launch; ask and
  we'll add it.
- **`NEXT_PUBLIC_*` changes need a redeploy** — they're compiled into the client
  bundle, not read at runtime.
