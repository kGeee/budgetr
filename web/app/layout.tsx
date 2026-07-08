import type { Metadata, Viewport } from "next";
import { Fraunces, Hanken_Grotesk, Spline_Sans_Mono } from "next/font/google";
import { cookies } from "next/headers";
import { Sidebar, MobileNav } from "@/components/sidebar";
import { SyncButton } from "@/components/sync-button";
import { RegisterSW } from "@/components/register-sw";
import { ScaleInit, ObfuscationToggle } from "@/components/obfuscation";
import { CurrencyInit, CurrencySwitcher } from "@/components/currency-switcher";
import { getAccounts, getDisplayCurrencyRates } from "@/lib/queries";
import { OBF_COOKIE, hiddenFromCookie, setHidden } from "@/lib/scale";
import {
  CURRENCY_COOKIE,
  RATES_BASE,
  currencyFromCookie,
  setDisplayCurrency,
  setRatesMap,
} from "@/lib/currency";
import "./globals.css";

// Read live account balances at request time for the sidebar.
export const dynamic = "force-dynamic";

const display = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  style: ["normal", "italic"],
  axes: ["opsz"],
});

const sans = Hanken_Grotesk({
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["400", "500", "600", "700"],
});

const mono = Spline_Sans_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "budgetr — private ledger",
  description: "Net worth, spending & income — read-only, on your machine.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    title: "budgetr",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#080b0a",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Seed privacy mode from the cookie before any server component formats
  // currency this request.
  const cookieStore = await cookies();
  const obfHidden = hiddenFromCookie(cookieStore.get(OBF_COOKIE)?.value);
  setHidden(obfHidden);

  // Seed the display currency + cached FX rates from the cookie/DB before any
  // server component formats money this request.
  const displayCurrency = currencyFromCookie(cookieStore.get(CURRENCY_COOKIE)?.value);
  const ratesMap = getDisplayCurrencyRates(RATES_BASE);
  setDisplayCurrency(displayCurrency);
  setRatesMap(ratesMap);

  const accounts = getAccounts();
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body>
        <ScaleInit hidden={obfHidden} />
        <CurrencyInit currency={displayCurrency} rates={ratesMap} />
        <RegisterSW />
        <div className="mx-auto flex min-h-dvh max-w-[1500px]">
          <Sidebar accounts={accounts} />
          <div className="flex min-w-0 flex-1 flex-col">
            {/* pt uses the iOS safe-area inset so the notch/status bar never
                covers the controls in standalone (Add to Home Screen) mode. */}
            <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-line bg-[color-mix(in_srgb,var(--ink)_82%,transparent)] px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur-xl sm:gap-4 sm:px-8">
              <MobileNav />
              <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
                <CurrencySwitcher current={displayCurrency} />
                <ObfuscationToggle initialHidden={obfHidden} />
                <SyncButton />
              </div>
            </header>
            <main className="flex-1 px-5 pt-8 pb-[max(2rem,env(safe-area-inset-bottom))] sm:px-8 lg:pt-10">
              {children}
            </main>
          </div>
        </div>
      </body>
    </html>
  );
}
