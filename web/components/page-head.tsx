/**
 * Page title row. It used to open every page with the date, a 40px title and a
 * rule — about 200px before the first figure. The title is now one compact line
 * that shares its row with the page's controls, so the hero starts near the top.
 */
export function PageHead({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line pb-3">
      <h1 className="display-2 font-display text-2xl">{title}</h1>
      {action}
    </div>
  );
}
