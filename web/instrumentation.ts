// Next.js instrumentation hook — runs once when the server starts, before any
// request is served.
// - Real installs: boot the companion sync engine (a no-op tick until a phone
//   is paired).
// - Web demo (in-memory DB): seed the example dataset here, at cold-start, so
//   it's populated before the first request. Next renders a route's layout and
//   page in parallel, so relying on the layout's ensureFirstRunDemo() to seed
//   races the page's own queries — a sibling page could read the still-empty
//   `:memory:` DB and render blank until a manual refresh. Seeding in register()
//   runs to completion before any query, closing that window. (The layout call
//   stays as a cheap idempotent backstop.)

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  if (process.env.DEMO_DB) {
    const { ensureFirstRunDemo } = await import("@/lib/demo-data");
    ensureFirstRunDemo();
    return;
  }

  const { startCompanionEngine } = await import("@/lib/companion/engine");
  startCompanionEngine();
}
