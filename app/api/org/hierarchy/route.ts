import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getSessionUser } from "@/lib/auth/session"

async function resolveAuthUser(req: Request) {
  const sessionUser = await getSessionUser()
  if (sessionUser) return sessionUser

  const authHeader = req.headers.get("Authorization")
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.replace("Bearer ", "").trim()
    const adminClient = createAdminClient()
    const { data: authData } = await adminClient.auth.getUser(token)
    if (authData?.user) {
      const { data: userRec } = await (adminClient as any)
        .from("users")
        .select("id, email, name, organization_id, org_unit_id")
        .eq("id", authData.user.id)
        .maybeSingle()
      if (userRec) {
        return {
          id: userRec.id,
          email: userRec.email,
          name: userRec.name,
          organizationId: userRec.organization_id,
          orgUnitId: userRec.org_unit_id,
          roles: [] as string[],
          scopeLevels: ["DIRECTOR", "SYSTEM_ADMIN"] as string[],
        }
      }
    }
  }
  return null
}

export async function GET(req: Request) {
  try {
    const sessionUser = await resolveAuthUser(req)
    if (!sessionUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const orgId = searchParams.get("orgId") || sessionUser.organizationId

    if (!orgId) {
      return NextResponse.json({ error: "Organization ID is required" }, { status: 400 })
    }

    const admin = createAdminClient()
    const db = admin as any

    // 1. Fetch organization details
    const { data: organization, error: orgErr } = await db
      .from("organizations")
      .select("id, name, type, created_at")
      .eq("id", orgId)
      .single()

    if (orgErr || !organization) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 })
    }

    // 2. Fetch all organizational units
    const { data: unitsData, error: unitsErr } = await db
      .from("org_units")
      .select("id, name, unit_type, parent_id, path, lead_user_id, created_at, updated_at")
      .eq("organization_id", orgId)
      .order("name", { ascending: true })

    if (unitsErr) {
      return NextResponse.json({ error: unitsErr.message }, { status: 500 })
    }

    const allUnits = unitsData || []

    // 3. Fetch all members in organization
    const { data: usersData, error: usersErr } = await db
      .from("users")
      .select("id, name, email, employee_id, designation, org_unit_id, status, created_at, updated_at")
      .eq("organization_id", orgId)
      .order("name", { ascending: true })

    if (usersErr) {
      return NextResponse.json({ error: usersErr.message }, { status: 500 })
    }

    const allUsers = usersData || []

    // 4. Fetch roles for this organization
    const { data: rolesData } = await db
      .from("roles")
      .select("id, name, scope_level")
      .eq("organization_id", orgId)

    const roles = rolesData || []
    const roleById = new Map<string, any>(roles.map((r: any) => [r.id, r]))

    // 5. Fetch user_roles for members in this organization
    const userIds = allUsers.map((u: any) => u.id)
    let userRoles: any[] = []
    if (userIds.length > 0) {
      const { data: urData } = await db
        .from("user_roles")
        .select("user_id, role_id, roles(id, name, scope_level)")
        .in("user_id", userIds)
      userRoles = urData || []
    }

    // 6. Fetch monthly progress
    const todayStr = new Date().toISOString().split("T")[0]
    const currentMonthStart = `${todayStr.slice(0, 7)}-01`
    const { data: progressData } = await db
      .from("monthly_work_progress")
      .select("user_id, display_progress_percentage")
      .eq("organization_id", orgId)
      .eq("month_start", currentMonthStart)

    const progressMap = new Map<string, number>(
      (progressData || []).map((p: any) => [p.user_id, Number(p.display_progress_percentage || 0)])
    )

    // 7. Fetch system permissions
    const { data: permissionsData } = await db.from("permissions").select("*")
    const permissions = permissionsData || []

    // 8. Map roles to members with role hierarchy priority
    // Priority: DIRECTOR > ORG_UNIT_LEAD > DEPT_ADMIN > FINANCE_ADMIN > SYSTEM_ADMIN > MEMBER
    const rolePriorityOrder: Record<string, number> = {
      DIRECTOR: 100,
      ORG_UNIT_LEAD: 80,
      DEPT_ADMIN: 60,
      FINANCE_ADMIN: 50,
      SYSTEM_ADMIN: 40,
      MEMBER: 10,
    }

    const userRolesMap = new Map<string, any[]>()
    for (const ur of userRoles) {
      const list = userRolesMap.get(ur.user_id) || []
      const roleObj = ur.roles || roleById.get(ur.role_id)
      if (roleObj) {
        list.push({ ...roleObj, role_id: ur.role_id })
      }
      userRolesMap.set(ur.user_id, list)
    }

    // Set of user IDs marked as unit leads in org_units table
    const leadUserIdSet = new Set(
      allUnits.map((u: any) => u.lead_user_id).filter(Boolean)
    )

    const formattedMembers = allUsers.map((u: any) => {
      const assignedRoles = userRolesMap.get(u.id) || []
      assignedRoles.sort((a, b) => {
        const pA = rolePriorityOrder[a.scope_level] || 0
        const pB = rolePriorityOrder[b.scope_level] || 0
        return pB - pA
      })

      let primaryRole = assignedRoles[0] || null

      // Fallback if role is not in user_roles table:
      if (!primaryRole) {
        if (leadUserIdSet.has(u.id) || u.designation?.toLowerCase().includes("hod") || u.designation?.toLowerCase().includes("lead")) {
          primaryRole = roles.find((r: any) => r.scope_level === "ORG_UNIT_LEAD") || {
            id: "lead-role",
            name: "HOD / Dept Lead",
            scope_level: "ORG_UNIT_LEAD",
          }
        } else if (u.designation?.toLowerCase().includes("director") || (!u.org_unit_id && u.id === sessionUser.id)) {
          primaryRole = roles.find((r: any) => r.scope_level === "DIRECTOR") || {
            id: "director-role",
            name: "Director",
            scope_level: "DIRECTOR",
          }
        } else {
          primaryRole = roles.find((r: any) => r.scope_level === "MEMBER") || {
            id: "member-role",
            name: "Faculty Member",
            scope_level: "MEMBER",
          }
        }
      }

      return {
        id: u.id,
        name: u.name || "Unnamed User",
        email: u.email,
        employee_id: u.employee_id || null,
        designation: u.designation || primaryRole?.name || "Staff Member",
        org_unit_id: u.org_unit_id || null,
        status: u.status || "ACTIVE",
        progress_percentage: progressMap.get(u.id) || 0,
        role: primaryRole,
        roleId: primaryRole?.id || primaryRole?.role_id,
        isUnitLead: leadUserIdSet.has(u.id) || primaryRole?.scope_level === "ORG_UNIT_LEAD",
      }
    })

    // 9. Identify Primary Director
    const director =
      formattedMembers.find((m: any) => m.role?.scope_level === "DIRECTOR") ||
      formattedMembers.find((m: any) => !m.org_unit_id) ||
      formattedMembers[0] ||
      null

    // 10. Filter out empty default seed unit "Main" if other real departments exist
    const realDepartmentsExist = allUnits.some(
      (u: any) => u.name.toLowerCase() !== "main"
    )

    let visibleUnits = allUnits
    if (realDepartmentsExist) {
      visibleUnits = allUnits.filter((u: any) => {
        if (u.name.toLowerCase() === "main") {
          const hasStaff = formattedMembers.some((m: any) => m.org_unit_id === u.id)
          const hasChildren = allUnits.some((child: any) => child.parent_id === u.id)
          return hasStaff || hasChildren
        }
        return true
      })
    }

    const unitIdSet = new Set(visibleUnits.map((u: any) => u.id))

    // 11. Build recursive hierarchical tree
    // Root units: units with parent_id null OR parent_id not in visibleUnits
    const rootUnits = visibleUnits.filter(
      (u: any) => !u.parent_id || !unitIdSet.has(u.parent_id)
    )

    function buildUnitNode(unit: any): any {
      const unitMembers = formattedMembers.filter((m: any) => m.org_unit_id === unit.id)

      // Find department lead:
      // Either user matching lead_user_id, or first user with ORG_UNIT_LEAD role
      let lead = unitMembers.find((m: any) => m.id === unit.lead_user_id)
      if (!lead) {
        lead = unitMembers.find((m: any) => m.role?.scope_level === "ORG_UNIT_LEAD")
      }

      const regularMembers = unitMembers.filter((m: any) => m.id !== lead?.id)
      const childUnits = visibleUnits.filter((child: any) => child.parent_id === unit.id)

      return {
        id: unit.id,
        name: unit.name,
        unit_type: unit.unit_type || "ACADEMIC_DEPARTMENT",
        parent_id: unit.parent_id,
        path: unit.path,
        leadUserId: lead?.id || unit.lead_user_id || null,
        lead: lead || null,
        members: regularMembers,
        totalMemberCount: unitMembers.length,
        children: childUnits.map(buildUnitNode),
      }
    }

    const hierarchicalTree = rootUnits.map(buildUnitNode)

    // 12. Unassigned members pool
    const assignedMemberIdSet = new Set(
      formattedMembers
        .filter((m: any) => m.org_unit_id && unitIdSet.has(m.org_unit_id))
        .map((m: any) => m.id)
    )

    const unassignedMembers = formattedMembers.filter(
      (m: any) => !assignedMemberIdSet.has(m.id) && m.id !== director?.id
    )

    return NextResponse.json({
      success: true,
      organization,
      director,
      tree: hierarchicalTree,
      flatUnits: allUnits,
      unassignedMembers,
      roles,
      permissions,
      syncedAt: new Date().toISOString(),
    })
  } catch (error: any) {
    console.error("[org/hierarchy] GET error:", error)
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 }
    )
  }
}

export async function POST(req: Request) {
  try {
    const sessionUser = await resolveAuthUser(req)
    if (!sessionUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await req.json()
    const {
      organizationId,
      name,
      unitType = "ACADEMIC_DEPARTMENT",
      parentId = null,
      leadUserId = null,
    } = body

    const orgId = organizationId || sessionUser.organizationId
    if (!name?.trim()) {
      return NextResponse.json({ error: "Department or unit name is required." }, { status: 400 })
    }

    const admin = createAdminClient()
    const db = admin as any

    // Check duplicate name within the same parent in this organization
    const parentCheckQuery = parentId
      ? db.from("org_units").select("id").eq("organization_id", orgId).eq("parent_id", parentId).ilike("name", name.trim())
      : db.from("org_units").select("id").eq("organization_id", orgId).is("parent_id", null).ilike("name", name.trim())

    const { data: existing } = await parentCheckQuery.maybeSingle()
    if (existing) {
      return NextResponse.json(
        { error: `A unit named "${name.trim()}" already exists at this hierarchy level.` },
        { status: 400 }
      )
    }

    const newUnitId = crypto.randomUUID()
    let pathSlug = `n${newUnitId.replace(/-/g, "_")}`

    if (parentId && parentId !== "none") {
      const { data: parentUnit } = await db
        .from("org_units")
        .select("path")
        .eq("id", parentId)
        .single()
      if (parentUnit?.path) {
        pathSlug = `${parentUnit.path}.${pathSlug}`
      }
    }

    const effectiveParentId = parentId && parentId !== "none" ? parentId : null

    const { data: newUnit, error: insertErr } = await db
      .from("org_units")
      .insert({
        id: newUnitId,
        organization_id: orgId,
        name: name.trim(),
        unit_type: unitType,
        parent_id: effectiveParentId,
        path: pathSlug,
        lead_user_id: leadUserId || null,
      })
      .select()
      .single()

    if (insertErr || !newUnit) {
      console.error("[org/hierarchy] Unit insert error:", insertErr)
      return NextResponse.json(
        { error: insertErr?.message || "Failed to create unit in database." },
        { status: 500 }
      )
    }

    // If leadUserId provided, update user's department and role
    if (leadUserId) {
      await db.from("users").update({ org_unit_id: newUnitId }).eq("id", leadUserId)

      const { data: leadRole } = await db
        .from("roles")
        .select("id")
        .eq("organization_id", orgId)
        .eq("scope_level", "ORG_UNIT_LEAD")
        .single()

      if (leadRole) {
        await db
          .from("user_roles")
          .upsert({ user_id: leadUserId, role_id: leadRole.id }, { onConflict: "user_id,role_id" })
      }
    }

    return NextResponse.json({
      success: true,
      message: `Unit "${name.trim()}" created successfully.`,
      unit: newUnit,
    })
  } catch (error: any) {
    console.error("[org/hierarchy] POST error:", error)
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 }
    )
  }
}

export async function PATCH(req: Request) {
  try {
    const sessionUser = await resolveAuthUser(req)
    if (!sessionUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await req.json()
    const {
      organizationId,
      memberId,
      name,
      employeeId,
      designation,
      orgUnitId,
      roleId,
      permissionOverrides,
    } = body

    const orgId = organizationId || sessionUser.organizationId
    if (!memberId) {
      return NextResponse.json({ error: "Member ID is required." }, { status: 400 })
    }

    const admin = createAdminClient()
    const db = admin as any

    const effectiveUnitId = orgUnitId === "none" || !orgUnitId ? null : orgUnitId

    // 1. Update user record
    const { error: userUpdateErr } = await db
      .from("users")
      .update({
        name: name ? name.trim() : undefined,
        employee_id: employeeId !== undefined ? (employeeId?.trim() || null) : undefined,
        designation: designation !== undefined ? (designation?.trim() || null) : undefined,
        org_unit_id: effectiveUnitId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", memberId)
      .eq("organization_id", orgId)

    if (userUpdateErr) {
      return NextResponse.json({ error: userUpdateErr.message }, { status: 500 })
    }

    // 2. Fetch the assigned role details if roleId was passed
    let isLeadRole = false
    if (roleId && roleId !== "none") {
      const { data: roleData } = await db
        .from("roles")
        .select("scope_level")
        .eq("id", roleId)
        .single()

      isLeadRole = roleData?.scope_level === "ORG_UNIT_LEAD"

      // Remove current roles and assign new primary role
      await db.from("user_roles").delete().eq("user_id", memberId)
      await db.from("user_roles").insert({
        user_id: memberId,
        role_id: roleId,
      })
    }

    // 3. Atomically sync org_units lead_user_id
    if (isLeadRole && effectiveUnitId) {
      // Set as lead for this unit
      await db
        .from("org_units")
        .update({ lead_user_id: memberId })
        .eq("id", effectiveUnitId)
    } else {
      // If user is no longer lead of this unit or moved to none, clear them if they were previously the lead
      await db
        .from("org_units")
        .update({ lead_user_id: null })
        .eq("lead_user_id", memberId)
        .neq("id", effectiveUnitId || "")
    }

    // 4. Update permission overrides if provided
    if (permissionOverrides && typeof permissionOverrides === "object") {
      for (const [permId, isAllowed] of Object.entries(permissionOverrides)) {
        await db.from("permission_overrides").upsert({
          user_id: memberId,
          permission_id: permId,
          is_allowed: Boolean(isAllowed),
        })
      }
    }

    return NextResponse.json({
      success: true,
      message: "Member updated and leadership synchronized successfully.",
    })
  } catch (error: any) {
    console.error("[org/hierarchy] PATCH error:", error)
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 }
    )
  }
}
