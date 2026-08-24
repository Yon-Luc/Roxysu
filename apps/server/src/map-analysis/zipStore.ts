import { createWriteStream, type WriteStream } from "node:fs";

/** Minimal ZIP (STORE only) for bundling .osu + audio + background. */

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    crc ^= data[i]!;
    for (let j = 0; j < 8; j += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(n: number): Uint8Array {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n, true);
  return b;
}

function u32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

export type ZipEntry = {
  name: string;
  data: Uint8Array;
};

/** Write an uncompressed ZIP to disk one entry at a time. */
export class ZipFileWriter {
  private offset = 0;
  private centrals: Uint8Array[] = [];
  private count = 0;
  private readonly stream: WriteStream;

  constructor(destPath: string) {
    this.stream = createWriteStream(destPath);
  }

  private write(data: Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
      this.stream.write(data, (err) => (err ? reject(err) : resolve()));
    });
  }

  async add(name: string, data: Uint8Array): Promise<void> {
    const nameBytes = new TextEncoder().encode(name);
    const crc = crc32(data);
    const size = data.length;
    const localHeader = concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(size),
      u32(size),
      u16(nameBytes.length),
      u16(0),
      nameBytes,
    ]);
    const centralHeader = concat([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(size),
      u32(size),
      u16(nameBytes.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(this.offset),
      nameBytes,
    ]);
    await this.write(localHeader);
    await this.write(data);
    this.centrals.push(centralHeader);
    this.offset += localHeader.length + data.length;
    this.count += 1;
  }

  async finish(): Promise<void> {
    const centralDir = concat(this.centrals);
    await this.write(centralDir);
    await this.write(
      concat([
        u32(0x06054b50),
        u16(0),
        u16(0),
        u16(this.count),
        u16(this.count),
        u32(centralDir.length),
        u32(this.offset),
        u16(0),
      ]),
    );
    await new Promise<void>((resolve, reject) => {
      this.stream.end((err: Error | null | undefined) =>
        err ? reject(err) : resolve(),
      );
    });
  }
}

/** Build an uncompressed ZIP archive. */
export function buildZip(entries: ZipEntry[]): Uint8Array {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = new TextEncoder().encode(entry.name);
    const crc = crc32(entry.data);
    const size = entry.data.length;

    const localHeader = concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(size),
      u32(size),
      u16(nameBytes.length),
      u16(0),
      nameBytes,
    ]);

    localParts.push(localHeader, entry.data);

    const centralHeader = concat([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(size),
      u32(size),
      u16(nameBytes.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      nameBytes,
    ]);
    centralParts.push(centralHeader);
    offset += localHeader.length + entry.data.length;
  }

  const centralDir = concat(centralParts);
  const localDir = concat(localParts);
  const end = concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(centralDir.length),
    u32(localDir.length),
    u16(0),
  ]);

  return concat([localDir, centralDir, end]);
}
