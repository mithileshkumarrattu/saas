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
    const admin = createAdminClient()
    const db = admin as any
    const user = await getSessionUser()

    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }

    const { organizationName, organizationType } = await request.json()

    if (!organizationName?.trim()) {
      return NextResponse.json({ error: "Organization name required" }, { status: 400 })
    }

    const orgType = VALID_ORG_TYPES.includes(organizationType)
      ? organizationType
      : "COLLEGE"

    let orgId = user.organizationId

    if (orgId) {
      // 1. Update existing organization
      const { error: orgError } = await db
        .from("organizations")
        .update({
          name: organizationName.trim(),
          type: orgType,
          updated_at: new Date().toISOString(),
        })
        .eq("id", orgId)

      if (orgError) throw orgError
    } else {
      // 1. Create organization
      const { data: org, error: orgError } = await db
        .from("organizations")
        .insert({
          name: organizationName.trim(),
          type: orgType,
        })
        .select("id")
        .single()

      if (orgError) throw orgError
      orgId = org.id
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
      const { data: rootUnit, error: unitError } = await db
        .from("org_units")
        .insert({
          organization_id: orgId,
          name: "Main",
          unit_type: "DEPARTMENT",
          parent_id: null,
        })
        .select("id")
        .single()

      if (!unitError && rootUnit) {
        rootUnitId = rootUnit.id
      }
    }

    // 3. Get or create DIRECTOR role
    const { data: directorRole } = await db
      .from("roles")
      .select("id")
      .eq("organization_id", orgId)
      .eq("scope_level", "DIRECTOR")
      .limit(1)
      .maybeSingle()

    let roleId = directorRole?.id

    if (!roleId) {
      const { data: newRole } = await db
        .from("roles")
        .insert({
          organization_id: orgId,
          name: "Director",
          scope_level: "DIRECTOR",
          is_system_role: true,
        })
        .select("id")
        .single()

      roleId = newRole?.id
    }

    // 4. Link user to organization
    await db
      .from("users")
      .update({
        organization_id: orgId,
        org_unit_id: rootUnitId || null,
      })
      .eq("id", user.id)

    // 5. Assign DIRECTOR role to user
    if (roleId) {
      await db
        .from("user_roles")
        .upsert({
          user_id: user.id,
          role_id: roleId,
        }, { onConflict: "user_id,role_id" })
    }

    // 6. Ensure Director's three wallets: SALARY_POOL, LOAN_POOL, PERSONAL
    const wallets = ["SALARY_POOL", "LOAN_POOL", "PERSONAL"]
    for (const purpose of wallets) {
      await db
        .from("wallets")
        .upsert({
          organization_id: orgId,
          owner_user_id: user.id,
          purpose: purpose,
          balance: 0,
        }, { onConflict: "owner_user_id,purpose" })
    }

    return NextResponse.json({
      success: true,
      organizationId: orgId,
      unitId: rootUnitId,
      redirectPath: `/${orgId}/director`,
    })
  } catch (error) {
    console.error("[provision-org] Error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to provision organization" },
      { status: 500 }
    )
  }
}
