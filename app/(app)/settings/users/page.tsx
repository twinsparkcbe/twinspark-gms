import { requireAdmin } from "@/lib/auth/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { listUsers } from "@/services/users";

import { UsersPageClient } from "@/components/users/users-page-client";

// Server-side Admin gate, same as every other Admin-only module page.
export default async function UsersPage() {
  const { userId } = await requireAdmin();
  const adminClient = createAdminClient();

  const users = await listUsers(adminClient);

  return <UsersPageClient initialUsers={users} currentUserId={userId} />;
}
