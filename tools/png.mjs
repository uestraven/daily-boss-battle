/** Minimal PNG codec: decode and encode 8-bit PNGs with no dependencies.
 *
 * Inflate and deflate come from node:zlib. Supports colour types 0, 2, 3, 4 and 6,
 * non-interlaced, which covers effectively all pixel art. Shared by the sprite linter,
 * the sheet fitter and the placeholder generator so there is one implementation.
 */
import {deflateSync, inflateSync} from 'node:zlib';

// ---------------------------------------------------------------- PNG in
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG');
  let offset = 8; let header = null; let palette = null; let paletteAlpha = null;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === 'IHDR') header = {width: data.readUInt32BE(0), height: data.readUInt32BE(4),
      bitDepth: data[8], colorType: data[9], interlace: data[12]};
    else if (type === 'PLTE') palette = Buffer.from(data);
    else if (type === 'tRNS') paletteAlpha = Buffer.from(data);
    else if (type === 'IDAT') idat.push(Buffer.from(data));
    else if (type === 'IEND') break;
  }
  if (!header) throw new Error('missing IHDR');
  if (header.bitDepth !== 8) throw new Error(`bit depth ${header.bitDepth} unsupported`);
  if (header.interlace) throw new Error('interlaced PNG unsupported');
  const channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[header.colorType];
  if (!channels) throw new Error(`colour type ${header.colorType} unsupported`);

  const raw = inflateSync(Buffer.concat(idat));
  const {width, height} = header;
  const stride = width * channels;
  const lines = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const out = lines.subarray(y * stride, (y + 1) * stride);
    const prior = y > 0 ? lines.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? out[i - channels] : 0;
      const b = prior ? prior[i] : 0;
      const c = prior && i >= channels ? prior[i - channels] : 0;
      let v = src[i];
      if (filter === 1) v += a; else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[i] = v & 0xff;
    }
  }
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const s = i * channels; const d = i * 4;
    if (header.colorType === 6) rgba.set(lines.subarray(s, s + 4), d);
    else if (header.colorType === 2) { rgba.set(lines.subarray(s, s + 3), d); rgba[d + 3] = 255; }
    else if (header.colorType === 0) { rgba.fill(lines[s], d, d + 3); rgba[d + 3] = 255; }
    else if (header.colorType === 4) { rgba.fill(lines[s], d, d + 3); rgba[d + 3] = lines[s + 1]; }
    else {
      const index = lines[s];
      rgba[d] = palette[index * 3]; rgba[d + 1] = palette[index * 3 + 1]; rgba[d + 2] = palette[index * 3 + 2];
      rgba[d + 3] = paletteAlpha && index < paletteAlpha.length ? paletteAlpha[index] : 255;
    }
  }
  return {width, height, rgba};
}

// ---------------------------------------------------------------- PNG out
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();
function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
export function encodePng(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 6; header[10] = 0; header[11] = 0; header[12] = 0;
  const stride = width * 4;
  const filtered = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    filtered[y * (stride + 1)] = 0; // filter: none
    rgba.copy(filtered, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(filtered, {level: 9})),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
