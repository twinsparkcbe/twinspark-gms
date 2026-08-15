"use client";

import { Banknote, Clock, Gift, Smartphone, Split, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatINR } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  editPaymentField,
  fillBalance,
  resolveDraft,
  selectPaymentOption,
  type PaymentDraft,
  type PaymentErrors,
  type PaymentOption,
} from "@/services/shared/payment";

/**
 * How a bill was settled — cash, UPI, or a split of both, plus two states
 * (unpaid, free service) that only the Record Payment dialog opts into. One
 * control shared by the New Sale form, the Service
 * completion form and the Record Payment dialog, per the project's
 * single-shared-component-set rule.
 *
 * All state lives in the caller as a `PaymentDraft`; every behaviour is a
 * pure function in services/shared/payment.ts. That split exists so the
 * keystroke rules (auto-fill, the pristine flags, clamping when the bill
 * total moves) are unit-testable — Vitest here runs in a `node` environment
 * with no React testing library.
 */
export function PaymentCapture({
  grandTotal,
  draft,
  onChange,
  allowUnpaid = false,
  allowFreeService = false,
  errors,
  className,
}: {
  grandTotal: number;
  draft: PaymentDraft;
  onChange: (next: PaymentDraft) => void;
  /**
   * Both default off, so a billing form offers only the three real tenders.
   * They're switched on for the Record Payment dialog, which is where a bill
   * legitimately gets marked unpaid or written off — that screen exists to
   * change a payment, so the states belong there rather than in front of
   * someone ringing up a sale.
   */
  allowUnpaid?: boolean;
  /** Service only — warranty/goodwill work, which has no counter equivalent. */
  allowFreeService?: boolean;
  errors?: PaymentErrors;
  className?: string;
}) {
  const resolved = resolveDraft(draft, grandTotal);
  const options = [
    ...BASE_OPTIONS,
    ...(allowUnpaid ? [UNPAID_OPTION] : []),
    ...(allowFreeService ? [FREE_SERVICE_OPTION] : []),
  ];

  return (
    <div className={cn("rounded-[14px] border border-neutral-200 bg-white p-4 shadow-sm", className)}>
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm font-bold text-neutral-900">
          <Wallet className="size-4 text-neutral-500" />
          Payment
        </p>
        <span className="text-sm text-neutral-500">
          Bill total <span className="font-semibold text-neutral-900">{formatINR(grandTotal)}</span>
        </span>
      </div>

      {/* One compact row of pills rather than a grid of cards. The counter
          person picks this several times an hour and already knows the five
          choices — big tiles spent vertical space on recognition that isn't
          needed, and gave "Not paid"/"Free" the same visual weight as the
          three tenders that get used all day. */}
      <div role="radiogroup" aria-label="How the customer paid" className="mt-3 flex flex-wrap gap-1.5">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={draft.option === option.value}
            onClick={() => onChange(selectPaymentOption(draft, option.value, grandTotal))}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors",
              "focus-visible:ring-[3px] focus-visible:ring-brand-red/20 focus-visible:outline-none",
              draft.option === option.value
                ? "border-brand-red bg-brand-red/5 text-brand-red"
                : "border-neutral-200 text-neutral-600 hover:border-neutral-300 hover:bg-neutral-50"
            )}
          >
            <option.icon className="size-3.5" />
            {option.label}
          </button>
        ))}
      </div>

      {draft.option === "SPLIT" && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <AmountField
            id="payment-cash"
            label="Cash"
            icon={Banknote}
            value={draft.cash}
            error={errors?.cash}
            onChange={(raw) => onChange(editPaymentField(draft, "cash", raw, grandTotal))}
            onFillBalance={() => onChange(fillBalance(draft, "cash", grandTotal))}
          />
          <AmountField
            id="payment-upi"
            label="UPI"
            icon={Smartphone}
            value={draft.upi}
            error={errors?.upi}
            onChange={(raw) => onChange(editPaymentField(draft, "upi", raw, grandTotal))}
            onFillBalance={() => onChange(fillBalance(draft, "upi", grandTotal))}
          />
        </div>
      )}

      {/* Balance due is a statement of fact, not an error — a customer paying
          part now and the rest on collection is normal at this counter. */}
      {resolved.balanceDue > 0 && draft.option !== "UNPAID" && draft.option !== "FREE_SERVICE" && (
        <p className="mt-3 rounded-[8px] bg-warning/10 px-3 py-2 text-sm font-medium text-neutral-900">
          Balance due <span className="font-bold">{formatINR(resolved.balanceDue)}</span> — this bill will be saved as
          part paid.
        </p>
      )}

      {draft.option === "UNPAID" && (
        <p className="mt-3 text-xs text-warning">This bill will be recorded as payment pending.</p>
      )}

      {draft.option === "FREE_SERVICE" && (
        <p className="mt-3 text-xs text-neutral-500">Nothing to collect — recorded as a free service.</p>
      )}

      {errors?.form && <p className="mt-3 text-sm text-danger">{errors.form}</p>}
    </div>
  );
}

type PaymentOptionSpec = { value: PaymentOption; label: string; icon: LucideIcon };

/** The three tenders every billing screen offers. */
const BASE_OPTIONS: PaymentOptionSpec[] = [
  { value: "CASH", label: "Cash", icon: Banknote },
  { value: "UPI", label: "UPI", icon: Smartphone },
  { value: "SPLIT", label: "Cash + UPI", icon: Split },
];

const UNPAID_OPTION: PaymentOptionSpec = { value: "UNPAID", label: "Not paid", icon: Clock };

const FREE_SERVICE_OPTION: PaymentOptionSpec = { value: "FREE_SERVICE", label: "Free", icon: Gift };

function AmountField({
  id,
  label,
  icon: Icon,
  value,
  error,
  onChange,
  onFillBalance,
}: {
  id: string;
  label: string;
  icon: LucideIcon;
  value: string;
  error?: string;
  onChange: (raw: string) => void;
  onFillBalance: () => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <Label htmlFor={id} className="flex items-center gap-1.5 text-xs font-medium text-neutral-600">
          <Icon className="size-3.5 text-neutral-400" />
          {label}
        </Label>
        {/* Neutral until hovered: two red links shouting "Fill balance" read
            as errors on a card that has none. */}
        <button
          type="button"
          onClick={onFillBalance}
          className="text-[11px] font-medium text-neutral-400 hover:text-brand-red hover:underline focus-visible:underline focus-visible:outline-none"
        >
          Fill balance
        </button>
      </div>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        min={0}
        step="0.01"
        value={value}
        aria-invalid={Boolean(error)}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 h-9 text-sm"
      />
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}
