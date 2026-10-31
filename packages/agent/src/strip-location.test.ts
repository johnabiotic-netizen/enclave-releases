import { crc32 } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { stripLocation } from './strip-location.js';

const LAT = [51, 1, 30, 1, 2614, 100]; // 51° 30' 26.14" as three rationals

/** A TIFF block like a phone writes: IFD0 with Make, Orientation and GPSInfo; a GPS IFD. */
function tiff(le: boolean): Buffer {
  const b = Buffer.alloc(200);
  const w16 = (o: number, v: number) => (le ? b.writeUInt16LE(v, o) : b.writeUInt16BE(v, o));
  const w32 = (o: number, v: number) => (le ? b.writeUInt32LE(v, o) : b.writeUInt32BE(v, o));
  b.write(le ? 'II' : 'MM', 0, 'latin1');
  w16(2, 42);
  w32(4, 8);
  // IFD0 at 8: 3 entries, next IFD 0. Make "Pixel" at 100.
  w16(8, 3);
  const entry = (o: number, tag: number, type: number, count: number, value: number) => {
    w16(o, tag);
    w16(o + 2, type);
    w32(o + 4, count);
    if (type === 3 && count === 1) w16(o + 8, value);
    else w32(o + 8, value);
  };
  entry(10, 0x010f, 2, 6, 100); // Make
  entry(22, 0x0112, 3, 1, 6); // Orientation: rotate 90
  entry(34, 0x8825, 4, 1, 50); // GPSInfo -> 50
  w32(46, 0);
  b.write('Pixel\0', 100, 'latin1');
  // GPS IFD at 50: LatitudeRef "N", Latitude -> 120.
  w16(50, 2);
  entry(52, 0x0001, 2, 2, 0);
  b.write('N\0', 60, 'latin1');
  entry(64, 0x0002, 5, 3, 120);
  w32(76, 0);
  LAT.forEach((v, i) => w32(120 + i * 4, v));
  return b;
}

function readTags(b: Buffer, t: number): number[] {
  const le = b[t] === 0x49;
  const u16 = (o: number) => (le ? b.readUInt16LE(o) : b.readUInt16BE(o));
  const u32 = (o: number) => (le ? b.readUInt32LE(o) : b.readUInt32BE(o));
  const ifd0 = t + u32(t + 4);
  return Array.from({ length: u16(ifd0) }, (_, i) => u16(ifd0 + 2 + i * 12));
}

function latitudeGone(b: Buffer): boolean {
  const be = Buffer.alloc(24);
  const le = Buffer.alloc(24);
  LAT.forEach((v, i) => (be.writeUInt32BE(v, i * 4), le.writeUInt32LE(v, i * 4)));
  return b.indexOf(be) < 0 && b.indexOf(le) < 0;
}

function jpeg(t: Buffer, extra = Buffer.alloc(0)): Buffer {
  const app1 = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), t]);
  const len = Buffer.alloc(2);
  len.writeUInt16BE(app1.length + 2);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe1]),
    len,
    app1,
    extra,
    Buffer.from([0xff, 0xda, 1, 2, 3, 4, 0xff, 0xd9]), // stands in for the picture
  ]);
}

function box(type: string, ...content: Buffer[]): Buffer {
  const body = Buffer.concat(content);
  const head = Buffer.alloc(8);
  head.writeUInt32BE(8 + body.length);
  head.write(type, 4, 'latin1');
  return Buffer.concat([head, body]);
}

describe('stripLocation', () => {
  for (const le of [true, false]) {
    it(`removes GPS from a JPEG's Exif (${le ? 'Intel' : 'Motorola'} order), keeping the rest`, () => {
      const file = jpeg(tiff(le));
      const before = Buffer.from(file);
      expect(stripLocation(file)).toBeGreaterThan(0);
      expect(file.length).toBe(before.length);
      const t = file.indexOf('Exif\0\0') + 6;
      expect(readTags(file, t)).toEqual([0x010f, 0x0112]);
      expect(file.includes('Pixel')).toBe(true);
      expect(latitudeGone(file)).toBe(true);
      expect(file.subarray(-8)).toEqual(before.subarray(-8)); // picture untouched
    });
  }

  it('strips every Exif block, such as the extra images of a multi-picture JPEG', () => {
    const file = jpeg(tiff(true), jpeg(tiff(false)));
    stripLocation(file);
    expect(latitudeGone(file)).toBe(true);
  });

  it('blanks GPS in XMP with spaces, keeping other fields', () => {
    const xmp =
      '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF><rdf:Description exif:GPSLatitude="51,30.43N" ' +
      'tiff:Make="Pixel"><exif:GPSLongitude>0,7.5W</exif:GPSLongitude><exif:GPSAltitude/>' +
      '</rdf:Description></rdf:RDF></x:xmpmeta>';
    const file = jpeg(tiff(true), Buffer.from(xmp, 'latin1'));
    const length = file.length;
    stripLocation(file);
    const text = file.toString('latin1');
    expect(file.length).toBe(length);
    expect(text).not.toMatch(/GPS|51,30|0,7\.5W/);
    expect(text).toContain('tiff:Make="Pixel"');
    expect(text).toContain('</rdf:Description></rdf:RDF></x:xmpmeta>');
  });

  it("strips a PNG's eXIf chunk and fixes its CRC", () => {
    const t = tiff(true);
    const chunk = (type: string, data: Buffer) => {
      const head = Buffer.alloc(8);
      head.writeUInt32BE(data.length);
      head.write(type, 4, 'latin1');
      const crc = Buffer.alloc(4);
      crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])));
      return Buffer.concat([head, data, crc]);
    };
    const file = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', Buffer.alloc(13)),
      chunk('eXIf', t),
      chunk('IEND', Buffer.alloc(0)),
    ]);
    stripLocation(file);
    expect(latitudeGone(file)).toBe(true);
    const at = 8 + 25;
    const data = file.subarray(at + 8, at + 8 + t.length);
    expect(readTags(file, at + 8)).toEqual([0x010f, 0x0112]);
    expect(file.readUInt32BE(at + 8 + t.length)).toBe(
      crc32(Buffer.concat([Buffer.from('eXIf'), data])),
    );
  });

  it("frees an MP4's ©xyz box and QuickTime location items", () => {
    const xyz = box('©xyz', Buffer.from('\0\x11\x15\xc7+51.5074-000.1278/', 'latin1'));
    const key = (name: string) => {
      const k = Buffer.alloc(8);
      k.writeUInt32BE(8 + name.length);
      k.write('mdta', 4, 'latin1');
      return Buffer.concat([k, Buffer.from(name, 'latin1')]);
    };
    const keys = box(
      'keys',
      Buffer.from([0, 0, 0, 0, 0, 0, 0, 2]),
      key('com.apple.quicktime.make'),
      key('com.apple.quicktime.location.ISO6709'),
    );
    const item = (index: number, value: string) => {
      const b = box('xxxx', box('data', Buffer.alloc(8), Buffer.from(value, 'latin1')));
      b.writeUInt32BE(index, 4);
      return b;
    };
    const ilst = box('ilst', item(1, 'Apple'), item(2, '+51.5074-000.1278+011.000/'));
    const meta = box('meta', box('hdlr', Buffer.alloc(25)), keys, ilst);
    const file = Buffer.concat([
      box('ftyp', Buffer.from('qt  \0\0\0\0', 'latin1')),
      box('mdat', Buffer.alloc(16, 7)),
      box('moov', box('udta', xyz), meta),
    ]);
    const length = file.length;
    stripLocation(file);
    const text = file.toString('latin1');
    expect(file.length).toBe(length);
    expect(text).not.toContain('+51.5074');
    expect(text).not.toContain('©xyz');
    expect(text).toContain('Apple');
    expect(text).toContain('com.apple.quicktime.location.ISO6709'); // key names are not a location
  });

  it('leaves other files untouched, even with a photo inside', () => {
    const zip = Buffer.concat([
      Buffer.from('PK\x03\x04', 'latin1'),
      Buffer.alloc(8),
      jpeg(tiff(true)),
    ]);
    const before = Buffer.from(zip);
    expect(stripLocation(zip)).toBe(0);
    expect(zip).toEqual(before);
  });

  it('leaves a photo without location as it was', () => {
    const t = tiff(true);
    t.writeUInt16LE(2, 8); // IFD0 without the GPSInfo entry
    const file = jpeg(t);
    const before = Buffer.from(file);
    expect(stripLocation(file)).toBe(0);
    expect(file).toEqual(before);
  });

  it('survives broken offsets', () => {
    const t = tiff(false);
    t.writeUInt32BE(0xfffffff0, 42); // GPSInfo points past the end
    const file = jpeg(t);
    expect(() => stripLocation(file)).not.toThrow();
    expect(readTags(file, file.indexOf('Exif\0\0') + 6)).toEqual([0x010f, 0x0112]);
  });
});
