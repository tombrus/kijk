import { readFile, writeFile } from "node:fs/promises";
import { createInterface }    from "node:readline";
import { randomBytes, pbkdf2, createCipheriv } from "node:crypto";

const PBKDF2_ITERATIONS = 600_000;
const SALT_LENGTH       = 16;
const IV_LENGTH         = 12;

function askPassword() {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question("Password: ", (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

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

const inputPath  = "secrets/page.html";
const outputPath = "encrypted/payload.enc";

const plaintext = await readFile(inputPath);
const password  = await askPassword();

const salt = randomBytes(SALT_LENGTH);
const iv   = randomBytes(IV_LENGTH);
const key  = await deriveKey(password, salt);

const cipher     = createCipheriv("aes-256-gcm", key, iv);
const encrypted  = Buffer.concat([cipher.update(plaintext), cipher.final()]);
const authTag    = cipher.getAuthTag();
const combined   = Buffer.concat([salt, iv, encrypted, authTag]);
const base64     = combined.toString("base64");

await writeFile(outputPath, base64, "utf8");
console.log(`Encrypted ${plaintext.length} bytes → ${outputPath}`);
