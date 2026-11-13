import { promises as fs } from 'fs';
import path from 'path';
import { config } from './config';

export interface UserRecord {
  discordId: string;
  puuid: string;
  riotName: string;
  tag: string;
  shard: string;
  /** Token Riot terenkripsi (AES-256-GCM). Password TIDAK pernah disimpan. */
  encAccessToken: string;
  encEntitlement: string;
  encCookies: string; // JSON string cookies, terenkripsi — buat refresh tanpa password
  accessTokenExpiresAt: number; // epoch ms
  wishlist: string[];
  createdAt: number;
  lastCheckedAt?: number;
}

function filePath(): string {
  return path.join(config.dataDir, 'users.json');
}

export async function loadUsers(): Promise<UserRecord[]> {
  try {
    const raw = await fs.readFile(filePath(), 'utf8');
    const parsed = JSON.parse(raw) as UserRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveUsers(users: UserRecord[]): Promise<void> {
  await fs.mkdir(config.dataDir, { recursive: true });
  const tmp = `${filePath()}.tmp-${process.pid}`;
  await fs.writeFile(tmp, JSON.stringify(users, null, 2), 'utf8');
  await fs.rename(tmp, filePath());
}

export async function getUser(discordId: string): Promise<UserRecord | undefined> {
  return (await loadUsers()).find((u) => u.discordId === discordId);
}

export async function upsertUser(user: UserRecord): Promise<void> {
  const users = await loadUsers();
  const idx = users.findIndex((u) => u.discordId === user.discordId);
  if (idx >= 0) users[idx] = user;
  else users.push(user);
  await saveUsers(users);
}

export async function deleteUser(discordId: string): Promise<void> {
  await saveUsers((await loadUsers()).filter((u) => u.discordId !== discordId));
}
