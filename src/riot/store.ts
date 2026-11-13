import { config, VP_CURRENCY_ID } from '../config';
import { getClientVersion, getValidSession, storefrontHeaders, type RiotSession } from './auth';
import { upsertUser, type UserRecord } from '../storage';

export interface ShopItem {
  uuid: string;
  name: string;
  icon: string | null;
  vp: number | null;
  discountVp?: number | null;
}

export interface ShopResult {
  items: ShopItem[];
  nightMarket: ShopItem[];
  secondsLeft: number;
  featuredBundleName?: string;
}

interface SkinCatalogEntry {
  displayName: string;
  displayIcon: string | null;
}

let catalogCache: { at: number; map: Map<string, SkinCatalogEntry> } | null = null;

/** Ambil katalog skin dari valorant-api.com (publik, tanpa login), cache 24 jam. */
export async function getSkinCatalog(): Promise<Map<string, SkinCatalogEntry>> {
  if (catalogCache && Date.now() - catalogCache.at < 24 * 60 * 60 * 1000) return catalogCache.map;
  const res = await fetch('https://valorant-api.com/v1/weapons/skins');
  if (!res.ok) throw new Error(`Gagal ambil katalog skin (${res.status})`);
  const data = (await res.json()) as {
    data?: Array<{ uuid?: string; displayName?: string; displayIcon?: string | null }>;
  };
  const map = new Map<string, SkinCatalogEntry>();
  for (const s of data.data ?? []) {
    if (s.uuid) map.set(s.uuid, { displayName: s.displayName ?? s.uuid, displayIcon: s.displayIcon ?? null });
  }
  catalogCache = { at: Date.now(), map };
  return map;
}

function mapOffer(
  offer: { OfferID?: string; Cost?: Record<string, number> },
  catalog: Map<string, SkinCatalogEntry>,
): ShopItem {
  const uuid = offer.OfferID ?? '';
  const entry = catalog.get(uuid);
  return {
    uuid,
    name: entry?.displayName ?? uuid,
    icon: entry?.displayIcon ?? null,
    vp: offer.Cost?.[VP_CURRENCY_ID] ?? null,
  };
}

export function parseStorefront(raw: unknown, catalog: Map<string, SkinCatalogEntry>): ShopResult {
  const d = raw as {
    SkinsPanelLayout?: {
      SingleItemOffers?: string[];
      SingleItemStoreOffers?: Array<{ OfferID?: string; Cost?: Record<string, number> }>;
      SingleItemOffersRemainingDurationInSeconds?: number;
    };
    BonusStore?: {
      BonusStoreOffers?: Array<{
        Offer?: { OfferID?: string; Cost?: Record<string, number> };
        DiscountCosts?: Record<string, number>;
      }>;
    };
    FeaturedBundle?: { Bundle?: { DisplayName?: string } };
  };
  const panel = d.SkinsPanelLayout;
  const items = (panel?.SingleItemStoreOffers ?? []).map((o) => mapOffer(o, catalog));
  const nightMarket = (d.BonusStore?.BonusStoreOffers ?? []).map((b) => {
    const item = mapOffer(b.Offer ?? {}, catalog);
    return { ...item, discountVp: b.DiscountCosts?.[VP_CURRENCY_ID] ?? null };
  });
  return {
    items,
    nightMarket,
    secondsLeft: panel?.SingleItemOffersRemainingDurationInSeconds ?? 0,
    featuredBundleName: d.FeaturedBundle?.Bundle?.DisplayName,
  };
}

export async function fetchShop(
  user: UserRecord,
): Promise<{ shop: ShopResult; user: UserRecord } | { error: 'need-login' }> {
  const valid = await getValidSession(user);
  if (!valid) return { error: 'need-login' };
  // Simpan token yang sudah di-refresh (kalau ada)
  if (valid.user !== user) await upsertUser(valid.user);

  const session: RiotSession = valid.session;
  const clientVersion = await getClientVersion();
  // Shard yang tersimpan bisa salah (dulu deteksi Riot Geo-nya bug, jadi
  // selalu fallback ke ap). Storefront di shard yang salah balas 404,
  // jadi coba shard tersimpan dulu, lalu shard lain sampai ada yang 200.
  // Kalau ada shard lain yang berhasil, simpan shard itu buat ke depannya.
  const shards = [session.shard, 'ap', 'na', 'eu', 'kr'].filter(
    (s, i, arr) => s && arr.indexOf(s) === i,
  );
  let lastStatus = 0;
  for (const shard of shards) {
    const url = `https://pd.${shard}.a.pvp.net/store/v2/storefront/${session.puuid}`;
    const res = await fetch(url, { headers: storefrontHeaders(session, clientVersion) });
    if (res.status === 401 || res.status === 403) return { error: 'need-login' };
    if (res.status === 404) {
      console.log(`[shop-checker] Storefront 404 di shard ${shard}, coba shard lain...`);
      lastStatus = 404;
      continue;
    }
    if (!res.ok) throw new Error(`Gagal ambil shop (${res.status}) di shard ${shard}`);
    const raw = await res.json();
    const catalog = await getSkinCatalog();
    const shop = parseStorefront(raw, catalog);
    if (shard !== session.shard) {
      console.log(`[shop-checker] Storefront ketemu di shard ${shard} (bukan ${session.shard}), shard disimpan.`);
      const updated: UserRecord = { ...valid.user, shard };
      await upsertUser(updated);
      return { shop, user: updated };
    }
    return { shop, user: valid.user };
  }
  throw new Error(
    `Gagal ambil shop (${lastStatus || 'error'}) di semua shard (${shards.join(', ')}). ` +
      `Akun ini mungkin belum pernah main Valorant di shard mana pun, atau region akunnya beda. ` +
      `Coba /logout lalu /login lagi dengan ssid baru.`,
  );
}

export interface PdProbe {
  riotName: string;
  tag: string;
  shard: string;
  puuidPrefix: string;
  clientVersion: string;
  walletStatus: number;
  walletVp: number | null;
  mmrStatus: number;
  storefrontStatus: number;
}

/**
 * Diagnostik: tes token + puuid yang sama ke 3 endpoint pd yang berbeda,
 * biar ketahuan apakah pd menolak token-nya sama sekali atau cuma
 * storefront-nya yang 404.
 * - wallet 200 + storefront 404  -> token diterima pd, masalah khusus storefront
 * - wallet 404 + mmr 404          -> pd tidak kenal token/puuid ini sama sekali
 *   (kemungkinan besar token web dari cookie reauth tidak diizinkan buat pd)
 * - 401/403 di mana-mana          -> sesi habis, perlu /login lagi
 */
export async function probePd(
  user: UserRecord,
): Promise<PdProbe | { error: 'need-login' }> {
  const valid = await getValidSession(user);
  if (!valid) return { error: 'need-login' };
  if (valid.user !== user) await upsertUser(valid.user);
  const session: RiotSession = valid.session;
  const clientVersion = await getClientVersion();
  const headers = storefrontHeaders(session, clientVersion);
  const base = `https://pd.${session.shard}.a.pvp.net`;
  const probe = async (path: string): Promise<number> => {
    try {
      const res = await fetch(`${base}${path}`, { headers });
      return res.status;
    } catch {
      return 0;
    }
  };
  const walletRes = await fetch(`${base}/store/v1/wallet/${session.puuid}`, { headers });
  const walletStatus = walletRes.status;
  let walletVp: number | null = null;
  if (walletRes.ok) {
    try {
      const data = (await walletRes.json()) as { Balances?: Record<string, number> };
      walletVp = data.Balances?.[VP_CURRENCY_ID] ?? null;
    } catch {
      walletVp = null;
    }
  }
  const mmrStatus = await probe(`/mmr/v1/players/${session.puuid}`);
  const storefrontStatus = await probe(`/store/v2/storefront/${session.puuid}`);
  console.log(
    `[shop-checker] /debug ${session.riotName}#${session.tag} shard=${session.shard} ` +
      `client=${clientVersion} wallet=${walletStatus} mmr=${mmrStatus} storefront=${storefrontStatus}`,
  );
  return {
    riotName: session.riotName,
    tag: session.tag,
    shard: session.shard,
    puuidPrefix: session.puuid.slice(0, 8),
    clientVersion,
    walletStatus,
    walletVp,
    mmrStatus,
    storefrontStatus,
  };
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h} jam ${m} menit lagi`;
}

export function matchesWishlist(name: string, wishlist: string[]): string | null {
  const lower = name.toLowerCase();
  return wishlist.find((w) => lower.includes(w.toLowerCase())) ?? null;
}

export function shardLabel(shard: string): string {
  return shard === 'ap' ? 'Asia Pasifik (ap)' : shard;
}

export function configCheckLabel(): string {
  return `${String(config.checkHourWib).padStart(2, '0')}:${String(config.checkMinuteWib).padStart(2, '0')} WIB`;
}
