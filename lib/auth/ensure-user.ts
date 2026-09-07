import { createAdminClient } from "@/lib/supabase/admin"
import { SessionUser } from "./session"
import type { User as AuthUser } from "@supabase/supabase-js"

/**
 * Standard system roles seeded on organization creation
 */
export const STANDARD_ROLES = [
  { name: "System Administrator", scope_level: "SYSTEM_ADMIN", is_system_role: true },
  { name: "Director", scope_level: "DIRECTOR", is_system_role: true },
  { name: "Head of Department", scope_level: "ORG_UNIT_LEAD", is_system_role: true },
  { name: "Department Administrator", scope_level: "DEPT_ADMIN", is_system_role: true },
  { name: "Finance Administrator", scope_level: "FINANCE_ADMIN", is_system_role: true },
  { name: "Faculty / Member", scope_level: "MEMBER", is_system_role: true },
]

/**
 * Ensures a user record exists in public.users, organizations, and user_roles.
 * Fresh signups receive ONLY the SYSTEM_ADMIN role with org_unit_id = null.
 * Invited users receive their exact designated invitation role.
 * NO silent promotion to DIRECTOR, NO fake Main/Root department creation.
 */
export async function ensureUserRecord(authUser: AuthUser): Promise<SessionUser | null> {
  const admin = createAdminClient()
  const db = admin as any
  const email = authUser.email || ""
  const name =
    authUser.user_metadata?.name ||
    authUser.user_metadata?.full_name ||
    email.split("@")[0] ||
    "User"

  try {
    // 1. Check for an active pending invitation first (Priority)
    const { data: invite } = await db
      .from("invitations")
      .select("*, roles(id, name, scope_level)")
      .eq("email", email)
      .eq("status", "PENDING")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    // 2. Fetch existing public.users record
    const { data: existingUser } = await db
      .from("users")
      .select(`
        id,
        email,
        name,
        organization_id,
        org_unit_id,
        user_roles(
          role_id,
          roles(
            id,
            name,
            scope_level
          )
        )
      `)
      .eq("id", authUser.id)
      .maybeSingle()

    // If there is an active pending invitation for this user, fulfill it
    if (invite) {
      const orgId = invite.organization_id
      const unitId = invite.org_unit_id || null
      const roleId = invite.intended_role_id || null
      const scopeLevel = invite.roles?.scope_level || "MEMBER"

      // Upsert user into the invited organization
      await db.from("users").upsert({
        id: authUser.id,
        organization_id: orgId,
        org_unit_id: unitId,
        email,
        name,
        status: "ACTIVE",
        employment_type: "FULL_TIME",
      })

      if (roleId) {
        await db.from("user_roles").upsert(
          { user_id: authUser.id, role_id: roleId },
          { onConflict: "user_id,role_id" }
        )
      }

      await db.from("invitations").update({ status: "ACCEPTED" }).eq("id", invite.id)

      return {
        id: authUser.id,
        email,
        name,
        organizationId: orgId,
        orgUnitId: unitId || undefined,
        roles: roleId ? [roleId] : [],
        scopeLevels: [scopeLevel],
      }
    }

    // If existing user already has organization and roles, return them
    if (existingUser && existingUser.organization_id) {
      const roles = (existingUser.user_roles as any[])?.map((ur: any) => ur.roles?.id).filter(Boolean) || []
      const scopeLevels = (existingUser.user_roles as any[])?.map((ur: any) => ur.roles?.scope_level).filter(Boolean) || []

      return {
        id: existingUser.id,
        email: existingUser.email,
        name: existingUser.name,
        organizationId: existingUser.organization_id,
        orgUnitId: existingUser.org_unit_id,
        roles,
        scopeLevels, // If empty, router safely routes to setup-incomplete page
      }
    }

    // 3. New Self-Signup / Fresh Direct Signup (No prior invitation and no existing user)
    // Create organization
    const { data: newOrg, error: orgErr } = await db
      .from("organizations")
      .insert({
        name: `${name}'s Organization`,
        type: "GENERIC",
      })
      .select("id")
      .single()

    if (orgErr || !newOrg) {
      console.error("[ensureUserRecord] Failed to create organization:", orgErr)
      return null
    }
    const orgId = newOrg.id

    // Upsert user into public.users with org_unit_id = null (pure operator identity, NO Main/Root dept)
    await db.from("users").upsert({
      id: authUser.id,
      organization_id: orgId,
      org_unit_id: null,
      email,
      name,
      status: "ACTIVE",
      employment_type: "FULL_TIME",
    })

    // Seed standard tenant-scoped roles
    const { data: insertedRoles } = await db
      .from("roles")
      .insert(
        STANDARD_ROLES.map((r) => ({
          organization_id: orgId,
          ...r,
        }))
      )
      .select("id, scope_level, name")

    const rolesList = insertedRoles || []
    const sysAdminRole = rolesList.find((r: any) => r.scope_level === "SYSTEM_ADMIN")

    if (sysAdminRole) {
      // Assign ONLY SYSTEM_ADMIN role
      await db.from("user_roles").upsert(
        { user_id: authUser.id, role_id: sysAdminRole.id },
        { onConflict: "user_id,role_id" }
      )
    }

    // Create default active work cycle
    const now = new Date()
    const cycleStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0]
    const cycleEnd = new Date(now.getFullYear(), now.getMonth() + 3, 0).toISOString().split("T")[0]

    try {
      await db.from("work_cycles").insert({
        organization_id: orgId,
        name: "Current Work Cycle",
        starts_on: cycleStart,
        ends_on: cycleEnd,
        scheduled_weight_percentage: 75,
        salary_threshold_percentage: 85,
        salary_request_opens_day: 26,
        status: "ACTIVE",
        created_by: authUser.id,
      })
    } catch {
      // Work cycle seeding is optional during initial provisioning
    }

    return {
      id: authUser.id,
      email,
      name,
      organizationId: orgId,
      orgUnitId: undefined,
      roles: sysAdminRole ? [sysAdminRole.id] : [],
      scopeLevels: ["SYSTEM_ADMIN"],
    }
  } catch (error) {
    console.error("[ensureUserRecord] Error in user provisioning:", error)
    return null
  }
}
