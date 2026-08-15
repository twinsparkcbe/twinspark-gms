# Mechanic Role — Scope (Step 1: features & use cases)

Confirmed 2026-08-14. Adds a third role, `mechanic`, to the User & Role
Management module (0020_user_roles_profiles.sql) plus the Service-module access
it implies.

## 1. Confirmed decisions

| Decision | Choice |
| --- | --- |
| DB representation | Real enum value. `user_metadata.role = 'mechanic'` literally — no aliasing to `sales_person`. |
| SQL strategy | Full rollout: shared helper functions + recreate every role-gated function/policy to use them. |
| Service access | Yes — full job lifecycle. Service Catalog stays Admin-only. |
| Payment status on service jobs | Admin only. Mechanic cannot set it. |
| Assigned mechanic on jobs | In scope — new `service_jobs.assigned_mechanic_id`. |

## 2. Access matrix

| Module | Admin | Sales Person | Mechanic |
| --- | --- | --- | --- |
| Dashboard | Yes | No | No |
| Inventory | Yes | No | No |
| Purchases | Yes | No | No |
| Sales (create, return, invoice print) | Yes | Yes | Yes |
| Service — job lifecycle | Yes | No | Yes |
| Service — catalog (packages, specific services, combos) | Yes | No | Read-only (used in pickers) |
| Service — payment status | Yes | No | No |
| Billing / invoice prints | Yes | Yes | Yes |
| Customers — directory + detail | Yes | Yes | Yes |
| Customers — Vehicles tab, Vehicle Detail, Service History | Yes | No | Yes |
| Online Orders (verify, approve, dispatch, reject, labels) | Yes | Yes | Yes |
| Reports | Yes | No | No |
| Settings / User Management | Yes | No | No |

`permissions.ts` moves from a single `SALES_PERSON_BLOCKED` list to a per-role
module map, since the two restricted roles are no longer identical.

## 3. User Management use cases (Settings -> Users)

1. Admin creates a user with role Mechanic (name, email, password, role).
2. Admin edits an existing user's role to/from Mechanic — writes `profiles.role`
   *and* `user_metadata.role`, same dual-write as today.
3. Role filter on the users list gains a "Mechanic" option; role badge renders
   "Mechanic" with its own colour (Admin stays info-blue).
4. Create-user dialog default role stays **Sales Person**.
5. Deactivate / reactivate / reset password for a Mechanic — unchanged flows.
6. Last-active-Admin rule unchanged (Mechanics never satisfy it).
7. Known carry-over: a role change only reaches SQL-level checks when that
   user's JWT next refreshes; app-layer guards (`profiles` read per request)
   are immediate. Same as today's Admin <-> Sales Person switch.

## 4. Service module — Mechanic

**Can:** open `/service` list, create a job (`/service/new`, `/service/intake`),
open job detail, edit job + lines/parts, change status (DRAFT -> IN_PROGRESS ->
READY_FOR_DELIVERY), complete a job (assigns invoice number, deducts stock via
`SERVICE_USAGE`), set delivery status, upload/delete job images, print job card
and service invoice, open Vehicle Detail and a customer's Service History, use
`escalate_sale_to_service` from Sales.

**Cannot:** create/edit/delete service packages, specific services or combo
offers (`/service/catalog` stays `requireAdmin`); set payment status; see
Reports, Dashboard, Inventory, Purchases, Settings; read `stock_movements`.

## 5. Assigned mechanic on service jobs

- New nullable column `service_jobs.assigned_mechanic_id uuid references profiles(id)`.
- Set on intake/new and editable on edit; picker lists **active users with role
  `mechanic`**, plus an explicit "Unassigned" option.
- Informational, **not** an access gate — any Mechanic can open any job.
- Both Admin and Mechanic can change the assignment.
- Service list: "Assigned to" column + filter. For a logged-in Mechanic the list
  defaults to "My jobs" (toggleable to All).
- Job card print shows the assigned mechanic's name.
- A deactivated user's historical assignments still display; the picker excludes
  them.
- Out of scope: mechanic-wise performance/productivity reporting.

## 6. SQL rollout

Two migration files — `alter type ... add value` cannot be used in the same
transaction that references the new literal.

**0025_mechanic_role_enum.sql** — `alter type public.user_role add value 'mechanic';`

**0026_mechanic_access.sql**
- Helpers: `public.jwt_role()`, `public.is_admin()`, `public.has_sales_access()`
  (admin | sales_person | mechanic), `public.has_service_access()` (admin | mechanic).
- Add `service_jobs.assigned_mechanic_id` + index.
- Recreate, bodies copied verbatim with only the guard line changed:
  - Sales/stock/online orders: `adjust_stock` (0013 version), `record_sale` (0024),
    `record_sale_return`, `undo_sale_return`, `update_sales_payment_status`,
    `escalate_sale_to_service`, `verify_online_order_payment`,
    `approve_online_order`, `dispatch_online_order`, `reject_online_order`.
  - Service: `create_service_job`, `replace_service_job_lines` (0022 version),
    `update_service_job`, `update_service_job_status`, `complete_service_job`,
    `update_service_delivery_status`. `update_service_payment_status` stays
    Admin-only. `adjust_stock`'s `SERVICE_USAGE` branch opens to Mechanic;
    `PURCHASE` / `MANUAL_CORRECTION` / `DAMAGE` stay Admin-only.
- Recreate policies: `customers_read`, `sales_read`, `sale_items_read`,
  `online_orders_staff_read`, online-order screenshot storage select, combo read
  policies (0021), `vehicles_admin_select`, `service_jobs` /
  `service_job_lines` / `service_inventory_usage` / `service_job_events` /
  `service_job_images` selects, `service_job_images` insert+delete, service-job
  image storage policies, service catalog **select** policies (0016/0017).
- Unchanged (Admin-only): catalog write functions (0017), `delete_*` (0023),
  inventory/purchase policies, `stock_movements_admin_select`, `profiles`.

## 7. App-layer changes

- `types/database.types.ts`: `UserRoleEnum`, `profiles` rows, `service_jobs.assigned_mechanic_id`.
- `lib/auth/permissions.ts`: per-role module map.
- New `lib/auth/require-service-access.ts` (Admin + Mechanic); every
  `app/(app)/service/**` page/action switches from `requireAdmin` except
  `/service/catalog`. `app/(app)/customers/vehicles/[id]` switches too.
- `customer-vehicle-visibility.ts`: vehicles tab/section + service history true
  for Admin and Mechanic.
- `app/page.tsx` post-login landing: admin -> `/dashboard`, sales_person ->
  `/sales`, mechanic -> `/service`. `requireAdmin`'s non-admin redirect follows
  the same rule.
- `getSessionAccess()` fail-closed fallback stays `sales_person` (most restrictive).
- `services/users/schemas.ts` + `users.ts`; `components/users/*` (badge, filters,
  form dialog).
- Service UI: payment-status control hidden for Mechanic; assigned-mechanic
  picker; "My jobs" filter.

## 8. Out of scope

Mechanic access to Dashboard/Reports/Inventory/Purchases; mechanic performance
reports; attendance/payroll; notifications; changing what Sales Person can do.
