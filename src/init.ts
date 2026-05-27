#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
const args = process.argv.slice(2).filter(a => a !== "init");
const tokenIdx = args.indexOf("--token");
const cliToken: string | undefined =
  tokenIdx !== -1 ? args[tokenIdx + 1] : args.find(a => a.startsWith("--token="))?.split("=")[1];

const UNIFIED_MCP_URL = "https://mcp.silverbackbase.com/mcp";
const SKILL_NAMES = ["range-sbb", "range-setup"] as const;

// ─── JSON config helpers ──────────────────────────────────────────────────────

function configHasUnifiedMcp(configPath: string): boolean {
  if (!existsSync(configPath)) return false;
  try {
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    const servers = (config.mcpServers ?? {}) as Record<string, unknown>;
    return Object.values(servers).some(s => {
      const server = s as Record<string, unknown>;
      if (typeof server?.url === "string" && server.url.includes("mcp.silverbackbase.com")) return true;
      if (Array.isArray(server?.args)) {
        return (server.args as string[]).some(
          a => typeof a === "string" && a.includes("mcp.silverbackbase.com"),
        );
      }
      return false;
    });
  } catch { return false; }
}

function extractTokenFromConfig(configPath: string): string | undefined {
  if (!existsSync(configPath)) return undefined;
  try {
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    const servers = (config.mcpServers ?? {}) as Record<string, unknown>;
    for (const s of Object.values(servers)) {
      const server = s as Record<string, unknown>;
      const headers = server?.headers as Record<string, string> | undefined;
      if (headers?.Authorization?.startsWith("Bearer sb_"))
        return headers.Authorization.replace("Bearer ", "");
      if (Array.isArray(server?.args)) {
        const a = server.args as string[];
        const hi = a.indexOf("--header");
        if (hi !== -1 && a[hi + 1]?.startsWith("Authorization: Bearer "))
          return a[hi + 1].replace("Authorization: Bearer ", "");
      }
    }
  } catch {}
  return undefined;
}

function upsertMcp(configPath: string, token: string) {
  let config: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    try { config = JSON.parse(readFileSync(configPath, "utf-8")); } catch {}
  } else {
    mkdirSync(dirname(configPath), { recursive: true });
  }
  const servers = (config.mcpServers as Record<string, unknown>) ?? {};
  servers["silverbackbase"] = {
    type: "http",
    url: UNIFIED_MCP_URL,
    headers: { Authorization: `Bearer ${token}` },
  };
  config.mcpServers = servers;
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

// ─── Skill installer ──────────────────────────────────────────────────────────

function installSkills(skillsDir: string): string[] {
  const __dir = dirname(fileURLToPath(import.meta.url));
  const installed: string[] = [];
  for (const name of SKILL_NAMES) {
    const src = join(__dir, "..", "assets", "skills", name, "SKILL.md");
    if (!existsSync(src)) continue;
    const dest = join(skillsDir, name, "SKILL.md");
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
    installed.push(name);
  }
  return installed;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const home = homedir();

  const claudeDesktopPath = process.platform === "win32"
    ? join(process.env.APPDATA ?? home, "Claude", "claude_desktop_config.json")
    : join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");

  const mcpClients = [
    { name: "Claude Code",    path: join(home, ".claude.json"),  format: "json" as const },
    { name: "Claude Desktop", path: claudeDesktopPath,           format: "json" as const },
  ];

  const hasMcp     = (c: typeof mcpClients[number]) => configHasUnifiedMcp(c.path);
  const extractToken = (c: typeof mcpClients[number]) => extractTokenFromConfig(c.path);
  const writeMcp   = (c: typeof mcpClients[number], t: string) => upsertMcp(c.path, t);

  console.log(`\n  📍 SilverBackBase — Range\n`);

  const withMcp    = mcpClients.filter(c => existsSync(c.path) && hasMcp(c));
  const withoutMcp = mcpClients.filter(c => existsSync(c.path) && !hasMcp(c));

  let token = cliToken ?? withMcp.map(c => extractToken(c)).find(Boolean);

  const mcpConfigured: string[] = [];
  const rl = createInterface({ input, output });

  if (withoutMcp.length > 0) {
    const claudeCodeClient = mcpClients[0];
    const targets = withoutMcp.some(c => c.name === "Claude Code")
      ? withoutMcp
      : (!existsSync(claudeCodeClient.path) ? [claudeCodeClient, ...withoutMcp] : withoutMcp);

    const missingNames = targets.map(c => c.name).join(", ");

    if (token) {
      const source = withMcp.length > 0 ? ` (token récupéré depuis ${withMcp[0].name})` : "";
      console.log(`  Le MCP SilverBackBase n'est pas encore configuré sur : ${missingNames}`);
      console.log(`  Il sera ajouté automatiquement${source}.\n`);
      const ans = (await rl.question(`  Confirmer ? (Y/n) : `)).trim().toLowerCase();
      if (ans !== "n") {
        for (const client of targets) {
          writeMcp(client, token);
          mcpConfigured.push(client.name);
        }
      }
    } else {
      token = (await rl.question(`  Entrez votre clé d'API (format sb_live_...) : `)).trim();
      if (!token || !token.startsWith("sb_")) {
        console.error(`\n  ❌ Clé d'API invalide. Obtenez la vôtre sur silverbackbase.com/account/tokens\n`);
        rl.close();
        process.exit(1);
      }
      for (const client of targets) {
        writeMcp(client, token);
        mcpConfigured.push(client.name);
      }
    }
  }

  rl.close();

  // Install skills for all detected agent clients
  const skillTargets = [
    { name: "Claude Code", dir: join(home, ".claude", "skills") },
  ];

  const skillsInstalled: string[] = [];
  for (const target of skillTargets) {
    const installed = installSkills(target.dir);
    if (installed.length > 0) skillsInstalled.push(target.name);
  }

  // Summary
  console.log("\n  Range configuré !\n");
  if (withMcp.length > 0 && mcpConfigured.length === 0) {
    withMcp.forEach(c => console.log(`  ✓ MCP déjà présent — ${c.name}`));
  }
  mcpConfigured.forEach(name => console.log(`  ✓ MCP installé — ${name}`));
  skillsInstalled.forEach(name => console.log(`  ✓ Skills installés — ${name} (range-sbb, range-setup)`));
  console.log("\n  Redémarre ton agent IA, puis tape /range-setup pour commencer.\n");
}

main().catch(err => {
  console.error("\n  ❌ Une erreur est survenue :", err);
  process.exit(1);
});
