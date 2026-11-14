import { requireTradingDesk } from "@/lib/trading-desk";

// The Options desk is part of the Trading desk. One gate here covers every tool
// under it; with the desk off, an old link lands on the Settings switch instead.
export default function OptionsLayout({ children }: { children: React.ReactNode }) {
  requireTradingDesk();
  return children;
}
