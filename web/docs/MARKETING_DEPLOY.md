# Marketing site deployment + Whop

The public marketing site (landing, `/pricing`, `/getting-started`, `/thanks`)
is the **same Next.js app** built in "marketing-only" mode. Purchases run through
a **hosted Whop checkout** — the app itself has no license server and never
phones home (data stays on the user's Mac). Whop takes payment and redirects the
buyer to the macOS DMG download after purchase.

So there are two setup tracks, both mostly configuration:

1. **Whop** — create the product, get the checkout link, set the post-purchase
   redirect to the latest GitHub Release DMG.
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
checkout URL set the pricing page surfaces a "Buy a license" link; with none it
falls back to the free GitHub download, so the page is never a dead end.

### Live demo (`DEMO_DB=1`)

Adding **`DEMO_DB=1`** turns on a live, read-only demo of the real dashboard so
visitors can try budgetr before downloading:

- The landing/`#screens` CTAs surface a **"Try the live demo"** button → `/overview`.
- `app/(app)/layout.tsx` relaxes its `notFound()` so the dashboard routes render
  (they still 404 on a marketing deploy *without* `DEMO_DB`).
- `db/index.ts` opens an **in-memory** SQLite DB (never disk), applies
  `db/demo-schema.ts`, and `lib/demo-data.ts` seeds the "Jordan Lee" dataset on
  the first request of each serverless cold start — so it works on Vercel's
  read-only filesystem and stays date-fresh.
- The dashboard is read-only: Sync, Connect, and Settings are hidden, and the
  demo banner's CTA becomes **"Download budgetr."** (Deep in-page edits still
  operate on the visitor's isolated in-memory copy and reset on the next cold
  start.)

> After any schema change (new migration), regenerate the demo schema:
> `bash scripts/gen-demo-schema.sh` (rewrites `db/demo-schema.ts`).

---

## Environment variables

| Variable | Required | Purpose | Example |
| --- | --- | --- | --- |
| `MARKETING_ONLY` | ✅ | Enables marketing mode (build + runtime). | `1` |
| `DEMO_DB` | optional | Serves a **live, read-only demo dashboard** on the marketing site (the "Try the live demo" CTA → `/overview`). Backed by an **in-memory** SQLite DB seeded per cold start (no persistent filesystem needed — safe on Vercel serverless), re-seeded with current dates each time. Unset ⇒ dashboard routes 404 as before. | `1` |
| `NEXT_PUBLIC_CHECKOUT_URL` | ✅ (to sell) | Whop hosted checkout link — the "Buy" CTA. Unset ⇒ free-download fallback. | `https://whop.com/checkout/ch_xxxxxxxx/` |
| `NEXT_PUBLIC_SITE_URL` | ✅ | Canonical origin for OpenGraph / `metadataBase`. | `https://budgetr.app` |
| `NEXT_PUBLIC_PRICE` | optional | Display price (default `$29`). | `$29` |
| `NEXT_PUBLIC_DOWNLOAD_URL` | optional | Free-download target (default: latest GitHub Release). | `https://github.com/kGeee/budgetr/releases/latest` |

`NEXT_PUBLIC_*` values are **inlined at build time** — after changing any of
them you must redeploy (a rebuild), not just restart.

---

## Part A — Whop

budgetr's Whop listing (production):

| Resource | ID |
| --- | --- |
| Company | `biz_MtlMZvFT8t41Sk` |
| Product | `prod_KsEESYFxS0cQW` |
| Plan | `plan_DZoy04FGD4McW` |
| Checkout link | `https://whop.com/checkout/ch_3Yc4SnEzTyrKeua/` |

1. The **checkout link** above is `NEXT_PUBLIC_CHECKOUT_URL` (also baked into
   `lib/site.ts` for DMG builds).
2. Set the checkout's **post-purchase redirect** to the latest GitHub Release
   DMG (`https://github.com/kGeee/budgetr/releases/latest/download/budgetr-mac.dmg`)
   so buyers land on the download immediately after paying.
3. Optionally keep `/thanks` as a secondary landing page — it mirrors the DMG
   download + setup steps for anyone who bookmarks it.
4. **License delivery (required)** — in Whop **Developer → Webhooks**:
   - **URL:** `https://budgetr.dev/api/license/webhook`
   - **Event:** `payment.succeeded`
   - Copy the signing secret (`ws_…`) into Vercel as **`WHOP_WEBHOOK_SECRET`**
     on the marketing/checkout project (alongside **`LICENSE_SIGNING_KEY`** and
     **`RESEND_API_KEY`**). Do not strip the `ws_` prefix or base64-encode it.

The DMG for the free trial is always served from public GitHub Releases; Whop
handles paid checkout only.

When Whop posts `payment.succeeded`, `/api/license/webhook`
(`app/api/license/webhook/route.ts`) verifies the Standard Webhooks signature,
ignores non-budgetr product/plan ids when present, mints a perpetual Ed25519
license keyed to the Whop payment id (`pay_…` → same key on retry), and emails
it via Resend. The Mac app verifies that key offline — no Whop-native license
keys.

It needs these env vars, **on the checkout deployment only**:

| Var | Purpose |
| --- | --- |
| `WHOP_WEBHOOK_SECRET` | verifies Whop webhook signatures (`ws_…`) |
| `LICENSE_SIGNING_KEY` | the PEM private key that signs licenses |
| `RESEND_API_KEY` | delivers the key to the buyer |

With **`WHOP_WEBHOOK_SECRET`** unset the Whop branch of the route no-ops with
**503** (same pattern as Polar). **`POLAR_WEBHOOK_SECRET`** is still accepted
for legacy Polar orders but is not required once checkout is on Whop.

Never set these on a self-hosted install — anyone holding `LICENSE_SIGNING_KEY`
can mint their own licenses. With them unset the route no-ops with a 503, so it's
inert on user installs. The matching public key is compiled into the app
(`lib/license/public-key.ts`) and verification is fully offline: no phone-home,
14-day trial first, and `BUDGETR_LICENSE_DISABLED=1` opts self-hosters out.

---

## Part B — Vercel (git-connected — recommended)

Deploy straight from the GitHub repo so pushes to `main` auto-deploy; no local
CLI needed.

1. <https://vercel.com/new> → **Import** `kGeee/budgetr`.
2. **Root Directory → `web`** (that's where `package.json` / `next.config.ts`
   live). Framework auto-detects as **Next.js**.
3. **Environment Variables** (add to Production on the **marketing/checkout**
   Vercel project — server-only secrets must never ship on user installs):
   | Name | Value |
   | --- | --- |
   | `MARKETING_ONLY` | `1` |
   | `NEXT_PUBLIC_SITE_URL` | `https://budgetr.dev` |
   | `NEXT_PUBLIC_PRICE` | `$29` (optional) |
   | `NEXT_PUBLIC_CHECKOUT_URL` | `https://whop.com/checkout/ch_3Yc4SnEzTyrKeua/` |
   | `WHOP_WEBHOOK_SECRET` | `ws_…` from Whop Developer → Webhooks |
   | `LICENSE_SIGNING_KEY` | PEM of `scripts/license/signing-key.private.pem` |
   | `RESEND_API_KEY` | Resend API key |
   | `LICENSE_FROM_EMAIL` | `budgetr <license@budgetr.dev>` (optional) |
   | `POLAR_WEBHOOK_SECRET` | optional — legacy Polar orders only |
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
