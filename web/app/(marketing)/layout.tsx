import { MarketingShell } from "@/components/marketing/marketing-shell";

// Public marketing chrome for /pricing, /getting-started, /thanks. The landing
// at "/" wraps itself (it lives outside this group so the root "/" branch can
// own it); these sub-pages get the shell here.
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return <MarketingShell>{children}</MarketingShell>;
}
