import { RegisterSW } from "@/components/register-sw";

// Bare shell for the Windows first-run privacy gate — no sidebar, no app chrome.
export const dynamic = "force-dynamic";

export default function DesktopSetupLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <RegisterSW />
      {children}
    </>
  );
}
