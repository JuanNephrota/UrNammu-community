import test from "node:test";
import assert from "node:assert/strict";
import {
  decryptSettingValue,
  encryptSettingValue,
  isEncryptedValue,
} from "./settings-crypto";

test("secret settings are encrypted and can be decrypted", () => {
  process.env.SETTINGS_ENCRYPTION_KEY = "test-secret-key";

  const encrypted = encryptSettingValue("openai_admin_key", "sk-admin-123");
  assert.equal(isEncryptedValue(encrypted), true);
  assert.notEqual(encrypted, "sk-admin-123");
  assert.equal(decryptSettingValue("openai_admin_key", encrypted), "sk-admin-123");
});

test("non-secret settings pass through unchanged", () => {
  const value = encryptSettingValue("google_scan_enabled", "true");
  assert.equal(value, "true");
  assert.equal(decryptSettingValue("google_scan_enabled", value), "true");
});
