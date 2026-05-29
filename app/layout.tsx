import type { Metadata } from "next";
import Link from "next/link";
import { Wallet, LayoutDashboard, ArrowLeftRight, LineChart, Landmark } from "lucide-react";
import { SyncButton } from "@/components/sync-button";
import "./globals.css";

export const metadata: Metadata = {
  title: "budgetr",
  description: "Personal net worth, spending & income tracker",
};

const nav = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/accounts", label: "Accounts", icon: Landmark },
  { href: "/transactions", label: "Transactions", icon: ArrowLeftRight },
  { href: "/investments", label: "Investments", icon: LineChart },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="flex min-h-screen">
          <aside className="hidden w-56 shrink-0 flex-col border-r bg-[var(--surface)] p-4 md:flex">
            <div className="mb-8 flex items-center gap-2 px-2">
              <Wallet className="text-[var(--accent)]" size={22} />
              <span className="text-lg font-semibold">budgetr</span>
            </div>
            <nav className="flex flex-col gap-1">
              {nav.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-[var(--muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
                >
                  <Icon size={18} />
                  {label}
                </Link>
              ))}
            </nav>
          </aside>

          <div className="flex min-w-0 flex-1 flex-col">
            <header className="flex items-center justify-between border-b bg-[var(--surface)] px-6 py-3">
              <nav className="flex gap-4 md:hidden">
                {nav.map(({ href, label }) => (
                  <Link key={href} href={href} className="text-sm text-[var(--muted)]">
                    {label}
                  </Link>
                ))}
              </nav>
              <div className="ml-auto">
                <SyncButton />
              </div>
            </header>
            <main className="flex-1 p-6">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
