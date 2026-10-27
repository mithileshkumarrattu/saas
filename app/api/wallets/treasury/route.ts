import { getSessionUser, hasScope } from "@/lib/auth/session"
import {
  WORK_TOKEN_ABI,
  DEFAULT_SEPOLIA_RPC,
  DEFAULT_WORK_TOKEN_ADDRESS,
  DEFAULT_OWNER_ADDRESS,
} from "@/lib/blockchain/work-token"
import { ethers } from "ethers"
import { NextResponse } from "next/server"

/**
 * GET /api/wallets/treasury
 * Returns treasury public address and live safe Sepolia balances.
 * Never exposes treasury private key.
 */
export async function GET() {
  try {
    const user = await getSessionUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const isAuthorized =
      hasScope(user.scopeLevels, "DIRECTOR") ||
      hasScope(user.scopeLevels, "SYSTEM_ADMIN") ||
      hasScope(user.scopeLevels, "FINANCE_ADMIN")
    if (!isAuthorized) {
      return NextResponse.json({ error: "Forbidden. Director or Admin access required." }, { status: 403 })
    }

    const rpcUrl = process.env.SEPOLIA_RPC_URL || DEFAULT_SEPOLIA_RPC
    const tokenAddress =
      process.env.WORK_TOKEN_ADDRESS ||
      process.env.WORK_TOKEN_CONTRACT_ADDRESS ||
      DEFAULT_WORK_TOKEN_ADDRESS
    const treasuryKey = process.env.TREASURY_PRIVATE_KEY || process.env.ADMIN_PRIVATE_KEY

    let treasuryAddress: string | null = null
    if (treasuryKey) {
      try {
        treasuryAddress = new ethers.Wallet(treasuryKey).address
      } catch {
        // Fallback to configured address
      }
    }

    if (!treasuryAddress) {
      treasuryAddress = process.env.TREASURY_PUBLIC_ADDRESS || DEFAULT_OWNER_ADDRESS
    }

    if (!rpcUrl || !tokenAddress || !treasuryAddress) {
      return NextResponse.json({
        configured: false,
        treasuryAddress: null,
        ethBalance: "0.0",
        workBalance: "0.0",
        message: "Treasury wallet not configured in environment.",
      })
    }

    const provider = new ethers.JsonRpcProvider(rpcUrl)

    const [ethWei, contract] = [
      await provider.getBalance(treasuryAddress).catch(() => BigInt(0)),
      new ethers.Contract(tokenAddress, WORK_TOKEN_ABI, provider),
    ]

    const [decimals, tokenWei] = await Promise.all([
      contract.decimals().catch(() => 18),
      contract.balanceOf(treasuryAddress).catch(() => BigInt(0)),
    ])

    const ethBalance = ethers.formatEther(ethWei)
    const workBalance = ethers.formatUnits(tokenWei, decimals)

    return NextResponse.json({
      configured: true,
      hasSigningKey: Boolean(treasuryKey),
      treasuryAddress,
      ethBalance,
      workBalance,
      network: "sepolia",
      tokenAddress,
    })
  } catch (error: any) {
    console.error("[wallets/treasury] Error:", error)
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 })
  }
}
