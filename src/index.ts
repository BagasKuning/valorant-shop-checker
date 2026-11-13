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
    startScheduler(client);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    try {
      await handleCommand(interaction, client);
    } catch (err) {
      console.error('[shop-checker] command error:', err);
      const msg = 'Waduh, botnya error. Coba lagi bentar lagi ya.';
      if (interaction.deferred) await interaction.editReply(msg);
      else if (!interaction.replied) await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
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
