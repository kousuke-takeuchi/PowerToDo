// design/storyboard.md の画面一覧と、storybook-static/index.json の Screens/* を突き合わせる。
// 事前に `npm run build-storybook` を実行しておくこと。
import { readFileSync } from "node:fs";

const md = readFileSync("design/storyboard.md", "utf8");
const names = [];
for (const line of md.split("\n")) {
  const cells = line.split("|").map((c) => c.trim());
  // | No | 画面 | id | サイズ | Phase |
  if (cells.length >= 7 && /^(D|M|ダーク)/.test(cells[1]) && /^[A-Za-z0-9]{5,6}$/.test(cells[3])) {
    names.push(cells[2]);
  }
}

const index = JSON.parse(readFileSync("storybook-static/index.json", "utf8"));
const stories = Object.values(index.entries).filter(
  (e) => e.type === "story" && e.title.startsWith("Screens/"),
);
const storyNames = new Set(stories.map((s) => s.name));

const missing = names.filter((n) => !storyNames.has(n));
const extra = [...storyNames].filter((n) => !names.includes(n));

console.log(`storyboard screens: ${names.length}`);
console.log(`Screens/* stories: ${stories.length}`);
console.log(`missing: ${missing.length ? missing.join(", ") : "none"}`);
console.log(`extra: ${extra.length ? extra.join(", ") : "none"}`);
process.exit(missing.length ? 1 : 0);
