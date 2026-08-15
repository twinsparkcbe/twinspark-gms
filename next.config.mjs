/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Next 15 dropped the client Router Cache staleTime for dynamic routes
    // from 30s (Next 14's default) to 0, which means every navigation —
    // including back to a page opened seconds ago — refetches the whole RSC
    // payload from the server. Every route here is dynamic (Supabase auth
    // cookies), so nothing was ever being reused. Restoring the 30s window
    // is safe because our mutations already invalidate this cache: Server
    // Actions call revalidatePath() and the two client-side flows call
    // router.refresh(), both of which clear the Router Cache immediately.
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
    serverActions: {
      // Payment screenshot / inventory image uploads are client-validated up
      // to 5MB (see MAX_IMAGE_BYTES in public-order-form.tsx and the
      // purchases dialogs). Next.js defaults this limit to 1MB, which was
      // rejecting any screenshot over that size before it reached our own
      // validation. 6mb leaves headroom for multipart/form-data overhead.
      bodySizeLimit: "6mb",
    },
  },
};

export default nextConfig;
