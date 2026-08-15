import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ArrowRight } from "lucide-react";

export function ReportCard({
  href,
  icon: Icon,
  title,
  description,
}: {
  href: string;
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col gap-3 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm transition-colors hover:border-primary/40 hover:bg-neutral-50"
    >
      <div className="flex items-center justify-between">
        <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-4.5" />
        </div>
        <ArrowRight className="size-4 text-neutral-300 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
      </div>
      <div>
        <h3 className="font-bold text-neutral-900">{title}</h3>
        <p className="mt-0.5 text-sm text-neutral-500">{description}</p>
      </div>
    </Link>
  );
}
