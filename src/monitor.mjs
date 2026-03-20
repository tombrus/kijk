import { readFile, writeFile }             from "node:fs/promises";
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

let password = "";
try {
  const info = JSON.parse(await readFile("secrets/info.json", "utf8"));
  password   = info["master-key"];
} catch {
  password = await askPassword();
}
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

const secureRe     = /^\[secure:(.+)]$/;
const obfuscatedRe = /^\[obfuscated:(.+)]$/;
const entryRe      = /^(.+?)\s*\|\s*(.+?)\s*\|\s*IP:\s*(.+?)\s*\|\s*UA:\s*(.+)$/;

function parseEntry(plaintext) {
  const m = plaintext.match(entryRe);
  if (m) {
    return { event: m[1], date: m[2], ip: m[3], ua: m[4] };
  }
  return null;
}

function formatDate(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return iso;
  }
  const pad  = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const rows = [];

for (const comment of comments) {
  const body            = comment.body.trim();
  const secureMatch     = body.match(secureRe);
  const obfuscatedMatch = body.match(obfuscatedRe);
  let tier              = "";
  let plaintext         = "";

  if (secureMatch) {
    tier = "SECURE";
    try {
      plaintext = decryptEntry(secureMatch[1], contentKey);
    } catch {
      plaintext = null;
    }
  } else if (obfuscatedMatch) {
    tier = "OBFUSC";
    if (monitorKey) {
      try {
        plaintext = decryptEntry(obfuscatedMatch[1], monitorKey);
      } catch {
        plaintext = null;
      }
    } else {
      plaintext = null;
    }
  } else {
    tier      = "PLAIN";
    plaintext = body;
  }

  if (plaintext === null) {
    rows.push({ tier, event: "<decryption failed>", date: "", ip: "", ua: "" });
  } else {
    const parsed = parseEntry(plaintext);
    if (parsed) {
      rows.push({ tier, event: parsed.event, date: formatDate(parsed.date), ip: parsed.ip, ua: parsed.ua });
    } else {
      rows.push({ tier, event: plaintext, date: "", ip: "", ua: "" });
    }
  }
}

const colW = {
  tier:  Math.max(4,  ...rows.map((r) => r.tier.length)),
  event: Math.max(5,  ...rows.map((r) => r.event.length)),
  date:  Math.max(4,  ...rows.map((r) => r.date.length)),
  ip:    Math.max(2,  ...rows.map((r) => r.ip.length)),
};

const header = [
  "TIER".padEnd(colW.tier),
  "EVENT".padEnd(colW.event),
  "DATE".padEnd(colW.date),
  "IP".padEnd(colW.ip),
  "UA",
].join("  ");

const separator = [
  "─".repeat(colW.tier),
  "─".repeat(colW.event),
  "─".repeat(colW.date),
  "─".repeat(colW.ip),
  "──",
].join("──");

console.log(`\n--- Access Log (${rows.length} entries) ---\n`);
console.log(header);
console.log(separator);

for (const row of rows) {
  const line = [
    row.tier.padEnd(colW.tier),
    row.event.padEnd(colW.event),
    row.date.padEnd(colW.date),
    row.ip.padEnd(colW.ip),
    row.ua,
  ].join("  ");
  console.log(line);
}

console.log(`\n--- End ---`);

// Write markdown report to secrets/monitor.md
const mdLines = [];
mdLines.push(`# Access Log`);
mdLines.push(``);
mdLines.push(`Generated: ${new Date().toISOString()}`);
mdLines.push(``);
mdLines.push(`| Tier | Event | Date | IP | UA |`);
mdLines.push(`| --- | --- | --- | --- | --- |`);

for (const row of rows) {
  const tier  = row.tier  || "";
  const event = row.event || "";
  const date  = row.date  || "";
  const ip    = row.ip    || "";
  const ua    = row.ua    || "";
  mdLines.push(`| ${tier} | ${event} | ${date} | ${ip} | ${ua} |`);
}

mdLines.push(``);
mdLines.push(`${rows.length} entries total.`);
mdLines.push(``);

await writeFile("secrets/monitor.md", mdLines.join("\n"), "utf8");
console.log(`\nWritten to secrets/monitor.md`);
