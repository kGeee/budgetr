/**
 * A page's own controls row.
 *
 * The title used to live here, under a date and above a rule — about 200px
 * before the first figure. The name and the section's tabs are now in the top
 * bar (components/topbar.tsx), so all this renders is whatever the page wants
 * beside them: a period picker, an Edit button. With no action it renders
 * nothing and the page opens on its hero.
 *
 * `title` is still taken so a page says what it is at its own call site.
 */
export function PageHead({ title, action }: { title: string; action?: React.ReactNode }) {
  if (!action) return null;
  return (
    <div
      data-page={title}
      className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2"
    >
      {action}
    </div>
  );
}
