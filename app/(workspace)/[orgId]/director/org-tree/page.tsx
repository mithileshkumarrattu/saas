"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { useParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { formatRole, formatDepartment } from "@/lib/utils/formatters"
import {
  Loader2,
  Plus,
  GitBranch,
  Building2,
  User,
  Users,
  Search,
  Copy,
  Check,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
  Maximize2,
  ChevronDown,
  ChevronRight,
  Shield,
  Crown,
  PanelRightClose,
  PanelRightOpen,
  RotateCcw,
  Sparkles,
  RefreshCw,
  Award,
  Layers,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
} from "lucide-react"
import { toast } from "sonner"

interface TreeNodeUnit {
  id: string
  name: string
  unit_type: string
  parent_id?: string | null
  path?: string | null
  leadUserId?: string | null
  lead?: any | null
  members: any[]
  totalMemberCount: number
  children: TreeNodeUnit[]
}

interface TreeMember {
  id: string
  name: string
  email: string
  employee_id?: string | null
  designation?: string | null
  org_unit_id?: string | null
  status: string
  progress_percentage?: number | string
  role?: any | null
  roleId?: string
  isUnitLead?: boolean
}

export default function OrgTreePage() {
  const params = useParams()
  const orgId = params.orgId as string
  const supabase = createClient()

  // Data State
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [lastSynced, setLastSynced] = useState<string>("Just now")
  const [actionLoading, setActionLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [organization, setOrganization] = useState<any | null>(null)
  const [director, setDirector] = useState<TreeMember | null>(null)
  const [tree, setTree] = useState<TreeNodeUnit[]>([])
  const [flatUnits, setFlatUnits] = useState<any[]>([])
  const [unassignedMembers, setUnassignedMembers] = useState<TreeMember[]>([])
  const [roles, setRoles] = useState<any[]>([])
  const [permissions, setPermissions] = useState<any[]>([])

  // Search & Selection
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedNode, setSelectedNode] = useState<{ type: "member" | "unit"; data: any } | null>(null)
  const [collapsedUnits, setCollapsedUnits] = useState<Record<string, boolean>>({})
  const [showInspector, setShowInspector] = useState(false)

  // Zoom & Pan Canvas State
  const [zoom, setZoom] = useState(0.95)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const [startPan, setStartPan] = useState({ x: 0, y: 0 })

  const canvasRef = useRef<HTMLDivElement>(null)
  const treeRef = useRef<HTMLDivElement>(null)

  // Modals & Invite
  const [showAddModal, setShowAddModal] = useState(false)
  const [addNodeType, setAddNodeType] = useState<"unit" | "member">("unit")
  const [copiedAddress, setCopiedAddress] = useState(false)
  const [generatedInvite, setGeneratedInvite] = useState<{
    name: string
    email: string
    link: string
    emailSent?: boolean
  } | null>(null)
  const [copiedInviteLink, setCopiedInviteLink] = useState(false)

  // Inspector Form State
  const [inspectorName, setInspectorName] = useState("")
  const [inspectorEmployeeId, setInspectorEmployeeId] = useState("")
  const [inspectorDesignation, setInspectorDesignation] = useState("")
  const [inspectorUnitId, setInspectorUnitId] = useState("")
  const [inspectorRoleId, setInspectorRoleId] = useState("")
  const [inspectorWalletAddress, setInspectorWalletAddress] = useState("")
  const [inspectorPermissions, setInspectorPermissions] = useState<Record<string, boolean>>({})

  // Add Form State
  const [newUnitName, setNewUnitName] = useState("")
  const [newUnitType, setNewUnitType] = useState("ACADEMIC_DEPARTMENT")
  const [newUnitParentId, setNewUnitParentId] = useState<string>("none")

  const [newMemberName, setNewMemberName] = useState("")
  const [newMemberEmail, setNewMemberEmail] = useState("")
  const [newMemberEmployeeId, setNewMemberEmployeeId] = useState("")
  const [newMemberDesignation, setNewMemberDesignation] = useState("")
  const [newMemberUnitId, setNewMemberUnitId] = useState<string>("none")
  const [newMemberRoleId, setNewMemberRoleId] = useState("")

  // 1. Fetch Hierarchy from Server API
  const fetchHierarchy = useCallback(async (isBackgroundSync = false) => {
    try {
      if (!orgId) return
      if (!isBackgroundSync) setLoading(true)
      else setSyncing(true)

      const res = await fetch(`/api/org/hierarchy?orgId=${orgId}`)
      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || "Failed to load hierarchy")
      }

      setOrganization(data.organization)
      setDirector(data.director)
      setTree(data.tree || [])
      setFlatUnits(data.flatUnits || [])
      setUnassignedMembers(data.unassignedMembers || [])
      setRoles(data.roles || [])
      setPermissions(data.permissions || [])
      setLastSynced(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }))

      // Select director as initial node if none selected
      if (!selectedNode && data.director) {
        handleSelectMember(data.director, false)
      }
    } catch (err: any) {
      console.error("Fetch hierarchy error:", err)
      setError(err.message || "Failed to sync hierarchy data.")
    } finally {
      setLoading(false)
      setSyncing(false)
    }
  }, [orgId, selectedNode])

  // Initial load
  useEffect(() => {
    fetchHierarchy()
  }, [fetchHierarchy])

  // 2. Realtime Database Subscription for Instant Dynamic Sync
  useEffect(() => {
    if (!orgId) return

    const channel = supabase
      .channel(`org-tree-realtime-${orgId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "org_units", filter: `organization_id=eq.${orgId}` },
        () => {
          fetchHierarchy(true)
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "users", filter: `organization_id=eq.${orgId}` },
        () => {
          fetchHierarchy(true)
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "user_roles" },
        () => {
          fetchHierarchy(true)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [orgId, supabase, fetchHierarchy])

  // Node Selection Handlers
  const handleSelectMember = async (member: any, openInspector: boolean = false) => {
    setSelectedNode({ type: "member", data: member })
    if (openInspector) setShowInspector(true)

    setInspectorName(member.name || "")
    setInspectorEmployeeId(member.employee_id || "")
    setInspectorDesignation(member.designation || "")
    setInspectorUnitId(member.org_unit_id || "none")
    setInspectorRoleId(member.roleId || member.role?.id || "")

    // Fetch personal wallet
    const { data: walletData } = await (supabase as any)
      .from("wallets")
      .select("id, balance")
      .eq("owner_user_id", member.id)
      .eq("purpose", "PERSONAL")
      .maybeSingle()
    setInspectorWalletAddress(walletData?.id || "No Personal Wallet Assigned")

    // Fetch permission overrides
    const { data: overrides } = await (supabase as any)
      .from("permission_overrides")
      .select("permission_id, is_allowed")
      .eq("user_id", member.id)

    const initialPermissions: Record<string, boolean> = {}
    permissions.forEach((p) => {
      const match = (overrides as any[])?.find((o: any) => o.permission_id === p.id)
      initialPermissions[p.id] = match ? match.is_allowed : false
    })
    setInspectorPermissions(initialPermissions)
  }

  const handleSelectUnit = (unit: TreeNodeUnit, openInspector: boolean = false) => {
    setSelectedNode({ type: "unit", data: unit })
    if (openInspector) setShowInspector(true)
    setInspectorName(unit.name)
    setInspectorUnitId(unit.id)
  }

  const toggleCollapse = (unitId: string) => {
    setCollapsedUnits((prev) => ({ ...prev, [unitId]: !prev[unitId] }))
  }

  // Pan controls
  const handleMouseDown = (e: React.MouseEvent) => {
    if (
      (e.target as HTMLElement).closest(".tree-node-interactive") ||
      (e.target as HTMLElement).closest("button") ||
      (e.target as HTMLElement).closest(".inspector-panel")
    ) {
      return
    }
    setIsPanning(true)
    setStartPan({ x: e.clientX - pan.x, y: e.clientY - pan.y })
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isPanning) return
    setPan({ x: e.clientX - startPan.x, y: e.clientY - startPan.y })
  }

  const handleMouseUp = () => {
    setIsPanning(false)
  }

  const handleResetView = () => {
    setZoom(0.95)
    setPan({ x: 0, y: 0 })
  }

  const handleFitView = useCallback(() => {
    if (!canvasRef.current || !treeRef.current) return
    const containerW = canvasRef.current.clientWidth - 48
    const containerH = canvasRef.current.clientHeight - 48
    const treeW = treeRef.current.scrollWidth
    const treeH = treeRef.current.scrollHeight

    if (treeW > 0 && containerW > 0) {
      const scaleX = containerW / treeW
      const scaleY = containerH / treeH
      const optimalZoom = Math.min(1, Math.max(0.35, Math.min(scaleX, scaleY)))
      setZoom(Number(optimalZoom.toFixed(2)))
      setPan({ x: 0, y: 0 })
    }
  }, [])

  // Save changes via Hierarchy API
  const handleSaveChanges = async () => {
    if (!selectedNode || selectedNode.type !== "member") return
    setError(null)
    setSuccess(null)
    setActionLoading(true)

    try {
      const memberId = selectedNode.data.id

      const res = await fetch("/api/org/hierarchy", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: orgId,
          memberId,
          name: inspectorName,
          employeeId: inspectorEmployeeId,
          designation: inspectorDesignation,
          orgUnitId: inspectorUnitId,
          roleId: inspectorRoleId,
          permissionOverrides: inspectorPermissions,
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to save member updates.")

      setSuccess("Member profile and leadership synced successfully!")
      toast.success("Member profile and leadership synced successfully!")
      await fetchHierarchy()
    } catch (err: any) {
      setError(err.message || "Failed to save member changes")
      toast.error(err.message || "Failed to save changes")
    } finally {
      setActionLoading(false)
    }
  }

  // Promote Member to Unit Lead
  const handlePromoteToLead = async (member: any, unitId: string) => {
    setActionLoading(true)
    try {
      const leadRole = roles.find((r) => r.scope_level === "ORG_UNIT_LEAD")
      const res = await fetch("/api/org/hierarchy", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: orgId,
          memberId: member.id,
          orgUnitId: unitId,
          roleId: leadRole?.id,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to assign lead.")
      toast.success(`${member.name} promoted to Department Lead!`)
      await fetchHierarchy()
    } catch (err: any) {
      toast.error(err.message || "Failed to promote member")
    } finally {
      setActionLoading(false)
    }
  }

  // Add Node (Unit or Member)
  const handleAddNodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    setActionLoading(true)

    try {
      if (addNodeType === "unit") {
        if (!newUnitName.trim()) throw new Error("Department or unit name is required")

        const res = await fetch("/api/org/hierarchy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            organizationId: orgId,
            name: newUnitName.trim(),
            unitType: newUnitType,
            parentId: newUnitParentId === "none" ? null : newUnitParentId,
          }),
        })

        const data = await res.json()
        if (!res.ok) throw new Error(data.error || "Failed to create unit.")

        setSuccess(`Unit "${newUnitName}" created successfully.`)
        toast.success(`Unit "${newUnitName}" created successfully.`)
        setShowAddModal(false)
        setNewUnitName("")
        setNewUnitParentId("none")
      } else {
        if (!newMemberName.trim() || !newMemberEmail.trim()) {
          throw new Error("Name and email are required")
        }

        const res = await fetch("/api/director/invite-member", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            organizationId: orgId,
            name: newMemberName.trim(),
            email: newMemberEmail.trim(),
            employeeId: newMemberEmployeeId || null,
            designation: newMemberDesignation || null,
            orgUnitId: newMemberUnitId === "none" ? null : newMemberUnitId || null,
            roleId: newMemberRoleId || null,
          }),
        })

        const data = await res.json()
        if (!res.ok) throw new Error(data.error || "Failed to invite member.")

        setShowAddModal(false)
        setGeneratedInvite({
          name: newMemberName.trim(),
          email: newMemberEmail.trim(),
          link: data.inviteLink,
          emailSent: data.emailSent,
        })
        setSuccess(`Invitation created for ${newMemberEmail.trim()}`)
        toast.success(`Invitation created for ${newMemberEmail.trim()}`)
        setNewMemberName("")
        setNewMemberEmail("")
        setNewMemberEmployeeId("")
        setNewMemberDesignation("")
        setNewMemberUnitId("none")
        setNewMemberRoleId("")
      }

      await fetchHierarchy()
    } catch (err: any) {
      setError(err.message || "Failed to create node")
      toast.error(err.message || "Failed to create node")
    } finally {
      setActionLoading(false)
    }
  }

  // Remove Member
  const handleRemoveMember = async () => {
    if (!selectedNode || selectedNode.type !== "member") return
    if (!confirm("Are you sure you want to remove this member from the organization?")) return
    setActionLoading(true)

    try {
      const { error: delErr } = await supabase
        .from("users")
        .delete()
        .eq("id", selectedNode.data.id)
      if (delErr) throw delErr

      setSuccess("Member removed.")
      toast.success("Member removed from organization.")
      setSelectedNode(null)
      await fetchHierarchy()
    } catch (err: any) {
      setError("Failed to remove member")
      toast.error("Failed to remove member")
    } finally {
      setActionLoading(false)
    }
  }

  const handleCopyWallet = () => {
    if (!inspectorWalletAddress) return
    navigator.clipboard.writeText(inspectorWalletAddress)
    setCopiedAddress(true)
    setTimeout(() => setCopiedAddress(false), 2000)
  }

  // Filter helper for search
  const matchesSearch = (text?: string | null) => {
    if (!searchQuery.trim()) return true
    return (text || "").toLowerCase().includes(searchQuery.toLowerCase().trim())
  }

  // Calculate totals
  const totalDepartmentCount = flatUnits.length
  let totalStaffCount = 0
  function countStaff(units: TreeNodeUnit[]) {
    for (const u of units) {
      totalStaffCount += u.totalMemberCount
      if (u.children?.length) countStaff(u.children)
    }
  }
  countStaff(tree)
  totalStaffCount += (unassignedMembers.length + (director ? 1 : 0))

  // ---------------------------------------------------------------------------
  // RECURSIVE UNIT NODE COMPONENT (Multi-Tier Hierarchy Renderer)
  // ---------------------------------------------------------------------------
  const renderUnitBranch = (unit: TreeNodeUnit, isFirst: boolean, isLast: boolean, isOnly: boolean) => {
    const isCollapsed = collapsedUnits[unit.id]
    const isSelected = selectedNode?.data?.id === unit.id
    const hasChildren = unit.children && unit.children.length > 0

    return (
      <div key={unit.id} className="flex flex-col items-center px-3 relative min-w-[240px] max-w-[280px]">
        {/* Horizontal Connector Arms from parent stem */}
        {!isOnly && (
          <div
            className={`absolute top-0 h-6 border-primary border-t-2 ${
              isFirst
                ? "left-1/2 right-0 border-l-2 rounded-tl-xl"
                : isLast
                ? "left-0 right-1/2 border-r-2 rounded-tr-xl"
                : "left-0 right-0"
            }`}
          />
        )}

        {/* Drop line from horizontal branch to card */}
        {!isFirst && !isLast && <div className="w-0.5 h-6 bg-primary" />}
        {(isFirst || isLast) && <div className="h-6" />}

        {/* ---------------- Department Card Node ---------------- */}
        <div
          onClick={() => handleSelectUnit(unit, false)}
          onDoubleClick={() => handleSelectUnit(unit, true)}
          title="Click to inspect, Double-click to open Inspector"
          className={`tree-node-interactive w-full p-3.5 rounded-2xl border-2 transition-all duration-200 cursor-pointer shadow-md bg-card ${
            isSelected
              ? "border-primary ring-3 ring-primary/30 shadow-primary/20 scale-102"
              : "border-border hover:border-primary/80 hover:shadow-lg"
          }`}
        >
          <div className="flex items-start justify-between gap-1.5">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="p-2.5 rounded-xl bg-primary/10 text-primary shrink-0 shadow-xs">
                <Building2 className="h-4 w-4" />
              </div>
              <div className="min-w-0 text-left">
                <h4 className="text-xs font-black text-foreground truncate">{unit.name}</h4>
                <div className="flex items-center gap-1 mt-0.5">
                  <span className="text-[9px] uppercase tracking-wider font-extrabold text-primary block truncate">
                    {formatDepartment(unit)}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setNewUnitParentId(unit.id)
                  setAddNodeType("unit")
                  setShowAddModal(true)
                }}
                className="p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-primary transition"
                title="Add Sub-Unit under this department"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>

              <button
                onClick={(e) => {
                  e.stopPropagation()
                  toggleCollapse(unit.id)
                }}
                className="p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition"
                title={isCollapsed ? "Expand Department" : "Collapse Department"}
              >
                {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>

          <div className="mt-2.5 pt-2 border-t border-border flex items-center justify-between text-[10px]">
            <span className="flex items-center gap-1 font-bold text-muted-foreground">
              <Users className="h-3 w-3" /> {unit.totalMemberCount} Staff
            </span>
            <div className="flex items-center gap-1">
              {hasChildren && (
                <Badge variant="outline" className="text-[9px] font-bold px-1 py-0 gap-0.5">
                  <Layers className="h-2.5 w-2.5" /> {unit.children.length} Sub-Unit{unit.children.length === 1 ? "" : "s"}
                </Badge>
              )}
              <Badge variant="secondary" className="text-[9px] font-bold px-1.5 py-0">
                {isCollapsed ? "Collapsed" : "Active"}
              </Badge>
            </div>
          </div>
        </div>

        {/* ---------------- Department Interior Sub-Tree (Lead + Members + Sub-units) ---------------- */}
        {!isCollapsed && (
          <div className="flex flex-col items-center w-full mt-0">
            {/* Vertical stem down from department card */}
            {(unit.lead || unit.members.length > 0 || hasChildren) && (
              <div className="w-0.5 h-6 bg-primary/70" />
            )}

            {/* 1. Department Lead (HOD) Highlighted Card */}
            {unit.lead ? (
              <div
                onClick={() => handleSelectMember(unit.lead, false)}
                onDoubleClick={() => handleSelectMember(unit.lead, true)}
                className={`tree-node-interactive w-full p-3 rounded-xl border-2 transition-all cursor-pointer shadow-xs bg-amber-500/5 dark:bg-amber-500/10 ${
                  selectedNode?.data?.id === unit.lead.id
                    ? "border-amber-500 ring-2 ring-amber-500/30 shadow-md scale-102"
                    : "border-amber-500/40 hover:border-amber-500 hover:shadow-sm"
                }`}
              >
                <div className="flex items-center gap-2.5 text-left">
                  <div className="h-9 w-9 rounded-lg bg-amber-500 text-amber-950 flex items-center justify-center font-bold shrink-0 shadow-xs">
                    <Crown className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-black text-foreground truncate block">
                        {unit.lead.name}
                      </span>
                      <Badge className="bg-amber-500 text-amber-950 text-[8px] font-extrabold px-1 py-0 uppercase">
                        HOD
                      </Badge>
                    </div>
                    <p className="text-[10px] text-amber-600 dark:text-amber-400 font-bold truncate">
                      {unit.lead.designation || "Head of Department"}
                    </p>
                    <p className="text-[9px] text-muted-foreground font-mono truncate">
                      {unit.lead.email}
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div
                onClick={() => handleSelectUnit(unit, true)}
                className="w-full p-2 rounded-xl border border-dashed border-muted-foreground/30 text-center text-[10px] text-muted-foreground hover:bg-muted/40 cursor-pointer transition"
              >
                + Assign Department Lead (HOD)
              </div>
            )}

            {/* 2. Faculty / Staff Members List */}
            {unit.members.length > 0 && (
              <div className="w-full space-y-2 mt-2">
                {unit.members.map((member: any) => {
                  const isMemberSelected = selectedNode?.data?.id === member.id
                  const progress = Number(member.progress_percentage || 0)

                  return (
                    <div
                      key={member.id}
                      onClick={() => handleSelectMember(member, false)}
                      onDoubleClick={() => handleSelectMember(member, true)}
                      title="Click to select, Double-click to open Inspector"
                      className={`tree-node-interactive p-2.5 rounded-xl border-2 transition-all duration-150 cursor-pointer shadow-xs flex items-center gap-2.5 bg-card ${
                        isMemberSelected
                          ? "border-primary ring-2 ring-primary/30 shadow-md scale-102"
                          : "border-border/80 hover:border-primary/60 hover:bg-accent/40"
                      }`}
                    >
                      <div className="h-8 w-8 rounded-lg bg-muted text-foreground flex items-center justify-center font-bold text-xs shrink-0 border">
                        {member.name?.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0 text-left">
                        <p className="text-xs font-bold text-foreground truncate">{member.name}</p>
                        <p className="text-[10px] text-muted-foreground font-semibold truncate">
                          {member.designation || formatRole(member.role?.name || "MEMBER")}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <Badge
                          className={`text-[9px] font-mono font-bold py-0 px-1 ${
                            progress >= 85
                              ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                              : progress >= 70
                              ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30"
                              : "bg-destructive/15 text-destructive border-destructive/30"
                          }`}
                        >
                          {progress}%
                        </Badge>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* 3. Nested Sub-Units (Child Branches) */}
            {hasChildren && (
              <div className="flex flex-col items-center w-full mt-2">
                {/* Stem down to child sub-units */}
                <div className="w-0.5 h-6 bg-primary" />
                <div className="flex justify-center items-start pt-0">
                  {unit.children.map((childUnit, cIdx) =>
                    renderUnitBranch(
                      childUnit,
                      cIdx === 0,
                      cIdx === unit.children.length - 1,
                      unit.children.length === 1
                    )
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-[1800px] mx-auto flex flex-col h-[calc(100vh-80px)]">
      {/* Top Header & Interactive Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 shrink-0">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight flex items-center gap-3 text-foreground">
              <GitBranch className="h-7 w-7 text-primary" />
              Organization Hierarchy Tree
            </h1>
            <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-600 border-emerald-500/30 gap-1 font-semibold">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              Live DB Synced
            </Badge>
          </div>
          <p className="text-muted-foreground text-xs sm:text-sm mt-0.5 font-medium">
            Multi-tier executive hierarchy &bull; Real-time dynamic synchronization with database
          </p>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Sync Button */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchHierarchy(false)}
            disabled={syncing || loading}
            className="h-8 text-xs font-semibold gap-1.5 bg-card"
            title={`Last synced: ${lastSynced}`}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin text-primary" : ""}`} />
            {syncing ? "Syncing..." : "Sync DB"}
          </Button>

          {/* Search */}
          <div className="relative w-48">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search people & units..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 h-8 text-xs bg-card"
            />
          </div>

          {/* Zoom / Pan Bar */}
          <div className="flex items-center border rounded-lg bg-card p-0.5 shadow-xs">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setZoom((prev) => Math.max(0.35, Number((prev - 0.1).toFixed(2))))}
              title="Zoom Out"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </Button>
            <span className="text-xs font-mono px-2 font-bold select-none">{Math.round(zoom * 100)}%</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setZoom((prev) => Math.min(1.6, Number((prev + 0.1).toFixed(2))))}
              title="Zoom In"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={handleFitView}
              title="Fit to Screen"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={handleResetView}
              title="Reset View"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowInspector(!showInspector)}
            className="gap-1.5 h-8 text-xs font-bold"
          >
            {showInspector ? <PanelRightClose className="h-3.5 w-3.5" /> : <PanelRightOpen className="h-3.5 w-3.5" />}
            {showInspector ? "Hide Inspector" : "Inspector"}
          </Button>

          <Button
            size="sm"
            onClick={() => {
              setNewUnitParentId("none")
              setAddNodeType("unit")
              setShowAddModal(true)
            }}
            className="gap-1.5 h-8 text-xs font-bold"
          >
            <Plus className="h-3.5 w-3.5" /> Add Node
          </Button>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-destructive/10 text-destructive text-xs rounded-xl border border-destructive/20 shrink-0 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setError(null)} className="h-6 text-xs">
            Dismiss
          </Button>
        </div>
      )}

      {success && (
        <div className="p-3 bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 text-xs rounded-xl shrink-0 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{success}</span>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setSuccess(null)} className="h-6 text-xs text-emerald-600 hover:text-emerald-700">
            Dismiss
          </Button>
        </div>
      )}

      {/* Main Canvas Viewport with Overlay Inspector */}
      <div className="flex-1 relative rounded-2xl border-2 border-border bg-card shadow-md flex flex-col min-h-0 overflow-hidden">
        {/* Canvas Sub-header */}
        <div className="px-4 py-2 border-b bg-muted/40 flex items-center justify-between shrink-0 z-10">
          <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-foreground">
            <Building2 className="h-4 w-4 text-primary" />
            <span>{organization?.name || "Organization Workspace"}</span>
            <Badge variant="outline" className="text-[10px] uppercase font-mono ml-1">
              {organization?.type || "INSTITUTION"}
            </Badge>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <span className="flex items-center gap-1 font-bold text-emerald-600 dark:text-emerald-400">
              <User className="h-3.5 w-3.5" /> {totalStaffCount} Members
            </span>
            <span className="text-muted-foreground font-bold">|</span>
            <span className="flex items-center gap-1 font-bold text-primary">
              <Building2 className="h-3.5 w-3.5" /> {totalDepartmentCount} Units
            </span>
            <span className="text-muted-foreground font-bold">|</span>
            <span className="text-muted-foreground text-[11px]">Synced: {lastSynced}</span>
          </div>
        </div>

        {/* Interactive Drag/Pan/Zoom Canvas */}
        <div
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          className="flex-1 overflow-auto p-4 sm:p-6 relative flex justify-center items-start cursor-grab active:cursor-grabbing select-none bg-background"
          style={{
            backgroundImage: `radial-gradient(var(--border) 1px, transparent 1px)`,
            backgroundSize: "24px 24px",
          }}
        >
          {loading ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground space-y-3">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm font-bold">Building hierarchical topology from database...</p>
            </div>
          ) : (
            <div
              ref={treeRef}
              className="transition-transform duration-100 origin-top flex flex-col items-center pb-20 pt-2 w-full max-w-full"
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              }}
            >
              {/* ------------------------------------------------------------- */}
              {/* LEVEL 0: EXECUTIVE ROOT NODE (DIRECTOR & ORGANIZATION) */}
              {/* ------------------------------------------------------------- */}
              {director && (
                <div className="flex flex-col items-center relative">
                  <div
                    onClick={() => handleSelectMember(director, false)}
                    onDoubleClick={() => handleSelectMember(director, true)}
                    title="Click to inspect, Double-click to open Inspector"
                    className={`tree-node-interactive cursor-pointer w-80 p-4 rounded-2xl border-2 transition-all duration-200 shadow-lg bg-card ${
                      selectedNode?.data?.id === director.id
                        ? "border-primary ring-3 ring-primary/30 shadow-primary/20 scale-102"
                        : "border-primary/60 hover:border-primary hover:shadow-xl"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-12 w-12 rounded-xl bg-primary text-primary-foreground flex items-center justify-center font-black text-xl shadow-md shrink-0">
                        <Crown className="h-6 w-6" />
                      </div>
                      <div className="flex-1 min-w-0 text-left">
                        <div className="flex items-center gap-1.5">
                          <span className="font-extrabold text-sm text-foreground truncate block">
                            {director.name}
                          </span>
                          <Badge className="bg-primary text-primary-foreground text-[9px] font-black py-0 px-1.5 uppercase">
                            Director
                          </Badge>
                        </div>
                        <p className="text-xs text-primary font-bold truncate mt-0.5">
                          {director.designation || "Executive Director & Chancellor"}
                        </p>
                        <p className="text-[10px] text-muted-foreground truncate font-mono">
                          {director.email}
                        </p>
                      </div>
                    </div>

                    <div className="mt-3 pt-2.5 border-t border-border flex items-center justify-between text-[11px] font-semibold">
                      <span className="text-muted-foreground">{organization?.name}</span>
                      <span className="font-bold text-emerald-600 dark:text-emerald-400 font-mono">
                        {totalDepartmentCount} Units &bull; {totalStaffCount} Members
                      </span>
                    </div>
                  </div>

                  {/* Trunk Stem Line Down to Root Units */}
                  {tree.length > 0 && <div className="w-0.5 h-8 bg-primary shadow-xs" />}
                </div>
              )}

              {/* ------------------------------------------------------------- */}
              {/* LEVEL 1+: MULTI-TIER RECURSIVE HIERARCHY BRANCHES */}
              {/* ------------------------------------------------------------- */}
              {tree.length > 0 ? (
                <div className="w-full flex justify-center">
                  <div className="flex justify-center items-start">
                    {tree.map((unit, idx) =>
                      renderUnitBranch(unit, idx === 0, idx === tree.length - 1, tree.length === 1)
                    )}
                  </div>
                </div>
              ) : (
                <div className="p-8 border-2 border-dashed rounded-2xl text-center max-w-md bg-card mt-6">
                  <Building2 className="h-10 w-10 text-muted-foreground mx-auto mb-3 opacity-60" />
                  <h3 className="font-bold text-sm">No Departments Configured</h3>
                  <p className="text-xs text-muted-foreground mt-1 mb-4">
                    Use the &quot;Add Node&quot; button above or import via CSV to establish your department hierarchy.
                  </p>
                  <Button
                    size="sm"
                    onClick={() => {
                      setNewUnitParentId("none")
                      setAddNodeType("unit")
                      setShowAddModal(true)
                    }}
                    className="h-8 text-xs font-bold gap-1.5"
                  >
                    <Plus className="h-3.5 w-3.5" /> Create First Department
                  </Button>
                </div>
              )}

              {/* ------------------------------------------------------------- */}
              {/* UNASSIGNED MEMBERS POOL */}
              {/* ------------------------------------------------------------- */}
              {unassignedMembers.length > 0 && (
                <div className="w-full max-w-2xl pt-8 border-t-2 border-dashed border-border mt-12">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4 text-muted-foreground" />
                      <span className="text-xs font-black uppercase tracking-wider text-muted-foreground">
                        Unassigned Members Pool ({unassignedMembers.length})
                      </span>
                    </div>
                    <span className="text-[11px] text-muted-foreground">
                      Click any member to assign them to a department in Inspector
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                    {unassignedMembers.map((m) => (
                      <div
                        key={m.id}
                        onClick={() => handleSelectMember(m, false)}
                        onDoubleClick={() => handleSelectMember(m, true)}
                        title="Click to select, Double-click to assign in Inspector"
                        className={`tree-node-interactive p-2.5 rounded-xl border-2 text-left cursor-pointer transition flex items-center gap-2.5 bg-card ${
                          selectedNode?.data?.id === m.id
                            ? "border-primary bg-primary/10 shadow-xs scale-102"
                            : "border-border hover:border-primary/60"
                        }`}
                      >
                        <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center text-xs font-bold shrink-0 border">
                          {m.name?.charAt(0)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-bold truncate text-foreground">{m.name}</p>
                          <p className="text-[10px] text-muted-foreground truncate font-mono">{m.email}</p>
                        </div>
                        <Badge variant="outline" className="text-[9px] px-1 py-0 shrink-0">
                          Unassigned
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ========================================================================= */}
        {/* OVERLAY SLIDE-OVER INSPECTOR PANEL (Right-Aligned) */}
        {/* ========================================================================= */}
        {showInspector && (
          <div className="inspector-panel absolute top-0 right-0 bottom-0 w-full sm:w-[400px] z-30 bg-background/95 backdrop-blur-md border-l-2 border-border shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
            <div className="p-3.5 border-b flex items-center justify-between bg-muted/40">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-primary" />
                <span className="text-xs font-black uppercase tracking-wider text-foreground">
                  Node Inspector & Settings
                </span>
              </div>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setShowInspector(false)}
                className="h-7 w-7 rounded-full hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {selectedNode?.type === "member" ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-3 p-3 rounded-xl border bg-card">
                    <div className="h-10 w-10 rounded-xl bg-primary text-primary-foreground flex items-center justify-center font-extrabold text-base shadow-sm shrink-0">
                      {selectedNode.data.name?.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0 text-left">
                      <h4 className="text-sm font-black truncate text-foreground">
                        {selectedNode.data.name}
                      </h4>
                      <p className="text-[11px] text-muted-foreground truncate font-mono">
                        {selectedNode.data.email}
                      </p>
                    </div>
                    <Badge variant="outline" className="text-[9px] uppercase font-bold px-1.5 py-0">
                      {selectedNode.data.role?.name || "Member"}
                    </Badge>
                  </div>

                  <div className="space-y-3 text-left">
                    <div className="space-y-1">
                      <Label className="text-xs font-bold text-foreground">Full Name</Label>
                      <Input
                        value={inspectorName}
                        onChange={(e) => setInspectorName(e.target.value)}
                        className="h-8 text-xs rounded-lg bg-card"
                        disabled={actionLoading}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs font-bold text-foreground">Employee ID</Label>
                        <Input
                          value={inspectorEmployeeId}
                          onChange={(e) => setInspectorEmployeeId(e.target.value)}
                          placeholder="EMP-001"
                          className="h-8 text-xs rounded-lg bg-card"
                          disabled={actionLoading}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs font-bold text-foreground">Designation</Label>
                        <Input
                          value={inspectorDesignation}
                          onChange={(e) => setInspectorDesignation(e.target.value)}
                          placeholder="Professor / Lead"
                          className="h-8 text-xs rounded-lg bg-card"
                          disabled={actionLoading}
                        />
                      </div>
                    </div>

                    <div className="space-y-1 text-left">
                      <Label className="text-xs font-bold text-foreground">Department Assignment</Label>
                      <Select
                        value={inspectorUnitId || "none"}
                        onValueChange={setInspectorUnitId}
                        disabled={actionLoading}
                      >
                        <SelectTrigger className="h-8 text-xs rounded-lg bg-card">
                          <SelectValue placeholder="Unassigned / Executive Root" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">-- Unassigned Pool --</SelectItem>
                          {flatUnits.map((u) => (
                            <SelectItem key={u.id} value={u.id}>
                              {u.name} ({u.unit_type || "Department"})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1 text-left">
                      <Label className="text-xs font-bold text-foreground">System Role Scope</Label>
                      <Select
                        value={inspectorRoleId || "none"}
                        onValueChange={setInspectorRoleId}
                        disabled={actionLoading}
                      >
                        <SelectTrigger className="h-8 text-xs rounded-lg bg-card">
                          <SelectValue placeholder="Select Role..." />
                        </SelectTrigger>
                        <SelectContent>
                          {roles.map((r) => (
                            <SelectItem key={r.id} value={r.id}>
                              {r.name} ({r.scope_level || "ROLE"})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Quick Action: Promote to Lead */}
                    {inspectorUnitId && inspectorUnitId !== "none" && (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => handlePromoteToLead(selectedNode.data, inspectorUnitId)}
                        disabled={actionLoading}
                        className="w-full h-8 text-xs font-bold gap-1.5 border"
                      >
                        <Crown className="h-3.5 w-3.5 text-amber-500" />
                        Set as Department Lead (HOD)
                      </Button>
                    )}

                    <div className="space-y-1 text-left">
                      <Label className="text-xs font-bold text-foreground">Personal Ledger Wallet</Label>
                      <div className="flex items-center gap-1.5">
                        <Input
                          value={inspectorWalletAddress}
                          readOnly
                          className="h-8 text-[10px] font-mono bg-muted/60 rounded-lg"
                        />
                        <Button
                          size="icon"
                          variant="outline"
                          onClick={handleCopyWallet}
                          className="h-8 w-8 shrink-0 rounded-lg"
                        >
                          {copiedAddress ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                        </Button>
                      </div>
                    </div>
                  </div>

                  {/* Permissions */}
                  <div className="pt-3 border-t space-y-2 text-left">
                    <Label className="text-[11px] font-black uppercase tracking-wider text-muted-foreground block">
                      Access Permissions Override
                    </Label>
                    <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                      {permissions.map((p) => (
                        <div key={p.id} className="flex items-center gap-2 text-xs">
                          <input
                            type="checkbox"
                            id={`perm-${p.id}`}
                            checked={inspectorPermissions[p.id] || false}
                            onChange={(e) => {
                              setInspectorPermissions((prev) => ({
                                ...prev,
                                [p.id]: e.target.checked,
                              }))
                            }}
                            disabled={actionLoading}
                            className="h-3.5 w-3.5 rounded border-muted text-primary accent-primary"
                          />
                          <label
                            htmlFor={`perm-${p.id}`}
                            className="text-xs cursor-pointer text-muted-foreground truncate font-medium"
                          >
                            {p.description || `${p.scope}.${p.action}`}
                          </label>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="pt-3 border-t flex items-center gap-2">
                    <Button
                      onClick={handleSaveChanges}
                      disabled={actionLoading}
                      className="flex-1 h-9 text-xs rounded-xl font-bold shadow-xs"
                    >
                      {actionLoading && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                      Save & Sync
                    </Button>
                    <Button
                      variant="outline"
                      onClick={handleRemoveMember}
                      disabled={actionLoading}
                      className="h-9 px-3 text-destructive border-destructive/20 hover:bg-destructive/10 rounded-xl shrink-0"
                      title="Remove Member"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ) : selectedNode?.type === "unit" ? (
                <div className="space-y-4 text-left">
                  <div className="flex items-center gap-3 p-3 rounded-xl border bg-card">
                    <div className="p-2.5 rounded-xl bg-primary/15 text-primary shadow-xs">
                      <Building2 className="h-6 w-6" />
                    </div>
                    <div className="text-left">
                      <h3 className="text-sm font-black text-foreground">{selectedNode.data.name}</h3>
                      <p className="text-[10px] text-primary font-bold uppercase tracking-wider">
                        {selectedNode.data.unit_type || "DEPARTMENT"}
                      </p>
                    </div>
                  </div>

                  <div className="pt-3 border-t text-xs text-muted-foreground space-y-2 font-medium">
                    <p>
                      <strong>Unit ID:</strong>{" "}
                      <span className="font-mono text-[11px] text-foreground">{selectedNode.data.id}</span>
                    </p>
                    <p>
                      <strong>Department Lead:</strong>{" "}
                      <span className="font-semibold text-foreground">
                        {selectedNode.data.lead ? selectedNode.data.lead.name : "Unassigned (Click member to promote)"}
                      </span>
                    </p>
                    <p>
                      <strong>Staff Headcount:</strong>{" "}
                      <span className="font-semibold text-foreground">
                        {selectedNode.data.totalMemberCount} Active Faculty/Staff
                      </span>
                    </p>
                    <p>
                      <strong>Sub-Departments:</strong>{" "}
                      <span className="font-semibold text-foreground">
                        {selectedNode.data.children?.length || 0} Nested Units
                      </span>
                    </p>
                  </div>

                  <div className="pt-3 border-t space-y-2">
                    <Button
                      size="sm"
                      onClick={() => {
                        setNewUnitParentId(selectedNode.data.id)
                        setAddNodeType("unit")
                        setShowAddModal(true)
                      }}
                      className="w-full h-8 text-xs font-bold gap-1.5"
                    >
                      <Plus className="h-3.5 w-3.5" /> Add Sub-Unit Under {selectedNode.data.name}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="p-6 border-2 border-dashed rounded-xl text-center text-muted-foreground text-xs">
                  Double-click on any card in the tree to inspect details.
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ------------------------------------------------------------- */}
      {/* ADD NODE MODAL (With Parent Unit Selector for Multi-Tier Hierarchy) */}
      {/* ------------------------------------------------------------- */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <Card className="w-full max-w-md rounded-2xl shadow-2xl border-2 bg-background animate-in zoom-in-95 duration-150">
            <div className="p-4 border-b flex items-center justify-between">
              <h3 className="font-bold text-base">Add New Structure Node</h3>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setShowAddModal(false)}
                className="h-7 w-7 rounded-full"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <form onSubmit={handleAddNodeSubmit}>
              <CardContent className="p-5 space-y-4">
                <div className="flex border-b pb-3 gap-4">
                  <button
                    type="button"
                    onClick={() => setAddNodeType("unit")}
                    className={`flex-1 pb-2 text-center text-xs font-bold border-b-2 transition-all ${
                      addNodeType === "unit" ? "border-primary text-primary" : "border-transparent text-muted-foreground"
                    }`}
                  >
                    Department / Sub-Unit
                  </button>
                  <button
                    type="button"
                    onClick={() => setAddNodeType("member")}
                    className={`flex-1 pb-2 text-center text-xs font-bold border-b-2 transition-all ${
                      addNodeType === "member" ? "border-primary text-primary" : "border-transparent text-muted-foreground"
                    }`}
                  >
                    Team Member
                  </button>
                </div>

                {addNodeType === "unit" ? (
                  <div className="space-y-3 text-left">
                    <div className="space-y-1">
                      <Label className="text-xs font-bold">Unit / Department Name</Label>
                      <Input
                        placeholder="e.g. AI & Robotics Lab, Civil Engineering"
                        value={newUnitName}
                        onChange={(e) => setNewUnitName(e.target.value)}
                        required
                        className="h-8 text-xs rounded-lg"
                      />
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs font-bold">Parent Department (Hierarchy Level)</Label>
                      <Select value={newUnitParentId} onValueChange={setNewUnitParentId}>
                        <SelectTrigger className="h-8 text-xs rounded-lg">
                          <SelectValue placeholder="Top Level (Directly under Director)" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">
                            <strong>Top Level</strong> (Root Department under Director)
                          </SelectItem>
                          {flatUnits.map((u) => (
                            <SelectItem key={u.id} value={u.id}>
                              {u.name} ({u.unit_type || "Department"})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-[10px] text-muted-foreground">
                        Select an existing department to create a nested sub-unit (e.g. lab, team, or section).
                      </p>
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs font-bold">Unit Type</Label>
                      <Select value={newUnitType} onValueChange={setNewUnitType}>
                        <SelectTrigger className="h-8 text-xs rounded-lg">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ACADEMIC_DEPARTMENT">Academic Department</SelectItem>
                          <SelectItem value="ADMIN_DEPARTMENT">Administrative Department</SelectItem>
                          <SelectItem value="DIVISION">Division</SelectItem>
                          <SelectItem value="TEAM">Team / Lab</SelectItem>
                          <SelectItem value="COMMITTEE">Committee</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3 text-left">
                    <div className="space-y-1">
                      <Label className="text-xs font-bold">Full Name</Label>
                      <Input
                        placeholder="e.g. Dr. Rajesh Sharma"
                        value={newMemberName}
                        onChange={(e) => setNewMemberName(e.target.value)}
                        required
                        className="h-8 text-xs rounded-lg"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs font-bold">Email Address</Label>
                      <Input
                        type="email"
                        placeholder="rajesh@institution.edu"
                        value={newMemberEmail}
                        onChange={(e) => setNewMemberEmail(e.target.value)}
                        required
                        className="h-8 text-xs rounded-lg"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs font-bold">Employee ID</Label>
                        <Input
                          placeholder="FAC-042"
                          value={newMemberEmployeeId}
                          onChange={(e) => setNewMemberEmployeeId(e.target.value)}
                          className="h-8 text-xs rounded-lg"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs font-bold">Designation</Label>
                        <Input
                          placeholder="Associate Professor"
                          value={newMemberDesignation}
                          onChange={(e) => setNewMemberDesignation(e.target.value)}
                          className="h-8 text-xs rounded-lg"
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs font-bold">Department</Label>
                      <Select value={newMemberUnitId} onValueChange={setNewMemberUnitId}>
                        <SelectTrigger className="h-8 text-xs rounded-lg">
                          <SelectValue placeholder="Select Department" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">-- Unassigned Pool --</SelectItem>
                          {flatUnits.map((u) => (
                            <SelectItem key={u.id} value={u.id}>
                              {u.name} ({u.unit_type || "Department"})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs font-bold">Role</Label>
                      <Select value={newMemberRoleId} onValueChange={setNewMemberRoleId}>
                        <SelectTrigger className="h-8 text-xs rounded-lg">
                          <SelectValue placeholder="Select Role" />
                        </SelectTrigger>
                        <SelectContent>
                          {roles.map((r) => (
                            <SelectItem key={r.id} value={r.id}>
                              {r.name} ({r.scope_level})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-2 pt-3 border-t">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowAddModal(false)}
                    className="flex-1 h-8 text-xs rounded-lg"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={actionLoading}
                    className="flex-1 h-8 text-xs rounded-lg font-bold"
                  >
                    {actionLoading && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                    {addNodeType === "unit" ? "Create Unit" : "Confirm & Send Invite"}
                  </Button>
                </div>
              </CardContent>
            </form>
          </Card>
        </div>
      )}

      {/* Generated Invite Link Confirmation Modal */}
      {generatedInvite && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <Card className="w-full max-w-md rounded-2xl shadow-2xl border-2 bg-background animate-in zoom-in-95 duration-150">
            <div className="p-4 border-b flex items-center justify-between bg-primary/5">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-600">
                  <Check className="h-4 w-4" />
                </div>
                <h3 className="font-extrabold text-base text-foreground">Invitation Link Active</h3>
              </div>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setGeneratedInvite(null)}
                className="h-7 w-7 rounded-full"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <CardContent className="p-5 space-y-4">
              <div className="p-3 rounded-xl bg-muted/40 border space-y-1">
                <p className="text-xs font-bold text-foreground">Invited Member: {generatedInvite.name}</p>
                <p className="text-xs text-muted-foreground font-mono">{generatedInvite.email}</p>
              </div>

              <div className="space-y-1.5 text-left">
                <Label className="text-xs font-bold text-foreground">Direct Onboarding Link</Label>
                <div className="flex items-center gap-1.5">
                  <Input value={generatedInvite.link} readOnly className="h-9 text-xs font-mono bg-card" />
                  <Button
                    size="sm"
                    onClick={() => {
                      navigator.clipboard.writeText(generatedInvite.link)
                      setCopiedInviteLink(true)
                      setTimeout(() => setCopiedInviteLink(false), 2000)
                    }}
                    className="h-9 px-3 text-xs gap-1.5 shrink-0 font-bold"
                  >
                    {copiedInviteLink ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                    {copiedInviteLink ? "Copied!" : "Copy Link"}
                  </Button>
                </div>
              </div>

              <Button
                onClick={() => setGeneratedInvite(null)}
                className="w-full h-9 text-xs font-bold rounded-xl"
              >
                Done
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
