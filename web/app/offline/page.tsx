export default function OfflinePage() {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center text-center">
      <span className="grid h-14 w-14 place-items-center rounded-2xl border border-[var(--brass-dim)] bg-[var(--panel)] font-display text-2xl text-[var(--brass)]">
        ₿
      </span>
      <h1 className="mt-6 font-display text-4xl tracking-tight">You&rsquo;re offline</h1>
      <p className="mt-3 max-w-sm text-[var(--muted)]">
        budgetr needs a connection to reach your local database. Reconnect and
        reload to continue.
      </p>
    </div>
  );
}
