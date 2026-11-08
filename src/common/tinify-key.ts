import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/**
 * Tinify API keys at rest: AES-256-GCM with TINIFY_KEY_SECRET (64 hex chars),
 * stored as `enc:v1:<iv>:<tag>:<data>` (base64). Same scheme as Herald's
 * crypto.util. A database dump alone no longer hands out the keys.
 */
const PREFIX = 'enc:v1:';
const IV_LENGTH = 12;
// Pinned on both sides: without it setAuthTag() accepts a truncated tag.
const AUTH_TAG_LENGTH = 16;

export function sealTinifyKey(plain: string, secretHex: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(
    'aes-256-gcm',
    Buffer.from(secretHex, 'hex'),
    iv,
    { authTagLength: AUTH_TAG_LENGTH },
  );
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return (
    PREFIX +
    [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64')).join(':')
  );
}

/**
 * The plaintext key. A value without the prefix predates encryption and is
 * returned as-is.
 * ponytail: legacy plaintext rows stay readable until re-saved from the
 * console; drop the fallback once none are left
 * (`SELECT id FROM clients WHERE "tinifyApiKey" NOT LIKE 'enc:v1:%'`).
 */
export function openTinifyKey(
  stored: string | null | undefined,
  secretHex: string,
): string | null {
  if (!stored) return null;
  if (!stored.startsWith(PREFIX)) return stored;
  const [iv, tag, data] = stored
    .slice(PREFIX.length)
    .split(':')
    .map((part) => Buffer.from(part ?? '', 'base64'));
  if (iv.length !== IV_LENGTH || tag.length !== AUTH_TAG_LENGTH) {
    throw new Error('Invalid Tinify key ciphertext');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    Buffer.from(secretHex, 'hex'),
    iv,
    { authTagLength: AUTH_TAG_LENGTH },
  );
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    'utf8',
  );
}
