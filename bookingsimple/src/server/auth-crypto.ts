import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
const SCRYPT_N = 32_768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_LENGTH = 64;

function scrypt(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: { N: number; r: number; p: number; maxmem: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keyLength, options, (error, derived) => {
      if (error) {
        reject(error);
      } else {
        resolve(derived);
      }
    });
  });
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function accountPartition(email: string): string {
  return `account_${sha256(normalizeEmail(email))}`;
}

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, SCRYPT_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 64 * 1024 * 1024,
  });
  return [
    "scrypt",
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString("base64url"),
    derived.toString("base64url"),
  ].join("$");
}

export async function verifyPassword(
  password: string,
  encoded: string,
): Promise<boolean> {
  const [algorithm, nText, rText, pText, saltText, hashText, extra] =
    encoded.split("$");
  if (
    algorithm !== "scrypt" ||
    nText !== String(SCRYPT_N) ||
    rText !== String(SCRYPT_R) ||
    pText !== String(SCRYPT_P) ||
    !saltText ||
    !hashText ||
    extra !== undefined
  ) {
    return false;
  }

  try {
    const salt = Buffer.from(saltText, "base64url");
    const expected = Buffer.from(hashText, "base64url");
    if (salt.length !== 16 || expected.length !== SCRYPT_LENGTH) {
      return false;
    }
    const actual = await scrypt(password, salt, SCRYPT_LENGTH, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
      maxmem: 64 * 1024 * 1024,
    });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function secureEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

function encryptionKey(environmentName: string): Buffer {
  const configured = process.env[environmentName];
  if (!configured) {
    throw new Error(`Missing required environment variable: ${environmentName}`);
  }
  const key = Buffer.from(configured, "base64");
  if (key.length !== 32 || key.toString("base64") !== configured) {
    throw new Error(`${environmentName} must be a base64-encoded 32-byte key.`);
  }
  return key;
}

export function encryptJson(value: unknown, environmentName: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    encryptionKey(environmentName),
    iv,
  );
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return [
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptJson<T>(
  encrypted: string,
  environmentName: string,
): T {
  const [ivText, tagText, ciphertextText, extra] = encrypted.split(".");
  if (!ivText || !tagText || !ciphertextText || extra !== undefined) {
    throw new Error("Encrypted data is invalid.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(environmentName),
    Buffer.from(ivText, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextText, "base64url")),
    decipher.final(),
  ]).toString("utf8");
  return JSON.parse(plaintext) as T;
}

export type SessionTokenParts = {
  accountKey: string;
  sessionId: string;
  token: string;
};

export function parseSessionToken(value: string): SessionTokenParts | null {
  if (value.length > 200) {
    return null;
  }
  const match = /^(account_[a-f0-9]{64})\.([a-f0-9]{32})\.([A-Za-z0-9_-]{43})$/.exec(
    value,
  );
  if (!match) {
    return null;
  }
  return { accountKey: match[1], sessionId: match[2], token: value };
}
