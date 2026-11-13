import type { Client } from 'discord.js';
import { config } from './config';
import { checkAllWishlists } from './discord/commands';

/**
 * Scheduler sederhana tanpa library tambahan:
 * cek tiap menit, kalau sudah jam CHECK_HOUR_WIB:CHECK_MINUTE_WIB WIB
 * dan belum dicek hari ini, jalankan cek wishlist.
 * WIB = UTC+7.
 */
export function startScheduler(client: Client): void {
  let lastCheckDate = '';
  setInterval(async () => {
    const nowUtc = new Date();
    const wib = new Date(nowUtc.getTime() + 7 * 60 * 60 * 1000);
    const today = wib.toISOString().slice(0, 10);
    const isTime =
      wib.getUTCHours() === config.checkHourWib && wib.getUTCMinutes() === config.checkMinuteWib;
    if (!isTime || lastCheckDate === today) return;
    lastCheckDate = today;
    console.log(`[shop-checker] Cek wishlist harian ${today} ${config.checkHourWib}:${config.checkMinuteWib} WIB`);
    try {
      const notified = await checkAllWishlists(client);
      console.log(`[shop-checker] Wishlist: ${notified.length} user di-notify`);
    } catch (err) {
      console.error('[shop-checker] scheduler error:', err);
    }
  }, 60 * 1000);
  console.log(
    `[shop-checker] Scheduler aktif: cek wishlist tiap hari ${config.checkHourWib}:${config.checkMinuteWib} WIB`,
  );
}
