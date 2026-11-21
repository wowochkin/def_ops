import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt) as unknown as (password: string, salt: Buffer, keylen: number, options: { N: number; r: number; p: number }) => Promise<Buffer>;
const N = 16_384;
const r = 8;
const p = 1;

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 8) throw new Error('Пароль должен содержать не менее 8 символов');
  const salt = randomBytes(16);
  const hash = await derive(password, salt, 32, { N, r, p }) as Buffer;
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, nText, rText, pText, saltText, hashText] = encoded.split('$');
  if (algorithm !== 'scrypt' || !saltText || !hashText) return false;
  const expected = Buffer.from(hashText, 'base64url');
  const actual = await derive(password, Buffer.from(saltText, 'base64url'), expected.length, { N: Number(nText), r: Number(rText), p: Number(pText) }) as Buffer;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
