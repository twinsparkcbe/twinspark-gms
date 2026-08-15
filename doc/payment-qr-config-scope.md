# Payment QR Config — Scope (Step 1: features & use cases)

Confirmed 2026-08-15. Admin configures one active payment destination (QR
image + UPI ID); the public `/order` form displays it read-only above the
payment-screenshot upload. Display only — no validation, no reconciliation,
no link to the order record.

## 1. Confirmed decisions

| Decision | Choice |
| --- | --- |
| QR source | Uploaded image (the client's real GPay/PhonePe merchant QR), not generated from the UPI ID. Amount-embedded generated QR (`upi://pay?...`) is a clean add-on later, not in this pass. |
| Active configs | Many configs, one active — enforced in the DB (partial unique index + `set_active_payment_qr()`), not app code. |
| Write access | Plain RLS-scoped client (`createClient()`), same as Inventory/Purchases — not the service-role admin client (`services/users` needs that only for `auth.admin.*`, which this table has no dependency on). |
| Public read | Anon can read only the single active row; every other row is invisible to an unauthenticated visitor. |
| Delete guard | The currently active config can't be deleted — the admin must activate a different config first. Chosen over silently leaving zero active configs, which would make the payment card vanish from `/order` with no obvious explanation. |
| Order flow impact | None. No changes to online-order payment verification, stock, or dispatch. |

## 2. Data model — `supabase/migrations/0030_payment_qr_config.sql`

```
payment_qr_configs
  id, label            -- e.g. "Twinspark GPay"
  upi_id               -- validated: name@handle
  payee_name
  qr_image_path        -- Supabase Storage (payment-qr-images bucket, public-read)
  is_active boolean
  created_at, updated_at, created_by
```

- Partial unique index on `is_active WHERE is_active` — at most one active
  config.
- `set_active_payment_qr(id)` deactivates every other row and activates the
  target in one statement — never a window with two or zero active rows.
- RLS: admin (via `auth.jwt() ->> role = 'admin'`) full read/write; anon read
  restricted to the active row only. `payment-qr-images` storage bucket is
  public-read, admin-write-only — same shape as `inventory-images`
  (0002_inventory_images.sql).

## 3. Admin module — `/settings/payment`

`moduleKey: "settings"`, Admin-only — same gate as `/settings/users`, added
as a second "Settings / Payment" nav entry alongside "Settings / Users".

Table of configs with an Active badge, plus Add / Edit / Set Active /
Delete. The active row's Delete action is disabled (see §1). The Add/Edit
form validates the UPI ID format and image type/size (reuses the existing
PNG/JPEG/WEBP + 5MB rule from the online-order screenshot upload) and shows
a live preview built from the same `PaymentDetailsCard` component the public
form renders — one markup, so admin preview and customer view can never
drift apart.

Files: `app/(app)/settings/payment/{page,loading,actions}.tsx`,
`components/settings/{payment-config-page-client,payment-config-table,
payment-config-form-dialog,confirm-delete-payment-config-dialog}.tsx`,
`services/payments/{qr-config,schemas,index}.ts`.

## 4. Public form change

`PaymentDetailsCard` (`components/online-orders/payment-details-card.tsx`)
renders directly above the screenshot upload in
`components/online-orders/public-order-form.tsx`: QR image, UPI ID with a
copy button, payee name, and a "scan or pay to this UPI ID, then upload the
screenshot" line.

Fetched server-side in `app/order/page.tsx` (`getActivePaymentQrConfig`) and
passed as a prop into `PublicOrderForm` — not a client action — so it's in
the first paint with no loading state. If no active config exists, the card
is simply absent; the form still works and the screenshot stays required.

## 5. Out of scope (this pass)

- Amount-embedded generated QR codes.
- Any link between a `payment_qr_configs` row and a specific
  `online_orders` row.
- Payment verification/reconciliation against the uploaded screenshot —
  unchanged from the existing manual "Verify Payment" staff workflow.
