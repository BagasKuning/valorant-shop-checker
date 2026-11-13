import 'dotenv/config';

export const config = {
  discordToken: process.env.DISCORD_TOKEN ?? '',
  clientId: process.env.DISCORD_CLIENT_ID ?? '',
  guildId: process.env.DISCORD_GUILD_ID ?? '',
  sessionSecret: process.env.SESSION_SECRET ?? '',
  defaultShard: process.env.DEFAULT_SHARD ?? 'ap',
  checkHourWib: Number(process.env.CHECK_HOUR_WIB ?? 7),
  checkMinuteWib: Number(process.env.CHECK_MINUTE_WIB ?? 5),
  dataDir: process.env.DATA_DIR ?? './data',
};

export const VP_CURRENCY_ID = '85ad13f7-3d1b-5128-9eb2-7cd8ee0b5741';
export const RIOT_CLIENT_PLATFORM_B64 =
  'ew0KCSJwbGF0Zm9ybVR5cGUiOiAiUEMiLA0KCSJwbGF0Zm9ybU9TIjogIldpbmRvd3MiLA0KCSJwbGF0Zm9ybU9TVmVyc2lvbiI6ICIxMC4wLjE5MDQyLjEuMjU2LjY0Yml0IiwNCgkicGxhdGZvcm1DaGlwc2V0IjogIlVua25vd24iDQp9';
