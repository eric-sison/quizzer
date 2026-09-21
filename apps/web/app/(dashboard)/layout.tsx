import { SidebarInset, SidebarProvider } from "@workspace/ui/components/sidebar"
import { Toaster } from "@workspace/ui/components/toast"

import { AppSidebar } from "@/components/app-sidebar"
import { getCurrentTeacher } from "@/lib/auth"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const teacher = await getCurrentTeacher()

  return (
    <SidebarProvider>
      <AppSidebar teacher={teacher} />
      <SidebarInset>{children}</SidebarInset>
      <Toaster />
    </SidebarProvider>
  )
}
