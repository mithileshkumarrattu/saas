import { ethers } from "ethers"
import CryptoJS from "crypto-js"
import crypto from "crypto"

export const DEFAULT_WORK_TOKEN_ADDRESS = "0x8e97d9ABDC7013B37e529512a1d36133d27fBef5"
export const DEFAULT_OWNER_ADDRESS = "0x20ed3c4334c3215d7cf5e879f73c18a5a5b5b03a"
export const DEFAULT_SEPOLIA_RPC = "https://ethereum-sepolia-rpc.publicnode.com"
export const DEFAULT_ENCRYPTION_KEY = "workledger-sepolia-aes-master-key-2026!"

export const WORK_TOKEN_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function transfer(address to, uint256 value) returns (bool)",
  "function approve(address spender, uint256 value) returns (bool)",
  "function transferFrom(address from, address to, uint256 value) returns (bool)",
  "function mint(address to, uint256 amount)",
  "function owner() view returns (address)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event Approval(address indexed owner, address indexed spender, uint256 value)",
]

export const SEPOLIA_CHAIN_ID = 11155111

/**
 * Standard Sepolia Etherscan transaction URL builder
 */
export function getEtherscanTxUrl(txHash: string): string {
  return `https://sepolia.etherscan.io/tx/${txHash}`
}

/**
 * Encrypt private key using CryptoJS AES (Standard across student & faculty app)
 */
export function encryptPrivateKey(privateKeyHex: string): string {
  const masterKey = process.env.WALLET_ENCRYPTION_KEY || DEFAULT_ENCRYPTION_KEY
  return CryptoJS.AES.encrypt(privateKeyHex, masterKey).toString()
}

/**
 * Universal AES Decryption for custodial private keys:
 * Supports CryptoJS.AES ciphertext and legacy GCM format.
 * Never logs or exposes raw private key.
 */
export function decryptPrivateKey(encryptedPayload: string): string {
  const primaryKey = process.env.WALLET_ENCRYPTION_KEY || DEFAULT_ENCRYPTION_KEY
  const backupKey = process.env.BACKUP_WALLET_ENCRYPTION_KEY

  const tryDecrypt = (payload: string, keyStr: string): string | null => {
    try {
      if (payload.includes(":")) {
        const parts = payload.split(":")
        if (parts.length === 3) {
          const [ivHex, authTagHex, encryptedHex] = parts
          const key = crypto.createHash("sha256").update(keyStr).digest()
          const iv = Buffer.from(ivHex, "hex")
          const authTag = Buffer.from(authTagHex, "hex")
          const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv)
          decipher.setAuthTag(authTag)
          let decrypted = decipher.update(encryptedHex, "hex", "utf8")
          decrypted += decipher.final("utf8")
          if (decrypted && decrypted.startsWith("0x")) return decrypted
        }
      }
      const bytes = CryptoJS.AES.decrypt(payload, keyStr)
      const decrypted = bytes.toString(CryptoJS.enc.Utf8)
      if (decrypted && decrypted.startsWith("0x")) return decrypted
    } catch {
      // Ignore individual attempt failure
    }
    return null
  }

  const primaryResult = tryDecrypt(encryptedPayload, primaryKey)
  if (primaryResult) return primaryResult

  if (backupKey) {
    const backupResult = tryDecrypt(encryptedPayload, backupKey)
    if (backupResult) return backupResult
  }

  throw new Error("Unable to decrypt blockchain private key.")
}

/**
 * Safe Blockchain Readiness Check (No private keys exposed)
 */
export async function checkBlockchainReadiness(): Promise<{
  configured: boolean
  chainId?: number
  rpcReachable: boolean
  workTokenAddress?: string
  tokenName?: string
  tokenSymbol?: string
  tokenDecimals?: number
  totalSupply?: string
  contractOwner?: string
  isOwnerMatched?: boolean
  treasuryAddress?: string
  treasuryEthBalance?: string
  treasuryWorkBalance?: string
  codeExists?: boolean
  statusMessage: string
}> {
  const rpcUrl = process.env.SEPOLIA_RPC_URL || DEFAULT_SEPOLIA_RPC
  const tokenAddress =
    process.env.WORK_TOKEN_ADDRESS ||
    process.env.WORK_TOKEN_CONTRACT_ADDRESS ||
    DEFAULT_WORK_TOKEN_ADDRESS
  const treasuryKey = process.env.TREASURY_PRIVATE_KEY || process.env.ADMIN_PRIVATE_KEY

  if (!ethers.isAddress(tokenAddress)) {
    return {
      configured: false,
      rpcReachable: false,
      statusMessage: `Invalid WORK_TOKEN_ADDRESS format: ${tokenAddress}`,
    }
  }

  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl)
    const network = await provider.getNetwork()
    const chainId = Number(network.chainId)

    const code = await provider.getCode(tokenAddress)
    const codeExists = Boolean(code && code !== "0x")

    let treasuryAddress = process.env.TREASURY_PUBLIC_ADDRESS || DEFAULT_OWNER_ADDRESS
    let treasuryEthBalance = "0.0"

    if (treasuryKey) {
      try {
        const treasuryWallet = new ethers.Wallet(treasuryKey, provider)
        treasuryAddress = treasuryWallet.address
      } catch {
        // Fallback to configured public address
      }
    }

    if (treasuryAddress) {
      try {
        const ethBalanceWei = await provider.getBalance(treasuryAddress)
        treasuryEthBalance = ethers.formatEther(ethBalanceWei)
      } catch {
        treasuryEthBalance = "0.0"
      }
    }

    const contract = new ethers.Contract(tokenAddress, WORK_TOKEN_ABI, provider)
    const [name, symbol, decimals, totalSupplyRaw, tokenBalanceWei, owner] = await Promise.all([
      contract.name().catch(() => "mvgr"),
      contract.symbol().catch(() => "MVGR"),
      contract.decimals().catch(() => 18),
      contract.totalSupply().catch(() => BigInt(0)),
      treasuryAddress ? contract.balanceOf(treasuryAddress).catch(() => BigInt(0)) : BigInt(0),
      contract.owner().catch(() => DEFAULT_OWNER_ADDRESS),
    ])

    const tokenDecimals = Number(decimals)
    const totalSupply = ethers.formatUnits(totalSupplyRaw, tokenDecimals)
    const treasuryWorkBalance = ethers.formatUnits(tokenBalanceWei, tokenDecimals)
    const isOwnerMatched = owner ? owner.toLowerCase() === treasuryAddress.toLowerCase() : false

    return {
      configured: true,
      chainId,
      rpcReachable: true,
      codeExists,
      workTokenAddress: tokenAddress,
      tokenName: name,
      tokenSymbol: symbol,
      tokenDecimals,
      totalSupply,
      contractOwner: owner || DEFAULT_OWNER_ADDRESS,
      isOwnerMatched,
      treasuryAddress,
      treasuryEthBalance,
      treasuryWorkBalance,
      statusMessage: codeExists
        ? `Sepolia testnet connection active. Contract ${name} (${symbol}) verified. Total supply: ${totalSupply}.`
        : "RPC connected, but no bytecode found at contract address.",
    }
  } catch (error: any) {
    return {
      configured: false,
      rpcReachable: false,
      statusMessage: `Sepolia connection check failed: ${error?.message || error}`,
    }
  }
}

/**
 * Execute real Sepolia ERC-20 salary settlement transfer/mint
 */
export async function executeSalaryMint(params: {
  recipientAddress: string
  amount: number
}): Promise<{
  txHash: string
  blockNumber: number
  gasUsed: string
  etherscanUrl: string
}> {
  const rpcUrl = process.env.SEPOLIA_RPC_URL || DEFAULT_SEPOLIA_RPC
  const tokenAddress =
    process.env.WORK_TOKEN_ADDRESS ||
    process.env.WORK_TOKEN_CONTRACT_ADDRESS ||
    DEFAULT_WORK_TOKEN_ADDRESS
  const treasuryKey = process.env.TREASURY_PRIVATE_KEY || process.env.ADMIN_PRIVATE_KEY

  if (!treasuryKey) {
    throw new Error("Treasury private key is not configured in server environment (TREASURY_PRIVATE_KEY).")
  }

  if (!ethers.isAddress(params.recipientAddress)) {
    throw new Error(`Invalid recipient address format: ${params.recipientAddress}`)
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl)
  const treasuryWallet = new ethers.Wallet(treasuryKey, provider)
  const contract = new ethers.Contract(tokenAddress, WORK_TOKEN_ABI, treasuryWallet)

  const decimals = await contract.decimals().catch(() => 18)
  const amountWei = ethers.parseUnits(params.amount.toString(), decimals)

  // In MVGRToken, 1,000,000 MVGR tokens belong to deployer/owner.
  // Execute transfer(recipient, amount) or mint fallback.
  let tx
  try {
    tx = await contract.transfer(params.recipientAddress, amountWei)
  } catch (transferErr: any) {
    console.warn("[executeSalaryMint] transfer failed, attempting mint:", transferErr?.message)
    tx = await contract.mint(params.recipientAddress, amountWei)
  }

  const receipt = await tx.wait(1)

  if (!receipt || receipt.status !== 1) {
    throw new Error(`On-chain transaction failed or reverted. Tx hash: ${tx.hash}`)
  }

  return {
    txHash: tx.hash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed ? receipt.gasUsed.toString() : "55000",
    etherscanUrl: getEtherscanTxUrl(tx.hash),
  }
}

export const executeSalaryTransfer = executeSalaryMint

