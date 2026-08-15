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
import { cn } from "@/lib/utils";
import { BrandCombobox } from "@/components/inventory/brand-combobox";
import {
  buildTrackTyreProductName,
  getTrackTyrePosition,
  ITEM_TYPE_OPTIONS,
  TRACK_TYRE_BRAND_NAME,
  TRACK_TYRE_POSITION_OPTIONS,
  type TrackTyrePosition,
} from "@/components/inventory/constants";
import type { BrandRow, InventoryItemRow, ItemDetailsInput } from "@/services/inventory";
import type { ItemType } from "@/types/database.types";

import { uploadInventoryImageAction } from "@/app/(app)/purchases/actions";

type SubmitResult = { success: boolean; error?: string };
const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * Edit Item Details — Purchases-side (doc/inventory-purchase-simplification-
 * scope.md §1.2). Master data only: name, SKU, brand, type, low-stock
 * threshold, photo. Deliberately has NO price fields and NO quantity field
 * — those live on batches (Record Purchase) and adjustStock() respectively,
 * never here.
 */
export function EditItemDetailsDialog({
  open,
  onOpenChange,
  item,
  brands,
  customTypeLabels,
  onCreateBrand,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: InventoryItemRow | null;
  brands: BrandRow[];
  customTypeLabels: string[];
  onCreateBrand: (name: string, itemType: ItemType) => Promise<{ success: boolean; data?: BrandRow; error?: string }>;
  onSubmit: (id: string, input: ItemDetailsInput) => Promise<SubmitResult>;
}) {
  const [itemType, setItemType] = useState<ItemType | "">("");
  const [brandId, setBrandId] = useState("");
  const [productName, setProductName] = useState("");
  const [skuCode, setSkuCode] = useState("");
  const [customTypeLabel, setCustomTypeLabel] = useState("");
  const [trackTyrePosition, setTrackTyrePosition] = useState<TrackTyrePosition | "">("");
  const [lowStockThreshold, setLowStockThreshold] = useState("0");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && item) {
      setItemType(item.itemType);
      setBrandId(item.brandId ?? "");
      setProductName(item.productName);
      setSkuCode(item.skuCode);
      setCustomTypeLabel(item.customTypeLabel ?? "");
      // Legacy pre-split rows (name still just "Track Tyre") resolve to ""
      // here — the admin has to explicitly pick Front or Back once to
      // relabel it, see doc/track-tyre-front-back-split-scope.md §1.4.
      setTrackTyrePosition(item.itemType === "TRACK_TYRE" ? (getTrackTyrePosition(item.productName) ?? "") : "");
      setLowStockThreshold(String(item.lowStockThreshold));
      setImageUrl(item.imageUrl);
      setErrors({});
    }
  }, [open, item]);

  // Product name is derived from Position, never typed, for Track Tyre.
  // Only fires once a position is actually picked — never clobbers the
  // legacy singleton name before that, so it stays visible/readable until
  // then. Declared above the `!item` early return (Rules of Hooks — every
  // hook must run on every render).
  useEffect(() => {
    if (itemType === "TRACK_TYRE" && trackTyrePosition) {
      setProductName(buildTrackTyreProductName(trackTyrePosition));
    }
  }, [itemType, trackTyrePosition]);

  if (!item) return null;
  const currentItem = item;

  const isOtherSparePart = itemType === "OTHER_SPARE_PART";
  const isTrackTyre = itemType === "TRACK_TYRE";
  const brandForTrackTyre = brands.find(
    (b) => b.itemType === "TRACK_TYRE" && b.name.trim().toLowerCase() === TRACK_TYRE_BRAND_NAME.toLowerCase()
  );
  const brandChoices = isTrackTyre
    ? brandForTrackTyre
      ? [brandForTrackTyre]
      : []
    : itemType
      ? brands.filter((b) => b.itemType === itemType)
      : [];

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
    return next;
  }

  async function handleSubmit() {
    const validationErrors = validate();
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) return;

    setIsSubmitting(true);
    const result = await onSubmit(currentItem.id, {
      itemType: itemType as ItemType,
      productName: productName.trim(),
      skuCode: skuCode.trim() || undefined,
      brandId,
      lowStockThreshold: Math.trunc(Number(lowStockThreshold)),
      imageUrl,
      customTypeLabel: isOtherSparePart ? customTypeLabel.trim() : null,
    });
    setIsSubmitting(false);

    if (result.success) {
      onOpenChange(false);
    } else if (result.error) {
      setErrors({ form: result.error });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Item Details</DialogTitle>
          <DialogDescription>
            Name, SKU, brand, type, and low stock threshold only — price comes from batches, stock comes
            from purchases and adjustments.
          </DialogDescription>
        </DialogHeader>

        <fieldset disabled={isSubmitting} className="space-y-4">
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

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Item Type *</Label>
              <Select
                value={itemType || undefined}
                onValueChange={(v) => {
                  setItemType(v as ItemType);
                  setErrors((prev) => ({ ...prev, itemType: "" }));
                }}
              >
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
          </div>

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
              {isTrackTyre ? (
                <>
                  {!trackTyrePosition && (
                    <p className="text-xs text-neutral-400">
                      This item predates the Front/Back split — pick a position to relabel it.
                    </p>
                  )}
                  {errors.trackTyrePosition && <p className="text-sm text-danger">{errors.trackTyrePosition}</p>}
                </>
              ) : (
                errors.productName && <p className="text-sm text-danger">{errors.productName}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>SKU / Code</Label>
              <Input value={skuCode} onChange={(e) => setSkuCode(e.target.value)} />
              <p className="text-xs text-neutral-400">Leave blank to keep the current SKU.</p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Low Stock Threshold *</Label>
            <Input
              type="number"
              step="1"
              min="0"
              className="max-w-[160px]"
              value={lowStockThreshold}
              onChange={(e) => {
                setLowStockThreshold(e.target.value);
                setErrors((prev) => ({ ...prev, lowStockThreshold: "" }));
              }}
            />
            {errors.lowStockThreshold && <p className="text-sm text-danger">{errors.lowStockThreshold}</p>}
          </div>

          {errors.form && <p className="text-sm text-danger">{errors.form}</p>}
        </fieldset>

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? "Saving..." : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
