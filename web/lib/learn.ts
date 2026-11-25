/**
 * Knowledge path at /learn — 11 articles in curriculum order.
 * Body copy is frozen (v2); do not invent $ totals or pad.
 */

export type LearnArticle = {
  slug: string;
  /** H1 / index title */
  title: string;
  /** Body paragraphs, verbatim from the brief (blank-line splits) */
  paragraphs: string[];
};

export const LEARN_ARTICLES: LearnArticle[] = [
  {
    slug: "saving",
    title: "Saving is the gap",
    paragraphs: [
      "Saving is the money you did not spend. That is the whole definition, and most people skip it. Income is not saving. A raise is not saving. Moving money from checking to a brokerage is not saving until you actually sent less out than came in this month.",
      'Write two numbers for the last calendar month you already lived. What landed (paychecks, transfers in, anything that increased cash). What left (rent, cards, the auto-renews, the cash you forgot). Subtract. The gap is saving. If the gap is negative, you spent reserves. You did not "have a bad month." You ran a deficit. Naming that without a fight is the whole point of this page.',
      "A budget is a plan for the gap. Tracking is how you find out whether the plan happened. If you only budget, you are arguing with a forecast. If you only track, you are reading a postmortem. You need both, in that order: see last month, then name this month.",
      "Example, labeled as an example, not anyone's real household. Take-home is $6,200. Everything that left is $5,400. The gap is $800. That $800 is saving, even if $300 of it sat in checking and $500 went to a brokerage. The brokerage transfer is not extra virtue. It is where part of the gap was stored. If take-home is $6,200 and $6,450 left, you did not save. You borrowed from last month, a card, or an emergency pile.",
      "Do this week: export or write last month's inflows and outflows. Two totals, one subtraction. Do not start with a category tree. Do not start with a FIRE number. The gap comes first.",
      "On a Mac, this job is easier when inflows, outflows, and the gap live in one ledger you can reopen tomorrow. Named envelopes come next. They are how you stop the gap from being an accident.",
    ],
  },
  {
    slug: "a-month-of-envelopes",
    title: "A month of envelopes",
    paragraphs: [
      "An envelope is a named pile with a cap. Rent is one envelope. Groceries are one envelope. The phone bill is one envelope. When groceries is empty, groceries stops. You do not steal from rent to cover a dinner, because rent has a name and a job.",
      'The leftover pile is how silent spend wins. "Miscellaneous" and "flex" and "the rest" are the same envelope with worse manners. If it does not have a name, it will get spent, and you will call it a surprise.',
      "Example, labeled as an example. A one-bedroom month: Rent $2,100. Groceries $550. Transit $120. Phone $70. Utilities $140. Insurance $90. Wants $300. That is not a recommended budget. It is a list of names. Notice wants is its own envelope, not mixed into groceries. Notice there is no envelope called leftover. If a dinner out happens, it comes from wants. If wants is empty, the dinner does not happen, or next month's wants gets honest.",
      "A personal pass for 30 days: list the bills you already know will fire. Name an envelope for each. Put a cap on each name from last month's actuals, not from a round number you wish. After 30 days you will know which names were real (they emptied on purpose) and which names were theater (they never moved).",
      "Tag envelopes beat leftover piles for the messy stuff. Subscriptions can be a tag across vendors. Vacation can be a tag you fund monthly. Work lunches can be a tag so they stop hiding in groceries. The rule is the same: a name, a cap, a remaining number.",
      "This is the first place a local Mac ledger earns its keep. Envelopes with pace (how fast you are spending versus how fast the month is moving) are the difference between a list of categories and a plan you can follow on a Tuesday.",
    ],
  },
  {
    slug: "emergency-fund",
    title: "Emergency fund in months",
    paragraphs: [
      "Count months of expenses, not a round dollar you saw on a video. Add the envelopes you cannot skip (rent, food, insurance, transit, minimums). That sum is one month. Three months is that sum times three. Six months is that sum times six.",
      "Example, labeled as an example. Skip-these envelopes add up to $4,000 a month. One month is $4,000. Three months is $12,000. Six months is $24,000. Those dollars are arithmetic, not a target you should screenshot. Your month might be $2,200 or $7,800. The unit is months, so the number stays honest when rent changes.",
      "Three months is a common starting line if pay is regular. Six months is the next line if income is lumpy, contract, or one-household. If three months is a wall, start at one. A one-month fund you actually hold beats a six-month number you recite.",
      "This pile is for surprises you cannot defer: a layoff, a medical bill, a car that has to move this week. It is not for a December flight you already named in June. That is a sinking fund. Mixing them is how an emergency fund becomes a vacation account with anxiety.",
      "Where it lives matters later. For now, the job is to name it as its own envelope, fill it on purpose, and stop touching it for wants. On a Mac ledger, that is just another named envelope with a cap you do not raid.",
    ],
  },
  {
    slug: "sinking-funds",
    title: "Sinking funds",
    paragraphs: [
      "If you can name the bill and the month, it is not an emergency. It is a sinking fund: an envelope you fill every month so the invoice is boring when it arrives.",
      "Annual insurance, a new set of tires, a December flight, a two-year passport, a deductible you will eventually hit: each gets a name and a monthly fill. When the bill arrives, the envelope pays it. The emergency fund stays untouched. The credit card does not become the plan.",
      'Example, labeled as an example. Car insurance is $1,200 once a year, due in March. That is $100 a month into a sinking fund named Car insurance. In February the envelope holds about $1,100 if you started in April. In March it pays the bill and goes back toward zero. You were not "hit with $1,200." You were paying $100 the whole time. A December flight at $600 is $50 a month if you start in January. The math is unromantic on purpose.',
      "The test: would you be surprised if this invoice showed up? If no, it is a sinking fund. If yes, it is an emergency. A birthday you have every year is not an emergency. A cracked windshield might be, unless you already named a deductible envelope.",
      "Do this week: list four bills you can already date. Name four envelopes. Divide each bill by the months left. That monthly fill is the cap. If the fill does not fit this month's gap, the trip is too soon, not the method.",
      "A ledger that already has named envelopes makes this a copy of a pattern, not a new personality. Same object as rent. Different date.",
    ],
  },
  {
    slug: "savings-rate",
    title: "Savings rate",
    paragraphs: [
      'Savings rate is money saved divided by take-home pay, for a month you already lived. Not gross. Not "including 401(k) I might have." Take-home in, gap out, divide.',
      "Two people with the same paycheck can have different lives because the rate is different. Income is a vanity number if the rate is zero. A smaller paycheck with a 20% rate is doing the job a larger paycheck with 2% is not. The 20% and 2% here are examples of rates, not goals we are assigning to you.",
      "Example, labeled as an example. Take-home $6,200. Gap $800. Rate is 800 / 6200, about 13%. If the same person funds a $200 sinking fund inside that $800, the rate does not change. The destination of the gap changed. If they add a $400 car payment they did not have last month, the gap shrinks and the rate falls. That is the mechanism. The rate is how you notice.",
      'This is the number people mean when they talk about getting off the treadmill. You do not need a FIRE page to compute it. You need last month\'s gap and last month\'s take-home. Coast-FIRE and "the number" are later, after the rate exists for a few months in a row.',
      "Do this week: compute the last three months as three separate rates, not an average. If they swing wildly, the envelopes are not named yet. If they are stable, you have a lever. Raise the rate by cutting a named envelope, not by hoping income up.",
      "A Mac ledger that already shows the gap next to take-home makes the rate a field, not a once-a-year spreadsheet. That is the only product sentence this page gets. The rate is still the subject.",
    ],
  },
  {
    slug: "investing-is-good",
    title: "Investing is good",
    paragraphs: [
      "This is education, not advice.",
      "Cash you will not spend for years is a weak place to store purchasing power. The groceries, rent, and repairs you will buy later tend to cost more later. A claim on productive assets (a share of companies, a fund of many companies) is how most people try not to fall behind. That is the case for investing. It is not a dare.",
      "Investing is good after an emergency fund exists. It is not good as a substitute for one. Selling a long-term account to cover rent is how a patient plan becomes a short-term mistake, usually at a bad time. If you do not yet have a named emergency envelope, go back to emergency fund in months. If you do, the question is how, not whether.",
      'Example, labeled as an example. $12,000 sits in checking because "I might need it." Three months of expenses in this example are $12,000. That cash is doing the emergency job. The next $400 of gap each month does not need to also sit in checking. That $400 is the first money that can go to work. Mixing the two piles is how people either never invest or invest the rent.',
      "Investing is also good because it gives the savings rate a second job. The rate fills the tank. Investing is what the tank does after it is more than a buffer. You can be bad at picking names and still be right about the sequence: gap, envelopes, emergency months, then a contribution you will not reverse next Tuesday.",
      "What investing is not: a replacement for the re-buy test, a way to outrun a 0% savings rate, or a reason to skip sinking funds. A fund will not pay the March insurance invoice. The sinking fund will.",
    ],
  },
  {
    slug: "how-to-invest",
    title: "How to invest",
    paragraphs: [
      "This is education, not advice.",
      "You need an account that can hold securities. A checking account cannot. A brokerage can. What people often buy first is a broad fund, not a single company, because one company can go to zero and a market of companies has not. That is a description of a common starting shape, not a recommendation of a ticker.",
      "You will see a small set of words on any serious ledger. Allocation: the mix you hold (stock, cash, maybe other). Contribution: what you add. Cost basis: what you paid. Lots: the slices of a position you bought on different days. When you sell, the lot you choose changes the gain, and the tax year cares. FIFO, LIFO, and specific identification are three ways to pick the slice. You do not need to use all three. You do need to know which one you used.",
      "Fees and inactivity both cost you. A fund with a small fee, held, beats a clever trade you do not follow. Inactivity is not a fee, but a contribution you skip is a rate you quietly lowered.",
      "Example, labeled as an example. You buy $200 of a broad fund on the 1st, three months in a row. You now have three lots. If you sell $200 later, which lot you sell changes the recorded gain. A ledger that tracks lots is doing the job a brokerage statement already knows and a notes app will lose.",
      "You do not need options to start. Options come after you can read a chart of what you already hold and say whether one name is too much of the pile. How to invest, for this curriculum, ends at: a brokerage, a boring first holding, contributions you can see, lots you can name.",
      "On a Mac, this is the same file as the envelopes. Cash, brokerage, lots, and the savings rate in one place is the point of a personal-finance ledger that is not only a budget app.",
    ],
  },
  {
    slug: "charts",
    title: "Charts",
    paragraphs: [
      "A price chart is time on the x-axis and price on the y-axis. That is the whole object. Candles add the open, high, low, and close for each period. A moving average is a smoother line over the same prices. None of these tell you what to buy. They tell you what already happened.",
      "A watchlist is a short list of names you actually follow, not a wall of tickers. If you cannot name why a name is on the list, it is decoration. Charts of names you do not hold are optional. Charts of names you do hold are how you notice a position changed while you were at work.",
      'When a finance app shows a reconstructed portfolio curve, it is a chart of your holdings, not of a single ticker. Deposits should be excluded if you want return rather than "the line went up because I added cash." That one distinction is the difference between a vanity chart and a useful one. Comparing that curve to SPY or QQQ is a way to ask whether your pile did the market\'s job, not a way to grade yourself every afternoon.',
      "Example, labeled as an example. You added $1,000 on the 15th. The account value rose $1,000 that day. A curve that includes deposits will look like a win. A curve that excludes deposits will look flat, which is the truth of that day. You want both views, labeled.",
      "Do this week: pick one index and one account curve. Ask only: did deposits explain the move. If you cannot answer, the chart is not wired to lots and contributions yet.",
      "A Mac desk that already has markets, a watchlist, and a reconstructed curve is the same skill as this page, applied to your file. The subject is still the chart.",
    ],
  },
  {
    slug: "analysis",
    title: "Analysis",
    paragraphs: [
      "Analysis is what you do after you have a position, not instead of saving. If the emergency fund is empty, this page can wait.",
      'Concentration: one name is too much of the pile. If a single ticker is a third of what you hold, you do not have a portfolio. You have a job in disguise. Correlation: two names that move together are not a hedge. Owning two tech funds is not "diversified into two funds." Beta versus a benchmark like SPY: how hard the position moves when the index moves. A beta near 1 means it roughly follows. Much higher means it swings harder. None of these are buy signals. They are vocabulary for "what do I actually hold."',
      'Example, labeled as an example. Four tickers. Two of them are 70% of the account and both are the same kind of company. Correlation is high. Concentration is high. Beta versus SPY is probably high too. The analysis is: this pile is one bet. The action is not "day trade it." The action is to know that, then decide later with a clear head whether that bet is the one you wanted.',
      "If a desk also shows sector or valuation numbers, those come from a market-data vendor. They are not the ledger. The ledger is lots, cost, and cash. Analysis sits on top. When the vendor is missing, the ledger should still be true.",
      'None of this replaces the savings rate. Analysis keeps a portfolio from pretending it is diversified when it is five tickets to the same ride. On a Mac, concentration, correlation, and beta versus SPY belong next to the same file as the envelopes, so you do not keep "budget brain" and "brokerage brain" in two clouds.',
    ],
  },
  {
    slug: "options",
    title: "Options",
    paragraphs: [
      "This is education, not advice. If you do not already trade options, skip this page and keep the emergency fund. This page exists so the words on a desk are not a foreign language.",
      "An option is a contract. A call is the right to buy a name at a strike before an expiration. A put is the right to sell. You pay or receive a premium. After you buy or sell, you have a live leg: one contract, one strike, one expiration, one side. A wheel, a covered call, a debit spread: those are just groups of legs. Learn the leg first.",
      "Useful views, once you have legs: a list of open legs, cash if assigned (what you would pay or receive if the contract became stock), what expires in the next week, a calendar of expirations, and a payoff sketch (max profit, max loss, breakeven). Those are the objects. Greeks (delta, theta, and the rest) need a live chain from an exchange. If the chain is missing, the Greeks panel should be empty, not invented.",
      "A 3D IV surface, a volatility smile, term structure, dealer gamma, and Section 1256 are not part of this curriculum. They are easy to put on a homepage and hard to teach honestly. This page will not sell them.",
      'Example, labeled as an example. You sold one call, strike 100, expiration in 18 days, premium $1.40. That is a leg. Cash if assigned is the strike times shares per contract, in dollars you should already have. If it expires in six days, it belongs on a "expiring soon" list. The payoff sketch is a picture of the two boring outcomes: it expires worthless, or you are assigned. That is enough to know what you are holding this week.',
      "On a Mac, an options desk that lists legs, assignment cash, a calendar, and a payoff is the same ledger as the groceries envelope. Different object. Same file. If you do not hold legs, you do not need the desk yet.",
    ],
  },
  {
    slug: "a-ledger-on-this-mac",
    title: "A ledger on this Mac",
    // Closer lines (Do this on your Mac / SQLite / demo) are rendered once by the
    // page component — do not also list them here or they double.
    paragraphs: [
      "This is the product page. The path you just read is the job. This page is where you do it.",
      "If the app has a copy of your ledger, it is not only yours. Cloud money apps keep a copy so they can sync across phones and the web. That is a real trade: convenience for a copy. Some people want that trade. This page is for people who do not.",
      "budgetr is a $29 one-time Mac personal-finance app. The ledger is a SQLite file on this Mac. budgetr does not have a copy. There is no budgetr server holding your envelopes, your lots, or your option legs.",
      'If you connect a bank, you create a Plaid account and paste your own keys. You bring the connection. That is not "no third party." It is bring-your-own-keys, on a file that still lives on this Mac.',
      "The job, in the order you read it: a gap you can name, envelopes with caps, an emergency fund in months, sinking funds for dated bills, a savings rate, then investing, then charts and analysis, then options if you actually hold legs. Envelopes with pace, a savings rate, lots, a reconstructed curve, concentration, and an options calendar are the same objects on this Mac, in one SQLite file.",
      "Apple Silicon. 14-day trial, no card. The live demo is sample data, read-only. It is not your file. Stamp that in your head before you click.",
    ],
  },
];

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
