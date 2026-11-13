import { loginStep1, loginStep2Mfa, type LoginResult } from '../riot/auth';
import { encrypt } from '../crypto';
import { upsertUser } from '../storage';

export type LoginStep = 'username' | 'password' | 'mfa';

export interface PendingLogin {
  step: LoginStep;
  username?: string;
  cookies?: import('../riot/auth').LoginResult extends { status: 'mfa'; cookies: infer C } ? C : never;
}

export const pendingLogins = new Map<string, PendingLogin>();

export function startLogin(discordId: string): void {
  pendingLogins.set(discordId, { step: 'username' });
}

export function isPending(discordId: string): boolean {
  return pendingLogins.has(discordId);
}

/**
 * Dipanggil untuk setiap DM dari user yang sedang dalam proses login.
 * Kembalikan teks balasan untuk user. Password / kode 2FA TIDAK pernah
 * disimpan atau di-log — hanya dipakai sekali untuk login ke Riot.
 */
export async function handleLoginDm(discordId: string, text: string): Promise<string> {
  const pending = pendingLogins.get(discordId);
  if (!pending) return '';

  if (pending.step === 'username') {
    const username = text.trim();
    if (!username) return 'Username Riot-nya kosong. Ketik username Riot kamu:';
    pending.username = username;
    pending.step = 'password';
    return (
      'Oke. Sekarang ketik **password Riot** kamu di DM ini.\n' +
      '• Pesan ini akan aku coba hapus setelah dibaca.\n' +
      '• Password TIDAK disimpan — hanya dipakai sekali buat login, lalu dibuang.\n' +
      '• Jangan kirim password ini di server / channel umum, hanya di DM ini.'
    );
  }

  if (pending.step === 'password') {
    const username = pending.username ?? '';
    const password = text; // jangan trim password, spasi bisa jadi bagian password
    try {
      const result: LoginResult = await loginStep1(username, password);
      if (result.status === 'mfa') {
        pending.step = 'mfa';
        pending.cookies = result.cookies as never;
        return 'Akun kamu pakai 2FA. Ketik **kode 2FA** dari email / authenticator kamu:';
      }
      const s = result.session;
      await upsertUser({
        discordId,
        puuid: s.puuid,
        riotName: s.riotName,
        tag: s.tag,
        shard: s.shard,
        encAccessToken: encrypt(s.accessToken),
        encEntitlement: encrypt(s.entitlement),
        encCookies: encrypt(s.cookies),
        accessTokenExpiresAt: s.expiresAt,
        wishlist: [],
        createdAt: Date.now(),
      });
      pendingLogins.delete(discordId);
      return (
        `Login berhasil! Halo **${s.riotName}#${s.tag}** (shard ${s.shard}).\n` +
        'Kamu nggak perlu login lagi — token-nya aku simpan terenkripsi dan di-refresh otomatis.\n' +
        'Coba ketik `/shop` dari HP kamu. Kalau mau berhenti, ketik `/logout`.'
      );
    } catch (err) {
      pendingLogins.delete(discordId);
      return `Login gagal: ${(err as Error).message}\nCoba lagi dengan \`/login\`.`;
    }
  }

  // step mfa
  const code = text.trim();
  try {
    const session = await loginStep2Mfa(
      pending.cookies as unknown as Parameters<typeof loginStep2Mfa>[0],
      code,
    );
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
      'Kamu nggak perlu login lagi — token-nya aku simpan terenkripsi dan di-refresh otomatis.\n' +
      'Coba ketik `/shop` dari HP kamu.'
    );
  } catch (err) {
    pendingLogins.delete(discordId);
    return `Login gagal: ${(err as Error).message}\nCoba lagi dengan \`/login\`.`;
  }
}
