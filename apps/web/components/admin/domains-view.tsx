"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import type { InstitutionConfig } from "@workspace/quiz-core"
import { Globe, Plus, Trash2 } from "lucide-react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@workspace/ui/components/empty"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Switch } from "@workspace/ui/components/switch"
import { toast } from "@workspace/ui/components/toast"

import { addDomainAction, removeDomainAction, updateInstitutionAction } from "@/lib/admin-actions"

export function AdminDomainsView({ config }: { config: InstitutionConfig }) {
  const router = useRouter()
  const { institution, domains } = config

  const [name, setName] = React.useState(institution.name)
  const [newDomain, setNewDomain] = React.useState("")
  const [removing, setRemoving] = React.useState<{ id: string; domain: string } | null>(null)
  const [pending, startTransition] = React.useTransition()

  function saveName() {
    const trimmed = name.trim()
    if (!trimmed || trimmed === institution.name) return
    startTransition(async () => {
      const result = await updateInstitutionAction({ name: trimmed })
      if (result.ok) {
        toast.add({ title: "Institution renamed", description: trimmed })
        router.refresh()
      } else {
        toast.add({ title: "Could not rename", description: result.message })
      }
    })
  }

  function toggleAutoProvision(checked: boolean) {
    startTransition(async () => {
      const result = await updateInstitutionAction({ autoProvisionStudents: checked })
      if (result.ok) {
        router.refresh()
      } else {
        toast.add({ title: "Could not update", description: result.message })
      }
    })
  }

  function addDomain(event: React.FormEvent) {
    event.preventDefault()
    const domain = newDomain.trim()
    if (!domain) return
    startTransition(async () => {
      const result = await addDomainAction(domain)
      if (result.ok) {
        toast.add({ title: "Domain added", description: domain.toLowerCase() })
        setNewDomain("")
        router.refresh()
      } else {
        toast.add({ title: "Could not add domain", description: result.message })
      }
    })
  }

  function removeDomain() {
    if (!removing) return
    const { id, domain } = removing
    startTransition(async () => {
      const result = await removeDomainAction(id)
      setRemoving(null)
      if (result.ok) {
        toast.add({ title: "Domain removed", description: domain })
        router.refresh()
      } else {
        toast.add({ title: "Could not remove domain", description: result.message })
      }
    })
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="font-heading text-xl font-semibold tracking-tight">Admin</h1>
          <p className="text-sm text-muted-foreground">
            Who can sign in, and what happens when they do.{" "}
            <Link href="/admin/members" className="text-primary underline-offset-4 hover:underline">
              Manage members
            </Link>
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Institution</CardTitle>
          <CardDescription>The name shown to teachers and students, and how new accounts are handled.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4">
            <form
              className="flex max-w-md items-end gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                saveName()
              }}
            >
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <Label htmlFor="institution-name">Name</Label>
                <Input
                  id="institution-name"
                  value={name}
                  maxLength={200}
                  onChange={(event) => setName(event.currentTarget.value)}
                />
              </div>
              <Button
                type="submit"
                variant="outline"
                disabled={pending || !name.trim() || name.trim() === institution.name}
              >
                Save
              </Button>
            </form>

            <div className="flex items-start gap-3">
              <Switch
                id="auto-provision"
                checked={institution.autoProvisionStudents}
                disabled={pending}
                onCheckedChange={toggleAutoProvision}
              />
              <div className="flex flex-col gap-0.5">
                <Label htmlFor="auto-provision">Auto-provision students</Label>
                <span className="text-xs text-muted-foreground">
                  Anyone signing in from an allowed domain becomes a student automatically.
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Allowed domains</CardTitle>
          <CardDescription>
            Google accounts may only sign in when their email ends in one of these domains.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3">
            <form className="flex max-w-md items-center gap-2" onSubmit={addDomain}>
              <Input
                value={newDomain}
                placeholder="school.edu"
                aria-label="Domain to allow"
                onChange={(event) => setNewDomain(event.currentTarget.value)}
              />
              <Button type="submit" variant="outline" disabled={pending || !newDomain.trim()}>
                <Plus />
                Add
              </Button>
            </form>

            {domains.length === 0 ? (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Globe />
                  </EmptyMedia>
                  <EmptyTitle>No domains allowed yet</EmptyTitle>
                  <EmptyDescription>Nobody can sign in until you add your institution&apos;s domain.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <ul className="flex flex-col divide-y rounded-lg border">
                {domains.map((entry) => (
                  <li key={entry.id} className="flex items-center gap-3 px-3 py-2">
                    <Globe className="size-4 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate font-mono text-sm">{entry.domain}</span>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove ${entry.domain}`}
                      disabled={pending}
                      onClick={() => setRemoving({ id: entry.id, domain: entry.domain })}
                    >
                      <Trash2 />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>

      <AlertDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removing?.domain}?</AlertDialogTitle>
            <AlertDialogDescription>
              Every member whose email is on this domain will be suspended and signed out everywhere, immediately. They
              cannot sign back in until the domain is re-added or an admin reactivates them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(event) => {
                event.preventDefault()
                removeDomain()
              }}
            >
              {pending ? "Removing…" : "Remove domain"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
