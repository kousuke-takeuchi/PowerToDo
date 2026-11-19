// Checks the docs: every relative link and image reference resolves, and mermaid node IDs avoid
// words mermaid reserves. Run with `npm run test:docs`.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");

function markdownFiles() {
  const files = ["README.md", "CLAUDE.md", "CONTRIBUTING.md", "design/README.md"].map((f) => join(root, f));
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        // Specs and plans are dated records; their links describe the code as it was.
        if (p !== join(root, "docs/superpowers")) walk(p);
      } else if (name.endsWith(".md")) files.push(p);
    }
  };
  walk(join(root, "docs"));
  return files.filter((f) => existsSync(f));
}

/** Relative targets of Markdown links, Markdown images and HTML src / srcset, outside code. */
function targets(text) {
  const prose = text.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
  const found = [];
  for (const m of prose.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) found.push(m[1]);
  for (const m of prose.matchAll(/\b(?:src|srcset)="([^"]+)"/g)) found.push(m[1]);
  return found.filter((t) => !/^(https?:|mailto:|#)/.test(t));
}

for (const file of markdownFiles()) {
  const name = relative(root, file);
  const text = readFileSync(file, "utf8");

  test(`${name}: links and images resolve`, () => {
    for (const t of targets(text)) {
      const path = decodeURIComponent(t.split("#")[0]);
      assert.ok(existsSync(resolve(dirname(file), path)), `${name}: ${t} がありません`);
    }
  });

  test(`${name}: mermaid node IDs are not reserved words`, () => {
    const reserved = new Set(["end", "graph", "subgraph", "flowchart", "style", "class", "classDef", "click", "default"]);
    for (const block of text.matchAll(/```mermaid\n([\s\S]*?)```/g)) {
      if (/^\s*sequenceDiagram/.test(block[1])) continue;
      for (const m of block[1].matchAll(/(?:^|-->|---|--\s[^-]*-->|\s)([A-Za-z_][\w]*)\s*[[({]/gm)) {
        assert.ok(!reserved.has(m[1]), `${name}: mermaid のノード ID「${m[1]}」は予約語です`);
      }
    }
  });
}
