import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { Sidebar, MobileNav } from "@/components/sidebar";
import { SyncButton } from "@/components/sync-button";
import { RegisterSW } from "@/components/register-sw";
import { ScaleInit, ObfuscationToggle } from "@/components/obfuscation";
import { CurrencyInit, CurrencySwitcher } from "@/components/currency-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { THEME_COOKIE, themeFromCookie } from "@/lib/theme";
import { getAccounts, getDisplayCurrencyRates } from "@/lib/queries";
import { OBF_COOKIE, hiddenFromCookie, setHidden } from "@/lib/scale";
import {
  CURRENCY_COOKIE,
  RATES_BASE,
  currencyFromCookie,
  setDisplayCurrency,
  setRatesMap,
} from "@/lib/currency";

// The private dashboard shell — reads cookies + live account balances at request
// time, so this segment is always dynamic. Split out of the root layout so the
// public marketing pages can render without the sidebar or any DB access.
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // On a marketing-only deployment (MARKETING_ONLY set), the private dashboard
  // isn't served — bail before touching the local DB.
  if (process.env.MARKETING_ONLY) notFound();

  // Seed privacy mode from the cookie before any server component formats
  // currency this request.
  const cookieStore = await cookies();
  const obfHidden = hiddenFromCookie(cookieStore.get(OBF_COOKIE)?.value);
  setHidden(obfHidden);

  // Seed the display currency + cached FX rates from the cookie/DB before any
  // server component formats money this request.
  const theme = themeFromCookie(cookieStore.get(THEME_COOKIE)?.value);
  const displayCurrency = currencyFromCookie(cookieStore.get(CURRENCY_COOKIE)?.value);
  const ratesMap = getDisplayCurrencyRates(RATES_BASE);
  setDisplayCurrency(displayCurrency);
  setRatesMap(ratesMap);

  const accounts = getAccounts();
  return (
    <>
      <ScaleInit hidden={obfHidden} />
      <CurrencyInit currency={displayCurrency} rates={ratesMap} />
      <RegisterSW />
      <div className="mx-auto flex min-h-dvh max-w-[1500px]">
        <Sidebar accounts={accounts} />
        <div className="flex min-w-0 flex-1 flex-col">
          {/* pt uses the iOS safe-area inset so the notch/status bar never
              covers the controls in standalone (Add to Home Screen) mode. */}
          <header className="material sticky top-0 z-20 flex items-center gap-2 border-b border-line px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:gap-4 sm:px-8">
            <MobileNav />
            <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
              <CurrencySwitcher current={displayCurrency} />
              <ThemeToggle initialTheme={theme} />
              <ObfuscationToggle initialHidden={obfHidden} />
              <SyncButton />
            </div>
          </header>
          <main className="flex-1 px-5 pt-8 pb-[max(2rem,env(safe-area-inset-bottom))] sm:px-8 lg:pt-10">
            {children}
          </main>
        </div>
      </div>
    </>
  );
}
