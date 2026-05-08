/**
 * Masks an API key for security purposes
 * Shows first 8 and last 4 characters, replaces middle with asterisks
 * @param apiKey - The API key to mask
 * @returns Masked API key or null/undefined if input is null/undefined
 */
export function maskApiKey(apiKey: string | null | undefined): string | null | undefined {
  if (!apiKey) return apiKey;

  const length = apiKey.length;

  // If key is too short (< 12 chars), mask everything except first 4 chars
  if (length < 12) {
    return apiKey.substring(0, 4) + '*'.repeat(Math.max(0, length - 4));
  }

  // Show first 8 and last 4 characters
  const start = apiKey.substring(0, 8);
  const end = apiKey.substring(length - 4);
  const maskedLength = length - 12;

  return `${start}${'*'.repeat(maskedLength)}${end}`;
}

