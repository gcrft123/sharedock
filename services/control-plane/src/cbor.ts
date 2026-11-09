/**
 * Minimal CBOR decoder — just enough for WebAuthn: unsigned/negative ints, byte
 * strings, text strings, arrays, and maps. Maps decode to a JS `Map` so COSE
 * keys (which use integer labels) and the attestation object (text labels) both
 * work. Indefinite-length items and floats are not needed by WebAuthn and are
 * rejected. Not a general-purpose CBOR library.
 */

type Cbor = number | bigint | string | Uint8Array | Cbor[] | Map<number | string, Cbor>;

class Reader {
  off = 0;
  constructor(readonly buf: Uint8Array) {}

  private u8(): number {
    if (this.off >= this.buf.length) throw new Error("cbor: unexpected end");
    return this.buf[this.off++];
  }
  private bytes(n: number): Uint8Array {
    if (this.off + n > this.buf.length) throw new Error("cbor: unexpected end");
    const s = this.buf.slice(this.off, this.off + n);
    this.off += n;
    return s;
  }
  private uint(n: number): number {
    let v = 0;
    for (let i = 0; i < n; i++) v = v * 256 + this.u8();
    return v;
  }

  private argument(ai: number): number {
    if (ai < 24) return ai;
    if (ai === 24) return this.u8();
    if (ai === 25) return this.uint(2);
    if (ai === 26) return this.uint(4);
    if (ai === 27) return this.uint(8);
    throw new Error(`cbor: unsupported additional info ${ai}`);
  }

  read(): Cbor {
    const ib = this.u8();
    const major = ib >> 5;
    const ai = ib & 0x1f;
    switch (major) {
      case 0: // unsigned int
        return this.argument(ai);
      case 1: // negative int
        return -1 - this.argument(ai);
      case 2: // byte string
        return this.bytes(this.argument(ai));
      case 3: // text string
        return new TextDecoder().decode(this.bytes(this.argument(ai)));
      case 4: {
        // array
        const len = this.argument(ai);
        const arr: Cbor[] = [];
        for (let i = 0; i < len; i++) arr.push(this.read());
        return arr;
      }
      case 5: {
        // map
        const len = this.argument(ai);
        const map = new Map<number | string, Cbor>();
        for (let i = 0; i < len; i++) {
          const k = this.read();
          if (typeof k !== "number" && typeof k !== "string") throw new Error("cbor: bad map key");
          map.set(k, this.read());
        }
        return map;
      }
      default:
        throw new Error(`cbor: unsupported major type ${major}`);
    }
  }
}

/** Decode a single CBOR item; ignores trailing bytes. */
export function cborDecode(buf: Uint8Array): Cbor {
  return new Reader(buf).read();
}
