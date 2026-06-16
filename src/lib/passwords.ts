import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
  return `${salt}:${derivedKey.toString("hex")}`;
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  const [salt, expectedHex] = passwordHash.split(":");
  if (!salt || !expectedHex) return false;

  const derivedKey = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
  const expected = Buffer.from(expectedHex, "hex");

  if (derivedKey.length !== expected.length) return false;
  return timingSafeEqual(derivedKey, expected);
}
