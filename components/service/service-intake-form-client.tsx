"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Bike, FileText, StickyNote } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useGlobalLoader } from "@/components/shared/global-loader";
import type { CustomerRow } from "@/services/sales";
import { MOBILE_NUMBER_ERROR, isValidMobileNumber } from "@/services/shared/mobile";
import type { LastServiceSummary, ServiceJobInput, ServiceJobRow, VehicleRow } from "@/services/service";

import {
  createServiceJobIntakeAction,
  fetchLastCompletedServiceForVehicleAction,
  findActiveServiceJobsForVehicleAction,
} from "@/app/(app)/service/actions";

import { CustomerVehicleField } from "./customer-vehicle-field";
import { LastServiceHint } from "./last-service-hint";
import { PendingJobBanner } from "./pending-job-banner";

const COMMON_COMPLAINTS = ["Engine Noise", "Brake Issue", "Starting Problem", "Mileage Drop", "Chain Noise"];

/**
 * Quick Intake (doc §21) — the optional, ~10-second log for the moment a
 * bike is dropped off: just enough to not lose track of it (who, which
 * bike, what they said is wrong), nothing about the work itself. The
 * advisor fills in what actually got done later, either from the Edit
 * screen or straight into Complete & Bill on this same job (doc §21's
 * "Service-First, Billing-Later"). Deliberately its own lightweight screen
 * rather than a stripped-down mode of the full New Service Job form, so
 * staff aren't scrolling past sections they can't fill in yet.
 */
export function ServiceIntakeFormClient({ customers, vehicles }: { customers: CustomerRow[]; vehicles: VehicleRow[] }) {
  const router = useRouter();

  const [customerName, setCustomerName] = useState("");
  const [customerMobile, setCustomerMobile] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [vehicleNumber, setVehicleNumber] = useState("");
  const [vehicleModel, setVehicleModel] = useState("");
  const [odometerReading, setOdometerReading] = useState("");
  const [complaintNotes, setComplaintNotes] = useState("");
  const [pendingJobs, setPendingJobs] = useState<ServiceJobRow[]>([]);
  const [lastService, setLastService] = useState<LastServiceSummary | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<{
    customerName?: string;
    customerMobile?: string;
    vehicleNumber?: string;
    vehicleModel?: string;
    odometerReading?: string;
    form?: string;
  }>({});
  const { runWithLoader } = useGlobalLoader();

  async function handleVehicleSelected(vehicle: VehicleRow) {
    const [pendingResult, lastServiceResult] = await Promise.all([
      findActiveServiceJobsForVehicleAction(vehicle.id),
      fetchLastCompletedServiceForVehicleAction(vehicle.id),
    ]);
    if (pendingResult.success) setPendingJobs(pendingResult.data);
    setLastService(lastServiceResult.success ? lastServiceResult.data : null);
  }

  function validate(): boolean {
    const next: typeof errors = {};
    if (!customerName.trim()) next.customerName = "Customer name is required.";
    if (!isValidMobileNumber(customerMobile)) next.customerMobile = MOBILE_NUMBER_ERROR;
    if (!vehicleNumber.trim()) next.vehicleNumber = "Vehicle number is required.";
    if (!vehicleModel.trim()) next.vehicleModel = "Vehicle model is required.";
    if (odometerReading.trim() === "" || Number(odometerReading) < 0) next.odometerReading = "Enter a valid odometer reading.";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit() {
    if (!validate()) return;

    const input: ServiceJobInput = {
      customerName: customerName.trim(),
      customerMobile: customerMobile.trim(),
      customerAddress: customerAddress.trim() || undefined,
      vehicleNumber: vehicleNumber.trim(),
      vehicleModel: vehicleModel.trim(),
      odometerReading: Math.trunc(Number(odometerReading) || 0),
      complaintNotes: complaintNotes.trim() || undefined,
      gstApplicable: false,
      gstAmount: 0,
      discountApplicable: false,
      discountAmount: 0,
      lines: [],
      usage: [],
    };

    setIsSubmitting(true);
    const result = await runWithLoader(() => createServiceJobIntakeAction(input));
    setIsSubmitting(false);

    if (result.success) {
      toast.success(`${result.data.jobNumber} logged — ${result.data.vehicleNumber} accepted for service.`);
      router.push(`/service/${result.data.id}`);
    } else {
      setErrors((prev) => ({ ...prev, form: result.error }));
      toast.error(result.error);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Button asChild variant="secondary" size="sm" className="rounded-[10px]">
        <Link href="/service">
          <ArrowLeft className="size-4" />
          Back to Service
        </Link>
      </Button>

      <div className="flex items-start justify-between gap-2.5">
        <div className="flex items-start gap-2.5">
          <Bike className="mt-1 size-6 shrink-0 text-primary" />
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-neutral-900">Accept Vehicle</h1>
            <p className="mt-1 text-sm text-neutral-500">
              Just enough to log the bike as it comes in. Add the services, parts, and bill once the work is actually done.
            </p>
          </div>
        </div>
        <Link href="/service/new" className="mt-2 shrink-0 text-sm font-medium text-primary hover:underline">
          Enter full details now
        </Link>
      </div>

      <fieldset disabled={isSubmitting} className="space-y-6">
        <div className="rounded-[14px] border border-neutral-200 bg-white p-4 shadow-sm">
          <CustomerVehicleField
            customerName={customerName}
            customerMobile={customerMobile}
            customerAddress={customerAddress}
            vehicleNumber={vehicleNumber}
            vehicleModel={vehicleModel}
            odometerReading={odometerReading}
            customers={customers}
            vehicles={vehicles}
            onChangeCustomerName={(v) => {
              setCustomerName(v);
              setErrors((prev) => ({ ...prev, customerName: undefined }));
            }}
            onChangeCustomerMobile={(v) => {
              setCustomerMobile(v);
              setErrors((prev) => ({ ...prev, customerMobile: undefined }));
            }}
            onChangeCustomerAddress={setCustomerAddress}
            onChangeVehicleNumber={(v) => {
              setVehicleNumber(v);
              setErrors((prev) => ({ ...prev, vehicleNumber: undefined }));
              setPendingJobs([]);
              setLastService(null);
            }}
            onChangeVehicleModel={(v) => {
              setVehicleModel(v);
              setErrors((prev) => ({ ...prev, vehicleModel: undefined }));
            }}
            onChangeOdometerReading={(v) => {
              setOdometerReading(v);
              setErrors((prev) => ({ ...prev, odometerReading: undefined }));
            }}
            onVehicleSelected={handleVehicleSelected}
            disabled={isSubmitting}
            errors={errors}
          />
          {lastService && (
            <div className="mt-3">
              <LastServiceHint summary={lastService} />
            </div>
          )}
          {pendingJobs.length > 0 && (
            <div className="mt-3">
              <PendingJobBanner jobs={pendingJobs} onDismiss={() => setPendingJobs([])} />
            </div>
          )}
        </div>

        <div className="rounded-[14px] border border-neutral-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <StickyNote className="size-4 text-primary" />
            <Label className="text-sm font-semibold text-neutral-900">Customer Complaint (optional)</Label>
          </div>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {COMMON_COMPLAINTS.map((chip) => (
              <button
                key={chip}
                type="button"
                disabled={isSubmitting}
                onClick={() => setComplaintNotes((prev) => (prev.trim() ? `${prev.trim()}, ${chip}` : chip))}
                className="rounded-full border border-neutral-200 px-3 py-1 text-xs font-medium text-neutral-600 hover:border-primary hover:text-primary"
              >
                {chip}
              </button>
            ))}
          </div>
          <Textarea
            placeholder="What did the customer say is wrong?"
            value={complaintNotes}
            disabled={isSubmitting}
            onChange={(e) => setComplaintNotes(e.target.value)}
            rows={2}
          />
        </div>

        {errors.form && <p className="text-sm text-danger">{errors.form}</p>}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => router.push("/service")} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="button" className="bg-primary hover:bg-primary/90" onClick={handleSubmit} disabled={isSubmitting}>
            <FileText className="size-4" />
            {isSubmitting ? "Accepting..." : "Accept Vehicle"}
          </Button>
        </div>
      </fieldset>
    </div>
  );
}
