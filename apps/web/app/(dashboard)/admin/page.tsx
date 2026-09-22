import { redirect } from "next/navigation"

/** /admin is a section, not a page; domains is its front door. */
export default function AdminPage() {
  redirect("/admin/domains")
}
