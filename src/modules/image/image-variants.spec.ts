import {
  DEFAULT_VARIANT_QUALITY,
  SRCSET_WIDTHS,
  VARIANT_QUALITIES,
  VARIANT_SIZES,
  buildSrcset,
  snapQuality,
  snapSize,
} from './image-variants';

describe('image variants', () => {
  it('snaps sizes up to the next step', () => {
    expect(snapSize(undefined)).toBeUndefined();
    expect(snapSize(1)).toBe(16);
    expect(snapSize(16)).toBe(16);
    expect(snapSize(17)).toBe(32);
    expect(snapSize(800)).toBe(960);
    expect(snapSize(1920)).toBe(1920);
    expect(snapSize(4000)).toBe(4096);
    expect(snapSize(4096)).toBe(4096);
  });

  it('snaps quality to the nearest step, ties up', () => {
    expect(snapQuality(undefined)).toBe(DEFAULT_VARIANT_QUALITY);
    expect(snapQuality(1)).toBe(40);
    expect(snapQuality(50)).toBe(60);
    expect(snapQuality(80)).toBe(85);
    expect(snapQuality(85)).toBe(85);
    expect(snapQuality(93)).toBe(100);
    expect(snapQuality(100)).toBe(100);
  });

  it('bounds the number of distinct variants', () => {
    const widths = new Set(
      Array.from({ length: 4096 }, (_, i) => snapSize(i + 1)),
    );
    const qualities = new Set(
      Array.from({ length: 100 }, (_, i) => snapQuality(i + 1)),
    );
    expect(widths.size).toBe(VARIANT_SIZES.length);
    expect(qualities.size).toBe(VARIANT_QUALITIES.length);
  });
});

describe('buildSrcset', () => {
  const fullPath = 'https://x/images/id';

  it('offers only widths that are variant steps', () => {
    for (const w of SRCSET_WIDTHS) {
      expect(VARIANT_SIZES).toContain(w);
    }
  });

  it('lists the fixed widths below the original, then the original', () => {
    expect(buildSrcset(fullPath, 1000)).toBe(
      `${fullPath}?width=320 320w, ${fullPath}?width=640 640w, ${fullPath}?width=960 960w, ${fullPath} 1000w`,
    );
  });

  it('serves the original instead of an equal fixed width', () => {
    const srcset = buildSrcset(fullPath, 1920);
    expect(srcset).not.toContain('?width=1920');
    expect(srcset.endsWith(`, ${fullPath} 1920w`)).toBe(true);
  });

  it('has a single entry when the original is below every fixed width', () => {
    expect(buildSrcset(fullPath, 200)).toBe(`${fullPath} 200w`);
  });

  it('keeps a prefixed fullPath intact', () => {
    expect(buildSrcset('https://x/v2/images/id', 4000)).toMatch(
      /^https:\/\/x\/v2\/images\/id\?width=320 320w, /,
    );
  });
});
