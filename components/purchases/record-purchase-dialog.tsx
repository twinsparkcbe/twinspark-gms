"use client";

import { useEffect, useRef, useState } from "react";
import { ImageOff, Loader2, Upload, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
// Runtime imports from Inventory's leaf modules (not the "@/services/inventory"
// barrel, which also re-exports server-only files) — mirrors the pattern
// already used by item-picker-combobox.tsx / purchase-return-dialog.tsx.
import { BrandCombobox } from "@/components/inventory/brand-combobox";
import {
  buildTrackTyreProductName,
  ITEM_TYPE_OPTIONS,
  TRACK_TYRE_BRAND_NAME,
  TRACK_TYRE_POSITION_OPTIONS,
  type TrackTyrePosition,
} from "@/components/inventory/constants";
import type { BrandRow, InventoryItemRow } from "@/services/inventory";
import type { NewItemWithPurchaseInput, PurchaseEntryInput } from "@/services/purchases";
import type { ItemType } from "@/types/database.types";

import { uploadInventoryImageAction } from "@/app/(app)/purchases/actions";

import { ItemPickerCombobox } from "./item-picker-combobox";

type Mode = "existing" | "new";
type SubmitResult = { success: boolean; error?: string };

const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function todayDateInputValue(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60 * 1000).toISOString().slice(0, 10);
}

export function RecordPurchaseDialog({
  open,
  onOpenChange,
  items,
  brands,
  customTypeLabels,
  preselectItemId = null,
  onCreateBrand,
  onFetchActiveTrackTyreItem,
  onFetchLatestSupplier,
  onSubmitExisting,
  onSubmitNewItem,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: InventoryItemRow[];
  /** Opens straight into Existing Item mode with this item already chosen —
   * used by Inventory's reorder cards, so "I'm out of this" goes directly to
   * "restock this" without hunting through the picker again. Ignored if the
   * id isn't in `items` (e.g. the item was deactivated in another tab). */
  preselectItemId?: string | null;
  brands: BrandRow[];
  customTypeLabels: string[];
  onCreateBrand: (name: string, itemType: ItemType) => Promise<{ success: boolean; data?: BrandRow; error?: string }>;
  onFetchActiveTrackTyreItem: (productName: string) => Promise<InventoryItemRow | null>;
  onFetchLatestSupplier: (inventoryItemId: string) => Promise<string | null>;
  onSubmitExisting: (input: PurchaseEntryInput) => Promise<SubmitResult>;
  onSubmitNewItem: (input: NewItemWithPurchaseInput) => Promise<SubmitResult>;
}) {
  const [mode, setMode] = useState<Mode>("existing");

  // Existing Item mode
  const [itemId, setItemId] = useState<string | null>(null);

  // New Item mode — item master fields
  const [itemType, setItemType] = useState<ItemType | "">("");
  const [brandId, setBrandId] = useState("");
  const [productName, setProductName] = useState("");
  const [skuCode, setSkuCode] = useState("");
  const [customTypeLabel, setCustomTypeLabel] = useState("");
  const [trackTyrePosition, setTrackTyrePosition] = useState<TrackTyrePosition | "">("");
  const [lowStockThreshold, setLowStockThreshold] = useState("5");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [existingTrackTyreItem, setExistingTrackTyreItem] = useState<InventoryItemRow | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Shared batch fields (both modes)
  const [quantity, setQuantity] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [sellingPrice, setSellingPrice] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(todayDateInputValue());
  const [supplierName, setSupplierName] = useState("");
  const [note, setNote] = useState("");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function resetAll() {
    setMode("existing");
    setItemId(null);
    setItemType("");
    setBrandId("");
    setProductName("");
    setSkuCode("");
    setCustomTypeLabel("");
    setTrackTyrePosition("");
    setLowStockThreshold("5");
    setImageUrl(null);
    setExistingTrackTyreItem(null);
    setQuantity("");
    setUnitPrice("");
    setSellingPrice("");
    setPurchaseDate(todayDateInputValue());
    setSupplierName("");
    setNote("");
    setErrors({});
  }

  useEffect(() => {
    if (!open) return;
    resetAll();

    // Both setters run in the same batch, so this lands after resetAll's
    // setItemId(null) rather than being overwritten by it. Setting itemId
    // also triggers the prefill effect below, so unit/selling price and the
    // last supplier fill in exactly as if the item had been picked by hand.
    if (preselectItemId && items.some((i) => i.id === preselectItemId)) {
      setMode("existing");
      setItemId(preselectItemId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Existing Item mode: prefill the batch fields from what was last recorded
  // for this item, so re-purchasing something already stocked doesn't mean
  // retyping numbers that usually haven't changed — all three stay editable.
  // Purchase/selling price come straight off the already-loaded
  // InventoryItemRow (its purchasePrice/sellingPrice are auto-synced to the
  // latest batch), so those fill in instantly; supplier name isn't tracked
  // on the item, so it's fetched separately.
  useEffect(() => {
    if (mode !== "existing" || !itemId) return;
    const item = items.find((i) => i.id === itemId);
    if (item) {
      setUnitPrice(String(item.purchasePrice));
      setSellingPrice(String(item.sellingPrice));
    }
    let cancelled = false;
    onFetchLatestSupplier(itemId).then((supplier) => {
      if (!cancelled) setSupplierName(supplier ?? "");
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, itemId]);

  const selectedItem = items.find((i) => i.id === itemId) ?? null;
  const quantityNum = Math.trunc(Number(quantity) || 0);
  const unitPriceNum = Number(unitPrice) || 0;
  const sellingPriceNum = Number(sellingPrice) || 0;
  const totalAmount = quantityNum > 0 && unitPriceNum > 0 ? quantityNum * unitPriceNum : 0;

  const isOtherSparePart = itemType === "OTHER_SPARE_PART";
  const isTrackTyre = itemType === "TRACK_TYRE";

  // Track Tyre Front and Back are each their own singleton (same rule as
  // the old Inventory Add Item flow, now scoped per position) — check for
  // an existing active item matching the picked position whenever New Item
  // + Track Tyre + a position is selected, so Save adds a batch to it
  // instead of creating a duplicate. An active Front never blocks Back.
  useEffect(() => {
    if (mode !== "new" || !isTrackTyre || !trackTyrePosition) {
      setExistingTrackTyreItem(null);
      return;
    }
    let cancelled = false;
    onFetchActiveTrackTyreItem(buildTrackTyreProductName(trackTyrePosition)).then((found) => {
      if (!cancelled) setExistingTrackTyreItem(found);
    });
    return () => {
      cancelled = true;
    };
  }, [mode, isTrackTyre, trackTyrePosition, onFetchActiveTrackTyreItem]);

  const brandForTrackTyre = brands.find(
    (b) => b.itemType === "TRACK_TYRE" && b.name.trim().toLowerCase() === TRACK_TYRE_BRAND_NAME.toLowerCase()
  );
  useEffect(() => {
    if (isTrackTyre && brandForTrackTyre && brandId !== brandForTrackTyre.id) {
      setBrandId(brandForTrackTyre.id);
    } else if (!isTrackTyre && brandForTrackTyre && brandId === brandForTrackTyre.id) {
      setBrandId("");
    }
  }, [isTrackTyre, brandForTrackTyre, brandId]);
  // Product name is derived from Position, never typed, for Track Tyre.
  useEffect(() => {
    if (isTrackTyre) {
      setProductName(trackTyrePosition ? buildTrackTyreProductName(trackTyrePosition) : "");
    }
  }, [isTrackTyre, trackTyrePosition]);
  useEffect(() => {
    if (!isOtherSparePart) setCustomTypeLabel("");
  }, [isOtherSparePart]);

  const brandChoices = isTrackTyre
    ? brandForTrackTyre
      ? [brandForTrackTyre]
      : []
    : itemType
      ? brands.filter((b) => b.itemType === itemType)
      : [];

  function handleItemTypeChange(next: ItemType) {
    setItemType(next);
    setBrandId("");
    setProductName("");
    setSkuCode("");
    setCustomTypeLabel("");
    setTrackTyrePosition("");
    setExistingTrackTyreItem(null);
    setErrors((prev) => ({
      ...prev,
      itemType: "",
      brandId: "",
      productName: "",
      customTypeLabel: "",
      trackTyrePosition: "",
    }));
  }

  async function processFile(file: File) {
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      toast.error("Only PNG, JPEG, or WEBP images are allowed.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      toast.error("Image must be 5MB or smaller.");
      return;
    }
    setIsUploadingImage(true);
    const formData = new FormData();
    formData.append("file", file);
    const result = await uploadInventoryImageAction(formData);
    setIsUploadingImage(false);
    if (result.success) {
      setImageUrl(result.data.url);
    } else {
      toast.error(result.error);
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) void processFile(file);
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDraggingOver(false);
    if (isUploadingImage) return;
    const file = e.dataTransfer.files?.[0];
    if (file) void processFile(file);
  }

  function validate(): Record<string, string> {
    const next: Record<string, string> = {};

    if (mode === "existing") {
      if (!itemId) next.itemId = "Select an item";
    } else if (!existingTrackTyreItem) {
      if (!itemType) next.itemType = "Select an item type";
      if (!brandId) next.brandId = "Select or create a brand";
      if (isTrackTyre) {
        if (!trackTyrePosition) next.trackTyrePosition = "Select Front or Back";
      } else if (!productName.trim()) {
        next.productName = "Product name is required";
      }
      if (isOtherSparePart && !customTypeLabel.trim()) next.customTypeLabel = "Specify what this item is";
      const thresholdNum = Math.trunc(Number(lowStockThreshold));
      if (!lowStockThreshold.trim() || Number.isNaN(thresholdNum) || thresholdNum < 0) {
        next.lowStockThreshold = "Low stock threshold cannot be negative";
      }
    }

    if (quantityNum <= 0) next.quantity = "Quantity must be greater than 0";
    if (unitPriceNum <= 0) next.unitPrice = "Purchase price must be greater than 0";
    if (sellingPriceNum <= 0) next.sellingPrice = "Selling price must be greater than 0";
    if (!purchaseDate) next.purchaseDate = "Purchase date is required";
    else if (new Date(purchaseDate).getTime() > Date.now()) next.purchaseDate = "Purchase date cannot be in the future";

    return next;
  }

  async function handleSubmit() {
    const validationErrors = validate();
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) return;

    setIsSubmitting(true);

    const batchFields = {
      quantity: quantityNum,
      unitPrice: unitPriceNum,
      sellingPrice: sellingPriceNum,
      purchaseDate: new Date(purchaseDate),
      supplierName: supplierName.trim() || undefined,
      note: note.trim() || undefined,
    };

    let result: SubmitResult;
    if (mode === "existing") {
      result = await onSubmitExisting({ inventoryItemId: itemId as string, ...batchFields });
    } else if (existingTrackTyreItem) {
      // Track Tyre singleton already exists — add a batch to it instead of
      // creating a duplicate item (same rule as the old Add Item flow).
      result = await onSubmitExisting({ inventoryItemId: existingTrackTyreItem.id, ...batchFields });
    } else {
      result = await onSubmitNewItem({
        itemType: itemType as ItemType,
        productName: productName.trim(),
        skuCode: skuCode.trim() || undefined,
        brandId,
        lowStockThreshold: Math.trunc(Number(lowStockThreshold)),
        imageUrl,
        customTypeLabel: isOtherSparePart ? customTypeLabel.trim() : null,
        ...batchFields,
      });
    }

    setIsSubmitting(false);
    if (result.success) {
      onOpenChange(false);
    } else if (result.error) {
      setErrors({ form: result.error });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Record Purchase</DialogTitle>
          <DialogDescription>
            Record stock bought from a supplier. Purchases is the only place inventory items and prices
            are created and managed.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-1 rounded-[10px] bg-neutral-100 p-1">
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => setMode("existing")}
            className={cn(
              "flex-1 rounded-[8px] py-1.5 text-sm font-medium transition-colors",
              mode === "existing" ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500"
            )}
          >
            Existing Item
          </button>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => setMode("new")}
            className={cn(
              "flex-1 rounded-[8px] py-1.5 text-sm font-medium transition-colors",
              mode === "new" ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500"
            )}
          >
            New Item
          </button>
        </div>

        <fieldset disabled={isSubmitting} className="space-y-4">
          {mode === "existing" ? (
            <div className="space-y-1.5">
              <Label>Item *</Label>
              <ItemPickerCombobox items={items} value={itemId} onChange={setItemId} hasError={Boolean(errors.itemId)} />
              {errors.itemId && <p className="text-sm text-danger">{errors.itemId}</p>}
              {selectedItem && (
                <p className="text-xs text-neutral-400">
                  Current stock: {selectedItem.availableQuantity} · Last cost: {selectedItem.purchasePrice}
                </p>
              )}
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label>Product Photo</Label>
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (!isUploadingImage) setIsDraggingOver(true);
                  }}
                  onDragLeave={() => setIsDraggingOver(false)}
                  onDrop={handleDrop}
                  className={cn(
                    "flex items-center gap-3 rounded-[10px] border border-dashed p-2 transition-colors",
                    isDraggingOver ? "border-brand-red bg-brand-red/5" : "border-transparent"
                  )}
                >
                  <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-[10px] border border-neutral-200 bg-neutral-50">
                    {isUploadingImage ? (
                      <Loader2 className="size-5 animate-spin text-neutral-400" />
                    ) : imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- dynamic Supabase Storage URL
                      <img src={imageUrl} alt="" className="size-full object-cover" />
                    ) : (
                      <ImageOff className="size-5 text-neutral-300" />
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isUploadingImage}
                    >
                      <Upload className="size-4" />
                      {imageUrl ? "Replace" : "Upload"}
                    </Button>
                    {imageUrl && (
                      <Button type="button" variant="ghost" size="sm" onClick={() => setImageUrl(null)}>
                        <X className="size-4" />
                        Remove
                      </Button>
                    )}
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={handleFileChange}
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label>Item Type *</Label>
                  <Select value={itemType || undefined} onValueChange={(v) => handleItemTypeChange(v as ItemType)}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select an item type" />
                    </SelectTrigger>
                    <SelectContent>
                      {ITEM_TYPE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {errors.itemType && <p className="text-sm text-danger">{errors.itemType}</p>}
                </div>

                <div className="space-y-1.5">
                  <Label>Brand *</Label>
                  <BrandCombobox
                    brands={brandChoices}
                    value={brandId || null}
                    onChange={(id) => {
                      setBrandId(id);
                      setErrors((prev) => ({ ...prev, brandId: "" }));
                    }}
                    onCreateBrand={(name) => onCreateBrand(name, itemType as ItemType)}
                    hasError={Boolean(errors.brandId)}
                    disabled={!itemType || (isTrackTyre && Boolean(brandForTrackTyre))}
                  />
                  {isTrackTyre ? (
                    <p className="text-xs text-neutral-400">Track Tyres use a single shared brand.</p>
                  ) : (
                    errors.brandId && <p className="text-sm text-danger">{errors.brandId}</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label>Low Stock Threshold *</Label>
                  <Input
                    type="number"
                    step="1"
                    min="0"
                    value={lowStockThreshold}
                    onChange={(e) => {
                      setLowStockThreshold(e.target.value);
                      setErrors((prev) => ({ ...prev, lowStockThreshold: "" }));
                    }}
                  />
                  {errors.lowStockThreshold && <p className="text-sm text-danger">{errors.lowStockThreshold}</p>}
                </div>
              </div>

              {isTrackTyre && existingTrackTyreItem && (
                <div className="rounded-md bg-neutral-50 px-3 py-2 text-sm text-neutral-600">
                  A Track Tyre - {trackTyrePosition} item already exists (SKU: {existingTrackTyreItem.skuCode}) —
                  saving will add this as a new batch on that item instead of creating a duplicate.
                </div>
              )}

              {isOtherSparePart && (
                <div className="space-y-1.5">
                  <Label>Specify Type *</Label>
                  <Combobox
                    options={customTypeLabels.map((label) => ({ value: label, label }))}
                    value={customTypeLabel || null}
                    onChange={(label) => {
                      setCustomTypeLabel(label ?? "");
                      setErrors((prev) => ({ ...prev, customTypeLabel: "" }));
                    }}
                    onCreate={async (label) => ({ success: true, value: label })}
                    placeholder="Search or add a type (e.g. Seat Cover)..."
                    emptyText="No matching types."
                    createLabel={(query) => `Add "${query}"`}
                    hasError={Boolean(errors.customTypeLabel)}
                  />
                  {errors.customTypeLabel && <p className="text-sm text-danger">{errors.customTypeLabel}</p>}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>{isTrackTyre ? "Position *" : "Product Name *"}</Label>
                  {isTrackTyre ? (
                    <Select
                      value={trackTyrePosition || undefined}
                      onValueChange={(v) => {
                        setTrackTyrePosition(v as TrackTyrePosition);
                        setErrors((prev) => ({ ...prev, trackTyrePosition: "" }));
                      }}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select Front or Back" />
                      </SelectTrigger>
                      <SelectContent>
                        {TRACK_TYRE_POSITION_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      value={productName}
                      onChange={(e) => {
                        setProductName(e.target.value);
                        setErrors((prev) => ({ ...prev, productName: "" }));
                      }}
                    />
                  )}
                  {isTrackTyre
                    ? errors.trackTyrePosition && <p className="text-sm text-danger">{errors.trackTyrePosition}</p>
                    : errors.productName && <p className="text-sm text-danger">{errors.productName}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label>SKU / Code</Label>
                  <Input
                    placeholder="Leave blank to auto-generate"
                    disabled={Boolean(existingTrackTyreItem)}
                    value={skuCode}
                    onChange={(e) => setSkuCode(e.target.value)}
                  />
                </div>
              </div>
            </>
          )}

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Quantity *</Label>
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                placeholder="e.g. 50"
                value={quantity}
                onChange={(e) => {
                  setQuantity(e.target.value);
                  setErrors((prev) => ({ ...prev, quantity: "" }));
                }}
              />
              {errors.quantity && <p className="text-sm text-danger">{errors.quantity}</p>}
            </div>

            <div className="space-y-1.5">
              <Label>Purchase Price / Unit *</Label>
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                placeholder="e.g. 1250"
                value={unitPrice}
                onChange={(e) => {
                  setUnitPrice(e.target.value);
                  setErrors((prev) => ({ ...prev, unitPrice: "" }));
                }}
              />
              {errors.unitPrice && <p className="text-sm text-danger">{errors.unitPrice}</p>}
            </div>

            <div className="space-y-1.5">
              <Label>Selling Price / Unit *</Label>
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                placeholder="e.g. 1450"
                value={sellingPrice}
                onChange={(e) => {
                  setSellingPrice(e.target.value);
                  setErrors((prev) => ({ ...prev, sellingPrice: "" }));
                }}
              />
              {errors.sellingPrice && <p className="text-sm text-danger">{errors.sellingPrice}</p>}
            </div>
          </div>
          <p className="-mt-2 text-xs text-neutral-400">
            Selling price is what this batch sells for. Every batch has its own price — older stock keeps
            whatever it was priced at.
          </p>

          {totalAmount > 0 && (
            <div className="flex items-center justify-between rounded-md bg-neutral-50 px-3 py-2">
              <span className="text-sm text-neutral-600">Total Purchase Amount</span>
              <span className="font-mono text-sm font-bold text-neutral-900">
                {totalAmount.toLocaleString("en-IN", { style: "currency", currency: "INR" })}
              </span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Purchase Date *</Label>
              <Input
                type="date"
                max={todayDateInputValue()}
                value={purchaseDate}
                onChange={(e) => {
                  setPurchaseDate(e.target.value);
                  setErrors((prev) => ({ ...prev, purchaseDate: "" }));
                }}
              />
              {errors.purchaseDate && <p className="text-sm text-danger">{errors.purchaseDate}</p>}
            </div>

            <div className="space-y-1.5">
              <Label>Supplier Name (optional)</Label>
              <Input
                placeholder="e.g. ABC Tyre Distributors"
                value={supplierName}
                onChange={(e) => setSupplierName(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Note (optional)</Label>
            <Textarea
              placeholder="e.g. Bulk order, discounted rate"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          {errors.form && <p className="text-sm text-danger">{errors.form}</p>}
        </fieldset>

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? "Recording..." : "Record Purchase"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
