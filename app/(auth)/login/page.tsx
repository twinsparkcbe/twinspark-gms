import { BrandMark } from "@/components/shared/brand-mark";

import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <div className="flex flex-col items-center">
      <BrandMark variant="login" className="mb-6" />
      <h1 className="text-center text-2xl font-black tracking-tight text-neutral-900">
        Twinspark Garage Management
      </h1>
      <p className="mt-1 text-center text-sm text-neutral-600">
        Inventory, Service &amp; POS Billing Platform
      </p>

      <div className="mt-8 w-full rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
        <LoginForm />
      </div>
    </div>
  );
}
