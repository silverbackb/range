import { readFileSync, writeFileSync, chmodSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const targets = ["dist/index.js"];

for (const rel of targets) {
  const file = resolve(__dirname, "..", rel);
  try {
    const content = readFileSync(file, "utf8");
    if (!content.startsWith("#!/usr/bin/env node")) {
      writeFileSync(file, `#!/usr/bin/env node\n${content}`);
    }
    chmodSync(file, 0o755);
    console.log(`shebang ok: ${rel}`);
  } catch (err) {
    console.error(`skipped ${rel}: ${err.message}`);
  }
}
