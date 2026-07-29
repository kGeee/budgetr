# Flagship — "I built a finance app that never sends your money anywhere"

| | |
| --- | --- |
| Platform | YouTube (primary), chaptered |
| Length | 12–15 min |
| Goal | Convert people who already distrust finance SaaS. |
| CTA | Live web demo first, `/pricing` second |
| Footage | Demo persona, video worktree |

**Don't quote a price on camera.** Pricing changes, promos happen, and a number
baked into a permanent video dates it. Say "one-time purchase, not a subscription" and
let the page carry the figure.

**Note on chapters:** each one is cut as a standalone short. Frame every demo inside a
centered 9:16 safe area.

---

## Cold open — 0:00–0:45

> [VISUAL: a competitor's login screen asking for bank credentials. Cursor hovers,
> doesn't click.]

Every budgeting app works the same way. You hand it your bank login. It logs into your
bank, on its servers, and keeps a copy of every transaction you've ever made. Then it
charges you fifteen dollars a month for the privilege.

> [VISUAL: cut to budgetr's Overview, fully populated.]

I wanted the opposite. So this is budgetr. It runs on your Mac, it stores everything in
a file you own, it is physically incapable of moving your money, and you buy it once
instead of renting it forever.

> [VISUAL: Finder, `~/Library/Application Support/budgetr/`, `budgetr.db` highlighted.]

That file is the whole app. Delete it and the data is gone — there's no copy anywhere,
because there's nowhere for a copy to be.

Let me show you what that actually buys you.

---

## Chapter 1 — "Local" is a claim, so let's check it — 0:45–2:30

> [VISUAL: Activity Monitor → Network tab, filtered to budgetr, while clicking around.]

Here's the app doing a full sync. Watch the network column. Calls go to Plaid — that's
your bank data coming in. Calls go to Yahoo and the SEC for prices and filings. Nothing
goes to a budgetr server, because there isn't one. I never registered a domain to
receive your transactions. There is no account to create. There is no password to reset,
because there's nothing to log into.

> [VISUAL: Settings → Connections, showing Plaid client ID and secret fields.]

The other half is these. Most apps use *their* Plaid account, which means your data
lands in their pipeline. budgetr makes you bring your own keys. It's an extra ten
minutes of setup and it's the entire point — the connection to your bank belongs to
you, and those keys are encrypted on disk before they're stored.

> [VISUAL: highlight "read-only" in the onboarding copy.]

And it's read-only. There's no transfer screen, no bill pay, no "move money" button
anywhere in this app. Not as a policy — as an absence. The code to move money was never
written.

---

## Chapter 2 — Getting data in — 2:30–4:00

> [VISUAL: Plaid Link modal, sandbox, `user_good` / `pass_good`.]

Connecting a bank is the normal Plaid flow you've seen a hundred times. Pick your
institution, log in, done.

> [VISUAL: Accounts page, institutions grouped, subtotals.]

But here's the part I want to flag, because it's the objection I hear most: **you don't
need a bank connection at all.**

> [VISUAL: Investments → Import, dragging in a `.qfx` file.]

If you'd rather not connect anything, export your broker's history — the file is usually
labelled "download for Quicken" — and drag it in. Schwab, Fidelity, Interactive Brokers,
E-Trade and Tastytrade are recognized automatically. If yours isn't, you get a column
mapper instead of a dead end.

> [VISUAL: the preview table, then the import completing.]

Re-importing an overlapping file is safe — trades are fingerprinted and de-duplicated.
So you can dump the same export in every month and it just works.

---

## Chapter 3 — The daily loop — 4:00–6:00

> [VISUAL: Transactions, "N to review" in brass.]

Day to day, this is where you live. Everything comes in categorized, and anything the
app wasn't confident about lands in a review queue.

> [VISUAL: open the transaction drawer.]

Open one and you get a suggestion based on your own history — "eighty-seven percent of
the last twelve from this merchant were Groceries." One tap.

> [VISUAL: change a category → the follow-up prompt appears.]

And then the thing I use constantly: change a category, and it offers to apply that to
every other transaction from the same merchant. One decision, retroactive.

> [VISUAL: add a tag → "Always tag Uber as #rideshare?"]

Same with tags. Tag something once, and it offers to write a rule. Say yes and it
backfills your entire history.

> [VISUAL: Rules page, showing a regex rule with an amount range.]

Those rules live here, and they'll take a regex, an amount range, and a specific account
if you want to get precise about it.

> [VISUAL: Vendors, merging "SQ *BLUE BOTTLE" / "BLUEBOTTLE.COM" / "Blue Bottle #12".]

And when your bank reports the same coffee shop under three different names — which it
will — the vendor merger suggests the matches and folds them into one merchant.

---

## Chapter 4 — The money you don't see leaving — 6:00–8:00

> [VISUAL: Recurring page.]

Nobody knows what they're subscribed to. budgetr works it out from your transaction
history — you never enter a bill.

> [VISUAL: Insights, the price-creep card.]

This is my favourite screen in the app. It watches for things that change quietly.
Netflix went up thirty-five percent — the latest charge is twenty-two ninety-nine against
a usual seventeen oh-seven. Nobody catches that manually. Ever.

> [VISUAL: scroll the other alert types.]

Same detector finds spending spikes against your own baseline — six-point-eight times
usual at one vendor — duplicate charges, and free trials about to convert.

> [VISUAL: Cashflow, the overdraft warning.]

And this one has saved me actual money. Most apps tell you whether the month ends
positive. This tells you your cash is projected to dip below zero mid-month — read the
actual figure and date off the screen — because rent clears before payday, even though
the month ends fine.

---

## Chapter 5 — Splitting with people — 8:00–9:15

> [VISUAL: transaction drawer → Split this bill.]

You paid for dinner. Split it — evenly, by amount, or by percent.

> [VISUAL: the budget updating.]

Your share is what counts against your budget. The part you fronted doesn't, because it
was never your spending.

> [VISUAL: Shared page → repayment inbox.]

Then your friend Venmos you back, and budgetr spots the inflow and connects it: "forty-two
fifty from Sam, matched to Tuesday's dinner." Confirm, and the balance zeroes out.

That's a loop most apps make you track in a spreadsheet.

---

## Chapter 6 — The part nobody expects — 9:15–11:30

> [VISUAL: Investments, holdings table.]

Now the part that makes people ask what this app actually is.

> [VISUAL: portfolio value chart, "reconstructed from your trades" label.]

Positions, cost basis, dividends, and a value curve rebuilt day by day from your trade
ledger rather than a number your broker cached.

> [VISUAL: benchmark table.]

Return against SPY and QQQ, time-weighted — deposits backed out, so adding cash doesn't
flatter your numbers.

> [VISUAL: options desk — smile, term structure, dealer gamma, then the 3D IV surface.]

And then there's a full options desk. Implied volatility smile, term structure, open
interest, dealer gamma, and a three-dimensional volatility surface — priced off the free
CBOE chain, so no extra data subscription.

> [VISUAL: wheel scanner, expand a row to the trade card.]

There's a scanner for cash-secured puts across about fifty-five liquid names plus
whatever you hold, and expanding a result gives you a ready-to-place card — entry limit,
stop, collateral, breakeven, and a warning when earnings land before expiry.

> [VISUAL: Realized gains, the method selector.]

And at tax time: realized gains with FIFO, LIFO or specific-identification, wash sales,
and manual lot pairing.

I have never seen this in a budgeting app. It's usually a separate two-hundred-dollar
subscription.

---

## Chapter 7 — The long game — 11:30–12:30

> [VISUAL: FIRE dashboard.]

Savings rate, runway, Coast-FIRE, and a projection against your FIRE number — all
computed from your real ledger, not numbers you typed into a calculator.

> [VISUAL: assumptions panel, values marked "est."]

Anything you leave blank gets derived from your actual data and labelled as an estimate.

---

## Chapter 8 — On your phone — 12:30–13:30

> [VISUAL: Settings → Phone companion → QR code → scanning it.]

Your Mac stays the source of truth. It publishes an end-to-end encrypted snapshot that
your phone reads.

> [VISUAL: the phone's Spending screen.]

The relay in the middle is deliberately content-blind — it moves sealed envelopes and
holds no keys. It couldn't read your finances if it wanted to.

> [VISUAL: Home Screen and Lock Screen widgets.]

And you get widgets. Month-to-date spending, budget pace, top categories, and a Lock
Screen ring for what's left — all of which redact themselves when the phone is locked.

---

## Close — 13:30–14:15

> [VISUAL: back to Overview.]

So: your data on your machine, your own bank keys, read-only, no account, no server, no
subscription.

> [VISUAL: the live web demo in a browser.]

If you want to poke at it before you commit, there's a live demo in the browser — real
interface, fake data, nothing to install.

> [VISUAL: pricing page.]

And if you want it: there's a free trial, then a one-time purchase. Not a subscription,
and updates are included. The price is on the page.

Link's below. Thanks for watching.

---

### Chapter markers

```
0:00  The problem with every budgeting app
0:45  Proving "local" actually means local
2:30  Getting your data in (without a bank, if you want)
4:00  The daily loop: review, rules, vendors
6:00  Subscriptions, price creep, and cash you didn't see leaving
8:00  Splitting bills and getting paid back
9:15  Investments, options, and tax lots
11:30 FIRE projections
12:30 The phone companion
13:30 Pricing
```
