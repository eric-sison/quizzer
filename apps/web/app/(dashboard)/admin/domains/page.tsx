import { AdminDomainsView } from "@/components/admin/domains-view"
import { adminApi } from "@/lib/api-client"
import { requireAdmin } from "@/lib/auth"

export const metadata = { title: "Admin · Domains" }

export default async function AdminDomainsPage() {
  // The layout only checked for a teacher; this section is admin-only.
  await requireAdmin()
  const config = await adminApi.getInstitution()

  return <AdminDomainsView config={config} />
}
