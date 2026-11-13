import {
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  Partials,
  REST,
  Routes,
} from 'discord.js';
import { config } from './config';
import { commands, handleCommand } from './discord/commands';
import { handleLoginDm, isPending } from './discord/loginFlow';
import { getSkinCatalog } from './riot/store';
import { startScheduler } from './scheduler';

async function registerCommands(): Promise<void> {
  if (!config.clientId) {
    console.log('[shop-checker] DISCORD_CLIENT_ID kosong, skip register slash command.');
    return;
  }
  const rest = new REST({ version: '10' }).setToken(config.discordToken);
  if (config.guildId) {
    await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body: commands });
    console.log(`[shop-checker] Slash command terdaftar di guild ${config.guildId} (instan).`);
  } else {
    await rest.put(Routes.applicationCommands(config.clientId), { body: commands });
    console.log('[shop-checker] Slash command terdaftar global (bisa nunggu ~1 jam).');
  }
}

async function main(): Promise<void> {
  if (!config.discordToken) {
    console.error('[shop-checker] DISCORD_TOKEN belum diisi di .env — lihat .env.example');
    process.exit(1);
  }
  if (!config.sessionSecret) {
    console.error('[shop-checker] SESSION_SECRET belum diisi di .env — generate dengan: npm run gen-secret');
    process.exit(1);
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel],
  });

  client.once(Events.ClientReady, (c) => {
    console.log(`[shop-checker] Login sebagai ${c.user.tag}`);
    console.log('[shop-checker] Bot private — invite hanya ke server kamu + teman.');
    // Panaskan cache katalog skin di background, biar /shop pertama
    // setelah restart tidak lama (katalognya 1400+ skin).
    getSkinCatalog().catch((err) => console.log('[shop-checker] gagal panaskan katalog:', err));
    startScheduler(client);
  });

  // Tanpa listener 'error', satu rejection yang lolos dari handler di atas
  // di-emit sebagai event 'error' di Client dan melempar (crash) proses
  // Node — persis yang terjadi 2026-11-13 18:47 WIB: deferReply gagal
  // Unknown interaction (10062), lalu reply darurat di catch ikut gagal
  // dengan 10062 yang sama dan membunuh bot. Listener ini + try/catch di
  // bawah memastikan error interaction tidak pernah mematikan bot lagi.
  client.on(Events.Error, (err) => {
    console.error('[shop-checker] client error:', err);
  });
  client.on(Events.ShardError, (err) => {
    console.error('[shop-checker] shard error:', err);
  });
  process.on('unhandledRejection', (err) => {
    console.error('[shop-checker] unhandled rejection (bot tetap jalan):', err);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    try {
      await handleCommand(interaction, client);
    } catch (err) {
      console.error('[shop-checker] command error:', err);
      // Balasan darurat ini TIDAK BOLEH throw lagi: kalau interaction-nya
      // sudah kedaluwarsa (Unknown interaction 10062, misal command dikirim
      // pas bot lagi restart), reply/editReply ikut gagal — dan rejection
      // itu yang sebelumnya men-crash bot. Abaikan saja; user tinggal
      // ketik command-nya ulang.
      const msg = 'Waduh, botnya error. Coba lagi bentar lagi ya.';
      try {
        if (interaction.deferred) await interaction.editReply(msg);
        else if (!interaction.replied) await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
      } catch {
        // Interaction sudah kedaluwarsa / tidak bisa dibalas — bukan error baru.
      }
    }
  });

  // DM login flow: /login -> paste cookie ssid -> selesai (tanpa password)
  client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;
    if (message.guildId !== null) return; // hanya DM
    if (!isPending(message.author.id)) return;
    const reply = await handleLoginDm(message.author.id, message.content);
    if (reply) {
      // Hapus pesan user yang berisi cookie ssid kalau bisa, lalu balas.
      // Di DM, hapus mungkin gagal tergantung permission — abaikan kalau gagal.
      await message.delete().catch(() => undefined);
      await message.author.send(reply).catch(() => undefined);
    }
  });

  await registerCommands();
  await client.login(config.discordToken);
}

main().catch((err) => {
  console.error('[shop-checker] fatal:', err);
  process.exit(1);
});
