/**
 * Education guides at /learn — slideshow-farm copy, frozen for web.
 * Short teach paragraphs only; do not invent $ totals or pad.
 */

export type LearnGuide = {
  slug: string;
  /** H1 — title case on web */
  hook: string;
  /** Brass/gold lead line */
  gold: string;
  /** Optional note under the gold line (rule-of-thumb labels) */
  goldNote?: string;
  /** Short teach paragraphs from the brief; no padding */
  teach: string[];
};

export const LEARN_CTA = {
  title: "Do this on your Mac.",
  body: "Your ledger is a SQLite file on this Mac. budgetr does not have a copy.",
  demoLabel: "Try the live demo",
  linkLabel: "budgetr.dev/overview",
  href: "/overview",
} as const;

/** Index footer CTA — points at the sample-data demo, not a DMG. */
export const LEARN_INDEX_CTA = {
  title: "Do this on your Mac.",
  body: "Live demo (sample data):",
  linkLabel: "budgetr.dev/overview",
  href: "/overview",
} as const;

export const LEARN_GUIDES: LearnGuide[] = [
  {
    slug: "net-worth-is-one-line",
    hook: "Your net worth is one line.",
    gold: "ASSETS − LIABILITIES.",
    teach: [
      "Income is not net worth.",
      "List assets.",
      "List debts.",
      "Subtract.",
    ],
  },
  {
    slug: "50-30-20",
    hook: "50/30/20 is three numbers.",
    gold: "50 / 30 / 20.",
    goldNote: "A rule of thumb, not a law.",
    teach: [
      "Needs / wants / save after tax.",
      "If needs blow 50, the budget is the life.",
    ],
  },
  {
    slug: "list-every-auto-renew",
    hook: "List every auto-renew.",
    gold: "1 LIST.",
    teach: [
      "Open bank + App Store + Amazon.",
      "Write the monthly cadence.",
      "Cancel what you would not re-buy today.",
    ],
  },
  {
    slug: "track-7-days",
    hook: "Track 7 days before you budget.",
    gold: "7 DAYS.",
    teach: [
      "Write every spend for a week.",
      "Then make envelopes.",
      "Guessing dies on day 3.",
    ],
  },
  {
    slug: "savings-rate",
    hook: "Savings rate beats income.",
    gold: "SAVED ÷ TAKE-HOME.",
    teach: [
      "SAVED ÷ TAKE-HOME.",
      "Same paycheck, different rate.",
      "FIRE's actual number.",
    ],
  },
  {
    slug: "one-envelope-per-bill",
    hook: "One envelope per bill.",
    gold: "1 BILL = 1 ENVELOPE.",
    teach: [
      "Rent, groceries, insurance each get a named pile.",
      "Leftover pile is how silent spend wins.",
    ],
  },
  {
    slug: "emergency-fund",
    hook: "Emergency fund in months.",
    gold: "3 MONTHS (or 6).",
    goldNote: "Rule of thumb.",
    teach: [
      "3 months (or 6), not a round TikTok dollar.",
      "Start at 1 month if 3 is a wall.",
    ],
  },
  {
    slug: "sinking-funds",
    hook: "Sinking funds stop the surprise.",
    gold: "NAME THE FUTURE BILL.",
    teach: [
      "Name the future bill (car, travel, annual insurance).",
      "If it's predictable, it is not an emergency.",
    ],
  },
  {
    slug: "re-buy-test",
    hook: "If you would not re-buy it today, cancel.",
    gold: "RE-BUY TEST.",
    teach: [
      "Subscriptions fail this more than groceries.",
      "One pass this week.",
    ],
  },
  {
    slug: "who-has-a-copy",
    hook: "If the app has a copy, it is not only yours.",
    gold: "WHO HAS A COPY?",
    teach: [
      "Who has a copy?",
      "Cloud money apps keep a copy to sync.",
      "A file on your Mac does not.",
    ],
  },
];

export function getLearnGuide(slug: string): LearnGuide | undefined {
  return LEARN_GUIDES.find((g) => g.slug === slug);
}
