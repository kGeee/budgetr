import type { Metadata } from "next";
import { Fraunces, Hanken_Grotesk, Spline_Sans_Mono } from "next/font/google";
import { Sidebar, MobileNav } from "@/components/sidebar";
import { SyncButton } from "@/components/sync-button";
import { getAccounts } from "@/lib/queries";
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
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const accounts = getAccounts();
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body>
        <div className="mx-auto flex min-h-dvh max-w-[1500px]">
          <Sidebar accounts={accounts} />
          <div className="flex min-w-0 flex-1 flex-col">
            <header className="sticky top-0 z-20 flex items-center gap-4 border-b border-line bg-[color-mix(in_srgb,var(--ink)_82%,transparent)] px-5 py-3 backdrop-blur-xl sm:px-8">
              <MobileNav />
              <div className="ml-auto">
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
