/**
 * Formats a file size in bytes to a human-readable string
 * @param bytes File size in bytes
 * @param decimals Number of decimal places (default: 2)
 * @returns Formatted string (e.g., "1.5 MB", "500 KB", "2.3 GB")
 */
export function formatFileSize(bytes: number, decimals: number = 2): string {
  if (bytes === 0) return '0 Bytes';
  if (bytes < 0) return 'N/A';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  // Ensure we don't exceed our sizes array
  const sizeIndex = Math.min(i, sizes.length - 1);

  const value = bytes / Math.pow(k, sizeIndex);

  return `${value.toFixed(dm)} ${sizes[sizeIndex]}`;
}
