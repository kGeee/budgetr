/**
 * Education guides at /learn — slideshow-farm copy, frozen.
 * Teach lines are H2s only; do not invent paragraphs or $ totals.
 */

export type LearnGuide = {
  slug: string;
  /** H1 hook */
  hook: string;
  /** Brass/gold accent line */
  gold: string;
  /** Optional note under the gold line (rule-of-thumb labels) */
  goldNote?: string;
  /** H2 teach lines (slides 2–5); verbatim, no padding */
  teach: string[];
};

export const LEARN_CTA = {
  title: "DO THIS ON YOUR MAC.",
  body: "Your ledger is a SQLite file on this Mac. budgetr does not have a copy.",
  linkLabel: "budgetr.dev/overview",
  href: "/overview",
} as const;

export const LEARN_GUIDES: LearnGuide[] = [
  {
    slug: "net-worth-is-one-line",
    hook: "YOUR NET WORTH IS ONE LINE.",
    gold: "ASSETS − LIABILITIES.",
    teach: [
      "income is not net worth",
      "list assets",
      "list debts",
      "subtract",
    ],
  },
  {
    slug: "50-30-20",
    hook: "50/30/20 IS THREE NUMBERS.",
    gold: "50 / 30 / 20.",
    goldNote: "A rule of thumb, not a law.",
    teach: [
      "needs / wants / save after tax",
      "if needs blow 50 the budget is the life",
    ],
  },
  {
    slug: "list-every-auto-renew",
    hook: "LIST EVERY AUTO-RENEW.",
    gold: "1 LIST.",
    teach: [
      "open bank + App Store + Amazon",
      "write the monthly cadence",
      "cancel what you would not re-buy today",
    ],
  },
  {
    slug: "track-7-days",
    hook: "TRACK 7 DAYS BEFORE YOU BUDGET.",
    gold: "7 DAYS.",
    teach: [
      "write every spend for a week",
      "then make envelopes",
      "guessing dies on day 3",
    ],
  },
  {
    slug: "savings-rate",
    hook: "SAVINGS RATE BEATS INCOME.",
    gold: "SAVED ÷ TAKE-HOME.",
    teach: [
      "SAVED ÷ TAKE-HOME",
      "same paycheck, different rate",
      "FIRE's actual number",
    ],
  },
  {
    slug: "one-envelope-per-bill",
    hook: "ONE ENVELOPE PER BILL.",
    gold: "1 BILL = 1 ENVELOPE.",
    teach: [
      "rent, groceries, insurance each get a named pile",
      "leftover pile is how silent spend wins",
    ],
  },
  {
    slug: "emergency-fund",
    hook: "EMERGENCY FUND IN MONTHS.",
    gold: "3 MONTHS (or 6).",
    goldNote: "Rule of thumb.",
    teach: [
      "3 months (or 6), not a round TikTok dollar",
      "start at 1 month if 3 is a wall",
    ],
  },
  {
    slug: "sinking-funds",
    hook: "SINKING FUNDS STOP THE SURPRISE.",
    gold: "NAME THE FUTURE BILL.",
    teach: [
      "name the future bill (car, travel, annual insurance)",
      "if it's predictable it is not an emergency",
    ],
  },
  {
    slug: "re-buy-test",
    hook: "IF YOU WOULD NOT RE-BUY IT TODAY, CANCEL.",
    gold: "RE-BUY TEST.",
    teach: [
      "subscriptions fail this more than groceries",
      "one pass this week",
    ],
  },
  {
    slug: "who-has-a-copy",
    hook: "IF THE APP HAS A COPY, IT IS NOT ONLY YOURS.",
    gold: "WHO HAS A COPY?",
    teach: [
      "WHO HAS A COPY?",
      "cloud money apps keep a copy to sync",
      "a file on your Mac does not",
    ],
  },
];

export function getLearnGuide(slug: string): LearnGuide | undefined {
  return LEARN_GUIDES.find((g) => g.slug === slug);
}
