import { getSessionUser } from "@/lib/auth/session"
import { createAdminClient } from "@/lib/supabase/admin"
import { NextRequest, NextResponse } from "next/server"

const VALID_ORG_TYPES = [
  "COLLEGE",
  "ENTERPRISE",
  "GOVERNMENT",
  "NGO",
  "HOSPITAL",
  "GENERIC",
]

export async function POST(request: NextRequest) {
  try {
    const user = await getSessionUser()
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }

    const body = await request.json()
    const { organizationName, organizationType } = body

    if (!organizationName?.trim()) {
      return NextResponse.json({ error: "Organization name is required" }, { status: 400 })
    }

    const orgType = VALID_ORG_TYPES.includes(organizationType)
      ? organizationType
      : "COLLEGE"

    const admin = createAdminClient()
    const db = admin as any

    let orgId = user.organizationId

    if (orgId) {
      // 1. Update existing placeholder organization
      const { error: updateErr } = await db
        .from("organizations")
        .update({
          name: organizationName.trim(),
          type: orgType,
          updated_at: new Date().toISOString(),
        })
        .eq("id", orgId)

      if (updateErr) throw updateErr
    } else {
      // 1. Create new organization
      const { data: newOrg, error: orgError } = await db
        .from("organizations")
        .insert({
          name: organizationName.trim(),
          type: orgType,
        })
        .select("id")
        .single()

      if (orgError) throw orgError
      orgId = newOrg.id

      // Link user to organization
      await db
        .from("users")
        .update({ organization_id: orgId })
        .eq("id", user.id)
    }

    // 2. Ensure root organization unit exists
    const { data: existingUnit } = await db
      .from("org_units")
      .select("id")
      .eq("organization_id", orgId)
      .limit(1)
      .maybeSingle()

    let rootUnitId = existingUnit?.id
    if (!rootUnitId) {
      const { data: newUnit, error: unitError } = await db
        .from("org_units")
        .insert({
          organization_id: orgId,
          name: "Main",
          unit_type: "DEPARTMENT",
          parent_id: null,
        })
        .select("id")
        .single()

      if (!unitError && newUnit) {
        rootUnitId = newUnit.id
      }
    }

    // 3. Ensure DIRECTOR and SYSTEM_ADMIN roles exist and are assigned
    const { data: existingRoles } = await db
      .from("roles")
      .select("id, scope_level")
      .eq("organization_id", orgId)

    let directorRole = existingRoles?.find((r: any) => r.scope_level === "DIRECTOR")
    let adminRole = existingRoles?.find((r: any) => r.scope_level === "SYSTEM_ADMIN")

    if (!directorRole) {
      const { data: newDirectorRole, error: dirErr } = await db
        .from("roles")
        .insert({
          organization_id: orgId,
          name: "Director",
          scope_level: "DIRECTOR",
          is_system_role: true,
        })
        .select("id, scope_level")
        .single()

      if (!dirErr && newDirectorRole) {
        directorRole = newDirectorRole
      }
    }

    if (!adminRole) {
      const { data: newAdminRole, error: admErr } = await db
        .from("roles")
        .insert({
          organization_id: orgId,
          name: "System Administrator",
          scope_level: "SYSTEM_ADMIN",
          is_system_role: true,
        })
        .select("id, scope_level")
        .single()

      if (!admErr && newAdminRole) {
        adminRole = newAdminRole
      }
    }

    // Assign DIRECTOR and SYSTEM_ADMIN roles to user
    const rolesToAssign = [directorRole?.id, adminRole?.id].filter(Boolean)
    for (const rId of rolesToAssign) {
      await db
        .from("user_roles")
        .upsert(
          { user_id: user.id, role_id: rId },
          { onConflict: "user_id,role_id" }
        )
    }

    // 4. Ensure Director's 3 wallets exist (SALARY_POOL, LOAN_POOL, PERSONAL)
    const walletPurposes = ["PERSONAL", "SALARY_POOL", "LOAN_POOL"]
    for (const purpose of walletPurposes) {
      await db
        .from("wallets")
        .upsert(
          {
            organization_id: orgId,
            owner_user_id: user.id,
            purpose,
            balance: 0,
          },
          { onConflict: "owner_user_id,purpose" }
        )
    }

    return NextResponse.json({
      success: true,
      organizationId: orgId,
      redirectPath: `/${orgId}/director`,
    })
  } catch (error) {
    console.error("[onboarding/setup] Error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to setup organization" },
      { status: 500 }
    )
  }
}
