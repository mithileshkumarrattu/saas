import { createAdminClient } from "@/lib/supabase/admin"
import { getSessionUser } from "@/lib/auth/session"
import { NextResponse } from "next/server"

interface ImportRowInput {
  full_name?: string
  name?: string
  faculty_name?: string
  email?: string
  faculty_email?: string
  designation?: string
  role?: string
  department?: string
  faculty_id?: string
  employee_id?: string
}

export async function POST(req: Request) {
  try {
    const user = await getSessionUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const hasAdminScope =
      user.scopeLevels.includes("SYSTEM_ADMIN") ||
      user.scopeLevels.includes("DIRECTOR")

    if (!hasAdminScope) {
      return NextResponse.json({ error: "Forbidden: System Admin permissions required." }, { status: 403 })
    }

    const body = await req.json()
    const rows = body.rows || body.users || []
    const dryRun = body.dryRun ?? false

    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: "No user rows provided." }, { status: 400 })
    }

    const admin = createAdminClient()
    const db = admin as any
    const orgId = user.organizationId

    // 1. Fetch organization details, units, and roles
    const [{ data: org }, { data: orgUnits }, { data: roles }] = await Promise.all([
      db.from("organizations").select("id, name").eq("id", orgId).single(),
      db.from("org_units").select("id, name").eq("organization_id", orgId),
      db.from("roles").select("id, name, scope_level").eq("organization_id", orgId),
    ])

    const unitByName = new Map<string, string>()
    for (const u of orgUnits || []) {
      unitByName.set(u.name.toLowerCase().trim(), u.id)
    }

    const roleByScope = new Map<string, string>()
    for (const r of roles || []) {
      roleByScope.set(r.scope_level, r.id)
    }

    const defaultPassword = process.env.BULK_IMPORT_DEFAULT_PASSWORD || "Welcome@WorkLedger2026!"

    // 2. Validate and normalize rows
    const validRows: any[] = []
    const rejectedRows: Array<{ rowNumber: number; row: ImportRowInput; reason: string }> = []
    const newDeptsToCreate = new Set<string>()

    for (let i = 0; i < rows.length; i++) {
      const row: ImportRowInput = rows[i]
      const rowNum = i + 1

      const email = (row.email || row.faculty_email || "").trim().toLowerCase()
      const name = (row.full_name || row.name || row.faculty_name || "").trim()
      const designation = (row.designation || "Staff Member").trim()
      const roleStr = (row.role || "MEMBER").trim().toUpperCase()
      const deptName = (row.department || "").trim()
      let facultyId = (row.faculty_id || row.employee_id || (row as any).employeeId || "").trim()

      if (!name) {
        rejectedRows.push({ rowNumber: rowNum, row, reason: "Full name is required." })
        continue
      }

      if (!email || !email.includes("@")) {
        rejectedRows.push({ rowNumber: rowNum, row, reason: `Invalid email address: "${email}"` })
        continue
      }

      // Map role string to standard scope_level
      let scopeLevel = "MEMBER"
      if (roleStr === "SYSTEM_ADMIN" || roleStr.includes("SYS_ADMIN")) {
        scopeLevel = "SYSTEM_ADMIN"
      } else if (roleStr === "DIRECTOR") {
        scopeLevel = "DIRECTOR"
      } else if (roleStr === "ORG_UNIT_LEAD" || roleStr === "HOD" || roleStr.includes("HEAD")) {
        scopeLevel = "ORG_UNIT_LEAD"
      } else if (roleStr === "DEPT_ADMIN" || roleStr.includes("SCHEDULE_ADMIN")) {
        scopeLevel = "DEPT_ADMIN"
      } else if (roleStr === "FINANCE_ADMIN" || roleStr === "FINANCE") {
        scopeLevel = "FINANCE_ADMIN"
      } else {
        scopeLevel = "MEMBER"
      }

      const deptRequired = ["MEMBER", "ORG_UNIT_LEAD", "DEPT_ADMIN"].includes(scopeLevel)
      if (deptRequired && !deptName) {
        rejectedRows.push({
          rowNumber: rowNum,
          row,
          reason: `Department is required for role "${scopeLevel}".`,
        })
        continue
      }

      if (deptName && !unitByName.has(deptName.toLowerCase())) {
        newDeptsToCreate.add(deptName)
      }

      if (!facultyId && deptRequired) {
        const prefix = deptName.slice(0, 3).toUpperCase() || "MEM"
        facultyId = `${prefix}-${Math.floor(1000 + Math.random() * 9000)}`
      }

      validRows.push({
        rowNum,
        name,
        email,
        designation,
        scopeLevel,
        deptName,
        facultyId,
      })
    }

    if (dryRun) {
      return NextResponse.json({
        dryRun: true,
        totalRows: rows.length,
        validCount: validRows.length,
        rejectedCount: rejectedRows.length,
        newDepartments: Array.from(newDeptsToCreate),
        validRows: validRows.slice(0, 50),
        rejectedRows,
      })
    }

    // 3. Execution: Create missing departments first
    const createdDepts: string[] = []
    for (const deptName of newDeptsToCreate) {
      const newId = crypto.randomUUID()
      const pathSlug = `n${newId.replace(/-/g, "_")}`

      const { data: newUnit, error: deptErr } = await db
        .from("org_units")
        .insert({
          id: newId,
          organization_id: orgId,
          name: deptName,
          unit_type: "ACADEMIC_DEPARTMENT",
          parent_id: null,
          path: pathSlug,
        })
        .select("id, name")
        .single()

      if (!deptErr && newUnit) {
        unitByName.set(deptName.toLowerCase(), newUnit.id)
        createdDepts.push(deptName)
      }
    }

    // 4. Provision users
    let createdCount = 0
    let existingCount = 0
    const results: any[] = []

    for (const item of validRows) {
      const orgUnitId = item.deptName ? unitByName.get(item.deptName.toLowerCase()) || null : null
      const roleId = roleByScope.get(item.scopeLevel)
      const memberRoleId = roleByScope.get("MEMBER")

      let authUserId: string | null = null

      // Create or lookup auth user
      const { data: authCreated, error: authErr } = await admin.auth.admin.createUser({
        email: item.email,
        password: defaultPassword,
        email_confirm: true,
        user_metadata: {
          name: item.name,
          must_change_password: true,
        },
      })

      if (authCreated?.user?.id) {
        authUserId = authCreated.user.id
        createdCount++
      } else {
        // Find existing auth user
        const { data: userList } = await admin.auth.admin.listUsers()
        const found = userList?.users?.find((u) => u.email?.toLowerCase() === item.email)
        if (found) {
          authUserId = found.id
          existingCount++
        }
      }

      if (authUserId) {
        // Upsert public.users
        const nowIso = new Date().toISOString()
        await db.from("users").upsert({
          id: authUserId,
          organization_id: orgId,
          org_unit_id: orgUnitId,
          email: item.email,
          name: item.name,
          designation: item.designation,
          status: "ACTIVE",
          employment_type: "FULL_TIME",
          updated_at: nowIso,
        })

        // Assign primary role
        if (roleId) {
          await db.from("user_roles").upsert(
            { user_id: authUserId, role_id: roleId },
            { onConflict: "user_id,role_id" }
          )
        }

        // If HOD, also assign MEMBER role
        if (item.scopeLevel === "ORG_UNIT_LEAD" && memberRoleId && memberRoleId !== roleId) {
          await db.from("user_roles").upsert(
            { user_id: authUserId, role_id: memberRoleId },
            { onConflict: "user_id,role_id" }
          )
        }

        // If HOD and department has no lead, set lead_user_id
        if (item.scopeLevel === "ORG_UNIT_LEAD" && orgUnitId) {
          await db
            .from("org_units")
            .update({ lead_user_id: authUserId })
            .eq("id", orgUnitId)
            .is("lead_user_id", null)
        }

        results.push({
          email: item.email,
          name: item.name,
          role: item.scopeLevel,
          department: item.deptName || "None",
          status: "SUCCESS",
        })
      }
    }

    return NextResponse.json({
      success: true,
      createdCount,
      existingCount,
      rejectedCount: rejectedRows.length,
      createdDepartments: createdDepts,
      passwordResetRequiredCount: createdCount,
      results,
      rejectedRows,
      message: `Successfully processed ${validRows.length} user records (${createdCount} created, ${existingCount} linked).`,
    })
  } catch (error: any) {
    console.error("[bulk-import-users] Error:", error)
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 })
  }
}
