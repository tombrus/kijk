import { readFile, writeFile } from "node:fs/promises";
import { randomBytes, pbkdf2, createCipheriv } from "node:crypto";

const PBKDF2_ITERATIONS = 600_000;
const SALT_LENGTH       = 16;
const IV_LENGTH         = 12;

function deriveKey(password, salt) {
  return new Promise((resolve, reject) => {
    pbkdf2(password, salt, PBKDF2_ITERATIONS, 32, "sha256", (err, key) => {
      if (err) {
        reject(err);
      } else {
        resolve(key);
      }
    });
  });
}

const infoPath   = "secrets/info.json";
const inputPath  = "secrets/page.html";
const outputPath = "encrypted/payload.enc";

const info      = JSON.parse(await readFile(infoPath, "utf8"));
const password  = info["master-key"];

if (!password) {
  console.error(`Error: ${infoPath} must contain 'master-key'`);
  process.exit(1);
}

const plaintext = await readFile(inputPath);

// Reuse existing salt so the content-derived key stays stable across
// re-encryptions (keeps monitor secure entries decryptable).
let salt;
try {
  const existing    = await readFile(outputPath, "utf8");
  const existingBuf = Buffer.from(existing.trim(), "base64");
  salt              = existingBuf.subarray(0, SALT_LENGTH);
  console.log("Reusing salt from existing payload");
} catch {
  salt = randomBytes(SALT_LENGTH);
  console.log("Generated new salt");
}
const iv = randomBytes(IV_LENGTH);
const key  = await deriveKey(password, salt);

const cipher     = createCipheriv("aes-256-gcm", key, iv);
const encrypted  = Buffer.concat([cipher.update(plaintext), cipher.final()]);
const authTag    = cipher.getAuthTag();
const combined   = Buffer.concat([salt, iv, encrypted, authTag]);
const base64     = combined.toString("base64");

await writeFile(outputPath, base64, "utf8");
console.log(`Encrypted ${plaintext.length} bytes → ${outputPath}`);
