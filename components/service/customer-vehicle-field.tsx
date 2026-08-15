"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Bike, User } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { CustomerRow } from "@/services/sales";
import { MOBILE_NUMBER_LENGTH, sanitizeMobileNumber } from "@/services/shared/mobile";
import type { VehicleRow } from "@/services/service";

const MAX_SUGGESTIONS = 8;

/**
 * Customer + Vehicle entry for a Service Job (doc §2). Mirrors Sales'
 * CustomerField pattern (mobile number is the find-or-create key,
 * auto-fill on match) and extends it with a second auto-suggest field for
 * Vehicle Number — picking a suggestion fills model + shows the vehicle's
 * last known odometer reading as a hint. Both lists are fetched once at
 * page load (doc §22 — no per-keystroke network round trip).
 */
export function CustomerVehicleField({
  customerName,
  customerMobile,
  customerAddress,
  vehicleNumber,
  vehicleModel,
  odometerReading,
  customers,
  vehicles,
  onChangeCustomerName,
  onChangeCustomerMobile,
  onChangeCustomerAddress,
  onChangeVehicleNumber,
  onChangeVehicleModel,
  onChangeOdometerReading,
  onVehicleSelected,
  disabled,
  errors,
}: {
  customerName: string;
  customerMobile: string;
  customerAddress: string;
  vehicleNumber: string;
  vehicleModel: string;
  odometerReading: string;
  customers: CustomerRow[];
  vehicles: VehicleRow[];
  onChangeCustomerName: (value: string) => void;
  onChangeCustomerMobile: (value: string) => void;
  onChangeCustomerAddress: (value: string) => void;
  onChangeVehicleNumber: (value: string) => void;
  onChangeVehicleModel: (value: string) => void;
  onChangeOdometerReading: (value: string) => void;
  /** Fired when an existing vehicle is picked from the suggestion list —
   * lets the caller run Pending Job Detection (doc §19). */
  onVehicleSelected?: (vehicle: VehicleRow) => void;
  disabled?: boolean;
  errors: { customerName?: string; customerMobile?: string; vehicleNumber?: string; vehicleModel?: string; odometerReading?: string };
}) {
  const [customerOpen, setCustomerOpen] = useState(false);
  const [vehicleOpen, setVehicleOpen] = useState(false);
  // Chip picker shown when an exact-matched mobile number belongs to a
  // customer with 2+ vehicles on file — staff pick which one, rather than
  // the field guessing (doc §2 addendum: auto-fill vehicle from phone).
  const [multiVehicleChoices, setMultiVehicleChoices] = useState<VehicleRow[]>([]);
  // Tracks the last mobile number we already auto-resolved, so the
  // exact-match effect below doesn't keep re-firing (and re-opening
  // dismissed chips) on every keystroke/rerender once it's handled once.
  const autoResolvedMobileRef = useRef<string | null>(null);
  const customerRef = useRef<HTMLDivElement>(null);
  const vehicleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!customerOpen && !vehicleOpen) return;
    function handlePointerDown(e: PointerEvent) {
      if (customerRef.current && !customerRef.current.contains(e.target as Node)) setCustomerOpen(false);
      if (vehicleRef.current && !vehicleRef.current.contains(e.target as Node)) setVehicleOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [customerOpen, vehicleOpen]);

  // Matches on the mobile number only. This field *is* the mobile number —
  // it can no longer hold letters, so matching customer names off it only
  // ever produced confusing results.
  const customerSuggestions = useMemo(() => {
    const term = customerMobile.trim();
    if (term.length < 2) return [];
    return customers.filter((c) => c.mobileNumber.includes(term)).slice(0, MAX_SUGGESTIONS);
  }, [customers, customerMobile]);

  const vehicleSuggestions = useMemo(() => {
    const term = vehicleNumber.trim().toLowerCase();
    if (term.length < 2) return [];
    return vehicles.filter((v) => v.vehicleNumber.toLowerCase().includes(term)).slice(0, MAX_SUGGESTIONS);
  }, [vehicles, vehicleNumber]);

  /** Fills the Vehicle fields and fires the caller's hook (Pending Job
   * Detection, Last Service lookup) — the one path every vehicle
   * resolution (typed suggestion, phone auto-fill, multi-vehicle chip)
   * funnels through, so those side effects always run. */
  function applyVehicle(vehicle: VehicleRow) {
    onChangeVehicleNumber(vehicle.vehicleNumber);
    onChangeVehicleModel(vehicle.vehicleModel);
    onVehicleSelected?.(vehicle);
  }

  /** Resolves this customer's vehicles (already-loaded `vehicles` prop, no
   * network round trip): exactly one auto-fills it, two or more show a
   * pick-one chip row, zero leaves the Vehicle fields for manual entry. */
  function resolveVehiclesForCustomer(customer: CustomerRow) {
    const matches = vehicles.filter((v) => v.customerId === customer.id);
    if (matches.length === 1) {
      applyVehicle(matches[0]);
      setMultiVehicleChoices([]);
    } else if (matches.length > 1) {
      setMultiVehicleChoices(matches);
    } else {
      setMultiVehicleChoices([]);
    }
  }

  function selectCustomer(customer: CustomerRow) {
    onChangeCustomerName(customer.name);
    onChangeCustomerMobile(customer.mobileNumber);
    onChangeCustomerAddress(customer.address ?? "");
    setCustomerOpen(false);
    autoResolvedMobileRef.current = customer.mobileNumber.trim();
    resolveVehiclesForCustomer(customer);
  }

  function selectVehicle(vehicle: VehicleRow) {
    applyVehicle(vehicle);
    setVehicleOpen(false);
    setMultiVehicleChoices([]);
  }

  // Auto-fill from an exact typed match — covers typing (or pasting) a full
  // number without clicking a suggestion. Guarded by vehicleNumber already
  // being empty so this never clobbers a job that's mid-edit or where the
  // vehicle was already picked/typed manually.
  useEffect(() => {
    const term = customerMobile.trim();
    if (term.length < MOBILE_NUMBER_LENGTH) return;
    if (autoResolvedMobileRef.current === term) return;

    const customer = customers.find((c) => c.mobileNumber.trim() === term);
    if (!customer) return;

    autoResolvedMobileRef.current = term;
    onChangeCustomerName(customer.name);
    onChangeCustomerAddress(customer.address ?? "");
    if (!vehicleNumber.trim()) resolveVehiclesForCustomer(customer);
    // Only the mobile number should re-trigger this — re-running on every
    // vehicleNumber/customers reference change would fight manual typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerMobile]);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div ref={customerRef} className="relative space-y-1.5">
          <Label>Mobile Number *</Label>
          <Input
            type="tel"
            inputMode="numeric"
            autoComplete="off"
            maxLength={MOBILE_NUMBER_LENGTH}
            placeholder="e.g. 9876543210"
            value={customerMobile}
            disabled={disabled}
            aria-invalid={Boolean(errors.customerMobile) || undefined}
            onChange={(e) => {
              // Sanitized here rather than only on submit — the field can
              // never hold a non-digit or an 11th digit, so there's nothing
              // to reject later.
              const value = sanitizeMobileNumber(e.target.value);
              onChangeCustomerMobile(value);
              setCustomerOpen(value.length >= 2);
              setMultiVehicleChoices([]);
            }}
            onFocus={() => customerSuggestions.length > 0 && setCustomerOpen(true)}
            onKeyDown={(e) => e.key === "Escape" && setCustomerOpen(false)}
          />
          {errors.customerMobile && <p className="text-sm text-danger">{errors.customerMobile}</p>}

          {customerOpen && customerSuggestions.length > 0 && (
            <div className="absolute top-full left-0 z-50 mt-1 w-full rounded-md border border-neutral-200 bg-white shadow-md">
              <div className="max-h-56 overflow-y-auto p-1">
                {customerSuggestions.map((customer) => (
                  <button
                    key={customer.id}
                    type="button"
                    onClick={() => selectCustomer(customer)}
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-neutral-100"
                  >
                    <User className="size-4 shrink-0 text-neutral-400" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-neutral-900">{customer.name}</span>
                      <span className="block truncate text-xs text-neutral-500">{customer.mobileNumber}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-1.5">
          <Label>Customer Name *</Label>
          <Input
            placeholder="e.g. Arun Kumar"
            value={customerName}
            disabled={disabled}
            aria-invalid={Boolean(errors.customerName) || undefined}
            onChange={(e) => onChangeCustomerName(e.target.value)}
          />
          {errors.customerName && <p className="text-sm text-danger">{errors.customerName}</p>}
        </div>

        <div className="sm:col-span-2 space-y-1.5">
          <Label>Address (optional)</Label>
          <Input
            placeholder="e.g. 12 Race Course Road, Coimbatore"
            value={customerAddress}
            disabled={disabled}
            onChange={(e) => onChangeCustomerAddress(e.target.value)}
          />
        </div>
      </div>

      {multiVehicleChoices.length > 0 && (
        <div className="rounded-[10px] border border-info/30 bg-info/5 px-3 py-2.5">
          <p className="mb-1.5 text-xs font-medium text-neutral-700">
            This customer has {multiVehicleChoices.length} vehicles on file — select one:
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            {multiVehicleChoices.map((vehicle) => (
              <button
                key={vehicle.id}
                type="button"
                disabled={disabled}
                onClick={() => {
                  applyVehicle(vehicle);
                  setMultiVehicleChoices([]);
                }}
                className="flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3 py-1 text-xs font-medium text-neutral-700 hover:border-primary hover:text-primary"
              >
                <Bike className="size-3.5 text-neutral-400" />
                {vehicle.vehicleNumber} · {vehicle.vehicleModel}
              </button>
            ))}
            <button
              type="button"
              disabled={disabled}
              onClick={() => setMultiVehicleChoices([])}
              className="rounded-full px-3 py-1 text-xs font-medium text-neutral-400 hover:text-neutral-600"
            >
              None of these — new vehicle
            </button>
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <div ref={vehicleRef} className="relative space-y-1.5">
          <Label>Vehicle Number *</Label>
          <Input
            placeholder="e.g. TN37AB1234"
            value={vehicleNumber}
            disabled={disabled}
            aria-invalid={Boolean(errors.vehicleNumber) || undefined}
            onChange={(e) => {
              onChangeVehicleNumber(e.target.value.toUpperCase());
              setVehicleOpen(e.target.value.trim().length >= 2);
              setMultiVehicleChoices([]);
            }}
            onFocus={() => vehicleSuggestions.length > 0 && setVehicleOpen(true)}
            className="uppercase"
          />
          {errors.vehicleNumber && <p className="text-sm text-danger">{errors.vehicleNumber}</p>}

          {vehicleOpen && vehicleSuggestions.length > 0 && (
            <div className="absolute top-full left-0 z-50 mt-1 w-full rounded-md border border-neutral-200 bg-white shadow-md">
              <div className="max-h-56 overflow-y-auto p-1">
                {vehicleSuggestions.map((vehicle) => (
                  <button
                    key={vehicle.id}
                    type="button"
                    onClick={() => selectVehicle(vehicle)}
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-neutral-100"
                  >
                    <Bike className="size-4 shrink-0 text-neutral-400" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-neutral-900">{vehicle.vehicleNumber}</span>
                      <span className="block truncate text-xs text-neutral-500">{vehicle.vehicleModel}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-1.5">
          <Label>Vehicle Model *</Label>
          <Input
            placeholder="e.g. KTM Duke 390"
            value={vehicleModel}
            disabled={disabled}
            aria-invalid={Boolean(errors.vehicleModel) || undefined}
            onChange={(e) => onChangeVehicleModel(e.target.value)}
          />
          {errors.vehicleModel && <p className="text-sm text-danger">{errors.vehicleModel}</p>}
        </div>

        <div className={cn("space-y-1.5")}>
          <Label>Odometer Reading (km) *</Label>
          <Input
            type="number"
            min={0}
            inputMode="numeric"
            placeholder="e.g. 12000"
            value={odometerReading}
            disabled={disabled}
            aria-invalid={Boolean(errors.odometerReading) || undefined}
            onChange={(e) => onChangeOdometerReading(e.target.value)}
          />
          {errors.odometerReading && <p className="text-sm text-danger">{errors.odometerReading}</p>}
        </div>
      </div>
    </div>
  );
}
