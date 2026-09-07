"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Building2, Loader2 } from "lucide-react"

export default function SetupPage() {
  const router = useRouter()

  const [orgName, setOrgName] = useState("")
  const [orgType, setOrgType] = useState("COLLEGE")
  const [loading, setLoading] = useState(false)
  const [fetchingSession, setFetchingSession] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Verify session on mount
  useEffect(() => {
    const checkSession = async () => {
      try {
        const response = await fetch("/api/auth/get-session")
        if (response.ok) {
          const sessionData = await response.json()
          if (!sessionData?.user) {
            router.push("/login")
            return
          }
        } else {
          router.push("/login")
        }
      } catch (err) {
        console.error("Failed to check existing session:", err)
      } finally {
        setFetchingSession(false)
      }
    }
    checkSession()
  }, [router])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      if (!orgName.trim()) {
        throw new Error("Organization name is required")
      }

      const res = await fetch("/api/onboarding/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationName: orgName.trim(),
          organizationType: orgType,
        }),
      })

      const data = await res.json()
      if (!res.ok || data.error) {
        throw new Error(data.error || "Failed to setup organization")
      }

      // Redirect to director dashboard dynamically
      router.push(data.redirectPath || `/${data.organizationId}/director`)
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to setup organization"
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  if (fetchingSession) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-2">
          <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
            <Building2 className="w-6 h-6 text-primary" />
          </div>
          <CardTitle className="text-2xl">Name Your Organization</CardTitle>
          <CardDescription>
            Give your institutional workspace a formal name to complete setup.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="p-3 text-sm text-destructive bg-destructive/10 rounded-md border border-destructive/20">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="orgName">Organization Name</Label>
              <Input
                id="orgName"
                type="text"
                placeholder="e.g., ABC University, TechCorp Inc."
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                disabled={loading}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="orgType">Organization Type</Label>
              <Select value={orgType} onValueChange={(val) => val && setOrgType(val)} disabled={loading}>
                <SelectTrigger id="orgType">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="COLLEGE">Educational Institution / College</SelectItem>
                  <SelectItem value="ENTERPRISE">Corporate / Enterprise</SelectItem>
                  <SelectItem value="GOVERNMENT">Government</SelectItem>
                  <SelectItem value="NGO">Non-Governmental Organization (NGO)</SelectItem>
                  <SelectItem value="HOSPITAL">Healthcare / Hospital</SelectItem>
                  <SelectItem value="GENERIC">Other / General</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Setting up...
                </>
              ) : (
                "Save & Launch Dashboard"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
