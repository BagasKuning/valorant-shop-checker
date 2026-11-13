import crypto from 'crypto';
import { config } from './config';

/**
 * Enkripsi token Riot (AES-256-GCM) sebelum disimpan ke data/users.json.
 * Kunci dari SESSION_SECRET (64 hex = 32 byte). Tanpa secret ini,
 * file users.json tidak bisa dibaca — jadi jangan commit .env dan
 * jangan ganti SESSION_SECRET sembarangan (semua user harus login ulang).
 */
function key(): Buffer {
  if (!/^[0-9a-fA-F]{64}$/.test(config.sessionSecret)) {
    throw new Error(
      'SESSION_SECRET harus 64 karakter hex. Generate dengan: npm run gen-secret',
    );
  }
  return Buffer.from(config.sessionSecret, 'hex');
}

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decrypt(payload: string): string {
  const buf = Buffer.from(payload, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}
