# Valorant Shop Checker — Bot Discord

Cek daily shop + night market Valorant kamu dari HP, tanpa buka game,
tanpa pindah ke Windows. Login Riot **cuma sekali** lewat DM, abis itu
tinggal `/shop` kapan aja.

Buat diri sendiri + teman, bukan bot publik. Private, server kamu sendiri.

> **Penting — baca dulu:** Shop pribadi Valorant tidak ada API resminya.
> Riot menyebut store tracking sebagai use case yang tidak disetujui,
> dan API resmi Valorant tidak punya endpoint store. Bot ini memakai
> endpoint internal yang dipakai game client-nya sendiri
> (`store/v2/storefront`), lewat login Riot kamu sendiri.
> Pakai akun utama kamu dengan risiko sendiri, dan jangan pernah
> membagikan password Riot ke bot / server yang bukan milik kamu.

## Fitur

| Perintah | Fungsi |
| --- | --- |
| `/login` | Login Riot sekali lewat DM (paste cookie `ssid` dari browser) |
| `/shop` | Lihat 4 daily shop + night market hari ini (ephemeral, hanya kamu yang lihat) |
| `/wishlist add <skin>` | Misal `/wishlist add Reaver Vandal` |
| `/wishlist list` | Lihat wishlist kamu |
| `/wishlist remove <skin>` | Hapus dari wishlist |
| `/logout` | Hapus login + wishlist kamu dari bot |
| `/help` | Cara pakai |

Tiap pagi jam 07:05 WIB (reset shop 00:00 UTC), bot cek wishlist semua
user dan DM kamu kalau skin incaran muncul.

## Cara kerja (singkat)

1. Kamu `/login` di server → bot DM kamu → kamu paste nilai cookie
   `ssid` Riot kamu di DM itu.
2. Bot tukar `ssid` itu jadi access token + entitlement + PUUID + shard
   kamu lewat Cookie Reauth (`GET auth.riotgames.com/authorize`).
3. **Bot tidak pernah minta password Riot.** Yang disimpan hanya
   access token + entitlement + cookies, dienkripsi AES-256-GCM pakai
   `SESSION_SECRET`, di file `data/users.json`.
4. Token di-refresh otomatis pakai cookies sebelum expire. Kalau refresh
   gagal (ssid kedaluwarsa, biasanya ~1-3 minggu), bot minta `/login`
   lagi dengan `ssid` baru.

### Cara ambil cookie `ssid`

1. Login ke https://playvalorant.com di browser (Chrome/Opera/Firefox).
2. Tekan F12 → tab **Application** → **Cookies** →
   `https://auth.riotgames.com`.
3. Cari cookie bernama `ssid`, salin **nilainya**.
4. Paste nilai itu di DM bot setelah `/login`. Jangan kirim password
   Riot ke bot / ke siapa pun.

### Kenapa bukan login username/password?

Riot mengubah endpoint login langsung (`PUT /api/v1/authorization`):
format body lamanya sekarang ditolak dengan error `invalid_request`,
dan format barunya butuh token hCaptcha dari halaman login Riot.
Docs Valorant API sendiri bilang login langsung "prone to breakage
(captchas and cloudflare anti-bot)" dan menyarankan Cookie Reauth.
Itulah kenapa bot ini pakai `ssid` — login lewat browser resmi Riot,
bot cuma menerima cookie sesinya.
5. `/shop` manggil `pd.{shard}.a.pvp.net/store/v2/storefront/{puuid}`,
   lalu nama / gambar / harga skin dicocokkan dari `valorant-api.com`
   (publik, tanpa login).

## Masuk server sendiri — tidak perlu verifikasi

Bot ini private, di bawah 100 server, jadi **tidak perlu** verifikasi
Discord, approval Riot, atau publish ke mana-mana:

1. Buka https://discord.com/developers/applications → New Application
2. Menu **Bot** → Reset Token → salin ke `DISCORD_TOKEN`
3. Salin **Application ID** → `DISCORD_CLIENT_ID`
4. Menu **OAuth2 → URL Generator** → centang `bot` + `applications.commands`,
   permission centang `Send Messages` → buka URL-nya, pilih server kamu.
5. Selesai. Bot langsung masuk server kamu.

## Cara jalanin lokal

```bash
cp .env.example .env
# isi DISCORD_TOKEN, DISCORD_CLIENT_ID
# isi SESSION_SECRET dengan: npm run gen-secret
# (opsional) DISCORD_GUILD_ID = ID server kamu biar slash command langsung muncul

npm install
npm run build
npm start

# development:
npm run dev
```

Coba dulu di laptop Linux kamu: bot jalan, `/login` dari Discord di HP,
terus `/shop` dari HP. Tidak perlu Windows sama sekali.

## Deploy ke Fly.io (~$2/bulan)

Perkiraan dari riset harga: mesin paling kecil Fly.io 256 MB sekitar
$2 per 30 hari. Cek harga terbaru di fly.io sebelum deploy — harga bisa
berubah, dan akun baru tidak ada free tier permanen, hanya trial 7 hari.

Kenapa butuh server online terus? Supaya kamu bisa `/shop` dari HP
kapan aja, dan bot bisa cek wishlist tiap pagi. Kalau bot cuma jalan di
laptop yang kadang mati, bot-nya juga mati.

```bash
# 1. Install flyctl, lalu login
fly auth login

# 2. Salin contoh config, ganti app name dengan yang unik
cp fly.toml.example fly.toml
# edit app = "valorant-shop-checker-dwi" -> nama unik kamu

# 3. Buat volume buat data/users.json (biar login tidak hilang pas redeploy)
fly volumes create valo_data --size 1 --region sin

# 4. Isi secrets (JANGAN tulis token di fly.toml / di chat)
fly secrets set DISCORD_TOKEN=... DISCORD_CLIENT_ID=... SESSION_SECRET=...

# 5. Deploy
fly deploy

# 6. Cek log
fly logs
```

Patungan: $2/bulan dibagi teman-teman yang pakai bot ini, misal 4 orang
= $0.50/orang/bulan. Bot ini memang didesain buat skala kecil itu.

Alternatif lain: Railway trial $5/30 hari lalu $1/bulan (tidak cukup buat
24/7), VPS kecil $4-6/bulan, atau PC Linux kamu sendiri kalau nyala terus.

## Struktur project

```
src/
  index.ts                 # login Discord, register command, DM login flow
  config.ts                # baca .env
  crypto.ts                # AES-256-GCM buat token Riot
  storage.ts               # data/users.json (login + wishlist)
  scheduler.ts             # cek wishlist tiap pagi 07:05 WIB
  riot/
    auth.ts                # login Riot, 2FA, refresh token, entitlement, shard
    store.ts               # ambil storefront, katalog skin, parsing shop
  discord/
    commands.ts            # /login /shop /wishlist /logout /help
    loginFlow.ts           # state machine login di DM
```

## Keamanan — baca ini sebelum dipakai teman

- Password Riot **tidak pernah diminta, disimpan, atau di-log**.
  Pesan DM berisi cookie `ssid` dicoba dihapus bot setelah dibaca.
  Jangan pernah kirim password Riot ke bot ini atau bot lain.
- Token Riot disimpan terenkripsi. Kalau `SESSION_SECRET` bocor,
  token bisa didekripsi — jaga secret itu seperti password.
- Jangan commit `.env`, `data/users.json`, atau `fly.toml` berisi secret
  ke Git. File-file itu sudah ada di `.gitignore`.
- `/logout` menghapus semua data login + wishlist kamu dari bot.
- Bot ini memakai endpoint tidak resmi. Riot bisa mengubah / memblokirnya
  sewaktu-waktu, dan akun bisa berisiko kalau dipakai sembarangan.
  Pakai akun utama dengan risiko sendiri, atau akun kedua kalau mau aman.

## Lisensi

MIT — bebas dipakai, diubah, dan dibagikan. Bukan produk resmi Riot Games.
Valorant adalah trademark Riot Games, Inc.
