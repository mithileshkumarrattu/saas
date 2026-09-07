import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"
import { Database } from "@/lib/database.types"

const DEFAULT_URL = "https://bzgqvwqzbjqpfunnyfwe.supabase.co"
const PLACEHOLDER_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.placeholder"

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const pathname = request.nextUrl.pathname

  // Skip static files, images, prefetch requests, and favicon for maximum speed
  if (
    pathname.startsWith("/_next") ||
    pathname.includes(".") ||
    pathname === "/favicon.ico" ||
    request.headers.get("x-middleware-prefetch") === "1" ||
    request.headers.get("purpose") === "prefetch"
  ) {
    return supabaseResponse
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || DEFAULT_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || PLACEHOLDER_ANON_KEY

  // If valid credentials are not yet configured in this deployment environment,
  // gracefully continue without crashing the edge middleware router
  if (!supabaseUrl || !anonKey || anonKey === PLACEHOLDER_ANON_KEY) {
    return supabaseResponse
  }

  try {
    const supabase = createServerClient<Database>(
      supabaseUrl,
      anonKey,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll()
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              supabaseResponse.cookies.set(name, value, options),
            )
          },
        },
      },
    )

    // Refresh user session when visiting actual pages/APIs
    await supabase.auth.getUser()
  } catch (err) {
    console.error("[middleware] Session refresh error:", err)
  }

  return supabaseResponse
}

