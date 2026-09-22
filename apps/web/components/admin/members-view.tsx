"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import type { Member, MemberRole } from "@workspace/quiz-core"
import { Ban, KeyRound, RotateCcw, Users } from "lucide-react"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@workspace/ui/components/empty"
import { NativeSelect, NativeSelectOption } from "@workspace/ui/components/native-select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@workspace/ui/components/table"
import { toast } from "@workspace/ui/components/toast"

import { revokeMemberSessionsAction, setMemberRoleAction, setMemberStatusAction } from "@/lib/admin-actions"

const ROLES: MemberRole[] = ["admin", "teacher", "student"]

export function AdminMembersView({ members, selfUserId }: { members: Member[]; selfUserId: string }) {
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()

  function run(work: () => Promise<{ ok: boolean; message?: string }>, done: string) {
    startTransition(async () => {
      const result = await work()
      if (result.ok) {
        toast.add({ title: done })
        router.refresh()
      } else {
        toast.add({ title: "That didn't work", description: result.message })
      }
    })
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="font-heading text-xl font-semibold tracking-tight">Members</h1>
          <p className="text-sm text-muted-foreground">
            Everyone who has signed in, and what they can do.{" "}
            <Link href="/admin/domains" className="text-primary underline-offset-4 hover:underline">
              Domains &amp; institution
            </Link>
          </p>
        </div>
      </div>

      {members.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Users />
            </EmptyMedia>
            <EmptyTitle>No members yet</EmptyTitle>
            <EmptyDescription>
              Members appear here after their first Google sign-in from an allowed domain.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>
                  <span className="block text-right">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((member) => {
                const isSelf = member.userId === selfUserId
                const suspended = member.status === "suspended"
                return (
                  <TableRow key={member.userId}>
                    <TableCell>
                      <span className="font-medium">{member.name}</span>
                      {isSelf ? <span className="ml-1.5 text-xs text-muted-foreground">(you)</span> : null}
                    </TableCell>
                    <TableCell>
                      <span className="text-muted-foreground">{member.email}</span>
                    </TableCell>
                    <TableCell>
                      <NativeSelect
                        size="sm"
                        value={member.role}
                        disabled={pending}
                        aria-label={`Role for ${member.name}`}
                        onChange={(event) =>
                          run(
                            () => setMemberRoleAction(member.userId, event.currentTarget.value as MemberRole),
                            "Role updated"
                          )
                        }
                      >
                        {ROLES.map((role) => (
                          <NativeSelectOption key={role} value={role}>
                            {role}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </TableCell>
                    <TableCell>
                      <Badge variant={suspended ? "destructive" : "secondary"}>{member.status}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={pending}
                          onClick={() =>
                            run(
                              () => setMemberStatusAction(member.userId, suspended ? "active" : "suspended"),
                              suspended ? "Member reactivated" : "Member suspended"
                            )
                          }
                        >
                          {suspended ? <RotateCcw /> : <Ban />}
                          {suspended ? "Reactivate" : "Suspend"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={pending}
                          onClick={() => run(() => revokeMemberSessionsAction(member.userId), "Sessions revoked")}
                        >
                          <KeyRound />
                          Revoke sessions
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
