import { createClient } from "@/lib/supabase/server"
import { getSessionUser } from "@/lib/auth/session"
import { getRedirectPath } from "@/lib/auth/get-redirect"
import { NextRequest, NextResponse } from "next/server"

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get("code")
  const intent = searchParams.get("intent") ?? "login" // login | signup | invite

  if (!code) {
    return NextResponse.redirect(new URL("/login?error=no_code", request.url))
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    console.error("[auth/callback] exchangeCodeForSession failed:", error)
    return NextResponse.redirect(new URL(`/login?error=${error.message}`, request.url))
  }

  const token = searchParams.get("token") || searchParams.get("invite")
  if (token) {
    try {
      const { createAdminClient } = await import("@/lib/supabase/admin")
      const admin = createAdminClient()
      const { data: authData } = await supabase.auth.getUser()
      if (authData?.user) {
        const { data: inv } = await (admin as any)
          .from("invitations")
          .select("*")
          .eq("token", token)
          .eq("status", "PENDING")
          .maybeSingle()

        if (inv) {
          await (admin as any).from("users").upsert({
            id: authData.user.id,
            organization_id: inv.organization_id,
            org_unit_id: inv.org_unit_id || null,
            email: authData.user.email,
            name: authData.user.user_metadata?.name || authData.user.email?.split("@")[0] || "User",
            status: "ACTIVE",
          })

          if (inv.intended_role_id) {
            await (admin as any).from("user_roles").upsert(
              { user_id: authData.user.id, role_id: inv.intended_role_id },
              { onConflict: "user_id,role_id" }
            )
          }

          await (admin as any).from("wallets").upsert(
            {
              organization_id: inv.organization_id,
              owner_user_id: authData.user.id,
              purpose: "PERSONAL",
              balance: 0,
            },
            { onConflict: "owner_user_id,purpose" }
          )

          await (admin as any).from("invitations").update({ status: "ACCEPTED" }).eq("id", inv.id)
        }
      }
    } catch (err) {
      console.error("[auth/callback] Token accept error:", err)
    }
  }

  // Get session to determine redirect destination
  const user = await getSessionUser()

  if (!user) {
    return NextResponse.redirect(new URL("/login?error=no_session", request.url))
  }

  // Compute destination based on intent
  let destination: string

  if (intent === "signup" && !token) {
    destination = "/onboarding/setup"
  } else {
    destination = getRedirectPath(user)
  }

  return NextResponse.redirect(new URL(destination, request.url))
}

