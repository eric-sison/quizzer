import { AdminMembersView } from "@/components/admin/members-view"
import { adminApi } from "@/lib/api-client"
import { requireAdmin } from "@/lib/auth"

export const metadata = { title: "Admin · Members" }

export default async function AdminMembersPage() {
  const admin = await requireAdmin()
  const members = await adminApi.listMembers()

  return <AdminMembersView members={members} selfUserId={admin.userId} />
}
