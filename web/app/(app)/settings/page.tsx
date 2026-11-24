import { cookies } from "next/headers";
import Link from "next/link";
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
import { AutoSyncRow } from "./auto-sync-row";
import { AssistantSettings } from "./assistant-settings";
import { getAssistantStatus } from "@/lib/assistant/settings";
import { demoEnabled } from "@/lib/site";
import {
  AUTO_SYNC_OPTIONS,
  autoSyncLabel,
  getAutoSyncHours,
  getAutoSyncLastRunAt,
} from "@/lib/auto-sync";
import { formatDistanceToNow } from "date-fns";
import { SettingRow, SettingRows } from "./setting-row";
import { PrivacySwitch } from "./privacy-switch";
import { SettingsIndex, type SettingsSection } from "./settings-index";
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
import { TRIAL_DAYS, getEntitlement } from "@/lib/license";
import { getConnectionSummary } from "@/lib/connection-health";
import { OBF_COOKIE, hiddenFromCookie } from "@/lib/scale";
import { hasPlaidCredentials } from "@/lib/plaid";
import { isTradingDeskEnabled } from "@/lib/trading-desk";
import { THEME_COOKIE, themeFromCookie } from "@/lib/theme";

export const dynamic = "force-dynamic";

// The index beside the sections, in reading order. The ids are the anchor
// contract other pages link to (#api-keys, #categories, #trading-desk, …), so
// they outlive the headings: "Appearance" is still #display, "Advanced" is
// still #trading-desk.
const SECTIONS: SettingsSection[] = [
  { id: "display", label: "Appearance" },
  { id: "api-keys", label: "Connections & API keys" },
  { id: "auto-sync", label: "Automatic sync" },
  { id: "companion", label: "Phone companion" },
  { id: "assistant", label: "AI assistant" },
  { id: "license", label: "License" },
  { id: "reports", label: "Scheduled report" },
  {
    id: "organize",
    label: "Organize",
    children: [
      { id: "categories", label: "Categories" },
      { id: "rules", label: "Auto-tag rules" },
    ],
  },
  { id: "trading-desk", label: "Advanced" },
];

// Clears the sticky app header when a section is jumped to.
const SECTION = "scroll-mt-24";

export default async function SettingsPage() {
  const schedule = await getReportSchedule();
  const cookieStore = await cookies();
  const theme = themeFromCookie(cookieStore.get(THEME_COOKIE)?.value);
  const privacy = hiddenFromCookie(cookieStore.get(OBF_COOKIE)?.value);
  const displayCurrency = getDisplayCurrencySetting();
  const plaidCfg = getPlaidConfig();
  const clientIdHint = plaidCfg.clientId ? `••••${plaidCfg.clientId.slice(-4)}` : null;
  const entitlement = getEntitlement();
  const countPending = getIncludePending();
  const pendingSummary = getPendingSummary();
  const tradingDesk = isTradingDeskEnabled();
  const autoSyncHours = getAutoSyncHours();
  const autoSyncLastRun = getAutoSyncLastRunAt();
  const syncStatus = getSyncStatus();
  // The AI assistant doesn't exist on the public web demo.
  const assistant = demoEnabled() ? null : getAssistantStatus();
  const categories = getCategories();
  const archivedCategories = getArchivedCategories();
  const rules = getTagRules();
  const ruleAccounts = getAccounts().map((a) => ({ id: a.id, name: a.name }));
  const ruleCategories = categories.map((c) => ({ id: c.id, name: c.name }));

  const plaidReady = hasPlaidCredentials();
  const connections = getConnectionSummary();
  const allReporting = connections.liveCount === connections.total;

  return (
    <div className="space-y-7">
      <PageHead title="Settings" />

      {/* One ruled page: the index on the left stays in view on wide screens,
          the sections scroll on the right — a head, then one row per setting. */}
      <div className="grid gap-x-14 gap-y-6 lg:grid-cols-[200px_minmax(0,1fr)]">
        <SettingsIndex sections={SECTIONS} />

        <div className="min-w-0 space-y-11">
          {/* Appearance — currency and pending left the app header in 0.15, so
              this is now their only home. */}
          <section id="display" className={SECTION} aria-label="Appearance">
            <SectionHead title="Appearance" />
            <SettingRows>
              <SettingRow title="Theme" control={<ThemeSegmented initialTheme={theme} />}>
                System follows your operating system&apos;s light or dark setting.
              </SettingRow>
              <SettingRow
                title="Display currency"
                control={<CurrencySwitcher current={displayCurrency} />}
              >
                Every figure is converted using cached ECB reference rates. Source currencies are
                preserved.
              </SettingRow>
              <SettingRow title="Privacy mode" control={<PrivacySwitch initialHidden={privacy} />}>
                Masks every amount on screen. Also in the top bar and under ⌘K.
              </SettingRow>
              <SettingRow
                title="Count pending transactions as spending"
                control={
                  <PendingSwitch
                    on={countPending}
                    count={pendingSummary.count}
                    amount={pendingSummary.amount}
                  />
                }
              >
                Off, a charge counts once it settles, so totals never move under you. On, pending
                charges count immediately, and the odd figure shifts when a hold posts at its final
                amount.
              </SettingRow>
            </SettingRows>
          </section>

          {/* Connections & API keys — institution health itself lives on /accounts */}
          <section id="api-keys" className={SECTION} aria-label="Connections and API keys">
            <SectionHead
              title="Connections & API keys"
              action={
                plaidReady ? (
                  <span className="text-[13px] text-[var(--jade)]">
                    Plaid is configured ({plaidCfg.env})
                  </span>
                ) : (
                  <span className="text-[13px] text-[var(--coral)]">
                    Plaid is not configured yet
                  </span>
                )
              }
            />
            <Link
              href="/accounts"
              className="flex min-h-[52px] items-center justify-between gap-3 border-b border-line py-2 transition-colors hover:bg-[var(--panel-2)]"
            >
              <span>
                <span className="font-medium">
                  {connections.total === 0
                    ? "No institutions connected yet"
                    : allReporting
                      ? `${connections.liveCount} of ${connections.total} ${
                          connections.total === 1 ? "institution is" : "institutions are"
                        } reporting normally`
                      : `${connections.liveCount} of ${connections.total} institutions reporting normally`}
                </span>
                <span className="block text-[13px] text-[var(--muted)]">
                  {connections.total === 0
                    ? "Connect a bank, card or brokerage from Accounts"
                    : "Review or disconnect a connection from Accounts"}
                </span>
              </span>
              <span aria-hidden className="text-[var(--muted)]">
                →
              </span>
            </Link>
            <ApiKeysForm
              rows
              initial={{
                hasPlaidKeys: plaidReady,
                env: plaidCfg.env,
                hasFinnhub: Boolean(getFinnhubKey()),
                clientIdHint,
              }}
            />
          </section>

          <section id="auto-sync" className={SECTION} aria-label="Automatic sync">
            <SectionHead title="Automatic sync" />
            <AutoSyncRow
              hours={autoSyncHours}
              options={AUTO_SYNC_OPTIONS.map((h) => ({ hours: h, label: autoSyncLabel(h) }))}
              lastRun={
                autoSyncLastRun ? formatDistanceToNow(autoSyncLastRun, { addSuffix: true }) : null
              }
              paired={syncStatus.paired}
            />
          </section>

          {/* Phone companion */}
          <section id="companion" className={SECTION} aria-label="Phone companion">
            <SectionHead title="Phone companion" />
            <CompanionCard initial={syncStatus} />
          </section>

          {/* AI assistant — optional, off by default, the user's own Anthropic key */}
          {assistant && (
            <section id="assistant" className={SECTION} aria-label="AI assistant">
              <SectionHead
                title="AI assistant"
                action={
                  assistant.enabled ? (
                    assistant.hasKey ? (
                      <span className="text-[13px] text-[var(--jade)]">On</span>
                    ) : (
                      <span className="text-[13px] text-[var(--brass)]">On · needs a key</span>
                    )
                  ) : (
                    <span className="text-[13px] text-[var(--muted)]">Off</span>
                  )
                }
              />
              <AssistantSettings
                enabled={assistant.enabled}
                hasKey={assistant.hasKey}
                keyHint={assistant.keyHint}
                model={assistant.model}
              />
            </section>
          )}

          {/* License / trial */}
          <section id="license" className={SECTION} aria-label="License">
            <SectionHead
              title="License"
              action={
                entitlement.status === "licensed" ? (
                  <span className="text-[13px] text-[var(--jade)]">Licensed</span>
                ) : entitlement.status === "trial" ? (
                  <span className="text-[13px] text-[var(--brass)]">
                    Trial · {entitlement.trialDaysLeft} of {TRIAL_DAYS} days left
                  </span>
                ) : (
                  <span className="text-[13px] text-[var(--coral)]">No active license</span>
                )
              }
            />
            <LicensePanel entitlement={entitlement} />
            <p className="pt-3 text-[13px] text-[var(--muted)]">
              Keys are verified offline on this device. Nothing is sent anywhere.
            </p>
          </section>

          {/* Scheduled report */}
          <section id="reports" className={SECTION} aria-label="Scheduled report">
            <SectionHead title="Scheduled report" />
            <ReportScheduleForm initial={schedule} />
          </section>

          {/* Organize — category and rule management (category spend lives on
              /spending; rules used to be /rules). */}
          <section id="organize" className={SECTION} aria-label="Organize">
            <SectionHead title="Organize" />

            <div id="categories" className={SECTION}>
              <SettingRow title="Categories">
                Rename, add, or archive the categories your spending rolls up into. Every
                transaction maps through these — overrides set per-transaction take precedence.
              </SettingRow>
              <div className="border-b border-line py-6">
                <CategoryManager categories={categories} archived={archivedCategories} />
              </div>
            </div>

            <div id="rules" className={SECTION}>
              <SettingRow title="Auto-tag rules">
                Rules tag matching transactions automatically — applied to new transactions on
                every sync and backfilled across your history when you add them. Add amount,
                account, or regex conditions for finer control, and optionally set a category too.
              </SettingRow>
              <div className="border-b border-line py-6">
                <RulesManager rules={rules} accounts={ruleAccounts} categories={ruleCategories} />
              </div>
            </div>
          </section>

          {/* Advanced — the trading desk. Desk pages redirect to this anchor
              while it's off, so the id stays #trading-desk. */}
          <section id="trading-desk" className={SECTION} aria-label="Advanced">
            <SectionHead title="Advanced" />
            <TradingDeskSwitch on={tradingDesk} />
          </section>
        </div>
      </div>
    </div>
  );
}
