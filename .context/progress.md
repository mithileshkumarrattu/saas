# Progress Ledger

| [BUILT] | [BROKEN] | [LEFT TO DO] |
| --- | --- | --- |
| [2026-08-02] Restructured workspace routing to dynamic `/[orgId]/[role]` | None | [ ] Provide Sepolia contract credentials to test live on-chain broadcast |
| [2026-08-02] Dynamic validation layout at `[orgId]/layout.tsx` | | |
| [2026-08-03] Fixed client-side role switcher and dynamic menu mapping | | |
| [2026-08-03] Created Director Invite Team Page | | |
| [2026-08-03] Decoupled signup invitation acceptor route & page flow | | |
| [2026-08-03] Org Structure Tree & HOD/Lead Builder | | |
| [2026-08-10] Re-architected interactive Org Tree Visualizer | | |
| [2026-08-10] Eliminated hardcoded mock data across all dashboards | | |
| [2026-08-11] Full architectural redesign — academic domain model | | |
| [2026-08-11] db-patch-v2.sql written (9 new tables, RLS, triggers, views) | | |
| [2026-08-11] New AppSidebar with Framer Motion hover-expand, mobile drawer | | |
| [2026-08-11] CSS glassmorphism + scrollbar utilities added | | |
| [2026-08-11] canvas-shell rewritten with DEPT_ADMIN role support | | |
| [2026-08-19] Phase 0: Eradicated token_value in favor of credit_value, killed fallback mocks (5000/10000), created getTeachingStaff query helper | | |
| [2026-08-19] Phase 1: Bulk faculty CSV/XLSX importer with auto-mapping + first-login forced password change at /auth/change-password | | |
| [2026-08-19] Phase 2: Timetable CSV/XLSX importer + 75/25 credit compiler engine + checkSalaryEligibility RPC | | |
| [2026-08-19] Phase 3: Task pool visibility scoping (ORGANIZATION vs ORG_UNIT) with department isolation | | |
| [2026-08-19] Phase 4: Attendance -> HOD Verification -> PERSONAL wallet credit -> Progress Recompute -> Salary Claim / Work Loan -> Finance Batch Reversal | | |
| [2026-08-19] Phase 5: Dashboard truthfulness pass — 100% database-driven queries with honest zero states | | |
| [2026-08-19] Phase 6: Demo seed datasets (faculty_import.csv, timetable_import.csv) + comprehensive presentation script (DEMO_SCRIPT.md) | | |
| [2026-08-19] Phase 7: Live Runtime Acceptance Suite (Tests A-M) executed & verified 100% PASS against Supabase | | |
| [2026-08-19] Phase 8: Demo Credential Recovery & Restoration — reset & verified deterministic passwords for 4 demo accounts | | |
| [2026-08-19] Master Rebuild Phase 0: Role model & actor separation — SYSTEM_ADMIN only signup, preview-mode banner, strict MEMBER teaching staff filter | | |
| [2026-08-19] Master Rebuild Phase 1: Real bulk faculty CSV/XLSX import with initial honest 0 targets & forced password rotation | | |
| [2026-08-19] Master Rebuild Phase 2: Dept Admin CRUD modules + 75/25 timetable schedule compiler | | |
| [2026-08-19] Master Rebuild Phase 3: Total eradication of token_value bug + organization vs org_unit task pool scoping | | |
| [2026-08-19] Master Rebuild Phase 4: Attendance submission -> HOD verification -> Personal wallet credit -> Live progress recompute | | |
| [2026-08-19] Master Rebuild Phase 5: Sepolia ERC-20 blockchain integration with ethers.js v6, AES-256 in-memory keys, WalletCard UI, and Etherscan links | | |
| [2026-08-19] Master Rebuild Phase 6: Live Rehearsal Guide (demo/REHEARSAL_NOTES.md) & 0-error TypeScript validation | | |
| [2026-08-19] Runtime Hotfix: Fixed role constraint 42P10 bug in ensure-user.ts, fixed [earnings] fetch error, and built /api/dept-admin/curriculum | | |
| [2026-08-19] Timetable & Batch Schema Fix: Removed nonexistent student_count column queries across batches/schedule/API routes | | |
| [2026-08-19] Timetable Compiler & Faculty UX Fix: Fixed timetable-compiler query-first deduplication, enabled faculty tasks page queries | | |
| [2026-08-19] Faculty Teaching Schedule & Attendance Pipeline Fix: Reinforced attendance logging & HOD approval routes | | |
| [2026-08-22] Step 0 Audit: Generated docs/TRUSTED_REBUILD_AUDIT.md and JSON pre-reset export across all 17 public tables | | |
| [2026-08-22] Trusted Work Model: Wrote 20260822_workledger_trusted_work.sql with work_cycles, scheduled_work_templates, etc. | | |
| [2026-08-22] Role Strictness: SYSTEM_ADMIN self-signup only, org_unit_id = null, eradicated DIRECTOR fallback in ensure-user.ts | | |
| [2026-08-22] Data Reset: Live table preview + typed phrase "RESET WORKLEDGER DEMO DATA" at config/reset and /api/admin/reset-data | | |
| [2026-08-22] Timetable Engine: Built XLSX timetable import (/dept-admin/import) with canonical headers, schedule matrix (/dept-admin/schedules) | | |
| [2026-08-22] Faculty Dashboard: Minimal Faculty Dashboard with live Monthly Progress card (85% threshold), today's scheduled sessions | | |
| [2026-08-22] HOD Workspace: Dual View (Employee + Manager) with scheduled review feed, ad-hoc task management, nominations review | | |
| [2026-08-22] Real Sepolia ERC-20: Built lib/blockchain/work-token.ts with ethers v6, AES-256-GCM encryption, readiness check route | | |
| [2026-08-22] Build Validation: 0 TypeScript errors (npx tsc --noEmit) and 100% successful Next.js production build (npm run build) | | |
| [2026-08-22] Unified Data Contract: Built lib/workledger/ with strict department isolation and zero legacy mock defaults | | |
| [2026-08-22] UI Refactor: Built responsive 2-column faculty dashboard and full-width prioritized initiatives | | |
| [2026-08-22] Legacy Retirement & Redirection: Redirected all non-[orgId] routes to canonical [orgId] paths | | |
| [2026-08-22] Verification Reports: Generated docs/DEPLOYMENT_CONSISTENCY_AUDIT.md and docs/DEPLOYMENT_E2E_TEST_REPORT.md | | |
| [2026-08-22] Final Core Repair: Eradicated verification_type in favor of canonical verification_mode, built transactional getOrCreateDefaultTaskType | | |
| [2026-09-04] Verified PR #5 (Commit 797ddd7): Verified all 12 audit remediations pulled, resolved TypeScript typings, compiled 53/53 Next.js routes with Turbopack, and passed 7/7 live database acceptance tests | | |
| [2026-09-06] Core Demo Flow Repair & Simple ERC-20 Sepolia: Deployed standard WorkLedgerToken.sol logic, fixed disappearing departments & cross-org role pollution, built bulk people & timetable CSV importers with downloadable templates, integrated HOD nominations/assignment portal, and built live Sepolia ERC-20 mint settlement | None | [ ] Execute demo runbook flow for tomorrow's presentation |
| [2026-09-06] Vercel Build & Prerender Fix: Synchronized pnpm-lock.yaml, added force-dynamic & safe placeholder fallbacks to lib/supabase client/server/admin to prevent SSR prerender failures, verified 55/55 routes generated, and pushed to origin/main | None | [ ] Verify live Vercel production deployment and trigger demo rehearsal |
| [2026-10-12] Sepolia MVGRToken & Automated Per-User Credentials Engine: Integrated confirmed deployed contract `MVGRToken` (`0x8e97d9ABDC7013B37e529512a1d36133d27fBef5`, Deployer `0x20ed3c4...b03a`, 1M supply) on Sepolia Testnet (ChainID 11155111). Implemented automated zero-friction wallet generation (`ethers.Wallet.createRandom()`), AES-256 encrypted custodial storage (`blockchain_wallets`), zero frontend private-key exposure, auto-provisioning on login/session verification (`ensureUserBlockchainWallet`), in-memory signing & live Sepolia ERC-20 transfers for task rewards & salary settlements | None | [ ] Add optional `TREASURY_PRIVATE_KEY` for automated live on-chain salary broadcasts |



