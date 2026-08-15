"use client";

import type { ElementType } from "react";
import { Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Initial row count shown per history table before "Show more" — same
 * page size used by every table elsewhere in the app. */
export const HISTORY_PAGE_SIZE = 10;

/** Heading row (icon + title + live count) for a full-width section — no
 * card wrapper, since each section is now its own table stretching the
 * page width rather than a boxed summary (2026-07-31 revision). */
export function SectionHeading({ title, icon: Icon, count }: { title: string; icon: ElementType; count: number }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="size-4 text-primary" />
      <p className="text-sm font-semibold text-neutral-900">
        {title} <span className="font-normal text-neutral-400">({count.toLocaleString("en-IN")})</span>
      </p>
    </div>
  );
}

export function SectionSearch({ placeholder, value, onChange }: { placeholder: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="relative min-w-0 sm:max-w-sm">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-neutral-400" />
      <Input
        placeholder={placeholder}
        className="h-9 rounded-[10px] pl-9 text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export function EmptyRow({ text, icon: Icon }: { text: string; icon: ElementType }) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
      <Icon className="size-8 text-neutral-300" />
      <p className="text-sm text-neutral-500">{text}</p>
    </div>
  );
}

export function ShowMoreButton({ remaining, onClick }: { remaining: number; onClick: () => void }) {
  return (
    <Button variant="ghost" size="sm" className="mt-2 rounded-[10px]" onClick={onClick}>
      Show {Math.min(remaining, HISTORY_PAGE_SIZE)} more
    </Button>
  );
}

export function TableHeaderRow({ columns, gridClass }: { columns: string[]; gridClass: string }) {
  return (
    <div className={`${gridClass} gap-3 px-4 py-2 text-xs font-semibold tracking-wide text-neutral-500 uppercase`}>
      {columns.map((col, i) => (
        <span key={col} className={i === columns.length - 1 ? "text-right" : undefined}>
          {col}
        </span>
      ))}
    </div>
  );
}
