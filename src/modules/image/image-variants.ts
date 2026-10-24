/**
 * On-demand transforms are snapped to a fixed grid before rendering, so any
 * width/height/quality in a URL maps to one of a bounded set of variants.
 * Old URLs keep working (they get the nearest step), but an attacker can no
 * longer force a fresh Sharp render per request by walking `?width=1,2,3…`.
 */

/** Pixel steps for width and height. A request snaps up to the next one. */
export const VARIANT_SIZES = [
  16, 32, 48, 64, 96, 128, 160, 192, 256, 320, 384, 480, 640, 768, 960, 1080,
  1280, 1440, 1600, 1920, 2560, 3200, 3840, 4096,
] as const;

/** Quality steps. A request snaps to the nearest one (ties go up). */
export const VARIANT_QUALITIES = [40, 60, 75, 85, 100] as const;

export const DEFAULT_VARIANT_QUALITY = 85;

/** Smallest step ≥ `size` (capped at the largest), so the caller never gets less than asked. */
export function snapSize(size: number | undefined): number | undefined {
  if (!size) return undefined;
  return (
    VARIANT_SIZES.find((step) => step >= size) ??
    VARIANT_SIZES[VARIANT_SIZES.length - 1]
  );
}

export function snapQuality(quality: number | undefined): number {
  if (!quality) return DEFAULT_VARIANT_QUALITY;
  return VARIANT_QUALITIES.reduce((best, step) =>
    Math.abs(step - quality) <= Math.abs(best - quality) ? step : best,
  );
}

/** Widths offered in `srcset`: a fixed subset of VARIANT_SIZES, so they share cache slots. */
export const SRCSET_WIDTHS = [320, 640, 960, 1280, 1920] as const;

/**
 * `srcset` for a public image: each fixed width below the original, then the
 * original itself (served from disk, no render, no cache slot).
 */
export function buildSrcset(fullPath: string, originalWidth: number): string {
  return [
    ...SRCSET_WIDTHS.filter((w) => w < originalWidth).map(
      (w) => `${fullPath}?width=${w} ${w}w`,
    ),
    `${fullPath} ${originalWidth}w`,
  ].join(', ');
}
