// Next.js instrumentation hook — runs once when the server starts.
// Boots the companion sync engine (a no-op tick until a phone is paired).
// Skipped for the in-memory demo DB: the marketing demo must never sync.

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs" && !process.env.DEMO_DB) {
    const { startCompanionEngine } = await import("@/lib/companion/engine");
    startCompanionEngine();
  }
}
