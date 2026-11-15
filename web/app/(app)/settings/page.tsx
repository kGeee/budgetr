import { cookies } from "next/headers";
import { PageHead } from "@/components/page-head";
import { SectionHead } from "@/components/ui/statement";
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
import { SectionIntro, SettingRow, SettingRows } from "./setting-row";
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

      {/* One ruled page: a section head, then one row per setting. */}
      <div className="space-y-12">
        {/* License / trial */}
        <section id="license" className={SECTION}>
          <SectionHead title="License" />
          <LicensePanel entitlement={entitlement} />
        </section>

        {/* Display — currency and pending left the app header in 0.15, so this
            is now their only home; they lead the everyday preferences. */}
        <section id="display" className={SECTION}>
          <SectionHead title="Display" />
          <SettingRows>
            <SettingRow
              title="Display currency"
              control={<CurrencySwitcher current={displayCurrency} />}
            >
              Every figure across budgetr is converted to this unit using cached ECB reference
              rates. Source currencies are preserved — this only changes how amounts are shown.
            </SettingRow>
            <SettingRow
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
            </SettingRow>
            <SettingRow title="Theme" control={<ThemeSegmented initialTheme={theme} />}>
              <span className="text-[var(--paper)]">System</span> follows your operating
              system&apos;s light/dark setting.
            </SettingRow>
          </SettingRows>
        </section>

        {/* Trading desk — desk pages redirect here while it's off */}
        <section id="trading-desk" className={SECTION}>
          <SectionHead title="Trading desk" />
          <TradingDeskSwitch on={tradingDesk} />
        </section>

        {/* Categories — management only; category spend lives on /spending */}
        <section id="categories" className={SECTION}>
          <SectionHead title="Categories" />
          <SectionIntro>
            Rename, add, or archive the categories your spending rolls up into. Every transaction
            maps through these — overrides set per-transaction take precedence.
          </SectionIntro>
          <div className="pt-6">
            <CategoryManager categories={categories} archived={archivedCategories} />
          </div>
        </section>

        {/* Auto-tag rules (was /rules) */}
        <section id="rules" className={SECTION}>
          <SectionHead title="Auto-tag rules" />
          <SectionIntro>
            Rules tag matching transactions automatically — applied to new transactions on every
            sync and backfilled across your history when you add them. Add amount, account, or regex
            conditions for finer control, and optionally set a category too.
          </SectionIntro>
          <div className="pt-6">
            <RulesManager rules={rules} accounts={ruleAccounts} categories={ruleCategories} />
          </div>
        </section>

        {/* Scheduled report */}
        <section id="reports" className={SECTION}>
          <SectionHead title="Scheduled report" />
          <SectionIntro>
            Email yourself a periodic summary — totals, top vendors, category breakdown and net
            worth. Delivery is a stub for now (the report is rendered and logged server-side); wire
            up a provider to go live.
          </SectionIntro>
          <ReportScheduleForm initial={schedule} />
        </section>

        {/* API keys — institution health lives on /accounts */}
        <section id="api-keys" className={SECTION}>
          <SectionHead title="API keys" />
          <SectionIntro>
            Your Plaid keys power bank connections; the optional Finnhub key adds live stock prices.
            Keys are encrypted on this device. Leave a field blank to keep the saved value.{" "}
            {hasPlaidCredentials() ? (
              <span className="text-[var(--jade)]">Plaid is configured ({plaidCfg.env}).</span>
            ) : (
              <span className="text-[var(--coral)]">Plaid is not configured yet.</span>
            )}
          </SectionIntro>
          <ApiKeysForm
            rows
            initial={{
              hasPlaidKeys: hasPlaidCredentials(),
              env: plaidCfg.env,
              hasFinnhub: Boolean(getFinnhubKey()),
              clientIdHint,
            }}
          />
        </section>

        {/* Phone companion */}
        <section id="companion" className={SECTION}>
          <SectionHead title="Phone companion" />
          <CompanionCard initial={getSyncStatus()} />
        </section>
      </div>
    </div>
  );
}
