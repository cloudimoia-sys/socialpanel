import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";
import { serverEnv } from "./env";

/**
 * Cifrado de credenciales BYOK (las API keys que trae cada cliente).
 *
 * AES-256-GCM. El tenant_id va como AAD, de forma que un ciphertext robado de
 * la fila de un tenant no puede descifrarse presentándolo como de otro.
 *
 * Formato: v1.<iv_b64>.<tag_b64>.<ciphertext_b64>
 */

const VERSION = "v1";

function masterKey(): Buffer {
  const key = Buffer.from(serverEnv().CREDENTIALS_ENCRYPTION_KEY, "base64");
  if (key.length !== 32) {
    throw new Error("CREDENTIALS_ENCRYPTION_KEY debe ser de 32 bytes en base64");
  }
  return key;
}

export function encryptSecret(plaintext: string, tenantId: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  cipher.setAAD(Buffer.from(tenantId, "utf8"));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(".");
}

export function decryptSecret(payload: string, tenantId: string): string {
  const [version, ivB64, tagB64, ctB64] = payload.split(".");
  if (version !== VERSION || !ivB64 || !tagB64 || !ctB64) {
    throw new Error("Formato de credencial inválido");
  }
  const decipher = createDecipheriv("aes-256-gcm", masterKey(), Buffer.from(ivB64, "base64"));
  decipher.setAAD(Buffer.from(tenantId, "utf8"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/** Los últimos 4 caracteres, para que el usuario reconozca la clave en la UI. */
export function hintFor(secret: string): string {
  return `••••${secret.slice(-4)}`;
}

/** Comparación en tiempo constante para tokens de webhook. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
