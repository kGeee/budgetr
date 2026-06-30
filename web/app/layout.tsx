import type { Metadata, Viewport } from "next";
import { Fraunces, Hanken_Grotesk, Spline_Sans_Mono } from "next/font/google";
import { cookies } from "next/headers";
import { Sidebar, MobileNav } from "@/components/sidebar";
import { SyncButton } from "@/components/sync-button";
import { RegisterSW } from "@/components/register-sw";
import { ScaleInit, ObfuscationToggle } from "@/components/obfuscation";
import { getAccounts } from "@/lib/queries";
import { OBF_COOKIE, factorFromCookie, setScaleFactor } from "@/lib/scale";
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
  // Seed the obfuscation scale from the cookie before any server component
  // formats currency this request.
  const obfFactor = factorFromCookie((await cookies()).get(OBF_COOKIE)?.value);
  setScaleFactor(obfFactor);

  const accounts = getAccounts();
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body>
        <ScaleInit factor={obfFactor} />
        <RegisterSW />
        <div className="mx-auto flex min-h-dvh max-w-[1500px]">
          <Sidebar accounts={accounts} />
          <div className="flex min-w-0 flex-1 flex-col">
            <header className="sticky top-0 z-20 flex items-center gap-4 border-b border-line bg-[color-mix(in_srgb,var(--ink)_82%,transparent)] px-5 py-3 backdrop-blur-xl sm:px-8">
              <MobileNav />
              <div className="ml-auto flex items-center gap-2">
                <ObfuscationToggle initialFactor={obfFactor} />
                <SyncButton />
              </div>
            </header>
            <main className="flex-1 px-5 py-8 sm:px-8 lg:py-10">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
