import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SITE, demoEnabled, DEMO_HREF } from "@/lib/site";

/**
 * A screenshot framed as a small app window — faux titlebar with brand-coloured
 * traffic lights and the wordmark, then the image. Used across the landing to
 * show the real product (fabricated demo data, no real accounts).
 */
function AppFrame({
  src,
  alt,
  width,
  height,
  priority = false,
  className = "",
}: {
  src: string;
  alt: string;
  width: number;
  height: number;
  priority?: boolean;
  className?: string;
}) {
  return (
    <figure
      className={`overflow-hidden rounded-[var(--radius)] border border-line bg-[var(--panel)] shadow-[var(--elev-2)] ${className}`}
    >
      <div className="flex items-center gap-2 border-b border-line bg-[var(--panel-2)] px-4 py-2.5">
        <span className="flex items-center gap-1.5" aria-hidden>
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--coral)]/80" />
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--brass)]/80" />
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--jade)]/80" />
        </span>
        <span className="ml-1.5 font-display text-xs tracking-tight text-[var(--muted)]">
          budgetr
        </span>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element -- static /public asset, no loader needed */}
      <img
        src={src}
        alt={alt}
        width={width}
        height={height}
        loading={priority ? "eager" : "lazy"}
        className="block w-full"
      />
    </figure>
  );
}

/** The big hero screenshot that sits directly under the landing hero. */
export function HeroShot() {
  return (
    <section className="mx-auto max-w-5xl px-5 pb-6 sm:px-8">
      <div className="relative">
        {/* soft brand glow behind the frame */}
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-x-8 -top-6 bottom-0 -z-10 rounded-[var(--radius)] bg-[radial-gradient(60%_60%_at_50%_0%,rgba(111,227,166,0.10),transparent_70%)]"
        />
        <AppFrame
          src="/marketing/overview.png"
          alt="budgetr overview — net worth, income vs spending, and 30-day category breakdown"
          width={2368}
          height={1340}
          priority
          className="lift"
        />
      </div>
      <p className="mt-4 text-center text-xs text-[var(--faint)]">
        Screens shown with sample data.
      </p>
    </section>
  );
}

const SHOTS = [
  {
    src: "/marketing/investments.png",
    w: 2368,
    h: 1450,
    eyebrow: "Investments",
    title: "Every position, reconstructed",
    body: "Market value, day change, unrealized gain, and cost basis at a glance — with a portfolio curve rebuilt from your trades and a return-vs-SPY/QQQ benchmark table.",
  },
  {
    src: "/marketing/options.png",
    w: 2368,
    h: 2360,
    eyebrow: "Options desk",
    title: "A trading desk, built in",
    body: "Per-ticker chains with the volatility smile, term structure, dealer gamma, and a drag-to-rotate 3D IV surface — priced off the free CBOE chain, no extra data feed.",
  },
  {
    src: "/marketing/budgets.png",
    w: 2368,
    h: 2300,
    eyebrow: "Budgets",
    title: "Budgets that keep pace",
    body: "See what's left to spend, whether you're ahead of pace for the month, and a projected month-end total — with per-category limits and rollover.",
  },
  {
    src: "/marketing/realized-gains.png",
    w: 2368,
    h: 1440,
    eyebrow: "Tax lots",
    title: "Realized gains, done right",
    body: "FIFO, LIFO, or Spec-ID cost basis with short/long-term splits and wash-sale flags — export-ready CSV when it's time to file.",
  },
];

/** Alternating image/copy feature rows — the closer look at the app. */
export function ScreenshotShowcase() {
  return (
    <section id="screens" className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
      <div className="text-center">
        <p className="eyebrow">A closer look</p>
        <h2 className="display-2 mt-3 font-display text-3xl sm:text-4xl">
          One private ledger for all of it
        </h2>
        <p className="mx-auto mt-3 max-w-lg text-[var(--muted)]">
          Net worth, spending, investments, options, and taxes — every screen runs locally on
          your Mac.
        </p>
        {demoEnabled() && (
          <Link
            href={DEMO_HREF}
            className="group mt-6 inline-flex items-center gap-1.5 rounded-full border border-[var(--brass-dim)] bg-[color-mix(in_srgb,var(--brass)_8%,transparent)] px-4 py-2 text-sm font-medium text-[var(--brass)] transition hover:border-[var(--brass)]"
          >
            Try the live demo — no download
            <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" />
          </Link>
        )}
      </div>

      <div className="mt-12 space-y-16 sm:space-y-24">
        {SHOTS.map((s, i) => (
          <div
            key={s.src}
            className="grid items-center gap-8 lg:grid-cols-2 lg:gap-12"
          >
            <div className={i % 2 === 1 ? "lg:order-2" : ""}>
              <AppFrame src={s.src} alt={`${s.title} — ${s.eyebrow}`} width={s.w} height={s.h} className="lift" />
            </div>
            <div className={i % 2 === 1 ? "lg:order-1" : ""}>
              <p className="eyebrow">{s.eyebrow}</p>
              <h3 className="mt-3 font-display text-2xl tracking-tight sm:text-3xl">{s.title}</h3>
              <p className="mt-4 max-w-md text-[var(--muted)]">{s.body}</p>
            </div>
          </div>
        ))}
      </div>

      <p className="mt-14 text-center text-xs text-[var(--faint)]">
        All figures above are fabricated sample data — {SITE.name} keeps your real accounts on your
        machine.
      </p>
    </section>
  );
}
