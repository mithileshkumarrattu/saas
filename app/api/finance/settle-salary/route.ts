import { createAdminClient } from "@/lib/supabase/admin"
import { getSessionUser } from "@/lib/auth/session"
import {
  executeSalaryMint,
  getEtherscanTxUrl,
  DEFAULT_SEPOLIA_RPC,
  DEFAULT_WORK_TOKEN_ADDRESS,
} from "@/lib/blockchain/work-token"
import { createRandomWallet } from "@/lib/blockchain/wallet-utils"
import { NextResponse } from "next/server"

export async function POST(req: Request) {
  try {
    const user = await getSessionUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const hasFinanceScope =
      user.scopeLevels.includes("FINANCE_ADMIN") ||
      user.scopeLevels.includes("DIRECTOR") ||
      user.scopeLevels.includes("SYSTEM_ADMIN")

    if (!hasFinanceScope) {
      return NextResponse.json(
        { error: "Insufficient permissions. Only Finance Admins or Directors can settle salary on-chain." },
        { status: 403 }
      )
    }

    const { requestId, facultyId, amount: customAmount } = await req.json()

    if (!requestId && !facultyId) {
      return NextResponse.json({ error: "requestId or facultyId is required." }, { status: 400 })
    }

    const admin = createAdminClient()
    const db = admin as any
    const orgId = user.organizationId

    // 1. Fetch the target salary request
    let query = db
      .from("salary_requests")
      .select("id, user_id, organization_id, status, earned_credits, target_credits, month_start, tx_hash, users(id, name, email)")
      .eq("organization_id", orgId)

    if (requestId) {
      query = query.eq("id", requestId)
    } else {
      const nowIso = new Date().toISOString()
      const currentMonthStart = `${nowIso.slice(0, 7)}-01`
      query = query.eq("user_id", facultyId).eq("month_start", currentMonthStart)
    }

    const { data: salaryReq, error: reqErr } = await query.maybeSingle()

    if (reqErr || !salaryReq) {
      return NextResponse.json({ error: "Salary request record not found." }, { status: 404 })
    }

    // 2. Validate status
    if (salaryReq.status === "ON_CHAIN_CONFIRMED") {
      return NextResponse.json({
        success: true,
        alreadyConfirmed: true,
        txHash: salaryReq.tx_hash,
        etherscanUrl: salaryReq.tx_hash ? getEtherscanTxUrl(salaryReq.tx_hash) : null,
        message: `Salary settlement has already been confirmed on-chain (Tx: ${salaryReq.tx_hash?.slice(0, 10)}...).`,
      })
    }

    if (salaryReq.status !== "HOD_APPROVED") {
      return NextResponse.json(
        {
          error: `Cannot settle salary request in status "${salaryReq.status}". HOD approval is required first.`,
        },
        { status: 400 }
      )
    }

    // 3. Find faculty's custodial audit wallet
    let { data: facultyWallet } = await db
      .from("blockchain_wallets")
      .select("id, public_address")
      .eq("user_id", salaryReq.user_id)
      .eq("organization_id", orgId)
      .eq("purpose", "PERSONAL")
      .maybeSingle()

    if (!facultyWallet || !facultyWallet.public_address) {
      try {
        const { address, encryptedPrivateKey } = createRandomWallet()
        const nowIso = new Date().toISOString()
        const { data: newWal } = await db
          .from("blockchain_wallets")
          .insert({
            organization_id: orgId,
            user_id: salaryReq.user_id,
            public_address: address,
            encrypted_private_key: encryptedPrivateKey,
            purpose: "PERSONAL",
            network: "sepolia",
            created_at: nowIso,
            updated_at: nowIso,
          })
          .select("id, public_address")
          .single()

        if (newWal) {
          facultyWallet = newWal
        }
      } catch (walErr) {
        console.warn("[settle-salary] Auto-provision note:", walErr)
      }
    }

    if (!facultyWallet || !facultyWallet.public_address) {
      return NextResponse.json(
        {
          error: `Faculty member ${salaryReq.users?.name || "faculty"} must have an audit wallet before settlement.`,
        },
        { status: 400 }
      )
    }

    // Determine mint amount (default to 10 WORK or custom amount)
    const tokenAmount = customAmount && Number(customAmount) > 0 ? Number(customAmount) : 10

    // 4. Check if blockchain is configured
    const rpcUrl = process.env.SEPOLIA_RPC_URL || DEFAULT_SEPOLIA_RPC
    const tokenAddress =
      process.env.WORK_TOKEN_ADDRESS ||
      process.env.WORK_TOKEN_CONTRACT_ADDRESS ||
      DEFAULT_WORK_TOKEN_ADDRESS
    const treasuryKey = process.env.TREASURY_PRIVATE_KEY || process.env.ADMIN_PRIVATE_KEY

    if (!rpcUrl || !tokenAddress || !treasuryKey) {
      return NextResponse.json(
        {
          error: "Sepolia treasury signing key is not configured in server environment (TREASURY_PRIVATE_KEY).",
        },
        { status: 503 }
      )
    }

    // 5. Execute on-chain mint transaction
    const mintReceipt = await executeSalaryMint({
      recipientAddress: facultyWallet.public_address,
      amount: tokenAmount,
    })

    const nowIso = new Date().toISOString()

    // 6. Record transaction in blockchain_transactions
    const { data: txRecord } = await db
      .from("blockchain_transactions")
      .insert({
        organization_id: orgId,
        from_address: process.env.TREASURY_PUBLIC_ADDRESS || "TREASURY",
        to_address: facultyWallet.public_address,
        amount: tokenAmount,
        event_type: "SALARY_MINT",
        status: "CONFIRMED",
        tx_hash: mintReceipt.txHash,
        block_number: mintReceipt.blockNumber,
        created_at: nowIso,
      })
      .select("id")
      .single()

    // 7. Update salary request status to ON_CHAIN_CONFIRMED
    await db
      .from("salary_requests")
      .update({
        status: "ON_CHAIN_CONFIRMED",
        tx_hash: mintReceipt.txHash,
        blockchain_tx_id: txRecord?.id || null,
        updated_at: nowIso,
      })
      .eq("id", salaryReq.id)

    return NextResponse.json({
      success: true,
      txHash: mintReceipt.txHash,
      blockNumber: mintReceipt.blockNumber,
      etherscanUrl: mintReceipt.etherscanUrl,
      amount: tokenAmount,
      recipientAddress: facultyWallet.public_address,
      facultyName: salaryReq.users?.name,
      message: `Successfully minted ${tokenAmount} WORK audit tokens to ${salaryReq.users?.name} on Ethereum Sepolia.`,
    })
  } catch (error: any) {
    console.error("[finance/settle-salary] Error:", error)
    return NextResponse.json(
      { error: error?.message || "Blockchain settlement failed." },
      { status: 500 }
    )
  }
}
