import { type NextRequest, NextResponse } from "next/server"
import { updateSession } from "@/lib/supabase/middleware"

export async function middleware(request: NextRequest) {
  try {
    return await updateSession(request)
  } catch (error) {
    console.error("[middleware] Unhandled invocation error:", error)
    return NextResponse.next({
      request,
    })
  }
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.svg$).*)",
  ],
}

