"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Users,
  UserPlus,
  Shield,
  Building2,
  RefreshCw,
  Search,
  CheckCircle2,
} from "lucide-react"
import { toast } from "sonner"

interface PersonItem {
  id: string
  name: string
  email: string
  designation: string
  departmentId: string | null
  departmentName: string
  departmentCode?: string
  scopeLevels: string[]
  primaryRole: string
  status: string
  createdAt: string
}

interface DeptItem {
  id: string
  name: string
  code?: string
}

interface Props {
  orgId: string
  initialUsers: PersonItem[]
  departments: DeptItem[]
}

const ROLE_OPTIONS = [
  { value: "DIRECTOR", label: "Director (Global Executive)", deptRequired: false },
  { value: "ORG_UNIT_LEAD", label: "Head of Department / HOD (Department Scope)", deptRequired: true },
  { value: "DEPT_ADMIN", label: "Department Administrator (Schedule & Import Helper)", deptRequired: true },
  { value: "MEMBER", label: "Faculty / Member (Department Scope)", deptRequired: true },
  { value: "FINANCE_ADMIN", label: "Finance Administrator (Global Settlement)", deptRequired: false },
  { value: "SYSTEM_ADMIN", label: "System Administrator (Tenant Operator)", deptRequired: false },
]

export function PeopleManagerClient({ orgId, initialUsers, departments }: Props) {
  const router = useRouter()
  const [users, setUsers] = useState<PersonItem[]>(initialUsers)
  const [showModal, setShowModal] = useState(false)
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState("")

  // Form states
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [designation, setDesignation] = useState("")
  const [scopeLevel, setScopeLevel] = useState("MEMBER")
  const [orgUnitId, setOrgUnitId] = useState("")
  const [password, setPassword] = useState("")
  const [setAsPrimaryLead, setSetAsPrimaryLead] = useState(false)

  const selectedRoleMeta = ROLE_OPTIONS.find((r) => r.value === scopeLevel) || ROLE_OPTIONS[3]

  const handleProvision = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!name.trim() || !email.trim()) {
      toast.error("Name and Email are required.")
      return
    }

    if (selectedRoleMeta.deptRequired && !orgUnitId) {
      toast.error(`Department selection is required for ${selectedRoleMeta.label}.`)
      return
    }

    try {
      setLoading(true)
      const res = await fetch("/api/admin/provision-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim().toLowerCase(),
          designation: designation.trim() || undefined,
          scopeLevel,
          orgUnitId: orgUnitId || undefined,
          password: password || undefined,
          setAsPrimaryLead,
        }),
      })

      const json = await res.json()
      if (!res.ok) {
        throw new Error(json.error || "Failed to provision user.")
      }

      toast.success(json.message || "User account provisioned successfully.")

      const targetDept = departments.find((d) => d.id === orgUnitId)
      const newPerson: PersonItem = {
        id: json.user.id,
        name: json.user.name,
        email: json.user.email,
        designation: designation || scopeLevel,
        departmentId: json.user.orgUnitId || null,
        departmentName: targetDept?.name || "None (Global)",
        departmentCode: targetDept?.code,
        scopeLevels: [scopeLevel],
        primaryRole: selectedRoleMeta.label.split(" (")[0],
        status: "ACTIVE",
        createdAt: new Date().toISOString(),
      }

      setUsers((prev) => [newPerson, ...prev])
      setName("")
      setEmail("")
      setDesignation("")
      setPassword("")
      setOrgUnitId("")
      setSetAsPrimaryLead(false)
      setShowModal(false)
      router.refresh()
    } catch (err: any) {
      toast.error(err.message || "Failed to provision user.")
    } finally {
      setLoading(false)
    }
  }

  const filteredUsers = users.filter((u) => {
    const q = search.toLowerCase()
    return (
      u.name.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      u.departmentName.toLowerCase().includes(q) ||
      u.primaryRole.toLowerCase().includes(q)
    )
  })

  return (
    <div className="space-y-6">
      {/* ── Action Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, email, department..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-9 text-xs"
          />
        </div>

        <Button
          onClick={() => setShowModal(true)}
          size="sm"
          className="gap-1.5 text-xs shrink-0"
        >
          <UserPlus className="h-4 w-4" />
          Provision Person
        </Button>
      </div>

      {/* ── Provision Person Dialog / Modal ── */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <Card className="w-full max-w-lg border-border bg-card shadow-2xl animate-in fade-in zoom-in-95">
            <CardHeader className="pb-3 border-b">
              <CardTitle className="text-base font-semibold">Provision Institutional User</CardTitle>
              <CardDescription className="text-xs">
                Creates an authenticated identity and assigns department-isolated role scopes.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-4">
              <form onSubmit={handleProvision} className="space-y-4 text-xs">
                <div className="space-y-1.5">
                  <Label htmlFor="user-role" className="text-xs font-medium">Institutional Role *</Label>
                  <select
                    id="user-role"
                    value={scopeLevel}
                    onChange={(e) => setScopeLevel(e.target.value)}
                    className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-xs shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    {ROLE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="user-name" className="text-xs font-medium">Full Name *</Label>
                    <Input
                      id="user-name"
                      placeholder="e.g. Dr. Jane Smith"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                      className="h-9 text-xs"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="user-email" className="text-xs font-medium">Institutional Email *</Label>
                    <Input
                      id="user-email"
                      type="email"
                      placeholder="e.g. jsmith@institution.edu"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      className="h-9 text-xs"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="user-desig" className="text-xs font-medium">Designation (Optional)</Label>
                    <Input
                      id="user-desig"
                      placeholder="e.g. Professor & HOD"
                      value={designation}
                      onChange={(e) => setDesignation(e.target.value)}
                      className="h-9 text-xs"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="user-pass" className="text-xs font-medium">Temporary Password (Optional)</Label>
                    <Input
                      id="user-pass"
                      type="password"
                      placeholder="Defaults to Welcome@WorkLedger2026!"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="h-9 text-xs"
                    />
                  </div>
                </div>

                {/* Department Selection */}
                <div className="space-y-1.5">
                  <Label htmlFor="user-dept" className="text-xs font-medium">
                    Department {selectedRoleMeta.deptRequired ? "*" : "(Optional for Global Roles)"}
                  </Label>
                  <select
                    id="user-dept"
                    value={orgUnitId}
                    onChange={(e) => setOrgUnitId(e.target.value)}
                    required={selectedRoleMeta.deptRequired}
                    className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-xs shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="">
                      {selectedRoleMeta.deptRequired ? "-- Select Required Department --" : "-- None (Global Scope) --"}
                    </option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} {d.code ? `(${d.code})` : ""}
                      </option>
                    ))}
                  </select>
                </div>

                {scopeLevel === "ORG_UNIT_LEAD" && (
                  <div className="flex items-center gap-2 p-2.5 rounded-lg bg-sky-500/10 border border-sky-500/20 text-sky-600 dark:text-sky-400">
                    <input
                      type="checkbox"
                      id="set-lead-primary"
                      checked={setAsPrimaryLead}
                      onChange={(e) => setSetAsPrimaryLead(e.target.checked)}
                      className="rounded border-sky-500/40"
                    />
                    <label htmlFor="set-lead-primary" className="text-[11px] cursor-pointer">
                      Designate as Primary Head of Department for this unit
                    </label>
                  </div>
                )}

                <div className="flex items-center justify-end gap-2 pt-3 border-t">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowModal(false)}
                    className="text-xs"
                  >
                    Cancel
                  </Button>
                  <Button type="submit" size="sm" disabled={loading} className="gap-1 text-xs">
                    {loading && <RefreshCw className="h-3 w-3 animate-spin" />}
                    Provision Account
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── People Roster Table ── */}
      <Card className="border-border/60 bg-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Institutional Roster</CardTitle>
          <CardDescription className="text-xs">
            {filteredUsers.length} active registered account{filteredUsers.length === 1 ? "" : "s"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="border-b text-muted-foreground uppercase text-[10px] tracking-wider">
                <tr>
                  <th className="py-2.5 px-3">Person</th>
                  <th className="py-2.5 px-3">Role</th>
                  <th className="py-2.5 px-3">Department</th>
                  <th className="py-2.5 px-3">Designation</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3 text-right">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {filteredUsers.map((u) => (
                  <tr key={u.id} className="hover:bg-muted/30">
                    <td className="py-2.5 px-3">
                      <div className="font-semibold text-foreground">{u.name}</div>
                      <div className="text-[11px] text-muted-foreground font-mono">{u.email}</div>
                    </td>
                    <td className="py-2.5 px-3">
                      <Badge variant="outline" className="text-[10px] py-0 font-medium">
                        {u.primaryRole}
                      </Badge>
                    </td>
                    <td className="py-2.5 px-3">
                      <span className="flex items-center gap-1.5 text-foreground font-medium">
                        <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        {u.departmentName}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-muted-foreground">{u.designation}</td>
                    <td className="py-2.5 px-3">
                      <span className="inline-flex items-center gap-1 text-[11px] text-emerald-500 font-medium">
                        <CheckCircle2 className="h-3 w-3" />
                        Active
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right text-muted-foreground font-mono">
                      {u.createdAt ? new Date(u.createdAt).toISOString().split('T')[0] : "Recent"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
