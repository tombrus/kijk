import { readFile }                        from "node:fs/promises";
import { createInterface }                 from "node:readline";
import { pbkdf2, createDecipheriv }        from "node:crypto";

const PBKDF2_ITERATIONS = 600_000;

const monKeyPath  = "encrypted/monitor.key";
const monDataPath = "encrypted/monitor.enc";
const payloadPath = "encrypted/payload.enc";

// Load and decrypt monitor config (API URL + PAT)
let monitorKeyB64 = "";
let monitorConfig = null;

try {
  monitorKeyB64       = (await readFile(monKeyPath, "utf8")).trim();
  const monitorDataB64 = (await readFile(monDataPath, "utf8")).trim();

  const keyBuf     = Buffer.from(monitorKeyB64, "base64");
  const dataBuf    = Buffer.from(monitorDataB64, "base64");
  const iv         = dataBuf.subarray(0, 12);
  const authTag    = dataBuf.subarray(dataBuf.length - 16);
  const ciphertext = dataBuf.subarray(12, dataBuf.length - 16);

  const decipher = createDecipheriv("aes-256-gcm", keyBuf, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  monitorConfig   = JSON.parse(decrypted.toString("utf8"));
} catch (err) {
  console.error(`Error: cannot read monitor config from encrypted/monitor.key + monitor.enc`);
  console.error(`Run ./prepare.sh first to generate these files.`);
  process.exit(1);
}

// Load payload to extract salt for content-derived key
const payloadB64 = (await readFile(payloadPath, "utf8")).trim();
const payloadRaw = Buffer.from(payloadB64, "base64");
const salt       = payloadRaw.subarray(0, 16);

// Ask for content password
function askPassword() {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question("Content password: ", (answer) => {
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

function decryptEntry(b64Data, keyBuffer) {
  const raw        = Buffer.from(b64Data, "base64");
  const iv         = raw.subarray(0, 12);
  const authTag    = raw.subarray(raw.length - 16);
  const ciphertext = raw.subarray(12, raw.length - 16);

  const decipher = createDecipheriv("aes-256-gcm", keyBuffer, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString("utf8");
}

const password   = await askPassword();
const contentKey = await deriveKey(password, salt);

const monitorKey = monitorKeyB64 ? Buffer.from(monitorKeyB64, "base64") : null;

// Fetch all comments from the issue
// noinspection JSObjectNullOrUndefined
const apiUrl = monitorConfig.url;
const token  = monitorConfig.token;
let page     = 1;
let comments = [];

while (true) {
  const resp = await fetch(`${apiUrl}?per_page=100&page=${page}`, {
    headers: {
      "Authorization": `token ${token}`,
      "Accept": "application/vnd.github+json",
    },
  });
  if (!resp.ok) {
    console.error(`GitHub API error: ${resp.status} ${resp.statusText}`);
    process.exit(1);
  }
  const batch = await resp.json();
  if (batch.length === 0) {
    break;
  }
  comments = comments.concat(batch);
  page++;
}

console.log(`\n--- Access Log (${comments.length} entries) ---\n`);

const secureRe     = /^\[secure:(.+)]$/;
const obfuscatedRe = /^\[obfuscated:(.+)]$/;

for (const comment of comments) {
  const body            = comment.body.trim();
  const secureMatch     = body.match(secureRe);
  const obfuscatedMatch = body.match(obfuscatedRe);

  if (secureMatch) {
    try {
      const plaintext = decryptEntry(secureMatch[1], contentKey);
      console.log(`[SECURE]     ${plaintext}`);
    } catch {
      console.log(`[SECURE]     <decryption failed — wrong password?>`);
    }
  } else if (obfuscatedMatch) {
    if (monitorKey) {
      try {
        const plaintext = decryptEntry(obfuscatedMatch[1], monitorKey);
        console.log(`[OBFUSCATED] ${plaintext}`);
      } catch {
        console.log(`[OBFUSCATED] <decryption failed>`);
      }
    } else {
      console.log(`[OBFUSCATED] <no monitor key available>`);
    }
  } else {
    console.log(`[PLAIN]      ${body}`);
  }
}

console.log(`\n--- End ---`);
