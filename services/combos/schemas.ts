import { z } from "zod";

/**
 * Combo Offers — input validation (doc/service-combo-offers-plan.md).
 *
 * Shared by Service and Sales: a combo is defined once and sold from either
 * module, so nothing here is service- or sales-specific.
 */

export const COMBO_COMPONENT_TYPES = ["PACKAGE", "SPECIFIC", "ITEM"] as const;
export const COMBO_COMPONENT_PRICING = ["INCLUDED", "EXTRA"] as const;

export type ComboComponentType = (typeof COMBO_COMPONENT_TYPES)[number];
export type ComboComponentPricing = (typeof COMBO_COMPONENT_PRICING)[number];

/**
 * One thing inside a combo. `superRefine` rather than `discriminatedUnion`
 * for the same reason as `serviceJobLineInputSchema`: three shapes on one
 * flat object, matching how the form holds it.
 *
 * `pricing` is the field that makes a combo a combo — INCLUDED means the
 * component leaves stock but adds nothing to the bill, because combo_price
 * already covers it.
 */
export const comboComponentInputSchema = z
  .object({
    componentType: z.enum(COMBO_COMPONENT_TYPES),
    generalServicePackageId: z.string().uuid().optional(),
    specificServiceId: z.string().uuid().optional(),
    inventoryItemId: z.string().uuid().optional(),
    quantity: z.coerce.number().int("Quantity must be a whole number").positive("Quantity must be greater than 0").default(1),
    pricing: z.enum(COMBO_COMPONENT_PRICING).default("INCLUDED"),
  })
  .superRefine((component, ctx) => {
    const refs = {
      PACKAGE: component.generalServicePackageId,
      SPECIFIC: component.specificServiceId,
      ITEM: component.inventoryItemId,
    } as const;

    if (!refs[component.componentType]) {
      const path = component.componentType === "PACKAGE" ? "generalServicePackageId" : component.componentType === "SPECIFIC" ? "specificServiceId" : "inventoryItemId";
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message: "Select what this component is" });
    }

    // Exactly one reference — two set would make the row ambiguous, and the
    // DB check constraint would reject it with a far less readable message.
    const setCount = Object.values(refs).filter(Boolean).length;
    if (setCount > 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["componentType"], message: "A component can only be one thing" });
    }
  });

export type ComboComponentInput = z.infer<typeof comboComponentInputSchema>;

/** Accepts `YYYY-MM-DD` from a date input, or nothing. */
const optionalDate = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value ? value : undefined))
  .refine((value) => value === undefined || /^\d{4}-\d{2}-\d{2}$/.test(value), { message: "Enter a valid date" });

export const comboInputSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(150),
    description: z.string().trim().max(500).optional(),
    comboPrice: z.coerce.number().min(0, "Combo price must be zero or greater"),
    validFrom: optionalDate,
    validTo: optionalDate,
    // A combo with nothing in it would charge a price for nothing.
    components: z.array(comboComponentInputSchema).min(1, "Add at least one service or part to the combo"),
  })
  .superRefine((combo, ctx) => {
    if (combo.validFrom && combo.validTo && combo.validTo < combo.validFrom) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["validTo"], message: "The end date can't be before the start date" });
    }
  });

export type ComboInput = z.infer<typeof comboInputSchema>;

export const comboDuplicateInputSchema = z.object({
  comboId: z.string().uuid(),
  newName: z.string().trim().min(1, "Name is required").max(150),
});

export type ComboDuplicateInput = z.infer<typeof comboDuplicateInputSchema>;

/**
 * Folds repeats of the same product into one component with summed quantity.
 * The DB enforces one row per referenced thing (partial unique indexes), so
 * without this a second "Engine Oil" would fail the insert rather than doing
 * the obvious thing.
 */
export function mergeDuplicateComponents(components: ComboComponentInput[]): ComboComponentInput[] {
  const merged: ComboComponentInput[] = [];

  for (const component of components) {
    const refId = component.generalServicePackageId ?? component.specificServiceId ?? component.inventoryItemId;
    const existing = merged.find(
      (m) => m.componentType === component.componentType && (m.generalServicePackageId ?? m.specificServiceId ?? m.inventoryItemId) === refId
    );

    if (existing) {
      existing.quantity += component.quantity;
      // A component billed as EXTRA anywhere stays EXTRA — quietly folding it
      // into an INCLUDED row would silently stop charging for it.
      if (component.pricing === "EXTRA") existing.pricing = "EXTRA";
    } else {
      merged.push({ ...component });
    }
  }

  return merged;
}
