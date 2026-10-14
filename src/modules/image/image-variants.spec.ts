import {
  DEFAULT_VARIANT_QUALITY,
  VARIANT_QUALITIES,
  VARIANT_SIZES,
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
