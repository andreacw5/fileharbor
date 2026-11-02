import { detectFileType, extensionOf } from './file-types';

describe('detectFileType', () => {
  const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0]);
  const pdf = Buffer.from('%PDF-1.7');

  it('accepts a zip and a pdf whose bytes match the extension', () => {
    expect(detectFileType('pack.ZIP', zip)).toBe('zip');
    expect(detectFileType('guide.pdf', pdf)).toBe('pdf');
  });

  it('rejects a .zip holding a pdf, and the reverse', () => {
    expect(detectFileType('pack.zip', pdf)).toBeUndefined();
    expect(detectFileType('guide.pdf', zip)).toBeUndefined();
  });

  it('rejects an .exe renamed .zip', () => {
    expect(
      detectFileType('setup.zip', Buffer.from('MZ\x90\x00\x03\x00\x00\x00')),
    ).toBeUndefined();
  });

  it('rejects an empty zip (end-of-central-directory only)', () => {
    expect(
      detectFileType(
        'empty.zip',
        Buffer.from([0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0]),
      ),
    ).toBeUndefined();
  });

  it('rejects a file shorter than the magic', () => {
    expect(detectFileType('tiny.pdf', Buffer.from('%PD'))).toBeUndefined();
  });
});

describe('extensionOf', () => {
  it('knows only zip and pdf, never an inherited key', () => {
    expect(extensionOf('a.tar.gz')).toBeUndefined();
    expect(extensionOf('noext')).toBeUndefined();
    expect(extensionOf('x.constructor')).toBeUndefined();
    expect(extensionOf('x.toString')).toBeUndefined();
  });
});
