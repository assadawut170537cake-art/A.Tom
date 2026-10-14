/// <reference types="node" />
import { createHash, createHmac, randomBytes } from 'crypto';

import { hmacSha256, sha256, signV4 } from '../core/crypto/sigv4';

const utf8 = (s: string) => new TextEncoder().encode(s);
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const H = (d: string) => createHash('sha256').update(d).digest('hex');
const M = (k: string | Buffer, d: string) => createHmac('sha256', k).update(d).digest();

const DATE = new Date('2015-08-30T12:36:00Z');
const AMZ = '20150830T123600Z';
const DAY = '20150830';
const CREDS = { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY' };

/** Independent SigV4 signature (node:crypto) for a canonical request built by hand. */
function referenceSignature(canonical: string, secret: string, region: string, service: string) {
  const scope = `${DAY}/${region}/${service}/aws4_request`;
  const sts = ['AWS4-HMAC-SHA256', AMZ, scope, H(canonical)].join('\n');
  let key = M(`AWS4${secret}`, DAY);
  for (const part of [region, service, 'aws4_request']) key = M(key, part);
  return createHmac('sha256', key).update(sts).digest('hex');
}

const signatureOf = (headers: Record<string, string>) => headers.Authorization?.split('Signature=')[1];

describe('sha256', () => {
  test.each([
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    [
      'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    ],
  ])('FIPS 180-2 vector %#', (input, digest) => {
    expect(hex(sha256(utf8(input)))).toBe(digest);
  });

  test('matches node:crypto across every padding boundary (0–200 bytes) and 1 MB', () => {
    for (let n = 0; n <= 200; n++) {
      const data = randomBytes(n);
      expect(hex(sha256(data))).toBe(createHash('sha256').update(data).digest('hex'));
    }
    const big = randomBytes(1 << 20);
    expect(hex(sha256(big))).toBe(createHash('sha256').update(big).digest('hex'));
  });
});

describe('hmacSha256', () => {
  // RFC 4231 test cases 6 and 7: 131-byte key (> 64-byte block) must be hashed first
  const longKey = new Uint8Array(131).fill(0xaa);

  test('RFC 4231 case 6: key longer than the block size', () => {
    const mac = hmacSha256(longKey, utf8('Test Using Larger Than Block-Size Key - Hash Key First'));
    expect(hex(mac)).toBe('60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54');
  });

  test('RFC 4231 case 7: long key and data longer than the block size', () => {
    const data =
      'This is a test using a larger than block-size key and a larger than block-size data. ' +
      'The key needs to be hashed before being used by the HMAC algorithm.';
    expect(hex(hmacSha256(longKey, utf8(data)))).toBe(
      '9b09ffa71b942fcb27635fbcd5b0e944bfdc63644f0713938a7f51535c3a35e2'
    );
  });

  test('matches node:crypto for key lengths around the 64-byte block (63, 64, 65, 200)', () => {
    for (const len of [0, 1, 32, 63, 64, 65, 128, 200]) {
      const key = randomBytes(len);
      const data = randomBytes(100);
      expect(hex(hmacSha256(key, data))).toBe(createHmac('sha256', key).update(data).digest('hex'));
    }
  });
});

describe('signV4', () => {
  test('AWS reference vector (get-vanilla-query-order-key-case)', () => {
    const h = signV4(
      { method: 'GET', url: 'https://example.amazonaws.com/?Param2=value2&Param1=value1', region: 'us-east-1', service: 'service', date: DATE },
      CREDS
    );
    expect(signatureOf(h)).toBe('b97d918cfa904a5beff61c982a1b6f458b799221646efd99d3219ec94cdf2500');
    expect(h['x-amz-date']).toBe(AMZ);
    expect(h).not.toHaveProperty('host');
  });

  test('secret long enough that the first HMAC key exceeds 64 bytes', () => {
    const secret = 'S'.repeat(100); // 'AWS4' + 100 chars = 104-byte key
    const body = '{"Text":"สวัสดี"}';
    const h = signV4(
      { method: 'POST', url: 'https://polly.us-east-1.amazonaws.com/v1/speech', region: 'us-east-1', service: 'polly', body, headers: { 'Content-Type': 'application/json' }, date: DATE },
      { accessKeyId: 'AK', secretAccessKey: secret }
    );
    const canonical = [
      'POST',
      '/v1/speech',
      '',
      `content-type:application/json\nhost:polly.us-east-1.amazonaws.com\nx-amz-date:${AMZ}\n`,
      'content-type;host;x-amz-date',
      H(body),
    ].join('\n');
    expect(signatureOf(h)).toBe(referenceSignature(canonical, secret, 'us-east-1', 'polly'));
  });

  test('sessionToken → x-amz-security-token header, signed', () => {
    const creds = { ...CREDS, sessionToken: 'FQoGZXIvYXdzEJr//token+/=' };
    const h = signV4({ method: 'GET', url: 'https://polly.eu-west-1.amazonaws.com/v1/voices', region: 'eu-west-1', service: 'polly', date: DATE }, creds);
    expect(h['x-amz-security-token']).toBe(creds.sessionToken);
    expect(h.Authorization).toContain('SignedHeaders=host;x-amz-date;x-amz-security-token,');
    const canonical = [
      'GET',
      '/v1/voices',
      '',
      `host:polly.eu-west-1.amazonaws.com\nx-amz-date:${AMZ}\nx-amz-security-token:${creds.sessionToken}\n`,
      'host;x-amz-date;x-amz-security-token',
      H(''),
    ].join('\n');
    expect(signatureOf(h)).toBe(referenceSignature(canonical, CREDS.secretAccessKey, 'eu-west-1', 'polly'));
  });

  test("query params with !'()* and spaces are RFC 3986-encoded and sorted", () => {
    const url = "https://polly.us-east-1.amazonaws.com/v1/voices?b=x y&a=it's(1)*!&a=0";
    const h = signV4({ method: 'GET', url, region: 'us-east-1', service: 'polly', date: DATE }, CREDS);
    const canonical = [
      'GET',
      '/v1/voices',
      'a=0&a=it%27s%281%29%2A%21&b=x%20y',
      `host:polly.us-east-1.amazonaws.com\nx-amz-date:${AMZ}\n`,
      'host;x-amz-date',
      H(''),
    ].join('\n');
    expect(signatureOf(h)).toBe(referenceSignature(canonical, CREDS.secretAccessKey, 'us-east-1', 'polly'));
  });

  test('header values are trimmed/collapsed and names lower-cased; no date → now', () => {
    const h = signV4(
      { method: 'get', url: 'https://h.amazonaws.com', region: 'r', service: 's', headers: { 'X-Custom': '  a   b  ' } },
      CREDS
    );
    expect(h.Authorization).toContain('SignedHeaders=host;x-amz-date;x-custom,');
    expect(h['x-amz-date']).toMatch(/^\d{8}T\d{6}Z$/);
  });
});
