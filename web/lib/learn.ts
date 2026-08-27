/**
 * Knowledge path at /learn — 11 articles in curriculum order.
 * Body copy is frozen; do not invent $ totals or pad.
 */

export type LearnArticle = {
  slug: string;
  /** H1 / index title */
  title: string;
  /** Body paragraphs, verbatim from the brief */
  paragraphs: string[];
};

export const LEARN_ARTICLES: LearnArticle[] = [
  {
    slug: "saving",
    title: "Saving is the gap",
    paragraphs: [
      "Saving is the money you did not spend. That is the whole definition. Income is not saving. A raise is not saving. A transfer to a brokerage is not saving until you actually sent less out than came in.",
      "Write two numbers for last month: what landed, and what left. The gap is saving. If the gap is negative, you spent reserves. Naming that without a spreadsheet fight is the point of this page.",
      "A budget is a plan for the gap. Tracking is how you find out whether the plan happened.",
    ],
  },
  {
    slug: "a-month-of-envelopes",
    title: "A month of envelopes",
    paragraphs: [
      "Example, labeled as an example. Not a real household.",
      "Rent is one envelope. Groceries are one envelope. The phone bill is one envelope. Each envelope has a name and a cap. When groceries is empty, groceries stops. You do not steal from rent to cover a dinner.",
      "The leftover pile is how silent spend wins. If it does not have a name, it will get spent.",
      "A personal pass for one month: list the bills you already know will fire. Name an envelope for each. Leave wants in their own envelope, not mixed into groceries. After 30 days you will know which names were real.",
    ],
  },
  {
    slug: "emergency-fund",
    title: "Emergency fund in months",
    paragraphs: [
      "Count months of expenses, not a round dollar you saw on a video. If your named envelopes add up to $4,000 a month, three months is $12,000. That $4,000 is an example, not a target.",
      "Three months is a common starting line. Six months is the next line if your income is lumpy. If three months is a wall, start at one. A one-month fund you actually hold beats a six-month number you do not.",
      "This pile is for surprises: a layoff, a medical bill, a broken car you cannot defer. It is not for flights you already knew about. Those are sinking funds.",
    ],
  },
  {
    slug: "sinking-funds",
    title: "Sinking funds",
    paragraphs: [
      "If you can name the bill and the month, it is not an emergency.",
      "Annual insurance, a new set of tires, a December flight: each gets its own envelope and a monthly fill. When the bill arrives, the envelope pays it. The emergency fund stays untouched.",
      "The test: would you be surprised if this invoice showed up? If no, it is a sinking fund. If yes, it is an emergency.",
    ],
  },
  {
    slug: "savings-rate",
    title: "Savings rate",
    paragraphs: [
      "Savings rate is money saved divided by take-home pay, for a month you already lived. Two people with the same paycheck can have different lives because the rate is different.",
      "Income is a vanity number if the rate is zero. A smaller paycheck with a 20% rate is doing the job a larger paycheck with 2% is not.",
      "This is the number people mean when they talk about getting off the treadmill. You do not need a FIRE page to compute it. You need last month's gap and last month's take-home.",
    ],
  },
  {
    slug: "investing-is-good",
    title: "Investing is good",
    paragraphs: [
      "This is education, not advice.",
      "Cash you will not spend for years is a weak place to store purchasing power. Prices of the things you will buy later tend to rise. A claim on productive assets is how most people try not to fall behind.",
      "Investing is good because it puts savings to work after the emergency fund exists. It is not good as a substitute for an emergency fund. Selling in a hurry to cover rent is how a long-term account becomes a short-term mistake.",
      "If you do not yet have a named emergency envelope, go back two pages. If you do, the next question is how, not whether.",
    ],
  },
  {
    slug: "how-to-invest",
    title: "How to invest",
    paragraphs: [
      "This is education, not advice.",
      "You need an account that can hold securities. A checking account cannot. A brokerage can. What you buy first is usually a broad fund, not a single company, because one company can go to zero and a market of companies has not.",
      "You will see words like allocation (what mix you hold), contribution (what you add), and cost basis (what you paid). Lots are the slices of a position you bought on different days. When you sell, the lot you choose changes the gain.",
      "Fees and inactivity both cost you. A fund with a small fee, held, beats a clever trade you do not follow.",
      "You do not need options to start. Options come after you can read a chart and a position.",
    ],
  },
  {
    slug: "charts",
    title: "Charts",
    paragraphs: [
      "A price chart is time on the x-axis and price on the y-axis. That is the whole object. Candles add the open, high, low, and close for each period. A moving average is a smoother line over the same prices.",
      "Charts do not tell you what to buy. They tell you what already happened. A watchlist is a short list of names you actually follow, not a wall of tickers.",
      'When a finance app shows a reconstructed portfolio curve, it is a chart of your holdings, not of a single ticker. Deposits should be excluded if you want return rather than "the line went up because I added cash."',
    ],
  },
  {
    slug: "analysis",
    title: "Analysis",
    paragraphs: [
      "Analysis is what you do after you have a position, not instead of saving.",
      "Concentration: one name is too much of the pile. Correlation: two names that move together are not a hedge. Beta vs a benchmark like SPY: how hard the position moves when the index moves.",
      "None of these replace the savings rate. They keep a portfolio from pretending it is diversified when it is five tickets to the same ride.",
      "If a desk also shows sector or valuation numbers, those come from a market-data vendor. They are not the ledger.",
    ],
  },
  {
    slug: "options",
    title: "Options",
    paragraphs: [
      "This is education, not advice.",
      "An option is a contract. A call is the right to buy. A put is the right to sell. It has a strike, an expiration, and a premium. After you buy or sell, you have a live leg.",
      "Useful views, once you have legs: a list of open legs, cash if assigned, what expires in the next week, a calendar of expirations, and a payoff sketch (max profit, max loss, breakeven). Those are the objects. A 3D IV surface, a volatility smile, and Section 1256 are not part of this curriculum.",
      "If you do not already trade options, skip this page and keep the emergency fund. This page exists so the words on a later desk are not a foreign language.",
    ],
  },
  {
    slug: "a-ledger-on-this-mac",
    title: "A ledger on this Mac",
    paragraphs: [
      "This is the only product page in the path.",
      "If the app has a copy of your ledger, it is not only yours. Cloud money apps keep a copy so they can sync. That is the trade.",
      "budgetr is a Mac personal-finance app. The ledger is a SQLite file on this Mac. budgetr does not have a copy.",
      'If you connect a bank, you bring your own Plaid keys. That is not "no third party."',
      "The path you just read is the job: named envelopes, a savings rate, then investing, then charts and analysis, then options if you actually trade them. Doing that job on this Mac means the file stays on this Mac.",
    ],
  },
];

/** Frozen closer — page 11 only. Links to the live demo overview, not a DMG. */
export const LEARN_PRODUCT_CLOSER = {
  title: "Do this on your Mac.",
  body: "Your ledger is a SQLite file on this Mac. budgetr does not have a copy.",
  demoLabel: "Try the live demo (sample data)",
  href: "/overview",
} as const;

export function getLearnArticle(slug: string): LearnArticle | undefined {
  return LEARN_ARTICLES.find((a) => a.slug === slug);
}

export function getLearnArticleIndex(slug: string): number {
  return LEARN_ARTICLES.findIndex((a) => a.slug === slug);
}

export function getNextLearnArticle(slug: string): LearnArticle | undefined {
  const i = getLearnArticleIndex(slug);
  if (i < 0 || i >= LEARN_ARTICLES.length - 1) return undefined;
  return LEARN_ARTICLES[i + 1];
}
