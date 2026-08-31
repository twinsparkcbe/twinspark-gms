import { Fragment } from "react";

import type { BusinessInfo } from "@/services/shared/invoice";
import { cn } from "@/lib/utils";

/**
 * The garage's phone numbers, printed in the top-right of every bill —
 * Sales Invoice, Service Invoice, Online Order Invoice and the Job Card.
 *
 * One component rather than the same JSX pasted into four views: a customer
 * ringing the number off a bill does not care which module printed it, and
 * the four headers had already drifted apart once (each grew its own GSTIN
 * rule). Adding or changing a number now means editing lib/business-info.ts
 * and nothing else.
 *
 * Renders nothing at all when no contacts are set, the same way the header
 * already treats an absent phone or GSTIN — a blank "Contact" heading on a
 * printed bill looks like a mistake.
 */
export function BusinessContacts({
  contacts,
  className,
}: {
  contacts?: BusinessInfo["contacts"];
  className?: string;
}) {
  if (!contacts || contacts.length === 0) return null;

  return (
    <div className={cn("mt-3", className)}>
      <p className="text-[10px] font-semibold tracking-wide text-neutral-500 uppercase">Contact</p>
      {/* A grid, not stacked text: the numbers line up under each other even
          though "Customer care" is much wider than "Office", which is what
          makes a column of phone numbers scannable at a glance. */}
      <div className="mt-0.5 grid justify-end grid-cols-[auto_auto] gap-x-2 text-xs leading-tight">
        {contacts.map((contact) =>
          contact.numbers.map((number, i) => (
            <Fragment key={`${contact.label}-${number}`}>
              {/* The label prints once per group; the extra numbers sit under
                  it with the label cell left empty. */}
              <span className="text-right text-neutral-800 font-bold">{i === 0 ? contact.label+' :' : ""}</span>
              <span className="text-right font-mono font-medium text-neutral-900">{number}</span>
            </Fragment>
          ))
        )}
      </div>
    </div>
  );
}
