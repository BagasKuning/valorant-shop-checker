import { config, RIOT_CLIENT_PLATFORM_B64 } from '../config';
import { decrypt, encrypt } from '../crypto';
import type { UserRecord } from '../storage';

const ENTITLEMENT_URL = 'https://entitlements.auth.riotgames.com/api/token/v1';
const USERINFO_URL = 'https://auth.riotgames.com/userinfo';
const GEO_URL = 'https://riot-geo.pas.riotgames.com/pas/v1/product/valorant';
// Cookie reauth (GET /authorize) — cara resmi yang direkomendasikan docs Valorant API
// buat gantiin login username/password langsung.
const AUTHORIZE_URL =
  'https://auth.riotgames.com/authorize?redirect_uri=https%3A%2F%2Fplayvalorant.com%2Fopt_in&client_id=play-valorant-web-prod&response_type=token%20id_token&nonce=1&scope=account%20openid';

export interface RiotSession {
  accessToken: string;
  idToken: string;
  entitlement: string;
  puuid: string;
  riotName: string;
  tag: string;
  shard: string;
  cookies: string; // JSON string, disimpan terenkripsi
  expiresAt: number;
}

interface CookieJar {
  [name: string]: string;
}

function parseSetCookie(headers: Headers): CookieJar {
  const jar: CookieJar = {};
  // Node fetch: getSetCookie() tersedia di Node 20+
  const raw = (headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  for (const line of raw) {
    const [pair] = line.split(';');
    const eq = pair.indexOf('=');
    if (eq > 0) jar[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  return jar;
}

function cookieHeader(jar: CookieJar): string {
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

function mergeJar(a: CookieJar, b: CookieJar): CookieJar {
  return { ...a, ...b };
}

function parseTokenFromUri(uri: string): { accessToken: string; idToken: string } | null {
  const hash = uri.split('#')[1] ?? '';
  const params = new URLSearchParams(hash);
  const accessToken = params.get('access_token');
  const idToken = params.get('id_token');
  if (!accessToken || !idToken) return null;
  return { accessToken, idToken };
}

async function getEntitlement(accessToken: string): Promise<string> {
  const res = await fetch(ENTITLEMENT_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!res.ok) throw new Error(`Gagal ambil entitlement (${res.status})`);
  const data = (await res.json()) as { entitlements_token?: string };
  if (!data.entitlements_token) throw new Error('Entitlement token kosong');
  return data.entitlements_token;
}

async function getUserInfo(accessToken: string): Promise<{ puuid: string; name: string; tag: string }> {
  const res = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Gagal ambil userinfo (${res.status})`);
  const data = (await res.json()) as { sub?: string; acct?: { game_name?: string; tag_line?: string } };
  if (!data.sub) throw new Error('PUUID tidak ditemukan');
  return {
    puuid: data.sub,
    name: data.acct?.game_name ?? 'Unknown',
    tag: data.acct?.tag_line ?? '',
  };
}

async function getShard(idToken: string): Promise<string> {
  try {
    const res = await fetch(GEO_URL, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id_token: idToken }),
    });
    if (!res.ok) return config.defaultShard;
    const data = (await res.json()) as { live_region?: string };
    const region = (data.live_region ?? '').toLowerCase();
    if (['ap', 'na', 'eu', 'kr', 'latam', 'br'].includes(region)) return region;
    return config.defaultShard;
  } catch {
    return config.defaultShard;
  }
}

export async function getClientVersion(): Promise<string> {
  try {
    const res = await fetch('https://valorant-api.com/v1/version');
    const data = (await res.json()) as { data?: { riotClientVersion?: string } };
    return data.data?.riotClientVersion ?? 'release-10.00-shipping-1-0000000';
  } catch {
    return 'release-10.00-shipping-1-0000000';
  }
}

/**
 * Login pakai cookie `ssid` Riot — pengganti login username/password.
 *
 * Kenapa password login dihapus: Riot mengubah endpoint
 * PUT /api/v1/authorization. Format body lamanya
 * { type: "auth", username, password } sekarang ditolak dengan
 * error `invalid_request`. Format barunya butuh
 * riot_identity: { captcha, username, password } — captcha hCaptcha
 * dari halaman login Riot, yang tidak bisa diisi bot Discord.
 * Docs Valorant API sendiri bilang login langsung "prone to breakage
 * (captchas and cloudflare anti-bot)" dan menyarankan Cookie Reauth
 * atau login lewat webview.
 *
 * Cara ambil ssid (sekali, di browser sendiri):
 * 1. Login ke https://playvalorant.com di browser (Chrome/Opera/Firefox).
 * 2. DevTools (F12) > Application > Cookies > https://auth.riotgames.com
 *    > salin nilai cookie `ssid`.
 * 3. Paste ssid itu di DM bot setelah `/login`. Bot TIDAK pernah
 *    minta password Riot lagi.
 * SSID cuma dipakai buat tukar jadi access token + entitlement, lalu
 * disimpan terenkripsi bareng tokennya. Refresh berikutnya pakai
 * cookie yang sama (reauth), tanpa password.
 */
export async function loginWithSsid(ssidRaw: string): Promise<RiotSession> {
  const ssid = ssidRaw.trim().replace(/^ssid=/i, '').trim();
  if (!ssid || ssid.length < 10) {
    throw new Error('SSID tidak valid. Salin nilai cookie `ssid` dari browser kamu, lalu paste di DM ini.');
  }
  return cookieReauth({ ssid });
}

/** Tukar cookie (khususnya `ssid`) jadi session, lewat GET /authorize. */
export async function cookieReauth(cookies: CookieJar): Promise<RiotSession> {
  const res = await fetch(AUTHORIZE_URL, {
    method: 'GET',
    headers: { Cookie: cookieHeader(cookies) },
    redirect: 'manual',
  });
  const jar = mergeJar(cookies, parseSetCookie(res.headers));
  const location = res.headers.get('location') ?? '';
  if (location.startsWith('https://playvalorant.com/opt_in#')) {
    const tokens = parseTokenFromUri(location);
    if (!tokens) throw new Error('Token tidak ditemukan di respons Riot');
    return buildSession(tokens.accessToken, tokens.idToken, jar);
  }
  throw new Error(
    'SSID tidak valid / sudah kedaluwarsa. Login ulang di browser Riot (playvalorant.com), ambil cookie `ssid` yang baru, lalu /login lagi.',
  );
}

async function buildSession(
  accessToken: string,
  idToken: string,
  jar: CookieJar,
): Promise<RiotSession> {
  const [entitlement, user, shard] = await Promise.all([
    getEntitlement(accessToken),
    getUserInfo(accessToken),
    getShard(idToken),
  ]);
  return {
    accessToken,
    idToken,
    entitlement,
    puuid: user.puuid,
    riotName: user.name,
    tag: user.tag,
    shard,
    cookies: JSON.stringify(jar),
    // Token Riot biasanya expire 1 jam. Refresh 5 menit lebih awal.
    expiresAt: Date.now() + 55 * 60 * 1000,
  };
}

/** Coba refresh token pakai cookies yang tersimpan, tanpa password. */
export async function reauth(user: UserRecord): Promise<RiotSession | null> {
  try {
    const jar = JSON.parse(decrypt(user.encCookies)) as CookieJar;
    return await cookieReauth(jar);
  } catch {
    return null;
  }
}

/** Ambil session yang masih valid, refresh otomatis kalau sudah mau expire. */
export async function getValidSession(
  user: UserRecord,
): Promise<{ session: RiotSession; user: UserRecord } | null> {
  if (Date.now() < user.accessTokenExpiresAt - 60 * 1000) {
    return {
      session: {
        accessToken: decrypt(user.encAccessToken),
        idToken: '',
        entitlement: decrypt(user.encEntitlement),
        puuid: user.puuid,
        riotName: user.riotName,
        tag: user.tag,
        shard: user.shard,
        cookies: decrypt(user.encCookies),
        expiresAt: user.accessTokenExpiresAt,
      },
      user,
    };
  }
  const refreshed = await reauth(user);
  if (!refreshed) return null;
  const updated: UserRecord = {
    ...user,
    encAccessToken: encrypt(refreshed.accessToken),
    encEntitlement: encrypt(refreshed.entitlement),
    encCookies: encrypt(refreshed.cookies),
    accessTokenExpiresAt: refreshed.expiresAt,
  };
  return { session: refreshed, user: updated };
}

export function storefrontHeaders(session: RiotSession, clientVersion: string): Record<string, string> {
  return {
    Authorization: `Bearer ${session.accessToken}`,
    'X-Riot-Entitlements-JWT': session.entitlement,
    'X-Riot-ClientPlatform': RIOT_CLIENT_PLATFORM_B64,
    'X-Riot-ClientVersion': clientVersion,
    'Content-Type': 'application/json',
  };
}
