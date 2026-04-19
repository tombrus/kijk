import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";

const wrapperPath = "src/wrapper.html";
const payloadPath = "encrypted/payload.enc";
const outputPath  = "dist/index.html";
const versionPath = "dist/version.txt";
const monKeyPath  = "encrypted/monitor.key";
const monDataPath = "encrypted/monitor.enc";
const titlePath   = "encrypted/title.txt";

const wrapper = await readFile(wrapperPath, "utf8");
const payload = await readFile(payloadPath, "utf8");

let monitorKey  = "";
let monitorData = "";
let title       = "Kijk";

try {
  monitorKey  = (await readFile(monKeyPath, "utf8")).trim();
  monitorData = (await readFile(monDataPath, "utf8")).trim();
  console.log("Monitoring enabled (read from encrypted/)");
} catch {
  console.log("Monitoring disabled (encrypted/monitor.key or monitor.enc not found)");
}

try {
  title = (await readFile(titlePath, "utf8")).trim();
} catch {
  console.log("No title found, using default");
}

let html = wrapper.replace("{{PAYLOAD}}", payload.trim());
html     = html.replace("{{MONITOR_KEY}}", monitorKey);
html     = html.replace("{{MONITOR_DATA}}", monitorData);
html     = html.replaceAll("{{TITLE}}", title);

const buildDate = new Date().toISOString().slice(0, 10);
html            = html.replaceAll("{{BUILD_DATE}}", buildDate);

const buildHash = createHash("sha256").update(html).digest("hex").slice(0, 8);
html            = html.replaceAll("{{BUILD_HASH}}", buildHash);

await mkdir("dist", { recursive: true });
await writeFile(outputPath, html, "utf8");
await writeFile(versionPath, buildHash + "\n", "utf8");
console.log(`Built ${outputPath} (hash: ${buildHash})`);
