import { openTinifyKey, sealTinifyKey } from './tinify-key';

const SECRET = 'ab'.repeat(32);

describe('tinify-key', () => {
  it('round-trips, never storing the plaintext', () => {
    const sealed = sealTinifyKey('sk_live_1234abcd', SECRET);
    expect(sealed).toMatch(/^enc:v1:/);
    expect(sealed).not.toContain('sk_live_1234abcd');
    expect(openTinifyKey(sealed, SECRET)).toBe('sk_live_1234abcd');
  });

  it('reads legacy plaintext and empty values as they are', () => {
    expect(openTinifyKey('legacy-key', SECRET)).toBe('legacy-key');
    expect(openTinifyKey(null, SECRET)).toBeNull();
  });

  it('rejects a tampered ciphertext or the wrong secret', () => {
    const sealed = sealTinifyKey('sk_live_1234abcd', SECRET);
    const tampered =
      sealed.slice(0, -2) + (sealed.endsWith('A=') ? 'B=' : 'A=');
    expect(() => openTinifyKey(tampered, SECRET)).toThrow();
    expect(() => openTinifyKey(sealed, 'cd'.repeat(32))).toThrow();
  });
});
