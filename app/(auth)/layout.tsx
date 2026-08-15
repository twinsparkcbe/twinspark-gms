export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const year = new Date().getFullYear();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-neutral-50 px-4 py-12">
      <div className="w-full max-w-md">{children}</div>
      <p className="text-xs text-neutral-400">
        Twinspark® Garage Management System. All rights reserved. {year}.
      </p>
    </div>
  );
}
