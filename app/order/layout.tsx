// Public, unauthenticated route (doc/online-orders-scope.md §1) — deliberately
// outside the (app) group's Sidebar/Header shell and outside (auth)'s
// login-specific copy. Same centered-card visual language as (auth)/layout.tsx
// so the page still looks like it belongs to Twinspark, just with no nav chrome.
export default function PublicOrderLayout({ children }: { children: React.ReactNode }) {
  const year = new Date().getFullYear();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-neutral-50 px-4 py-12">
      <div className="w-full max-w-lg">{children}</div>
      <p className="text-xs text-neutral-400">Twinspark® Garage Management System. All rights reserved. {year}.</p>
    </div>
  );
}
