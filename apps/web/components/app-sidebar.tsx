"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  ChartNoAxesColumn,
  ClipboardCheck,
  Settings,
  Users,
} from "lucide-react"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@workspace/ui/components/sidebar"

import type { Teacher } from "@/lib/auth"

const NAV = [
  { href: "/quizzes", label: "Quizzes", icon: ClipboardCheck },
  { href: "/results", label: "Results", icon: ChartNoAxesColumn },
  { href: "/students", label: "Students", icon: Users },
  { href: "/settings", label: "Settings", icon: Settings },
]

export function AppSidebar({ teacher }: { teacher: Teacher }) {
  const pathname = usePathname()

  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1.5">
          <span className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <ClipboardCheck className="size-3.5" />
          </span>
          <span className="font-heading text-sm font-semibold tracking-tight">
            Quizzer
          </span>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    isActive={pathname.startsWith(item.href)}
                    render={
                      <Link href={item.href}>
                        <item.icon />
                        <span>{item.label}</span>
                      </Link>
                    }
                  />
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <div className="flex items-center gap-2.5 rounded-lg border border-dashed p-2">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full border bg-muted font-heading text-[11px] font-semibold text-muted-foreground">
            {teacher.name
              .split(" ")
              .map((part) => part[0])
              .join("")
              .slice(0, 2)
              .toUpperCase()}
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-xs font-medium">{teacher.name}</span>
            {/* Honest label: sign-in is a seam, not a real session yet. */}
            <span className="text-[10px] text-muted-foreground">
              Mock sign-in
            </span>
          </span>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
