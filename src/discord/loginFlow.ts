import { loginWithSsid } from '../riot/auth';
import { encrypt } from '../crypto';
import { upsertUser } from '../storage';

export type LoginStep = 'ssid';

export interface PendingLogin {
  step: LoginStep;
}

export const pendingLogins = new Map<string, PendingLogin>();

export function startLogin(discordId: string): void {
  pendingLogins.set(discordId, { step: 'ssid' });
}

export function isPending(discordId: string): boolean {
  return pendingLogins.has(discordId);
}

export const SSID_HOWTO =
  'Cara ambil cookie `ssid` (sekali aja, di browser kamu):\n' +
  '1. Login ke https://playvalorant.com di browser (Chrome/Opera/Firefox).\n' +
  '2. Tekan F12 > tab Application > Cookies > https://auth.riotgames.com.\n' +
  '3. Cari cookie bernama `ssid`, salin nilainya (bukan nama cookienya).\n' +
  '4. Paste nilai itu di DM ini.\n\n' +
  'Kenapa bukan password lagi? Riot mengubah login username/password: ' +
  'sekarang butuh captcha hCaptcha dari halaman login, jadi bot tidak ' +
  'bisa login pakai password. Login pakai cookie `ssid` adalah cara ' +
  'yang direkomendasikan docs Valorant API — dan bot tidak pernah ' +
  'minta / menyimpan password Riot kamu.';

/**
 * Dipanggil untuk setiap DM dari user yang sedang dalam proses login.
 * Kembalikan teks balasan untuk user. SSID TIDAK pernah di-log — hanya
 * dipakai sekali untuk tukar jadi access token, lalu disimpan terenkripsi.
 */
export async function handleLoginDm(discordId: string, text: string): Promise<string> {
  const pending = pendingLogins.get(discordId);
  if (!pending) return '';

  const ssid = text.trim();
  if (!ssid) return 'SSID-nya kosong. Paste nilai cookie `ssid` kamu di DM ini:';
  try {
    const session = await loginWithSsid(ssid);
    await upsertUser({
      discordId,
      puuid: session.puuid,
      riotName: session.riotName,
      tag: session.tag,
      shard: session.shard,
      encAccessToken: encrypt(session.accessToken),
      encEntitlement: encrypt(session.entitlement),
      encCookies: encrypt(session.cookies),
      accessTokenExpiresAt: session.expiresAt,
      wishlist: [],
      createdAt: Date.now(),
    });
    pendingLogins.delete(discordId);
    return (
      `Login berhasil! Halo **${session.riotName}#${session.tag}** (shard ${session.shard}).\n` +
      'Kamu nggak perlu login lagi — token-nya aku simpan terenkripsi dan di-refresh otomatis pakai cookie.\n' +
      'Coba ketik `/shop` dari HP kamu. Kalau mau berhenti, ketik `/logout`.\n' +
      'Catatan: cookie `ssid` biasanya bertahan ~1-3 minggu. Kalau nanti `/shop` bilang sesi habis, ambil `ssid` baru dan `/login` lagi.'
    );
  } catch (err) {
    pendingLogins.delete(discordId);
    return `${(err as Error).message}\nCoba lagi dengan \`/login\`.`;
  }
}
