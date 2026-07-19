import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";

export function vaultDir(): string {
  return (
    process.env.FOUNDRY_HOME ||
    process.env.RELAY_MEMORY_DIR ||
    path.join(homedir(), ".foundry")
  );
}

function vaultPath(): string {
  return path.join(vaultDir(), "secrets.enc.json");
}

function machineKey(): Buffer {
  // Derive a machine-local key. Not perfect HSM security, but better than plaintext .env.
  const material = [
    process.env.FOUNDRY_SECRET_KEY || "",
    homedir(),
    process.platform,
    process.arch,
    "foundry-v1",
  ].join("|");
  return createHash("sha256").update(material).digest();
}

function encrypt(plaintext: string): string {
  const key = machineKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

function decrypt(payload: string): string {
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", machineKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

export type SecretMap = Record<string, string>;

export async function loadSecrets(): Promise<SecretMap> {
  try {
    const raw = await readFile(vaultPath(), "utf8");
    const parsed = JSON.parse(raw) as { v: number; data: string };
    if (parsed.v !== 1 || !parsed.data) return {};
    return JSON.parse(decrypt(parsed.data)) as SecretMap;
  } catch {
    return {};
  }
}

export async function saveSecrets(secrets: SecretMap): Promise<void> {
  await mkdir(vaultDir(), { recursive: true });
  const payload = {
    v: 1,
    data: encrypt(JSON.stringify(secrets)),
    updatedAt: new Date().toISOString(),
  };
  const file = vaultPath();
  await writeFile(file, JSON.stringify(payload, null, 2), "utf8");
  try {
    await chmod(file, 0o600);
  } catch {
    // Windows may ignore chmod
  }
}

export async function setSecret(key: string, value: string): Promise<void> {
  const secrets = await loadSecrets();
  secrets[key] = value;
  await saveSecrets(secrets);
}

export async function getSecret(key: string): Promise<string | undefined> {
  const secrets = await loadSecrets();
  return secrets[key];
}

/** Prefer env, then locally encrypted credential file. */
export async function resolveApiKeys(): Promise<{
  openaiApiKey: string;
  cursorApiKey?: string;
  source: "env" | "vault" | "mixed" | "missing";
}> {
  const vault = await loadSecrets();
  const openaiApiKey = process.env.OPENAI_API_KEY || vault.OPENAI_API_KEY || "";
  const cursorApiKey = process.env.CURSOR_API_KEY || vault.CURSOR_API_KEY;
  let source: "env" | "vault" | "mixed" | "missing" = "missing";
  if (process.env.OPENAI_API_KEY && vault.OPENAI_API_KEY) source = "mixed";
  else if (process.env.OPENAI_API_KEY) source = "env";
  else if (vault.OPENAI_API_KEY) source = "vault";
  return { openaiApiKey, cursorApiKey, source };
}

/** Test helper — derive scrypt so we don't unused-import. */
export function derivePasswordKey(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, 32);
}
