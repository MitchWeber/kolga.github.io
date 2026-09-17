#!/usr/bin/env node
/**
 * Builds the password gate.
 *
 *   node tools/build.mjs            encrypt src/index.html into index.html
 *   node tools/build.mjs --unlock   decrypt index.html back into src/index.html
 *
 * The password comes from --password=…, from KOLGA_SITE_PASSWORD, or from a
 * prompt. It is never written to disk.
 *
 * src/index.html is the page you edit; index.html is generated and is the only
 * copy the site serves. Node's crypto is all this needs — no dependencies.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import crypto from "node:crypto";

// OWASP's floor for PBKDF2-HMAC-SHA256. It costs a visitor well under a second
// and costs anyone guessing the password a great deal more.
const ITERATIONS = 310000;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(root, "src", "index.html");
const TEMPLATE = path.join(root, "tools", "gate.html");
const OUTPUT = path.join(root, "index.html");

function deriveKey(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, ITERATIONS, 32, "sha256", (err, key) => {
      if (err) reject(err); else resolve(key);
    });
  });
}

async function encrypt(plaintext, password) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = await deriveKey(password, salt);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    v: 1,
    kdf: "PBKDF2-SHA256",
    iterations: ITERATIONS,
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    // WebCrypto expects the GCM tag appended to the ciphertext; Node keeps it apart.
    ciphertext: Buffer.concat([body, cipher.getAuthTag()]).toString("base64")
  };
}

async function decrypt(payload, password) {
  const salt = Buffer.from(payload.salt, "base64");
  const iv = Buffer.from(payload.iv, "base64");
  const blob = Buffer.from(payload.ciphertext, "base64");
  const body = blob.subarray(0, blob.length - 16);
  const tag = blob.subarray(blob.length - 16);
  const key = await deriveKey(password, salt);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  // A wrong password fails the tag check in final(), so this throws rather than
  // handing back plausible-looking rubbish.
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}

async function readPayload() {
  let html;
  try {
    html = await readFile(OUTPUT, "utf8");
  } catch {
    return null;
  }
  const match = /<script type="application\/json" id="payload">([\s\S]*?)<\/script>/.exec(html);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

async function askPassword(prompt) {
  const env = process.env.KOLGA_SITE_PASSWORD;
  if (env) return env;
  const flag = process.argv.find((a) => a.startsWith("--password="));
  if (flag) return flag.slice("--password=".length);

  if (!process.stdin.isTTY) {
    // Supports `echo hunter2 | node tools/build.mjs`.
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const piped = Buffer.concat(chunks).toString("utf8").split("\n")[0].trim();
    if (piped) return piped;
    throw new Error("no password on stdin");
  }

  // Read it without echoing to the terminal.
  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  let value = "";
  for await (const chunk of process.stdin) {
    const key = chunk.toString("utf8");
    if (key === "\r" || key === "\n" || key === "") break;
    if (key === "") { process.stdout.write("\n"); process.exit(130); }
    if (key === "" || key === "\b") { value = value.slice(0, -1); continue; }
    value += key;
  }
  process.stdin.setRawMode(false);
  process.stdin.pause();
  process.stdout.write("\n");
  return value;
}

async function build() {
  const password = await askPassword("Site password: ");
  if (!password) throw new Error("a password is required");

  const source = await readFile(SOURCE, "utf8");
  const template = await readFile(TEMPLATE, "utf8");
  if (!template.includes("__PAYLOAD__")) throw new Error("tools/gate.html has no __PAYLOAD__ placeholder");

  const render = (payload) => template.replace("__PAYLOAD__", JSON.stringify(payload).replace(/</g, "\\u003c"));

  // Reuse the ciphertext when the source has not changed: a fresh salt and IV on
  // every run would rewrite 88 KB for nothing. The gate around it is still
  // re-rendered, so an edit to tools/gate.html alone does reach the page.
  let payload = null;
  let reused = false;
  const existing = await readPayload();
  if (existing) {
    try {
      if ((await decrypt(existing, password)) === source) {
        payload = existing;
        reused = true;
      }
    } catch {
      console.log("The existing index.html was built with a different password; replacing it.");
    }
  }

  if (!payload) {
    payload = await encrypt(source, password);
    // Never ship a page that cannot be opened: decrypt what was just produced.
    if ((await decrypt(payload, password)) !== source) {
      throw new Error("the encrypted page did not decrypt back to its source");
    }
  }

  const html = render(payload);
  let published = null;
  try { published = await readFile(OUTPUT, "utf8"); } catch {}
  if (published === html) {
    console.log("index.html is already up to date.");
    return;
  }

  await writeFile(OUTPUT, html, "utf8");
  const kb = (Buffer.byteLength(payload.ciphertext, "utf8") / 1024).toFixed(0);
  console.log(reused
    ? "Wrote index.html — gate refreshed, ciphertext unchanged."
    : `Wrote index.html — ${kb} KB of ciphertext, PBKDF2-SHA256 × ${ITERATIONS}, AES-256-GCM.`);
}

async function unlock() {
  const payload = await readPayload();
  if (!payload) throw new Error("index.html holds no encrypted payload");
  const password = await askPassword("Site password: ");
  let plaintext;
  try {
    plaintext = await decrypt(payload, password);
  } catch {
    // The raw OpenSSL wording ("unable to authenticate data") says nothing useful.
    throw new Error("that password does not open index.html");
  }
  await mkdir(path.dirname(SOURCE), { recursive: true });
  await writeFile(SOURCE, plaintext, "utf8");
  console.log("Wrote src/index.html from the published page.");
}

const wantsUnlock = process.argv.includes("--unlock");
try {
  await (wantsUnlock ? unlock() : build());
} catch (err) {
  console.error("Failed: " + (err && err.message ? err.message : err));
  process.exit(1);
}
