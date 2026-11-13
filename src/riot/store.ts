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
  const url = `https://pd.${session.shard}.a.pvp.net/store/v2/storefront/${session.puuid}`;
  const res = await fetch(url, { headers: storefrontHeaders(session, clientVersion) });
  if (res.status === 401 || res.status === 403) return { error: 'need-login' };
  if (!res.ok) throw new Error(`Gagal ambil shop (${res.status})`);
  const raw = await res.json();
  const catalog = await getSkinCatalog();
  return { shop: parseStorefront(raw, catalog), user: valid.user };
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
