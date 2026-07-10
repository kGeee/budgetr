import { format } from "date-fns";

export function PageHead({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
      <div>
        <p className="eyebrow">{format(new Date(), "EEEE, MMMM d")}</p>
        <h1 className="display-2 mt-1.5 font-display text-3xl sm:text-4xl">
          {title}
        </h1>
      </div>
      {action}
    </div>
  );
}
