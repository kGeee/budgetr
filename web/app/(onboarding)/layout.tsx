import { notFound } from "next/navigation";
import { RegisterSW } from "@/components/register-sw";

// First-run onboarding gets its own bare shell — no sidebar, no dashboard
// header. It's a private feature (touches the local DB) so it stays out of the
// public marketing tree, but a new user hasn't connected anything yet, so the
// dashboard chrome would only be dead weight. Kept as a sibling route group to
// app/(app) so it escapes that layout's sidebar entirely.
export const dynamic = "force-dynamic";

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  // On a marketing-only deployment (MARKETING_ONLY set), the private onboarding
  // flow isn't served — mirror the guard in app/(app)/layout.tsx.
  if (process.env.MARKETING_ONLY) notFound();

  return (
    <>
      <RegisterSW />
      <main className="mx-auto min-h-dvh w-full max-w-2xl px-5 pt-10 pb-[max(2rem,env(safe-area-inset-bottom))] sm:px-8">
        {children}
      </main>
    </>
  );
}
