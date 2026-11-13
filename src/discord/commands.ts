import {
  EmbedBuilder,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Client,
} from 'discord.js';
import { configCheckLabel, fetchShop, formatDuration, matchesWishlist, shardLabel } from '../riot/store';
import { deleteUser, getUser, loadUsers, upsertUser } from '../storage';
import { startLogin } from './loginFlow';

export const commands = [
  new SlashCommandBuilder()
    .setName('login')
    .setDescription('Login Riot sekali (lewat DM) — abis itu tidak perlu login lagi'),
  new SlashCommandBuilder()
    .setName('shop')
    .setDescription('Lihat daily shop + night market kamu hari ini'),
  new SlashCommandBuilder()
    .setName('wishlist')
    .setDescription('Atur skin incaran kamu')
    .addSubcommand((s) =>
      s.setName('add').setDescription('Tambah skin ke wishlist').addStringOption((o) => o.setName('skin').setDescription('Nama skin, misal Reaver Vandal').setRequired(true)),
    )
    .addSubcommand((s) => s.setName('list').setDescription('Lihat wishlist kamu'))
    .addSubcommand((s) =>
      s.setName('remove').setDescription('Hapus skin dari wishlist').addStringOption((o) => o.setName('skin').setDescription('Nama skin').setRequired(true)),
    ),
  new SlashCommandBuilder()
    .setName('logout')
    .setDescription('Hapus login Riot kamu dari bot ini'),
  new SlashCommandBuilder().setName('help').setDescription('Cara pakai bot Valorant Shop Checker'),
].map((c) => c.toJSON());

function shopEmbed(riotName: string, tag: string, shop: Awaited<ReturnType<typeof fetchShop>>): EmbedBuilder | null {
  if ('error' in shop) return null;
  const embed = new EmbedBuilder()
    .setTitle(`Daily Shop — ${riotName}#${tag}`)
    .setColor(0xff4655)
    .setDescription(
      shop.shop.items.length === 0
        ? 'Shop hari ini kosong / tidak bisa dibaca. Coba lagi sebentar lagi.'
        : shop.shop.items
            .map((it, i) => `${i + 1}. **${it.name}** — ${it.vp !== null ? `${it.vp} VP` : 'harga tidak tersedia'}`)
            .join('\n'),
    )
    .setFooter({ text: `Reset dalam ${formatDuration(shop.shop.secondsLeft)} • Cek tiap hari ${configCheckLabel()} buat wishlist` });
  if (shop.shop.nightMarket.length > 0) {
    embed.addFields({
      name: 'Night Market',
      value: shop.shop.nightMarket
        .map((it) => `• **${it.name}** — ${it.discountVp !== null ? `${it.discountVp} VP (diskon)` : it.vp !== null ? `${it.vp} VP` : '?'}`)
        .join('\n'),
    });
  }
  const firstIcon = shop.shop.items[0]?.icon;
  if (firstIcon) embed.setThumbnail(firstIcon);
  return embed;
}

export async function handleCommand(
  interaction: ChatInputCommandInteraction,
  client: Client,
): Promise<void> {
  const userId = interaction.user.id;

  switch (interaction.commandName) {
    case 'login': {
      const existing = await getUser(userId);
      if (existing) {
        await interaction.reply({
          content: `Kamu sudah login sebagai **${existing.riotName}#${existing.tag}**. Pakai \`/shop\` aja, atau \`/logout\` dulu kalau mau ganti akun.`,
          ephemeral: true,
        });
        return;
      }
      startLogin(userId);
      await interaction.reply({
        content:
          'Oke, cek **DM** kamu. Aku sudah kirim langkah login di sana.\n' +
          'Login cuma sekali — abis itu kamu tinggal `/shop` dari HP kapan aja.',
        ephemeral: true,
      });
      try {
        await interaction.user.send(
          'Halo! Buat login Riot, ketik dulu **username Riot** kamu di DM ini.\n' +
          'Jangan kirim password di server / channel umum — hanya di DM ini.',
        );
      } catch {
        await interaction.followUp({
          content: 'Aku tidak bisa DM kamu. Buka Settings Discord > Privacy > Allow direct messages, lalu coba `/login` lagi.',
          ephemeral: true,
        });
      }
      return;
    }
    case 'shop': {
      await interaction.deferReply({ ephemeral: true });
      const user = await getUser(userId);
      if (!user) {
        await interaction.editReply('Kamu belum login. Ketik `/login` dulu (cuma sekali).');
        return;
      }
      try {
        const result = await fetchShop(user);
        if ('error' in result) {
          await interaction.editReply('Sesi Riot kamu sudah habis. Ketik `/login` lagi ya (cuma sekali).');
          return;
        }
        const embed = shopEmbed(user.riotName, user.tag, result);
        if (!embed) {
          await interaction.editReply('Shop tidak bisa dibaca. Coba lagi sebentar lagi.');
          return;
        }
        await interaction.editReply({ embeds: [embed] });
      } catch (err) {
        await interaction.editReply(`Gagal ambil shop: ${(err as Error).message}`);
      }
      return;
    }
    case 'wishlist': {
      const sub = interaction.options.getSubcommand();
      const user = await getUser(userId);
      if (!user) {
        await interaction.reply({ content: 'Kamu belum login. Ketik `/login` dulu.', ephemeral: true });
        return;
      }
      if (sub === 'list') {
        await interaction.reply({
          content:
            user.wishlist.length === 0
              ? 'Wishlist kamu masih kosong. Tambah dengan `/wishlist add <nama skin>`, misal `/wishlist add Reaver Vandal`.'
              : `Wishlist kamu:\n${user.wishlist.map((w, i) => `${i + 1}. ${w}`).join('\n')}\n\nBot akan DM kamu tiap pagi ${configCheckLabel()} kalau ada yang muncul di shop.`,
          ephemeral: true,
        });
        return;
      }
      const skin = (interaction.options.getString('skin') ?? '').trim();
      if (!skin) {
        await interaction.reply({ content: 'Nama skin-nya kosong.', ephemeral: true });
        return;
      }
      if (sub === 'add') {
        if (user.wishlist.some((w) => w.toLowerCase() === skin.toLowerCase())) {
          await interaction.reply({ content: `"${skin}" sudah ada di wishlist kamu.`, ephemeral: true });
          return;
        }
        user.wishlist.push(skin);
        await upsertUser(user);
        await interaction.reply({ content: `Ditambahkan ke wishlist: **${skin}**. Bot akan DM kamu kalau skin ini muncul di shop.`, ephemeral: true });
        return;
      }
      // remove
      const before = user.wishlist.length;
      user.wishlist = user.wishlist.filter((w) => w.toLowerCase() !== skin.toLowerCase());
      if (user.wishlist.length === before) {
        await interaction.reply({ content: `"${skin}" tidak ada di wishlist kamu.`, ephemeral: true });
        return;
      }
      await upsertUser(user);
      await interaction.reply({ content: `Dihapus dari wishlist: **${skin}**.`, ephemeral: true });
      return;
    }
    case 'logout': {
      await deleteUser(userId);
      await interaction.reply({ content: 'Logout berhasil. Login Riot dan wishlist kamu sudah dihapus dari bot ini.', ephemeral: true });
      return;
    }
    case 'help': {
      await interaction.reply({
        content: [
          '**Valorant Shop Checker — buat kamu + teman, cek dari HP**',
          '',
          '`/login` — login Riot sekali lewat DM (password tidak disimpan)',
          '`/shop` — lihat daily shop + night market kamu hari ini (hanya kamu yang bisa lihat)',
          '`/wishlist add <skin>` — misal `/wishlist add Reaver Vandal`',
          '`/wishlist list` — lihat wishlist kamu',
          '`/wishlist remove <skin>` — hapus dari wishlist',
          '`/logout` — hapus login kamu dari bot',
          '',
          `Bot cek wishlist tiap pagi ${configCheckLabel()} dan DM kamu kalau skin incaran muncul.`,
          'Bot ini private, hanya untuk server kamu + teman. Jangan share token / SESSION_SECRET ke siapa pun.',
        ].join('\n'),
        ephemeral: true,
      });
      return;
    }
    default:
      await interaction.reply({ content: 'Perintah tidak dikenal.', ephemeral: true });
  }
}

/** Dipakai scheduler buat DM user kalau wishlist-nya muncul. */
export async function checkAllWishlists(client: Client): Promise<string[]> {
  const users = await loadUsers();
  const notified: string[] = [];
  for (const user of users) {
    if (user.wishlist.length === 0) continue;
    try {
      const result = await fetchShop(user);
      if ('error' in result) continue;
      const all = [...result.shop.items, ...result.shop.nightMarket];
      const hits = all
        .map((it) => ({ item: it, wish: matchesWishlist(it.name, user.wishlist) }))
        .filter((h) => h.wish);
      if (hits.length === 0) continue;
      const discordUser = await client.users.fetch(user.discordId).catch(() => null);
      if (!discordUser) continue;
      await discordUser.send(
        `Woy, skin incaran kamu muncul di shop hari ini!\n` +
          hits.map((h) => `• **${h.item.name}** — ${h.item.vp !== null ? `${h.item.vp} VP` : '?'}`).join('\n') +
          `\nCek lengkapnya dengan \`/shop\`. Shop reset dalam ${formatDuration(result.shop.secondsLeft)}.`,
      );
      notified.push(user.discordId);
    } catch (err) {
      console.error(`[shop-checker] wishlist check gagal untuk ${user.discordId}:`, err);
    }
  }
  return notified;
}

export function shardLabelFor(user: { shard: string }): string {
  return shardLabel(user.shard);
}
