import { createAdminClient } from "@/lib/supabase/admin"
import { getSessionUser, hasScope } from "@/lib/auth/session"
import { NextResponse } from "next/server"

export async function POST(req: Request) {
  try {
    const user = await getSessionUser()
    if (!user || !hasScope(user.scopeLevels, "SYSTEM_ADMIN")) {
      return NextResponse.json({ error: "Unauthorized. System Admin role required." }, { status: 403 })
    }

    const {
      email,
      name,
      designation,
      scopeLevel,
      orgUnitId,
      password,
      setAsPrimaryLead = false,
    } = await req.json()

    if (!email?.trim() || !name?.trim() || !scopeLevel) {
      return NextResponse.json(
        { error: "Email, name, and role scope level are required." },
        { status: 400 }
      )
    }

    const cleanEmail = email.trim().toLowerCase()
    const validScopes = ["SYSTEM_ADMIN", "DIRECTOR", "ORG_UNIT_LEAD", "DEPT_ADMIN", "MEMBER", "FINANCE_ADMIN"]
    if (!validScopes.includes(scopeLevel)) {
      return NextResponse.json({ error: "Invalid role scope level." }, { status: 400 })
    }

    // Role safety: Department selection is mandatory for MEMBER, ORG_UNIT_LEAD, and DEPT_ADMIN
    if (["MEMBER", "ORG_UNIT_LEAD", "DEPT_ADMIN"].includes(scopeLevel) && !orgUnitId) {
      return NextResponse.json(
        { error: `Department selection is required when creating a ${scopeLevel}.` },
        { status: 400 }
      )
    }

    const admin = createAdminClient()
    const db = admin as any
    const orgId = user.organizationId

    // 1. Verify organization roles
    const { data: orgRoles } = await db
      .from("roles")
      .select("id, scope_level, name")
      .eq("organization_id", orgId)

    const targetRole = (orgRoles || []).find((r: any) => r.scope_level === scopeLevel)
    const memberRole = (orgRoles || []).find((r: any) => r.scope_level === "MEMBER")

    if (!targetRole) {
      return NextResponse.json({ error: `Role ${scopeLevel} not found in organization.` }, { status: 400 })
    }

    // 2. Check if user already exists in auth.users or public.users
    const tempPassword = password || process.env.BULK_IMPORT_DEFAULT_PASSWORD || "Welcome@WorkLedger2026!"
    let authUserId: string | null = null

    // Try to create auth user
    const { data: authCreated, error: authErr } = await admin.auth.admin.createUser({
      email: cleanEmail,
      password: tempPassword,
      email_confirm: true,
      user_metadata: {
        name: name.trim(),
        must_change_password: true,
      },
    })

    if (authCreated?.user?.id) {
      authUserId = authCreated.user.id
    } else if (authErr?.message?.includes("already registered") || authErr?.message?.includes("already been registered")) {
      // Find existing auth user ID
      const { data: userList } = await admin.auth.admin.listUsers()
      const found = userList?.users?.find((u) => u.email?.toLowerCase() === cleanEmail)
      authUserId = found?.id || null
    } else {
      console.error("[provision-user] Auth user creation error:", authErr)
      return NextResponse.json({ error: `Failed to create auth identity: ${authErr?.message}` }, { status: 500 })
    }

    if (!authUserId) {
      return NextResponse.json({ error: "Could not resolve user auth identifier." }, { status: 500 })
    }

    // 3. Upsert user into public.users
    const finalOrgUnitId = ["SYSTEM_ADMIN", "DIRECTOR", "FINANCE_ADMIN"].includes(scopeLevel)
      ? (orgUnitId || null)
      : orgUnitId

    const nowIso = new Date().toISOString()
    const { data: profile, error: profileErr } = await db
      .from("users")
      .upsert({
        id: authUserId,
        organization_id: orgId,
        org_unit_id: finalOrgUnitId,
        email: cleanEmail,
        name: name.trim(),
        designation: designation?.trim() || scopeLevel,
        status: "ACTIVE",
        employment_type: "FULL_TIME",
        updated_at: nowIso,
      })
      .select()
      .single()

    if (profileErr) {
      console.error("[provision-user] Profile upsert error:", profileErr)
      return NextResponse.json({ error: `Failed to create user profile: ${profileErr.message}` }, { status: 500 })
    }

    // 4. Assign role in user_roles
    await db.from("user_roles").upsert(
      { user_id: authUserId, role_id: targetRole.id },
      { onConflict: "user_id,role_id" }
    )

    // For HOD (ORG_UNIT_LEAD), also assign MEMBER role so they have personal faculty work context
    if (scopeLevel === "ORG_UNIT_LEAD" && memberRole && memberRole.id !== targetRole.id) {
      await db.from("user_roles").upsert(
        { user_id: authUserId, role_id: memberRole.id },
        { onConflict: "user_id,role_id" }
      )
    }

    // If HOD and setAsPrimaryLead is checked, set org_units.lead_user_id
    if (scopeLevel === "ORG_UNIT_LEAD" && finalOrgUnitId && setAsPrimaryLead) {
      await db
        .from("org_units")
        .update({ lead_user_id: authUserId })
        .eq("id", finalOrgUnitId)
    }

    return NextResponse.json({
      success: true,
      user: {
        id: authUserId,
        email: cleanEmail,
        name: name.trim(),
        scopeLevel,
        orgUnitId: finalOrgUnitId,
      },
      message: `Account for ${name.trim()} (${scopeLevel}) provisioned successfully.`,
    })
  } catch (error: any) {
    console.error("[provision-user] Error:", error)
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 })
  }
}
