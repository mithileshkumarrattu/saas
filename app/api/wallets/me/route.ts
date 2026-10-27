import { createAdminClient } from "@/lib/supabase/admin"
import { getSessionUser } from "@/lib/auth/session"
import {
  encryptPrivateKey,
  WORK_TOKEN_ABI,
  DEFAULT_SEPOLIA_RPC,
  DEFAULT_WORK_TOKEN_ADDRESS,
  DEFAULT_ENCRYPTION_KEY,
} from "@/lib/blockchain/work-token"
import { fundWallet } from "@/lib/blockchain/wallet-utils"
import { ethers } from "ethers"
import { NextResponse } from "next/server"

/**
 * GET /api/wallets/me
 * Returns authenticated user's audit wallet metadata, live Sepolia balances, and tx history.
 * Never exposes private keys or encrypted secrets.
 */
export async function GET() {
  try {
    const user = await getSessionUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const admin = createAdminClient()
    const db = admin as any
    const rpcUrl = process.env.SEPOLIA_RPC_URL || DEFAULT_SEPOLIA_RPC
    const tokenAddress =
      process.env.WORK_TOKEN_ADDRESS ||
      process.env.WORK_TOKEN_CONTRACT_ADDRESS ||
      DEFAULT_WORK_TOKEN_ADDRESS
    const isChainConfigured = Boolean(rpcUrl && tokenAddress)

    // 1. Fetch user's personal audit wallet record
    const { data: walletRecord } = await db
      .from("blockchain_wallets")
      .select("id, public_address, purpose, network, created_at")
      .eq("user_id", user.id)
      .eq("organization_id", user.organizationId)
      .eq("purpose", "PERSONAL")
      .maybeSingle()

    let activeWallet = walletRecord

    // Auto-provision if missing
    if (!activeWallet) {
      try {
        const randomWallet = ethers.Wallet.createRandom()
        const encryptedKey = encryptPrivateKey(randomWallet.privateKey)
        const nowIso = new Date().toISOString()

        const { data: inserted } = await db
          .from("blockchain_wallets")
          .insert({
            user_id: user.id,
            organization_id: user.organizationId,
            public_address: randomWallet.address,
            encrypted_private_key: encryptedKey,
            purpose: "PERSONAL",
            network: "sepolia",
            created_at: nowIso,
            updated_at: nowIso,
          })
          .select("id, public_address, purpose, network, created_at")
          .single()

        if (inserted) {
          activeWallet = inserted
          fundWallet(randomWallet.address).catch(() => {})
        }
      } catch (genErr) {
        console.warn("[wallets/me] Auto-provision note:", genErr)
      }
    }

    if (!activeWallet) {
      return NextResponse.json({
        status: isChainConfigured ? "READY_NO_WALLET" : "NOT_CONFIGURED",
        configured: isChainConfigured,
        wallet: null,
        transactions: [],
        message: isChainConfigured
          ? "Your audit wallet has not been created."
          : "Blockchain audit wallet is not configured.",
      })
    }

    let ethBalance = "0.0"
    let workBalance = "0.0"
    let isReachable = false

    // 2. Query live Sepolia contract & provider balances
    if (isChainConfigured && rpcUrl && tokenAddress) {
      try {
        const provider = new ethers.JsonRpcProvider(rpcUrl)
        const [ethWei, contract] = [
          await provider.getBalance(activeWallet.public_address).catch(() => BigInt(0)),
          new ethers.Contract(tokenAddress, WORK_TOKEN_ABI, provider),
        ]

        const [decimals, tokenWei] = await Promise.all([
          contract.decimals().catch(() => 18),
          contract.balanceOf(activeWallet.public_address).catch(() => BigInt(0)),
        ])

        ethBalance = ethers.formatEther(ethWei)
        workBalance = ethers.formatUnits(tokenWei, decimals)
        isReachable = true
      } catch (rpcErr) {
        console.error("[wallets/me] RPC balance fetch error:", rpcErr)
      }
    }

    // 3. Fetch actual persisted blockchain transactions
    const { data: txRecords } = await db
      .from("blockchain_transactions")
      .select("id, tx_hash, amount, event_type, status, block_number, created_at, from_address, to_address")
      .eq("organization_id", user.organizationId)
      .or(`to_address.eq.${activeWallet.public_address},from_address.eq.${activeWallet.public_address}`)
      .order("created_at", { ascending: false })
      .limit(10)

    const transactions = (txRecords || []).map((tx: any) => ({
      id: tx.id,
      txHash: tx.tx_hash,
      amount: Number(tx.amount || 0),
      eventType: tx.event_type,
      status: tx.status,
      blockNumber: tx.block_number,
      createdAt: tx.created_at,
      etherscanUrl: `https://sepolia.etherscan.io/tx/${tx.tx_hash}`,
    }))

    return NextResponse.json({
      status: "READY",
      configured: isChainConfigured,
      rpcReachable: isReachable,
      wallet: {
        id: activeWallet.id,
        publicAddress: activeWallet.public_address,
        ethBalance,
        workBalance,
        network: activeWallet.network || "sepolia",
        createdAt: activeWallet.created_at,
      },
      transactions,
    })
  } catch (error: any) {
    console.error("[wallets/me] Error:", error)
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 })
  }
}

/**
 * POST /api/wallets/me
 * Creates personal custodial audit wallet for the current authenticated user only.
 */
export async function POST() {
  try {
    const user = await getSessionUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const encryptionKey = process.env.WALLET_ENCRYPTION_KEY || DEFAULT_ENCRYPTION_KEY

    const admin = createAdminClient()
    const db = admin as any

    // 1. Check if user already has a wallet
    const { data: existing } = await db
      .from("blockchain_wallets")
      .select("id, public_address")
      .eq("user_id", user.id)
      .eq("organization_id", user.organizationId)
      .eq("purpose", "PERSONAL")
      .maybeSingle()

    if (existing) {
      return NextResponse.json({
        success: true,
        publicAddress: existing.public_address,
        message: "Audit wallet already exists.",
      })
    }

    // 2. Generate random ethers wallet server-side
    const randomWallet = ethers.Wallet.createRandom()
    const encryptedKey = encryptPrivateKey(randomWallet.privateKey)
    const nowIso = new Date().toISOString()

    // 3. Persist to blockchain_wallets
    const { data: inserted, error: insertErr } = await db
      .from("blockchain_wallets")
      .insert({
        user_id: user.id,
        organization_id: user.organizationId,
        public_address: randomWallet.address,
        encrypted_private_key: encryptedKey,
        purpose: "PERSONAL",
        network: "sepolia",
        created_at: nowIso,
        updated_at: nowIso,
      })
      .select("id, public_address, purpose, network, created_at")
      .single()

    if (insertErr || !inserted) {
      console.error("[wallets/me] Insert error:", insertErr)
      return NextResponse.json({ error: `Failed to save wallet: ${insertErr?.message}` }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      publicAddress: inserted.public_address,
      message: "Personal blockchain audit wallet created successfully.",
    })
  } catch (error: any) {
    console.error("[wallets/me] Error:", error)
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 })
  }
}
