import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';

/**
 * Constants for cryptographic operations
 */
export const CRYPTO_CONSTANTS = {
  /** Number of bytes for refresh token generation */
  REFRESH_TOKEN_BYTES: 40,
  /** Bcrypt cost factor (number of rounds) */
  BCRYPT_ROUNDS: 12,
  /** Hash algorithm for refresh tokens */
  HASH_ALGORITHM: 'sha256' as const,
} as const;

/**
 * Utility class for cryptographic operations in admin authentication
 */
export class CryptoUtils {
  /**
   * Generate a cryptographically secure random token
   * @param bytes Number of random bytes to generate
   * @returns Hex-encoded random token
   */
  static generateSecureToken(bytes: number = CRYPTO_CONSTANTS.REFRESH_TOKEN_BYTES): string {
    return crypto.randomBytes(bytes).toString('hex');
  }

  /**
   * Hash a token using SHA-256
   * Used for storing refresh tokens securely in the database
   * @param token The raw token to hash
   * @returns SHA-256 hash of the token
   */
  static hashToken(token: string): string {
    return crypto.createHash(CRYPTO_CONSTANTS.HASH_ALGORITHM).update(token).digest('hex');
  }

  /**
   * Hash a password using bcrypt
   * Bcrypt is intentionally slow to protect against brute-force attacks
   * @param password The plaintext password
   * @param rounds Optional: bcrypt cost factor (defaults to 12)
   * @returns Bcrypt hash of the password
   */
  static async hashPassword(password: string, rounds: number = CRYPTO_CONSTANTS.BCRYPT_ROUNDS): Promise<string> {
    return bcrypt.hash(password, rounds);
  }

  /**
   * Verify a password against a bcrypt hash
   * @param password The plaintext password to verify
   * @param hash The bcrypt hash to compare against
   * @returns True if password matches, false otherwise
   */
  static async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }
}

