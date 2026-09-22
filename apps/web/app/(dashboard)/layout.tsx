import { SidebarInset, SidebarProvider } from "@workspace/ui/components/sidebar"
import { Toaster } from "@workspace/ui/components/toast"

import { AppSidebar } from "@/components/app-sidebar"
import { getCurrentTeacher, getSession } from "@/lib/auth"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // getSession() is cache()d, so the second call inside getCurrentTeacher()
  // reuses the same round-trip to apps/api.
  const [teacher, session] = await Promise.all([getCurrentTeacher(), getSession()])
  const isAdmin = session?.user.role === "admin"

  return (
    <SidebarProvider>
      <AppSidebar teacher={teacher} isAdmin={isAdmin} />
      <SidebarInset>{children}</SidebarInset>
      <Toaster />
    </SidebarProvider>
  )
}
