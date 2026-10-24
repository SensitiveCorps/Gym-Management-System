import { scrypt, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import sharp from 'sharp';
import argon2 from 'argon2';
const derive = promisify(scrypt);
export const hashToken = (value) =>
  createHash('sha256').update(value).digest('hex');
export const token = () => randomBytes(32).toString('hex');
export class UserError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
export function text(value, name, max = 200) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max)
    throw new UserError(`${name} is required (maximum ${max} characters).`);
  return value.trim();
}
export function id(value) {
  const result = String(value ?? '');
  if (!/^[1-9]\d{0,15}$/.test(result))
    throw new UserError('Invalid record identifier.');
  return result;
}
export function password(value) {
  if (typeof value !== 'string' || value.length < 8 || value.length > 256)
    throw new UserError('Use a password between 8 and 256 characters.');
  return value;
}
export async function hashPassword(value) {
  password(value);
  return argon2.hash(value, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 1,
    hashLength: 32,
  });
}
export async function verifyPassword(value, stored) {
  if (
    typeof value !== 'string' ||
    value.length > 256 ||
    typeof stored !== 'string'
  )
    return false;
  if (stored.startsWith('$argon2id$')) {
    try {
      return await argon2.verify(stored, value);
    } catch {
      return false;
    }
  }
  const [scheme, n, r, p, salt, encoded] = stored.split('$');
  if (
    scheme !== 'scrypt' ||
    n !== '32768' ||
    r !== '8' ||
    p !== '3' ||
    !/^[a-f0-9]{32}$/.test(salt || '') ||
    !/^[a-f0-9]{128}$/.test(encoded || '')
  )
    return false;
  const actual = await derive(value, salt, 64, {
    N: 32768,
    r: 8,
    p: 3,
    maxmem: 64 * 1024 * 1024,
  });
  return timingSafeEqual(actual, Buffer.from(encoded, 'hex'));
}
export async function photoBytes(value) {
  if (
    typeof value !== 'string' ||
    value.length > 3_000_000 ||
    !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value)
  )
    throw new UserError(
      'A JPEG, PNG or WebP photo no larger than 2 MB is required.',
    );
  const bytes = Buffer.from(value.split(',')[1], 'base64');
  if (bytes.length > 2 * 1024 * 1024)
    throw new UserError('The photo exceeds 2 MB.');
  const jpeg =
      bytes.length > 3 &&
      bytes[0] === 255 &&
      bytes[1] === 216 &&
      bytes[2] === 255,
    png = bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    webp =
      bytes.subarray(0, 4).toString() === 'RIFF' &&
      bytes.subarray(8, 12).toString() === 'WEBP';
  if (!jpeg && !png && !webp)
    throw new UserError('Choose an actual JPEG, PNG or WebP photo.');
  try {
    return await sharp(bytes, {
      limitInputPixels: 40_000_000,
      failOn: 'warning',
    })
      .rotate()
      .resize(600, 600, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
  } catch {
    throw new UserError(
      'The photo could not be decoded. Choose another image.',
    );
  }
}
export const ID_TYPES = {
  'Student ID': 'STUDENT_ID',
  'National ID': 'NATIONAL_ID',
  Passport: 'PASSPORT',
  'Birth certificate': 'BIRTH_CERTIFICATE',
};
export function identityType(value) {
  if (!ID_TYPES[value])
    throw new UserError('Choose a supported identity document.');
  return ID_TYPES[value];
}
export function bool(value, name) {
  if (typeof value !== 'boolean')
    throw new UserError(`${name} must be true or false.`);
  return value;
}
export function date(value) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(Date.parse(value + 'T00:00:00Z')) ||
    new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value
  )
    throw new UserError('Choose a valid calendar date.');
  return value;
}
export function time(value) {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value))
    throw new UserError('Choose a valid opening and closing time.');
  return value;
}
export function plan(value) {
  const name = text(value.name, 'Plan name', 100),
    price = Number(value.price),
    days = Number(value.days);
  if (
    value.price === '' ||
    !Number.isFinite(price) ||
    price < 0 ||
    price > 9999999999 ||
    Math.abs(price * 100 - Math.round(price * 100)) > 1e-6
  )
    throw new UserError(
      'Price must be nonnegative with at most two decimal places.',
    );
  if (!Number.isInteger(days) || days < 1 || days > 3650)
    throw new UserError('Duration must be a whole number from 1 to 3650 days.');
  return {
    id: value.id,
    name,
    price,
    days,
    on: bool(value.on, 'Plan availability'),
  };
}
