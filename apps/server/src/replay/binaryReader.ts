/** Binary reader for legacy osu! .osr / lazer-encoded score blobs. */
export class OsuBinaryReader {
  private offset = 0;

  constructor(private readonly buf: Buffer) {}

  get remaining(): number {
    return this.buf.length - this.offset;
  }

  readByte(): number {
    if (this.offset >= this.buf.length) throw new Error("Unexpected EOF");
    return this.buf[this.offset++]!;
  }

  readBytes(n: number): Buffer {
    if (this.offset + n > this.buf.length) throw new Error("Unexpected EOF");
    const slice = this.buf.subarray(this.offset, this.offset + n);
    this.offset += n;
    return slice;
  }

  readInt16(): number {
    const v = this.buf.readInt16LE(this.offset);
    this.offset += 2;
    return v;
  }

  readUInt16(): number {
    const v = this.buf.readUInt16LE(this.offset);
    this.offset += 2;
    return v;
  }

  readInt32(): number {
    const v = this.buf.readInt32LE(this.offset);
    this.offset += 4;
    return v;
  }

  readUInt32(): number {
    const v = this.buf.readUInt32LE(this.offset);
    this.offset += 4;
    return v;
  }

  readInt64(): bigint {
    const v = this.buf.readBigInt64LE(this.offset);
    this.offset += 8;
    return v;
  }

  /** Windows FILETIME ticks → Date (ms). */
  readDate(): Date {
    const ticks = this.readInt64();
    // ticks since 0001-01-01; Unix epoch = 621355968000000000 ticks
    const ms = Number((ticks - 621355968000000000n) / 10000n);
    return new Date(ms);
  }

  readUleb128(): number {
    let result = 0;
    let shift = 0;
    for (;;) {
      const b = this.readByte();
      result |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) break;
      shift += 7;
      if (shift > 35) throw new Error("ULEB128 too long");
    }
    return result >>> 0;
  }

  readString(): string {
    const marker = this.readByte();
    if (marker === 0x00) return "";
    if (marker !== 0x0b) {
      throw new Error(`Invalid string marker 0x${marker.toString(16)}`);
    }
    const len = this.readUleb128();
    if (len === 0) return "";
    return this.readBytes(len).toString("utf8");
  }
}
