import { ethers } from "ethers"
import CryptoJS from "crypto-js"
import crypto from "crypto"
import WORK_TOKEN_ABI from "./WorkTokenABI.json"

export const DEFAULT_SEPOLIA_RPC = "https://ethereum-sepolia-rpc.publicnode.com"
export const DEFAULT_ENCRYPTION_KEY = "workledger-sepolia-aes-master-key-2026!"
export const DEFAULT_WORK_TOKEN_ADDRESS = "0x8e97d9ABDC7013B37e529512a1d36133d27fBef5"
export const DEFAULT_OWNER_ADDRESS = "0x20ed3c4334c3215d7cf5e879f73c18a5a5b5b03a"

export const WORK_TOKEN_CONTRACT_ADDRESS =
  process.env.WORK_TOKEN_CONTRACT_ADDRESS ||
  process.env.WORK_TOKEN_ADDRESS ||
  DEFAULT_WORK_TOKEN_ADDRESS

export const TOKEN_OWNER_ADDRESS =
  process.env.TREASURY_PUBLIC_ADDRESS ||
  process.env.TOKEN_OWNER_ADDRESS ||
  DEFAULT_OWNER_ADDRESS

/**
 * Helper to build standard Sepolia Etherscan link.
 */
export function getEtherscanTxUrl(txHash: string): string {
  return `https://sepolia.etherscan.io/tx/${txHash}`
}

/**
 * Get configured JSON-RPC provider for Sepolia testnet.
 */
export function getSepoliaProvider(): ethers.JsonRpcProvider {
  const rpcUrl = process.env.SEPOLIA_RPC_URL || DEFAULT_SEPOLIA_RPC
  return new ethers.JsonRpcProvider(rpcUrl)
}

/**
 * Generates a fresh random Ethereum wallet, encrypts the private key via AES-256.
 */
export function createRandomWallet(): {
  address: string
  encryptedPrivateKey: string
  mnemonic?: string
} {
  const randomWallet = ethers.Wallet.createRandom()
  const encryptionKey = process.env.WALLET_ENCRYPTION_KEY || DEFAULT_ENCRYPTION_KEY

  const encryptedPrivateKey = CryptoJS.AES.encrypt(
    randomWallet.privateKey,
    encryptionKey
  ).toString()

  return {
    address: randomWallet.address,
    encryptedPrivateKey,
    mnemonic: randomWallet.mnemonic?.phrase,
  }
}

/**
 * Decrypts an AES-256 encrypted private key in server memory.
 * Supports CryptoJS AES ciphertext format and legacy AES-256-GCM format.
 * Keys are never logged and never exposed to the client.
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
 * Instantiate an ethers.Wallet instance for an encrypted private key attached to Sepolia.
 */
export function getWalletInstance(encryptedPrivateKey: string): ethers.Wallet {
  const privateKey = decryptPrivateKey(encryptedPrivateKey)
  const provider = getSepoliaProvider()
  return new ethers.Wallet(privateKey, provider)
}

/**
 * Get the Director / Org Admin Genesis Signer that pays gas for relays.
 */
export function getAdminWallet(): ethers.Wallet | null {
  const adminKey = process.env.ADMIN_PRIVATE_KEY || process.env.TREASURY_PRIVATE_KEY
  if (!adminKey) {
    return null
  }
  const provider = getSepoliaProvider()
  return new ethers.Wallet(adminKey, provider)
}

/**
 * Instantiate the WORK Token contract attached to a signer or provider.
 */
export function getTokenContract(
  signerOrProvider?: ethers.Signer | ethers.Provider
): ethers.Contract {
  const provider = signerOrProvider || getSepoliaProvider()
  return new ethers.Contract(WORK_TOKEN_CONTRACT_ADDRESS, WORK_TOKEN_ABI, provider)
}

/**
 * Funds a new user's wallet with Sepolia ETH from the admin wallet so they can broadcast transactions.
 */
export async function fundWallet(
  recipientAddress: string,
  amountEth: string = "0.005"
): Promise<{ txHash: string; success: boolean }> {
  const adminWallet = getAdminWallet()
  if (!adminWallet) {
    console.warn("[wallet-utils] Admin wallet key not configured, skipping gas funding.")
    return { txHash: `sim_fund_${Date.now()}`, success: true }
  }

  try {
    const tx = await adminWallet.sendTransaction({
      to: recipientAddress,
      value: ethers.parseEther(amountEth),
    })
    return { txHash: tx.hash, success: true }
  } catch (error: any) {
    console.error("[wallet-utils] Gas funding failed:", error)
    return { txHash: "", success: false }
  }
}

/**
 * Fetch real-time on-chain ERC-20 token balance for an address.
 */
export async function getOnChainTokenBalance(address: string): Promise<number> {
  try {
    const contract = getTokenContract()
    const rawBalance = await contract.balanceOf(address)
    const decimals = await contract.decimals().catch(() => 18)
    return Number(ethers.formatUnits(rawBalance, decimals))
  } catch (error) {
    // Return 0 if contract query fails or address has 0 balance
    return 0
  }
}
