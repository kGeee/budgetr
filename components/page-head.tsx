import { format } from "date-fns";

export function PageHead({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="eyebrow">{format(new Date(), "EEEE, MMMM d")}</p>
        <h1 className="mt-1 font-display text-3xl tracking-tight">{title}</h1>
      </div>
      {action}
    </div>
  );
}
