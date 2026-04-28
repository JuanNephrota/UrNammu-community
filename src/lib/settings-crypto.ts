import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

const ENCRYPTED_PREFIX = "enc:v1";

const SECRET_KEYS = new Set([
  "ai_api_key",
  "anthropic_admin_key",
  "google_service_account_key",
  "openai_admin_key",
  "proxy_secret",
]);

function getEncryptionKey(): Buffer | null {
  const raw = process.env.SETTINGS_ENCRYPTION_KEY;
  if (!raw) return null;
  return createHash("sha256").update(raw).digest();
}

export function isSecretSetting(key: string): boolean {
  return SECRET_KEYS.has(key) || key.endsWith("_secret") || key.endsWith("_key");
}

export function isEncryptedValue(value: string): boolean {
  return value.startsWith(`${ENCRYPTED_PREFIX}:`);
}

export function encryptSettingValue(key: string, value: string): string {
  if (!isSecretSetting(key)) return value;

  const encryptionKey = getEncryptionKey();
  if (!encryptionKey) {
    throw new Error(
      "Secret settings require SETTINGS_ENCRYPTION_KEY to be configured before they can be stored."
    );
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${ENCRYPTED_PREFIX}:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decryptSettingValue(key: string, value: string): string {
  if (!isSecretSetting(key) || !isEncryptedValue(value)) return value;

  const encryptionKey = getEncryptionKey();
  if (!encryptionKey) {
    throw new Error(
      `SETTINGS_ENCRYPTION_KEY is required to read the encrypted setting "${key}".`
    );
  }

  const [, version, ivB64, tagB64, encryptedB64] = value.split(":");
  if (version !== "v1" || !ivB64 || !tagB64 || !encryptedB64) {
    throw new Error(`Encrypted setting "${key}" has an invalid format.`);
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey,
    Buffer.from(ivB64, "base64")
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedB64, "base64")),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}
