import {
  FILE_LINK_TTL_SECONDS,
  signFileLink,
  verifyFileLink,
} from './file-link';
import { sanitizeLoggedUrl } from '@/common/share-tokens';

describe('signed file links', () => {
  const secret = 's'.repeat(32);
  const now = Date.UTC(2026, 10, 2, 10, 0, 0);
  const { token, expiresAt } = signFileLink('file-1', secret, now);

  it('expires FILE_LINK_TTL_SECONDS from now', () => {
    expect(expiresAt.getTime()).toBe(now + FILE_LINK_TTL_SECONDS * 1000);
  });

  it('opens its own file until it expires', () => {
    expect(verifyFileLink('file-1', token, secret, now)).toBe(true);
    expect(
      verifyFileLink('file-1', token, secret, expiresAt.getTime() - 1),
    ).toBe(true);
    expect(verifyFileLink('file-1', token, secret, expiresAt.getTime())).toBe(
      false,
    );
  });

  it('never opens another file, or with another secret', () => {
    expect(verifyFileLink('file-2', token, secret, now)).toBe(false);
    expect(verifyFileLink('file-1', token, 't'.repeat(32), now)).toBe(false);
  });

  it('rejects a tampered, malformed or shorter token without throwing', () => {
    const [exp, sig] = token.split('.');
    const flipped = sig[0] === 'A' ? 'B' + sig.slice(1) : 'A' + sig.slice(1);
    for (const bad of [
      `${exp}.${flipped}`,
      `${Number(exp) + 60}.${sig}`, // extended expiry
      `${exp}.${sig.slice(1)}`, // different length
      `${exp}.${sig}x`,
      sig,
      `${exp}.`,
      `.${sig}`,
      'garbage',
      '',
      undefined,
    ]) {
      expect(verifyFileLink('file-1', bad, secret, now)).toBe(false);
    }
  });

  it('keeps the token out of logged URLs', () => {
    expect(sanitizeLoggedUrl(`/files/file-1/download?token=${token}`)).toBe(
      '/files/file-1/download?token=%5BREDACTED%5D',
    );
  });
});
