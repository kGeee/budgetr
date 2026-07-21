// Metro config: teach SDK 54's Metro about the file:-linked @budgetr/*
// packages, which live outside this project root (../packages). Metro must
// both watch those folders and resolve the scoped names to them explicitly.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const repoRoot = path.resolve(projectRoot, "..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [
  path.resolve(repoRoot, "packages/core"),
  path.resolve(repoRoot, "packages/sync-crypto"),
];

config.resolver.extraNodeModules = {
  "@budgetr/core": path.resolve(repoRoot, "packages/core"),
  "@budgetr/sync-crypto": path.resolve(repoRoot, "packages/sync-crypto"),
};

// Dependencies of the linked packages (tweetnacl) resolve from the app's own
// node_modules — the packages ship no node_modules of their own when linked.
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, "node_modules")];

module.exports = config;
