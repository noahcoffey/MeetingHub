import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";

// Symmetric encryption for secrets at rest (Google refresh tokens). AES-256-GCM
// with a key derived from AUTH_SECRET, so no extra key management. Payload format
// is `iv.tag.ciphertext`, each base64. AUTH_SECRET is always set in any real
// deployment; rotating it invalidates stored ciphertexts (accounts re-connect).
const ALGO = "aes-256-gcm";

function deriveKey(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set");
  // Fixed salt is fine — the entropy is AUTH_SECRET; scrypt just stretches it to 32 bytes.
  return scryptSync(secret, "meetinghub-secret-enc-v1", 32);
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, deriveKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    iv.toString("base64"),
    tag.toString("base64"),
    enc.toString("base64"),
  ].join(".");
}

export function decryptSecret(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(".");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("malformed ciphertext");
  }
  const decipher = createDecipheriv(ALGO, deriveKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
