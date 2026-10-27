import { createAdminClient } from "@/lib/supabase/admin"
import { SessionUser } from "./session"
import type { User as AuthUser } from "@supabase/supabase-js"
import { createRandomWallet, fundWallet } from "@/lib/blockchain/wallet-utils"

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
 * Idempotently ensures the user has a personal Sepolia blockchain audit wallet provisioned.
 * Generates an encrypted keypair using AES-256 and persists it to public.blockchain_wallets.
 * Safe and non-destructive: if a wallet already exists, it is untouched.
 */
export async function ensureUserBlockchainWallet(
  db: any,
  userId: string,
  organizationId: string
): Promise<{ address: string; isNew: boolean } | null> {
  if (!userId || !organizationId) return null

  try {
    const { data: existing } = await db
      .from("blockchain_wallets")
      .select("id, public_address")
      .eq("user_id", userId)
      .eq("organization_id", organizationId)
      .eq("purpose", "PERSONAL")
      .maybeSingle()

    if (existing) {
      return { address: existing.public_address, isNew: false }
    }

    const { address, encryptedPrivateKey } = createRandomWallet()
    const nowIso = new Date().toISOString()

    const { data: inserted, error: insertErr } = await db
      .from("blockchain_wallets")
      .insert({
        organization_id: organizationId,
        user_id: userId,
        public_address: address,
        encrypted_private_key: encryptedPrivateKey,
        purpose: "PERSONAL",
        network: "sepolia",
        created_at: nowIso,
        updated_at: nowIso,
      })
      .select("id, public_address")
      .single()

    if (insertErr) {
      console.warn("[ensureUserBlockchainWallet] Insert note:", insertErr.message)
      return null
    }

    // Trigger gas funding asynchronously if relayer key is present
    fundWallet(address).catch(() => {})

    return { address: inserted.public_address, isNew: true }
  } catch (err: any) {
    console.warn("[ensureUserBlockchainWallet] Execution error:", err?.message)
    return null
  }
}

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

    // 2. Fetch existing public.users record (by auth ID first)
    let { data: existingUser } = await db
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

    // If not found by ID, check by email to heal provisioned/invited accounts
    if (!existingUser && email) {
      const { data: userByEmail } = await db
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
        .ilike("email", email.trim())
        .maybeSingle()

      if (userByEmail) {
        const oldId = userByEmail.id
        if (oldId !== authUser.id) {
          // Re-link related records to new authUser.id
          await db.from("user_roles").update({ user_id: authUser.id }).eq("user_id", oldId)
          await db.from("wallets").update({ owner_user_id: authUser.id }).eq("owner_user_id", oldId)
          await db.from("org_units").update({ lead_user_id: authUser.id }).eq("lead_user_id", oldId)
          await db.from("tasks").update({ assignee_user_id: authUser.id }).eq("assignee_user_id", oldId)
          await db.from("tasks").update({ creator_user_id: authUser.id }).eq("creator_user_id", oldId)
          await db.from("users").delete().eq("id", oldId)
          await db.from("users").upsert({
            id: authUser.id,
            organization_id: userByEmail.organization_id,
            org_unit_id: userByEmail.org_unit_id,
            email: email.trim().toLowerCase(),
            name: userByEmail.name || name,
            status: "ACTIVE",
            employment_type: "FULL_TIME",
            updated_at: new Date().toISOString(),
          })
        }
        existingUser = {
          ...userByEmail,
          id: authUser.id,
        }
      }
    }

    // If still no existing user, check if there is ANY historical invitation for this email
    if (!existingUser && email) {
      const { data: pastInvite } = await db
        .from("invitations")
        .select("*, roles(id, name, scope_level)")
        .ilike("email", email.trim())
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()

      if (pastInvite && pastInvite.organization_id) {
        const orgId = pastInvite.organization_id
        const unitId = pastInvite.org_unit_id || null
        const roleId = pastInvite.intended_role_id || null
        const scopeLevel = pastInvite.roles?.scope_level || "MEMBER"

        await db.from("users").upsert({
          id: authUser.id,
          organization_id: orgId,
          org_unit_id: unitId,
          email: email.trim().toLowerCase(),
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

        await db.from("wallets").upsert(
          {
            organization_id: orgId,
            owner_user_id: authUser.id,
            purpose: "PERSONAL",
            balance: 0,
          },
          { onConflict: "owner_user_id,purpose" }
        )

        // Ensure Sepolia blockchain wallet is provisioned
        ensureUserBlockchainWallet(db, authUser.id, orgId).catch(() => {})

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
    }

    // If existing user already has organization and roles, return them
    if (existingUser && existingUser.organization_id) {
      const roles = (existingUser.user_roles as any[])?.map((ur: any) => ur.roles?.id).filter(Boolean) || []
      const scopeLevels = (existingUser.user_roles as any[])?.map((ur: any) => ur.roles?.scope_level).filter(Boolean) || []

      // Ensure Sepolia blockchain wallet is provisioned
      ensureUserBlockchainWallet(db, existingUser.id, existingUser.organization_id).catch(() => {})

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

    // Ensure Sepolia blockchain wallet is provisioned
    ensureUserBlockchainWallet(db, authUser.id, orgId).catch(() => {})

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
