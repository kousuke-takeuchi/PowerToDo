// Builds the Go sidecar (tailnet/) into src-tauri/binaries/powertodo-tailnet-<target triple>[.exe],
// the name Tauri's bundle.externalBin expects.
//
//   node scripts/build-tailnet.mjs [--target <rust target triple>]
//
// Target precedence: --target, then $TAURI_ENV_TARGET_TRIPLE (set by `tauri build --target`),
// then the host triple from `rustc -vV`.
//
// Go is looked up in this order: $GO, then `go` on PATH, then /opt/homebrew/bin/go (for a shell
// where `go` is not on PATH, e.g. an app started from the Dock).
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const TARGETS = {
  "aarch64-apple-darwin": ["darwin", "arm64"],
  "x86_64-apple-darwin": ["darwin", "amd64"],
  "x86_64-pc-windows-msvc": ["windows", "amd64"],
  "aarch64-pc-windows-msvc": ["windows", "arm64"],
  "x86_64-unknown-linux-gnu": ["linux", "amd64"],
  "aarch64-unknown-linux-gnu": ["linux", "arm64"],
};

function die(message) {
  console.error(`build-tailnet: ${message}`);
  process.exit(1);
}

function hostTriple() {
  let text;
  try {
    text = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
  } catch (e) {
    die(`cannot run rustc to find the host target (${e.message}); pass --target <triple>`);
  }
  const m = /^host:\s*(\S+)/m.exec(text);
  if (!m) die("rustc -vV did not print a host line; pass --target <triple>");
  return m[1];
}

function findGo() {
  const env = process.env.GO;
  if (env) {
    if (existsSync(env)) return env;
    die(`$GO is set to ${env}, which does not exist`);
  }
  const r = spawnSync("go", ["version"], { encoding: "utf8" });
  if (r.status === 0 && /^go version go/.test(r.stdout)) return "go";
  const brew = "/opt/homebrew/bin/go";
  return existsSync(brew) ? brew : null;
}

const args = process.argv.slice(2);
let target;
const t = args.indexOf("--target");
if (t >= 0) {
  target = args[t + 1];
  if (!target) die("--target needs a value");
}
target ??= process.env.TAURI_ENV_TARGET_TRIPLE || hostTriple();

if (target === "universal-apple-darwin") {
  die(
    "universal-apple-darwin is not supported: Tauri expects one sidecar per architecture. " +
      "Run this script with --target aarch64-apple-darwin and --target x86_64-apple-darwin, then lipo them if needed.",
  );
}
const pair = TARGETS[target];
if (!pair) die(`unsupported target ${target} (supported: ${Object.keys(TARGETS).join(", ")})`);
const [goos, goarch] = pair;

const go = findGo();
if (!go) die("Go was not found. Install Go (https://go.dev/dl/), or set the GO environment variable to the go binary.");

const outDir = join(root, "src-tauri", "binaries");
mkdirSync(outDir, { recursive: true });
const out = join(outDir, `powertodo-tailnet-${target}${goos === "windows" ? ".exe" : ""}`);

console.log(`build-tailnet: ${go} build -> ${out} (${goos}/${goarch})`);
const r = spawnSync(go, ["build", "-trimpath", "-ldflags", "-s -w", "-o", out, "."], {
  cwd: join(root, "tailnet"),
  stdio: "inherit",
  env: { ...process.env, CGO_ENABLED: "0", GOOS: goos, GOARCH: goarch },
});
if (r.error) die(r.error.message);
if (r.status !== 0) die(`go build failed (exit ${r.status})`);
