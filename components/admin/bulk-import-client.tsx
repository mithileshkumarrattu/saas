"use client"

import { useState, useRef } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  FileSpreadsheet,
  Upload,
  Download,
  CheckCircle2,
  AlertCircle,
  Users,
  Building2,
  KeyRound,
  RefreshCw,
  FileText,
  Copy,
  Check,
  XCircle,
  ArrowRight,
  ShieldCheck,
} from "lucide-react"
import { toast } from "sonner"

interface Props {
  orgId: string
}

const DEFAULT_IMPORT_PASSWORD = "Welcome@WorkLedger2026!"

export function BulkImportClient({ orgId }: Props) {
  const [file, setFile] = useState<File | null>(null)
  const [parsing, setParsing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [preview, setPreview] = useState<any | null>(null)
  const [result, setResult] = useState<any | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const copyPassword = () => {
    navigator.clipboard.writeText(DEFAULT_IMPORT_PASSWORD)
    setCopied(true)
    toast.success("Default password copied to clipboard!")
    setTimeout(() => setCopied(false), 2000)
  }

  // 1. Template Downloaders
  const downloadPeopleTemplate = () => {
    const csvContent =
      "full_name,email,designation,role,department,faculty_id\n" +
      "Dr. R. HOD,hod.cse@mvgr.demo,Professor & HOD,ORG_UNIT_LEAD,CSE,CSE-HOD-001\n" +
      "Dept Schedule Admin,deptadmin.cse@mvgr.demo,Schedule Coordinator,DEPT_ADMIN,CSE,\n" +
      "Faculty One,faculty.one@mvgr.demo,Assistant Professor,MEMBER,CSE,CSE-FAC-001\n" +
      "Faculty Two,faculty.two@mvgr.demo,Assistant Professor,MEMBER,CSE,CSE-FAC-002\n" +
      "Director One,director@mvgr.demo,Director,DIRECTOR,,\n" +
      "Finance One,finance@mvgr.demo,Finance Administrator,FINANCE_ADMIN,,\n"

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.setAttribute("download", "people_import_template.csv")
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    toast.success("Downloaded people_import_template.csv")
  }

  const downloadTimetableTemplate = () => {
    const csvContent =
      "faculty_id,faculty_name,faculty_email,day,start_time,end_time,task_name,credits,description\n" +
      "CSE-FAC-001,Faculty One,faculty.one@mvgr.demo,MON,09:15,10:15,V SE SEC-A,1.0,Weekly scheduled academic session\n" +
      "CSE-FAC-001,Faculty One,faculty.one@mvgr.demo,WED,10:15,11:15,V SE SEC-B,1.0,Weekly scheduled academic session\n" +
      "CSE-FAC-001,Faculty One,faculty.one@mvgr.demo,FRI,11:15,12:15,VII SE CSD,1.0,Weekly scheduled academic session\n"

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.setAttribute("download", "timetable_import_template.csv")
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    toast.success("Downloaded timetable_import_template.csv")
  }

  // 2. CSV Parser with Header Normalization & Quote Handling
  const normalizeHeader = (raw: string): string => {
    const cleaned = raw.trim().toLowerCase().replace(/[\s_\-]+/g, "_").replace(/['"]/g, "")
    if (["full_name", "name", "fullname", "faculty_name", "facultyname", "employee_name"].includes(cleaned)) return "full_name"
    if (["email", "email_address", "faculty_email", "e_mail", "mail"].includes(cleaned)) return "email"
    if (["role", "user_role", "scope", "access_level"].includes(cleaned)) return "role"
    if (["department", "dept", "dept_name", "department_name", "unit"].includes(cleaned)) return "department"
    if (["designation", "title", "job_title", "position"].includes(cleaned)) return "designation"
    if (["faculty_id", "employee_id", "emp_id", "empid", "id"].includes(cleaned)) return "faculty_id"
    return cleaned
  }

  const parseCSVLine = (line: string): string[] => {
    const result: string[] = []
    let current = ""
    let inQuotes = false

    for (let i = 0; i < line.length; i++) {
      const char = line[i]
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"'
          i++
        } else {
          inQuotes = !inQuotes
        }
      } else if (char === "," && !inQuotes) {
        result.push(current.trim())
        current = ""
      } else {
        current += char
      }
    }
    result.push(current.trim())
    return result
  }

  const parseCSV = (text: string) => {
    // Strip UTF-8 BOM if present
    const cleanText = text.replace(/^\uFEFF/, "")
    const lines = cleanText.split(/\r\n|\n/).filter((l) => l.trim().length > 0)
    if (lines.length < 2) {
      throw new Error("CSV file must contain a header row and at least one user record.")
    }

    const rawHeaders = parseCSVLine(lines[0])
    const normalizedHeaders = rawHeaders.map(normalizeHeader)

    const hasName = normalizedHeaders.includes("full_name")
    const hasEmail = normalizedHeaders.includes("email")

    if (!hasName && !hasEmail) {
      throw new Error(
        `Missing required columns. Expected headers like "full_name" and "email". Found: ${rawHeaders.join(", ")}`
      )
    }

    const rows: any[] = []
    for (let i = 1; i < lines.length; i++) {
      const currentValues = parseCSVLine(lines[i])
      if (currentValues.length === 0 || (currentValues.length === 1 && !currentValues[0])) continue

      const rowObj: any = {}
      for (let j = 0; j < normalizedHeaders.length; j++) {
        rowObj[normalizedHeaders[j]] = currentValues[j] || ""
      }

      // Ensure full_name fallback if 'name' was used
      if (!rowObj.full_name && rowObj.name) {
        rowObj.full_name = rowObj.name
      }
      rows.push(rowObj)
    }

    return rows
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0]
    if (!selected) return

    setFile(selected)
    setError(null)
    setResult(null)
    setPreview(null)
    setParsing(true)

    try {
      const text = await selected.text()
      const rows = parseCSV(text)

      if (rows.length === 0) {
        throw new Error("No data rows found in the CSV file.")
      }

      // Dry run preview validation
      const res = await fetch("/api/admin/bulk-import-users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows, dryRun: true }),
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || "Failed to validate import file against server.")
      }

      setPreview({ ...data, rawRows: rows })
      toast.success(`Validated ${data.validCount} rows ready for ingestion.`)
    } catch (err: any) {
      const msg = err.message || "Failed to parse CSV file."
      setError(msg)
      toast.error(msg)
    } finally {
      setParsing(false)
    }
  }

  const clearFile = () => {
    setFile(null)
    setPreview(null)
    setError(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
  }

  const executeImport = async () => {
    if (!preview?.rawRows) return

    try {
      setImporting(true)
      setError(null)
      const res = await fetch("/api/admin/bulk-import-users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: preview.rawRows, dryRun: false }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Import execution failed.")

      setResult(data)
      setPreview(null)
      setFile(null)
      if (fileInputRef.current) {
        fileInputRef.current.value = ""
      }
      toast.success(data.message || "Bulk import executed successfully.")
    } catch (err: any) {
      const msg = err.message || "Import execution error."
      setError(msg)
      toast.error(msg)
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Default Password Callout Card */}
      <Card className="rounded-xl border border-primary/20 bg-primary/5 dark:bg-primary/10 shadow-sm">
        <CardContent className="p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-primary/10 text-primary mt-0.5 sm:mt-0">
              <KeyRound className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-primary">
                  Default Credentials Notice
                </span>
                <Badge variant="outline" className="text-[10px] bg-background">
                  First-Time Login
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Imported users are provisioned with this temporary default password and must reset it on initial login:
              </p>
              <div className="flex items-center gap-2 mt-1.5">
                <code className="px-2 py-0.5 rounded bg-background border text-xs font-mono font-semibold text-foreground select-all">
                  {DEFAULT_IMPORT_PASSWORD}
                </code>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={copyPassword}
                  className="h-6 px-2 text-[11px] gap-1 hover:bg-background"
                >
                  {copied ? (
                    <>
                      <Check className="h-3 w-3 text-emerald-500" /> Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" /> Copy Password
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
          <div className="text-[11px] text-muted-foreground bg-background/60 rounded-lg p-2.5 border sm:max-w-xs">
            <ShieldCheck className="h-4 w-4 text-emerald-500 inline mr-1" />
            Admins do not need to send manual passwords. Users can immediately sign in with this password and their email.
          </div>
        </CardContent>
      </Card>

      {/* Action cards for Template Downloads */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card className="rounded-xl border border-muted/60 bg-card/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Users className="h-4 w-4 text-sky-500" /> People Import Template
            </CardTitle>
            <CardDescription className="text-xs">
              CSV template for bulk provisioning HODs, Faculty, Dept Admins, Directors, and Finance.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <Button
              onClick={downloadPeopleTemplate}
              variant="outline"
              size="sm"
              className="w-full text-xs gap-1.5 h-8"
            >
              <Download className="h-3.5 w-3.5" /> Download People Import Template (.csv)
            </Button>
          </CardContent>
        </Card>

        <Card className="rounded-xl border border-muted/60 bg-card/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4 text-emerald-500" /> Timetable Import Template
            </CardTitle>
            <CardDescription className="text-xs">
              CSV template for Department Admins to import recurring weekly faculty schedules.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <Button
              onClick={downloadTimetableTemplate}
              variant="outline"
              size="sm"
              className="w-full text-xs gap-1.5 h-8"
            >
              <Download className="h-3.5 w-3.5" /> Download Timetable Import Template (.csv)
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* File Upload Zone & Prominent Submit Area */}
      <Card className="rounded-xl border border-muted/60 bg-card/50 overflow-hidden">
        <CardHeader>
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Upload className="h-4 w-4 text-primary" /> Upload People Data File (.CSV)
          </CardTitle>
          <CardDescription className="text-xs">
            Select or drag your CSV file. The system validates all roles, auto-detects departments, and provides an instant preview before finalizing import.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Dropzone */}
          <div className="relative border-2 border-dashed rounded-xl p-8 text-center space-y-3 hover:bg-muted/40 transition">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              title="Select CSV file"
            />
            <FileText className="h-10 w-10 text-muted-foreground mx-auto" />
            <div>
              <p className="text-xs font-semibold text-foreground">
                {file ? file.name : "Click to select or drop CSV file here"}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Columns accepted: full_name, email, designation, role, department, faculty_id
              </p>
            </div>
            {parsing && (
              <div className="flex items-center justify-center gap-2 text-xs text-primary font-medium">
                <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Validating CSV structure and checking existing records...
              </div>
            )}
          </div>

          {/* Active Error Notice */}
          {error && (
            <div className="p-3.5 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs space-y-1">
              <div className="flex items-center gap-2 font-semibold">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>Validation Error</span>
              </div>
              <p className="text-[11px] pl-6 text-destructive/90">{error}</p>
            </div>
          )}

          {/* Action & Submit Bar (ALWAYS VISIBLE) */}
          <div className="p-4 rounded-xl bg-muted/30 border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-foreground">Import Submission:</span>
                {file ? (
                  <Badge variant="secondary" className="text-[11px] gap-1">
                    <FileText className="h-3 w-3" /> {file.name} ({(file.size / 1024).toFixed(1)} KB)
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[11px] text-muted-foreground">
                    No File Selected
                  </Badge>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground">
                {!file
                  ? "Select a CSV file above to preview records and unlock the Submit button."
                  : parsing
                  ? "Parsing and validating rows with organization database..."
                  : error
                  ? "Correct the CSV formatting errors or download the template above to proceed."
                  : preview
                  ? `Ready to import ${preview.validCount} valid user record(s).`
                  : "File selected. Ready to process."}
              </p>
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              {file && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={clearFile}
                  disabled={importing || parsing}
                  className="h-10 text-xs text-muted-foreground hover:text-foreground"
                >
                  <XCircle className="h-3.5 w-3.5 mr-1" /> Clear File
                </Button>
              )}

              <Button
                id="bulk-import-submit-btn"
                onClick={executeImport}
                disabled={!file || parsing || importing || !preview || preview.validCount === 0 || !!error}
                className="h-10 px-5 text-xs font-semibold gap-2 shadow-sm flex-1 sm:flex-initial"
              >
                {importing ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" /> Provisioning Accounts...
                  </>
                ) : parsing ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" /> Validating CSV...
                  </>
                ) : preview?.validCount > 0 ? (
                  <>
                    <CheckCircle2 className="h-4 w-4" /> Submit & Import {preview.validCount} Users
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4" /> Submit & Import Users
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Validation Preview Panel */}
          {preview && (
            <div className="space-y-4 pt-2 border-t">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
                    <CheckCircle2 className="h-3 w-3 mr-1" /> {preview.validCount} Valid Row{preview.validCount === 1 ? "" : "s"}
                  </Badge>
                  {preview.rejectedCount > 0 && (
                    <Badge variant="outline" className="text-xs bg-rose-500/10 text-rose-600 border-rose-500/20">
                      <AlertCircle className="h-3 w-3 mr-1" /> {preview.rejectedCount} Invalid Row{preview.rejectedCount === 1 ? "" : "s"}
                    </Badge>
                  )}
                  {preview.newDepartments?.length > 0 && (
                    <Badge variant="outline" className="text-xs bg-sky-500/10 text-sky-600 border-sky-500/20">
                      <Building2 className="h-3 w-3 mr-1" /> +{preview.newDepartments.length} Department{preview.newDepartments.length === 1 ? "" : "s"} will be created ({preview.newDepartments.join(", ")})
                    </Badge>
                  )}
                </div>

                <p className="text-[11px] text-muted-foreground">
                  Review the rows below before clicking <strong className="text-foreground">Submit & Import</strong>.
                </p>
              </div>

              {/* Validation Summary Table */}
              <div className="max-h-60 overflow-y-auto rounded-lg border text-xs">
                <table className="w-full text-left">
                  <thead className="bg-muted/50 text-muted-foreground uppercase text-[10px] tracking-wider sticky top-0">
                    <tr>
                      <th className="p-2.5">Name</th>
                      <th className="p-2.5">Email</th>
                      <th className="p-2.5">Role</th>
                      <th className="p-2.5">Department</th>
                      <th className="p-2.5">Faculty ID</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-muted/30">
                    {preview.validRows.map((r: any, idx: number) => (
                      <tr key={idx} className="hover:bg-muted/20">
                        <td className="p-2.5 font-medium">{r.name}</td>
                        <td className="p-2.5 font-mono text-muted-foreground">{r.email}</td>
                        <td className="p-2.5">
                          <Badge variant="secondary" className="text-[10px]">
                            {r.scopeLevel}
                          </Badge>
                        </td>
                        <td className="p-2.5 text-muted-foreground">{r.deptName || "Global"}</td>
                        <td className="p-2.5 font-mono text-[10px]">{r.facultyId || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Rejected Rows Notice */}
              {preview.rejectedRows?.length > 0 && (
                <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 text-xs space-y-1">
                  <p className="font-semibold flex items-center gap-1.5">
                    <AlertCircle className="h-3.5 w-3.5" /> Skipped Invalid Rows:
                  </p>
                  {preview.rejectedRows.map((rej: any, idx: number) => (
                    <p key={idx} className="text-[11px]">
                      • Row {rej.rowNumber}: {rej.reason}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Success Result Summary */}
          {result && (
            <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-semibold text-sm">
                  <CheckCircle2 className="h-5 w-5" /> {result.message || "Bulk import executed successfully."}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setResult(null)}
                  className="h-7 text-xs bg-background"
                >
                  Dismiss
                </Button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs pt-1">
                <div className="p-2.5 rounded-lg bg-background/60 border">
                  <p className="text-[11px] text-muted-foreground">Accounts Created</p>
                  <p className="text-base font-bold text-foreground">{result.createdCount}</p>
                </div>
                <div className="p-2.5 rounded-lg bg-background/60 border">
                  <p className="text-[11px] text-muted-foreground">Existing Linked</p>
                  <p className="text-base font-bold text-foreground">{result.existingCount}</p>
                </div>
                <div className="p-2.5 rounded-lg bg-background/60 border">
                  <p className="text-[11px] text-muted-foreground">New Departments</p>
                  <p className="text-base font-bold text-foreground">{result.createdDepartments?.length || 0}</p>
                </div>
                <div className="p-2.5 rounded-lg bg-background/60 border">
                  <p className="text-[11px] text-muted-foreground">Must Change Password</p>
                  <p className="text-base font-bold text-foreground">{result.passwordResetRequiredCount}</p>
                </div>
              </div>

              <div className="flex items-center gap-2 p-2.5 rounded-lg bg-background/80 border text-xs text-muted-foreground">
                <KeyRound className="h-4 w-4 text-amber-500 shrink-0" />
                <span>
                  All newly created users have been provisioned with the default password <code className="font-mono font-semibold text-foreground">{DEFAULT_IMPORT_PASSWORD}</code> and will be prompted to set their permanent password on first login.
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
