/**
 * Minimal AWS Signature Version 4 signer (pure TS SHA-256/HMAC — no native crypto or SDK needed).
 * Used by Amazon Polly; only handles the request shapes we send (JSON body, simple query strings).
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const utf8 = (s: string) => new TextEncoder().encode(s);

/**
 * Element read for the fixed-size tables below. Every index used is in range by construction
 * (64-entry K/W, 8-word state, 64-byte blocks), so `?? 0` never triggers — it only satisfies
 * noUncheckedIndexedAccess without non-null assertions.
 */
const at = (arr: Uint32Array | Uint8Array, i: number): number => arr[i] ?? 0;

function sha256(data: Uint8Array): Uint8Array {
  const len = data.length;
  const padded = new Uint8Array(((len + 9 + 63) >> 6) << 6);
  padded.set(data);
  padded[len] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(len / 0x20000000));
  view.setUint32(padded.length - 4, (len << 3) >>> 0);

  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const w15 = at(w, i - 15);
      const w2 = at(w, i - 2);
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
      w[i] = (at(w, i - 16) + s0 + at(w, i - 7) + s1) >>> 0;
    }
    let a = at(h, 0);
    let b = at(h, 1);
    let c = at(h, 2);
    let d = at(h, 3);
    let e = at(h, 4);
    let f = at(h, 5);
    let g = at(h, 6);
    let hh = at(h, 7);
    for (let i = 0; i < 64; i++) {
      const t1 =
        (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + at(K, i) + at(w, i)) >>>
        0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    // Uint32Array stores wrap mod 2^32, exactly like the original `h[i] += x`
    [a, b, c, d, e, f, g, hh].forEach((x, i) => (h[i] = at(h, i) + x));
  }
  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) outView.setUint32(i * 4, at(h, i));
  return out;
}

function hmacSha256(key: Uint8Array, data: Uint8Array): Uint8Array {
  const block = new Uint8Array(64);
  block.set(key.length > 64 ? sha256(key) : key);
  const inner = new Uint8Array(64 + data.length);
  const outer = new Uint8Array(64 + 32);
  for (let i = 0; i < 64; i++) {
    inner[i] = at(block, i) ^ 0x36;
    outer[i] = at(block, i) ^ 0x5c;
  }
  inner.set(data, 64);
  outer.set(sha256(inner), 64);
  return sha256(outer);
}

const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

interface SigV4Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

interface SigV4Request {
  method: string;
  url: string;
  region: string;
  service: string;
  headers?: Record<string, string>;
  body?: string | undefined;
  /** Injected for tests; defaults to now. */
  date?: Date;
}

/** RFC 3986 encoding as SigV4 requires (encodeURIComponent leaves !'()* unescaped). */
const awsEncode = (s: string) =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

/** Returns the headers to send (including Authorization and x-amz-date). */
export function signV4(req: SigV4Request, creds: SigV4Credentials): Record<string, string> {
  const url = new URL(req.url);
  const amzDate = (req.date ?? new Date()).toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const body = req.body ?? '';
  const payloadHash = toHex(sha256(utf8(body)));

  const headers: Record<string, string> = {
    ...req.headers,
    host: url.host,
    'x-amz-date': amzDate,
    ...(creds.sessionToken && { 'x-amz-security-token': creds.sessionToken }),
  };
  const lower = Object.entries(headers)
    .map(([k, v]) => [k.toLowerCase(), v.trim().replace(/\s+/g, ' ')] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const signedHeaders = lower.map(([k]) => k).join(';');
  const canonicalHeaders = lower.map(([k, v]) => `${k}:${v}\n`).join('');

  const query = [...url.searchParams.entries()]
    .map(([k, v]): [string, string] => [awsEncode(k), awsEncode(v)])
    .sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : 1) : a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const path = url.pathname.split('/').map((seg) => awsEncode(decodeURIComponent(seg))).join('/');

  const canonicalRequest = [
    req.method.toUpperCase(),
    path || '/',
    query,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${day}/${req.region}/${req.service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    toHex(sha256(utf8(canonicalRequest))),
  ].join('\n');

  let key = hmacSha256(utf8('AWS4' + creds.secretAccessKey), utf8(day));
  for (const part of [req.region, req.service, 'aws4_request']) key = hmacSha256(key, utf8(part));
  const signature = toHex(hmacSha256(key, utf8(stringToSign)));

  const { host: _host, ...sendHeaders } = headers;
  return {
    ...sendHeaders,
    Authorization: `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}
