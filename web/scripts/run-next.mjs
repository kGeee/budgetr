import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

const MIN_MAJOR = 20;
const MIN_MINOR = 9;

function supported(version) {
  const [major, minor] = version.replace(/^v/, "").split(".").map(Number);
  return major > MIN_MAJOR || (major === MIN_MAJOR && minor >= MIN_MINOR);
}

function versionOf(binary) {
  const result = spawnSync(binary, ["--version"], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "";
}

function nativeModulesCompatible(binary) {
  const sqlite = join(process.cwd(), "node_modules/better-sqlite3");
  if (!existsSync(sqlite)) return true;
  const probe = spawnSync(
    binary,
    ["-e", `const Database=require(${JSON.stringify(sqlite)});new Database(':memory:').close()`],
    { stdio: "ignore" },
  );
  return probe.status === 0;
}

const pathCandidates = (process.env.PATH ?? "")
  .split(delimiter)
  .filter(Boolean)
  .map((entry) => join(entry, "node"));
const home = process.env.HOME ?? "";
const candidates = [
  process.env.BUDGETR_NODE_BINARY,
  process.execPath,
  home ? join(home, ".brv-cli/bin/node") : undefined,
  "/opt/homebrew/opt/node/bin/node",
  "/usr/local/opt/node/bin/node",
  ...pathCandidates,
].filter(Boolean);

const node = [...new Set(candidates)].find((candidate) => {
  if (!existsSync(candidate)) return false;
  const version = versionOf(candidate);
  return version && supported(version) && nativeModulesCompatible(candidate);
});

if (!node) {
  console.error(
    `budgetr requires Node.js >=${MIN_MAJOR}.${MIN_MINOR}. Current: ${process.version}. ` +
      "Install a current Node release or set BUDGETR_NODE_BINARY to its executable.",
  );
  process.exit(1);
}

if (node !== process.execPath) {
  console.log(`Using ${node} (${versionOf(node)}); the active shell has ${process.version}.`);
}

const next = join(process.cwd(), "node_modules/next/dist/bin/next");
const result = spawnSync(node, [next, ...process.argv.slice(2)], { stdio: "inherit" });
process.exit(result.status ?? 1);
