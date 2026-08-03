import { app, safeStorage } from "electron";
import fs from "fs";
import path from "path";

export type ProviderKey = "openai" | "anthropic";

const KEY_FILE = "api-keys.json";

function getKeyPath(): string {
  return path.join(app.getPath("userData"), KEY_FILE);
}

function loadKeys(): Record<string, string> {
  try {
    const p = getKeyPath();
    if (!fs.existsSync(p)) return {};
    const data = JSON.parse(fs.readFileSync(p, "utf8"));
    return typeof data === "object" && data ? data : {};
  } catch {
    return {};
  }
}

function saveKeys(keys: Record<string, string>): void {
  const p = getKeyPath();
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(p, JSON.stringify(keys, null, 2), "utf8");
}

function encrypt(value: string): string {
  if (!safeStorage.isEncryptionAvailable()) return value;
  return safeStorage.encryptString(value).toString("base64");
}

function decrypt(value: string): string {
  if (!safeStorage.isEncryptionAvailable()) return value;
  return safeStorage.decryptString(Buffer.from(value, "base64"));
}

export async function storeApiKey(provider: ProviderKey, apiKey: string): Promise<void> {
  const keys = loadKeys();
  keys[provider] = encrypt(apiKey);
  saveKeys(keys);
}

export async function getApiKey(provider: ProviderKey): Promise<string | null> {
  const keys = loadKeys();
  const value = keys[provider];
  if (!value) return null;
  return decrypt(value);
}

export async function deleteApiKey(provider: ProviderKey): Promise<boolean> {
  const keys = loadKeys();
  if (!keys[provider]) return false;
  delete keys[provider];
  saveKeys(keys);
  return true;
}

export async function hasApiKey(provider: ProviderKey): Promise<boolean> {
  return (await getApiKey(provider)) !== null;
}

export function validateApiKeyFormat(provider: ProviderKey, apiKey: string): boolean {
  if (provider === "openai") return /^sk-[A-Za-z0-9]{20,}$/.test(apiKey);
  if (provider === "anthropic") return /^sk-ant-[A-Za-z0-9-_]{20,}$/.test(apiKey);
  return false;
}

export function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 8) return "****";
  return `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`;
}
