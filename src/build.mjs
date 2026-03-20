import { readFile, writeFile, mkdir } from "node:fs/promises";

const wrapperPath = "src/wrapper.html";
const payloadPath = "encrypted/payload.enc";
const outputPath  = "dist/index.html";
const monKeyPath  = "encrypted/monitor.key";
const monDataPath = "encrypted/monitor.enc";

const wrapper = await readFile(wrapperPath, "utf8");
const payload = await readFile(payloadPath, "utf8");

let monitorKey  = "";
let monitorData = "";

try {
  monitorKey  = (await readFile(monKeyPath, "utf8")).trim();
  monitorData = (await readFile(monDataPath, "utf8")).trim();
  console.log("Monitoring enabled (read from encrypted/)");
} catch {
  console.log("Monitoring disabled (encrypted/monitor.key or monitor.enc not found)");
}

let html = wrapper.replace("{{PAYLOAD}}", payload.trim());
html     = html.replace("{{MONITOR_KEY}}", monitorKey);
html     = html.replace("{{MONITOR_DATA}}", monitorData);

await mkdir("dist", { recursive: true });
await writeFile(outputPath, html, "utf8");
console.log(`Built ${outputPath}`);
