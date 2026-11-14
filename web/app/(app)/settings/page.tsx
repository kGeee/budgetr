import { cookies } from "next/headers";
import {
  BadgeCheck,
  CandlestickChart,
  KeyRound,
  Mail,
  SlidersHorizontal,
  Smartphone,
  Tags,
  Wand2,
} from "lucide-react";
import { PageHead } from "@/components/page-head";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { CurrencySwitcher } from "@/components/currency-switcher";
import { ThemeSegmented } from "@/components/theme-toggle";
import { ReportScheduleForm } from "@/components/report-schedule-form";
import { ApiKeysForm } from "@/components/api-keys-form";
import { CompanionCard } from "@/components/companion-card";
import { LicensePanel } from "@/components/license/license-panel";
import { CategoryManager } from "@/components/budget/category-manager";
import { RulesManager } from "@/components/transactions/rules-manager";
import { PendingSwitch } from "@/components/pending-toggle";
import { TradingDeskSwitch } from "./trading-desk-switch";
import { getSyncStatus } from "@/lib/companion/store";
import {
  getAccounts,
  getArchivedCategories,
  getCategories,
  getDisplayCurrencySetting,
  getPendingSummary,
  getTagRules,
} from "@/lib/queries";
import { getIncludePending } from "@/lib/pending";
import { getReportSchedule } from "@/lib/actions-reports";
import { getFinnhubKey, getPlaidConfig } from "@/lib/app-config";
import { getEntitlement } from "@/lib/license";
import { hasPlaidCredentials } from "@/lib/plaid";
import { isTradingDeskEnabled } from "@/lib/trading-desk";
import { THEME_COOKIE, themeFromCookie } from "@/lib/theme";

export const dynamic = "force-dynamic";

// The page is long now that Categories and Rules live here, so it opens with an
// index. Ids are the shared anchor contract other pages link to.
const SECTIONS = [
  { id: "license", label: "License" },
  { id: "display", label: "Display" },
  { id: "trading-desk", label: "Trading desk" },
  { id: "categories", label: "Categories" },
  { id: "rules", label: "Rules" },
  { id: "reports", label: "Reports" },
  { id: "api-keys", label: "API keys" },
  { id: "companion", label: "Companion" },
] as const;

// Clears the sticky app header when a section is jumped to.
const SECTION = "scroll-mt-24";

/** One labelled row inside the Display card. */
function DisplayRow({
  title,
  children,
  control,
}: {
  title: string;
  children: React.ReactNode;
  control: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 py-5 first:pt-0 last:pb-0">
      <div className="max-w-md">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-1 text-sm text-[var(--muted)]">{children}</p>
      </div>
      {control}
    </div>
  );
}

export default async function SettingsPage() {
  const schedule = await getReportSchedule();
  const theme = themeFromCookie((await cookies()).get(THEME_COOKIE)?.value);
  const displayCurrency = getDisplayCurrencySetting();
  const plaidCfg = getPlaidConfig();
  const clientIdHint = plaidCfg.clientId ? `••••${plaidCfg.clientId.slice(-4)}` : null;
  const entitlement = getEntitlement();
  const countPending = getIncludePending();
  const pendingSummary = getPendingSummary();
  const tradingDesk = isTradingDeskEnabled();
  const categories = getCategories();
  const archivedCategories = getArchivedCategories();
  const rules = getTagRules();
  const ruleAccounts = getAccounts().map((a) => ({ id: a.id, name: a.name }));
  const ruleCategories = categories.map((c) => ({ id: c.id, name: c.name }));

  return (
    <div className="space-y-7">
      <PageHead title="Settings" />

      <nav aria-label="Settings sections" className="-mt-2 flex flex-wrap gap-2">
        {SECTIONS.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className="rounded-full border border-line px-3 py-1 text-xs text-[var(--muted)] transition-colors hover:border-[var(--brass-dim)] hover:text-[var(--brass)]"
          >
            {s.label}
          </a>
        ))}
      </nav>

      {/* License / trial */}
      <Card id="license" className={SECTION}>
        <CardHeader>
          <CardTitle>License</CardTitle>
          <BadgeCheck size={15} className="text-[var(--brass)]" />
        </CardHeader>
        <LicensePanel entitlement={entitlement} />
      </Card>

      {/* Display — currency and pending left the app header in 0.15, so this is
          now their only home; they lead the everyday preferences. */}
      <Card id="display" className={SECTION}>
        <CardHeader>
          <CardTitle>Display</CardTitle>
          <SlidersHorizontal size={15} className="text-[var(--brass)]" />
        </CardHeader>
        <div className="divide-y divide-[var(--line)]">
          <DisplayRow
            title="Display currency"
            control={<CurrencySwitcher current={displayCurrency} />}
          >
            Every figure across budgetr is converted to this unit using cached ECB reference
            rates. Source currencies are preserved — this only changes how amounts are shown.
          </DisplayRow>
          <DisplayRow
            title="Count pending transactions"
            control={
              <PendingSwitch
                on={countPending}
                count={pendingSummary.count}
                amount={pendingSummary.amount}
              />
            }
          >
            Off (the default), a charge only counts toward spending once it settles, so totals
            never move under you. On, pending charges count immediately — usually the truer
            picture, at the cost of the odd figure changing when a hold posts at its final amount.
          </DisplayRow>
          <DisplayRow title="Theme" control={<ThemeSegmented initialTheme={theme} />}>
            <span className="text-[var(--paper)]">System</span> follows your operating
            system&apos;s light/dark setting.
          </DisplayRow>
        </div>
      </Card>

      {/* Trading desk — desk pages redirect here while it's off */}
      <Card id="trading-desk" className={SECTION}>
        <CardHeader>
          <CardTitle>Trading desk</CardTitle>
          <CandlestickChart size={15} className="text-[var(--brass)]" />
        </CardHeader>
        <TradingDeskSwitch on={tradingDesk} />
      </Card>

      {/* Categories — management only; category spend lives on /spending */}
      <Card id="categories" className={SECTION}>
        <CardHeader>
          <CardTitle>Categories</CardTitle>
          <Tags size={15} className="text-[var(--brass)]" />
        </CardHeader>
        <p className="mb-6 max-w-xl text-sm text-[var(--muted)]">
          Rename, add, or archive the categories your spending rolls up into. Every transaction
          maps through these — overrides set per-transaction take precedence.
        </p>
        <CategoryManager categories={categories} archived={archivedCategories} />
      </Card>

      {/* Auto-tag rules (was /rules) */}
      <Card id="rules" className={SECTION}>
        <CardHeader>
          <CardTitle>Auto-tag rules</CardTitle>
          <Wand2 size={15} className="text-[var(--brass)]" />
        </CardHeader>
        <p className="mb-6 max-w-xl text-sm text-[var(--muted)]">
          Rules tag matching transactions automatically — applied to new transactions on every
          sync and backfilled across your history when you add them. Add amount, account, or regex
          conditions for finer control, and optionally set a category too.
        </p>
        <RulesManager rules={rules} accounts={ruleAccounts} categories={ruleCategories} />
      </Card>

      {/* Scheduled report */}
      <Card id="reports" className={SECTION}>
        <CardHeader>
          <CardTitle>Scheduled report</CardTitle>
          <Mail size={15} className="text-[var(--brass)]" />
        </CardHeader>
        <p className="mb-6 max-w-md text-sm text-[var(--muted)]">
          Email yourself a periodic summary — totals, top vendors, category breakdown and net
          worth. Delivery is a stub for now (the report is rendered and logged server-side); wire
          up a provider to go live.
        </p>
        <ReportScheduleForm initial={schedule} />
      </Card>

      {/* API keys — institution health lives on /accounts */}
      <Card id="api-keys" className={SECTION}>
        <CardHeader>
          <CardTitle>API keys</CardTitle>
          <KeyRound size={15} className="text-[var(--brass)]" />
        </CardHeader>
        <p className="mb-6 max-w-md text-sm text-[var(--muted)]">
          Your Plaid keys power bank connections; the optional Finnhub key adds live stock prices.
          Keys are encrypted on this device. Leave a field blank to keep the saved value.{" "}
          {hasPlaidCredentials() ? (
            <span className="text-[var(--jade)]">Plaid is configured ({plaidCfg.env}).</span>
          ) : (
            <span className="text-[var(--coral)]">Plaid is not configured yet.</span>
          )}
        </p>
        <ApiKeysForm
          initial={{
            hasPlaidKeys: hasPlaidCredentials(),
            env: plaidCfg.env,
            hasFinnhub: Boolean(getFinnhubKey()),
            clientIdHint,
          }}
        />
      </Card>

      {/* Phone companion */}
      <Card id="companion" className={SECTION}>
        <CardHeader>
          <CardTitle>Phone companion</CardTitle>
          <Smartphone size={15} className="text-[var(--brass)]" />
        </CardHeader>
        <CompanionCard initial={getSyncStatus()} />
      </Card>
    </div>
  );
}
