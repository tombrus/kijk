import { readFile, writeFile, mkdir } from "node:fs/promises";

const wrapperPath = "src/wrapper.html";
const payloadPath = "encrypted/payload.enc";
const outputPath  = "dist/index.html";

const wrapper = await readFile(wrapperPath, "utf8");
const payload = await readFile(payloadPath, "utf8");

const html = wrapper.replace("{{PAYLOAD}}", payload.trim());

await mkdir("dist", { recursive: true });
await writeFile(outputPath, html, "utf8");
console.log(`Built ${outputPath}`);
