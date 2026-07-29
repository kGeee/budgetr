# Setup — "From download to your first dashboard"

| | |
| --- | --- |
| Platform | YouTube; embedded in-app and on `/thanks` |
| Length | 6–8 min |
| Goal | Retention, not acquisition. Get a buyer to a populated dashboard. |
| CTA | None. They already bought. Just get them working. |
| Footage | A genuinely fresh install — wipe and re-record, don't fake it |

**Source of truth:** this must not drift from the written flow in
`web/app/(marketing)/getting-started/page.tsx` and the in-app wizard copy in
`web/components/onboarding-wizard.tsx`. If you change one, change all three.

**Tone shift.** No hooks, no persuasion. Calm, literal, slightly slower than feels
natural. Someone is following along with their own machine paused.

**Record fresh.** The first-run experience auto-seeds demo data exactly once per
install (`ensureFirstRunDemo()`), so it can't be re-shot on a used database. Start from
a clean data directory.

---

## 0:00–0:30 — What we're doing

> [VISUAL: the finished Overview.]

By the end of this you'll have this: your accounts, your spending, your net worth, on
your own machine. It takes about ten minutes, and most of that is Plaid's signup form.

Three things happen: install the app, get your own bank-connection keys, connect a bank.
That's it.

---

## 0:30–1:30 — Install

> [VISUAL: GitHub releases page → download `budgetr-mac.dmg`.]

Download the DMG from the releases page, open it, drag budgetr into Applications.

> [VISUAL: double-click. It opens.]

It's signed with an Apple Developer ID and notarized, so it just opens — no Gatekeeper
warning, nothing to right-click around.

> [VISUAL: the app opens onto a fully populated dashboard.]

Now — this will surprise you. It opens with data already in it. That's **demo data**,
seeded so you land on something explorable instead of an empty shell. It's a made-up
person. Have a click around; we'll clear it in a minute.

> [VISUAL: point at the demo banner.]

That's what this banner is telling you.

---

## 1:30–3:30 — Get your Plaid keys

> [VISUAL: the banner's "Set up my accounts" → the wizard opens.]

Click "Set up my accounts" and the setup walks you through it.

> [VISUAL: the wizard's Welcome step.]

First, why this step exists at all. budgetr doesn't have a Plaid account that everyone
shares — you use your own. That's what keeps your bank connection yours instead of
routing through somebody's pipeline. It costs nothing and it's the reason this app can
promise what it promises.

> [VISUAL: browser → `dashboard.plaid.com/signup`.]

So: sign up at Plaid. It's free. It asks what you're building — you're building a
personal finance tool for yourself.

> [VISUAL: Plaid dashboard → Developers → Keys.]

Once you're in, go to Developers, then Keys. You want two values: your **client ID**,
and a **secret**.

> [VISUAL: point at the Sandbox and Production rows.]

And you'll see more than one secret. Sandbox is free and fake — a pretend bank with
pretend transactions, good for seeing how the app behaves. Production is your real bank.

My advice: start with Sandbox for five minutes, then switch. I'll show you both.

---

## 3:30–4:30 — Enter the keys

> [VISUAL: back in the app, the wizard's key form. Paste client ID and secret, pick
> Sandbox.]

Paste the client ID, paste the secret, choose the environment.

> [VISUAL: click save; the verifying state, then success.]

It checks the keys against Plaid before saving them, so if you've pasted the wrong
secret you find out now rather than three screens later.

> [VISUAL: the confirmation line.]

Those keys are encrypted on disk. And note what didn't happen — nothing was sent to me.
There's nowhere for it to go.

---

## 4:30–5:45 — Connect a bank

> [VISUAL: "Connect" step → Plaid Link opens.]

Now connect. This is Plaid's own flow.

> [VISUAL: choose any institution → the sandbox login.]

Because we're in Sandbox, the login is `user_good`, password `pass_good`. That's a fake
bank with a fake history.

> [VISUAL: Link completes → back in the wizard → "Sync & open dashboard".]

Then sync, and you're on your dashboard.

> [VISUAL: Overview populating with real (sandbox) data.]

That's the whole loop. When you connect your actual bank, this is exactly what it looks
like — the only difference is the numbers are yours.

---

## 5:45–6:30 — Going to production, and the no-bank path

> [VISUAL: Settings → Connections, switching to Production.]

To use your real bank: swap in your production secret and set the environment to
Production.

> [VISUAL: the re-link.]

One thing that trips people up — you re-link your bank after switching. Plaid tokens are
tied to the environment they were made in, so a sandbox connection can't carry over.
It's a one-time re-connect, not a setting you flip.

> [VISUAL: Investments → Import.]

And if you'd rather not connect a bank at all: export your broker's history — the file
labelled "for Quicken", or a CSV — and drag it in. Schwab, Fidelity, IBKR, E-Trade and
Tastytrade are recognized automatically. You get your whole portfolio with no bank
connection anywhere.

---

## 6:30–7:15 — Where your stuff lives

> [VISUAL: Settings → Show Data Folder.]

Two files matter, and the app will show you both.

**`budgetr.db`** is your data. All of it. Back it up like any other file — copy it to a
drive, put it in a synced folder, whatever you already do. Restoring is putting it back.

**`budgetr.env`** is your keys.

> [VISUAL: highlight `APP_ENCRYPTION_KEY`.]

One warning worth ten seconds: don't change `APP_ENCRYPTION_KEY` after you've linked
accounts. It's what encrypts your bank tokens, and changing it makes existing links
unreadable. You'd have to re-link everything.

---

## 7:15–7:45 — Close

> [VISUAL: Overview.]

That's it. Your accounts sync, your spending categorizes itself, and nothing leaves
your machine.

If you want to know what the rest of the app does, there's a full walkthrough linked
below. And if you get stuck, reply to your receipt email — that reaches me directly.

---

## Chapter markers

```
0:00  What you'll have at the end
0:30  Installing the app
1:30  Why you need your own Plaid keys, and getting them
3:30  Entering your keys
4:30  Connecting a bank (sandbox first)
5:45  Switching to your real bank · the no-bank path
6:30  Where your data and keys live
7:15  Wrap
```
