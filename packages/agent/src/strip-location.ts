// Removes where a phone photo or video was taken before it goes into a profile, so a file can't
// give away a location that doesn't match the profile's proxy (DECISIONS 2026-10-31).
//
// Works in place and never changes the file's size or picture: the GPS tags leave every Exif
// block, GPS fields in XMP become spaces, and location boxes in MP4/MOV become 'free' boxes.
// Camera model, date, orientation and everything else stay. Only image and video formats phones
// produce are touched (JPEG, PNG, WebP, HEIC/AVIF, MP4/MOV); other files pass through unchanged,
// so a document with a photo inside never has its own checksums broken.
import { crc32 } from 'node:zlib';

type Range = [start: number, end: number];
type Kind = 'jpeg' | 'png' | 'webp' | 'isobmff';

/** Strips location data from `buf` in place. Returns how many places were changed. */
export function stripLocation(buf: Buffer): number {
  const kind = fileKind(buf);
  if (!kind) return 0;
  const changed: Range[] = [];
  for (const tiff of exifBlocks(buf, kind)) stripTiffGps(buf, tiff, changed);
  stripXmp(buf, changed);
  if (kind === 'isobmff') stripBoxes(buf, 0, buf.length, changed, 0);
  if (kind === 'png' && changed.length > 0) fixPngCrcs(buf, changed);
  return changed.length;
}

function fileKind(b: Buffer): Kind | null {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.subarray(0, 8).equals(PNG_SIGNATURE)) return 'png';
  if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') {
    return 'webp';
  }
  if (b.toString('latin1', 4, 8) === 'ftyp') return 'isobmff';
  return null;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const EXIF_SIGNATURE = Buffer.from('Exif\0\0', 'latin1');

function isTiff(b: Buffer, o: number): boolean {
  if (o < 0 || o + 8 > b.length) return false;
  return (
    (b[o] === 0x49 && b[o + 1] === 0x49 && b[o + 2] === 0x2a && b[o + 3] === 0) ||
    (b[o] === 0x4d && b[o + 1] === 0x4d && b[o + 2] === 0 && b[o + 3] === 0x2a)
  );
}

/** Start offsets of the TIFF structures (Exif) in the file. */
function exifBlocks(b: Buffer, kind: Kind): number[] {
  const found = new Set<number>();
  // JPEG APP1 (also the extra images of a multi-picture JPEG), HEIF Exif items, and WebP or PNG
  // Exif written with the "Exif\0\0" prefix.
  for (let i = b.indexOf(EXIF_SIGNATURE); i >= 0; i = b.indexOf(EXIF_SIGNATURE, i + 1)) {
    if (isTiff(b, i + 6)) found.add(i + 6);
  }
  // PNG eXIf and WebP EXIF chunks hold the TIFF structure directly.
  if (kind === 'png') {
    for (const c of pngChunks(b)) if (c.type === 'eXIf' && isTiff(b, c.data)) found.add(c.data);
  }
  if (kind === 'webp') {
    let o = 12;
    while (o + 8 <= b.length) {
      const size = b.readUInt32LE(o + 4);
      if (b.toString('latin1', o, o + 4) === 'EXIF' && isTiff(b, o + 8)) found.add(o + 8);
      o += 8 + size + (size & 1);
    }
  }
  return [...found];
}

// Bytes per value for each TIFF field type.
const TYPE_SIZE: Record<number, number> = {
  1: 1,
  2: 1,
  3: 2,
  4: 4,
  5: 8,
  6: 1,
  7: 1,
  8: 2,
  9: 4,
  10: 8,
  11: 4,
  12: 8,
  13: 4,
};
const GPS_IFD_TAG = 0x8825;

/** Removes the GPSInfo entry from IFD0 and zeroes the GPS IFD and its values. */
function stripTiffGps(b: Buffer, t: number, changed: Range[]): void {
  const le = b[t] === 0x49;
  const u16 = (o: number) => (le ? b.readUInt16LE(o) : b.readUInt16BE(o));
  const u32 = (o: number) => (le ? b.readUInt32LE(o) : b.readUInt32BE(o));
  const w16 = (o: number, v: number) => (le ? b.writeUInt16LE(v, o) : b.writeUInt16BE(v, o));
  const inside = (o: number, n: number) => o >= t && n >= 0 && o + n <= b.length;

  const ifd0 = t + u32(t + 4);
  if (!inside(ifd0, 2)) return;
  const n = u16(ifd0);
  const end = ifd0 + 2 + n * 12 + 4;
  if (n === 0 || !inside(ifd0, end - ifd0)) return;
  for (let i = 0; i < n; i++) {
    const e = ifd0 + 2 + i * 12;
    if (u16(e) !== GPS_IFD_TAG) continue;

    const gps = t + u32(e + 8);
    if (inside(gps, 2)) {
      const m = u16(gps);
      const size = 2 + m * 12 + 4;
      if (inside(gps, size)) {
        for (let j = 0; j < m; j++) {
          const g = gps + 2 + j * 12;
          const bytes = (TYPE_SIZE[u16(g + 2)] ?? 0) * u32(g + 4);
          const at = t + u32(g + 8);
          if (bytes > 4 && inside(at, bytes)) {
            b.fill(0, at, at + bytes);
            changed.push([at, at + bytes]);
          }
        }
        b.fill(0, gps, gps + size);
        changed.push([gps, gps + size]);
      }
    }
    // Drop the entry: later entries and the next-IFD offset move up 12 bytes; entries stay sorted.
    b.copy(b, e, e + 12, end);
    b.fill(0, end - 12, end);
    w16(ifd0, n - 1);
    changed.push([ifd0, end]);
    return;
  }
}

const XMP_OPEN = Buffer.from('<x:xmpmeta', 'latin1');
const XMP_CLOSE = Buffer.from('</x:xmpmeta>', 'latin1');
const XMP_GPS = [
  /<[\w.-]+:GPS\w*(?:\s[^>]*)?\/>/g, // <exif:GPSLatitude/>
  /<([\w.-]+:GPS\w*)(?:\s[^>]*)?>[\s\S]*?<\/\1\s*>/g, // <exif:GPSLatitude>..</exif:GPSLatitude>
  /\s[\w.-]+:GPS\w*\s*=\s*(?:"[^"]*"|'[^']*')/g, // exif:GPSLatitude="..."
];

/** Blanks GPS fields in every XMP packet with spaces (valid XML, same length). */
function stripXmp(b: Buffer, changed: Range[]): void {
  for (let s = b.indexOf(XMP_OPEN); s >= 0; s = b.indexOf(XMP_OPEN, s + 1)) {
    const close = b.indexOf(XMP_CLOSE, s);
    if (close < 0) return;
    const end = close + XMP_CLOSE.length;
    const text = b.toString('latin1', s, end); // one char per byte, so offsets and length hold
    let out = text;
    for (const re of XMP_GPS) out = out.replace(re, (m) => ' '.repeat(m.length));
    if (out !== text) {
      b.write(out, s, 'latin1');
      changed.push([s, end]);
    }
  }
}

const BOX_CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'udta', 'meta', 'edts']);

/**
 * Walks MP4/MOV boxes: '©xyz' (Android and older iPhones) and QuickTime metadata items whose
 * key names a location (com.apple.quicktime.location.*) become 'free' boxes with zeroed content.
 */
function stripBoxes(b: Buffer, start: number, end: number, changed: Range[], depth: number): void {
  const free = (o: number, header: number, size: number) => {
    b.write('free', o + 4, 'latin1');
    b.fill(0, o + header, o + size);
    changed.push([o, o + size]);
  };
  let keys: string[] = [];
  const items: { o: number; header: number; size: number; index: number }[] = [];
  for (const box of boxes(b, start, end)) {
    const { o, type, header, size } = box;
    const body = o + header;
    if (type === '©xyz') {
      free(o, header, size);
    } else if (type === 'keys') {
      keys = metaKeys(b, body, o + size);
    } else if (type === 'ilst') {
      for (const item of boxes(b, body, o + size)) {
        if (item.type === '©xyz') free(item.o, item.header, item.size);
        else items.push({ ...item, index: b.readUInt32BE(item.o + 4) });
      }
    } else if (depth < 8 && BOX_CONTAINERS.has(type)) {
      // ISO 'meta' is a full box (4 bytes of version and flags first); QuickTime's isn't.
      const inner = type === 'meta' && b.toString('latin1', body + 4, body + 8) !== 'hdlr' ? 4 : 0;
      stripBoxes(b, body + inner, o + size, changed, depth + 1);
    }
  }
  for (const item of items) {
    if (/location/i.test(keys[item.index - 1] ?? '')) free(item.o, item.header, item.size);
  }
}

function* boxes(b: Buffer, start: number, end: number) {
  let o = start;
  while (o + 8 <= end) {
    let size = b.readUInt32BE(o);
    let header = 8;
    if (size === 1) {
      if (o + 16 > end) return;
      size = Number(b.readBigUInt64BE(o + 8));
      header = 16;
    } else if (size === 0) {
      size = end - o;
    }
    if (size < header || o + size > end) return;
    yield { o, type: b.toString('latin1', o + 4, o + 8), header, size };
    o += size;
  }
}

/** Key names of a QuickTime 'keys' box, in order (items refer to them from 1). */
function metaKeys(b: Buffer, body: number, end: number): string[] {
  const names: string[] = [];
  if (body + 8 > end) return names;
  const count = b.readUInt32BE(body + 4);
  let o = body + 8;
  for (let i = 0; i < count && o + 8 <= end; i++) {
    const size = b.readUInt32BE(o);
    if (size < 8 || o + size > end) break;
    names.push(b.toString('latin1', o + 8, o + size));
    o += size;
  }
  return names;
}

function* pngChunks(b: Buffer) {
  let o = 8;
  while (o + 12 <= b.length) {
    const length = b.readUInt32BE(o);
    if (o + 12 + length > b.length) return;
    const type = b.toString('latin1', o + 4, o + 8);
    yield { o, type, data: o + 8, length };
    if (type === 'IEND') return;
    o += 12 + length;
  }
}

/** PNG chunks carry a CRC; recompute it for every chunk that changed. */
function fixPngCrcs(b: Buffer, changed: Range[]): void {
  for (const c of pngChunks(b)) {
    const dataEnd = c.data + c.length;
    if (changed.some(([s, e]) => s < dataEnd && e > c.data)) {
      b.writeUInt32BE(crc32(b.subarray(c.o + 4, dataEnd)), dataEnd);
    }
  }
}
