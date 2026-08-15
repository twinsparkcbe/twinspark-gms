"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Loader2 } from "lucide-react";

/**
 * Full-screen blocking loader. Sits above everything (z-[100]) with an
 * opaque-ish backdrop, so it both shows progress and prevents the user from
 * clicking/tabbing into anything underneath while an action is in flight —
 * pair with `disabled`/`<fieldset disabled>` on the underlying form for
 * belt-and-suspenders protection (keyboard users, assistive tech).
 *
 * Reusable across any full-page async action (login, checkout, etc.) — see
 * twinspark-style-guide.md §7 (Feedback) for the loading-state pattern.
 */
export function LoadingOverlay({ show, label = "Loading..." }: { show: boolean; label?: string }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-3 bg-white/85 backdrop-blur-sm"
          role="status"
          aria-live="polite"
        >
          <Loader2 className="size-8 animate-spin text-brand-red" aria-hidden />
          <p className="text-sm font-medium text-neutral-600">{label}</p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
