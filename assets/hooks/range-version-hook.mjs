#!/usr/bin/env node
// Range — version check hook (installed by range-init, do not edit manually)
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const RANGE_URL    = "https://range.silverbackbase.com";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const KEYWORDS     = ["range", "positionnement local", "mot-clé", "keyword", "/range-setup", "/range-sbb", "range_"];

const sbbDir        = join(homedir(), ".silverbackbase");
const installedFile = join(sbbDir, "range-skill-version");
const cacheFile     = join(sbbDir, "range-version-cache.json");

let raw = "";
process.stdin.on("data", c => { raw += c; });
process.stdin.on("end", () => { check().then(() => process.exit(0)).catch(() => process.exit(0)); });

async function check() {
  try {
    const prompt = (JSON.parse(raw)?.prompt ?? "").toLowerCase();
    if (!KEYWORDS.some(kw => prompt.includes(kw))) return;
    if (!existsSync(installedFile)) return;

    const installedVersion = readFileSync(installedFile, "utf-8").trim();
    if (!installedVersion) return;

    let latestVersion = null;
    let cacheAge = Infinity;
    try {
      const cache = JSON.parse(readFileSync(cacheFile, "utf-8"));
      cacheAge = Date.now() - (cache.checkedAt ?? 0);
      if (cache.version) latestVersion = cache.version;
    } catch {}

    if (cacheAge > CACHE_TTL_MS) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 800);
        const resp = await fetch(`${RANGE_URL}/version`, { signal: controller.signal });
        clearTimeout(timer);
        if (resp.ok) {
          const data = await resp.json();
          latestVersion = data.version;
          mkdirSync(sbbDir, { recursive: true });
          writeFileSync(cacheFile, JSON.stringify({ version: latestVersion, checkedAt: Date.now() }), "utf-8");
        }
      } catch {}
    }

    if (latestVersion && installedVersion !== latestVersion) {
      process.stdout.write(
        `[Range] Mise à jour disponible : skill ${installedVersion} → ${latestVersion}. Lance \`npx @silverbackbase/range@latest init\` pour activer les nouvelles recommandations.\n`
      );
    }
  } catch {}
}
