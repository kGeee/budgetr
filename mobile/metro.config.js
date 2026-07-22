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

// The @budgetr/* packages resolve to their TypeScript source on native (via the
// "react-native" export condition), but that source uses NodeNext-style imports
// with explicit ".js" specifiers that actually point at sibling ".ts" files.
// tsc needs those extensions for the dist build; Metro can't map ".js" -> ".ts"
// on its own. Rewrite the specifier to extensionless for our source packages so
// Metro's sourceExts resolve the real ".ts" file.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (
    moduleName.startsWith(".") &&
    moduleName.endsWith(".js") &&
    /[/\\]packages[/\\](core|sync-crypto)[/\\]/.test(context.originModulePath)
  ) {
    return context.resolveRequest(
      context,
      moduleName.replace(/\.js$/, ""),
      platform
    );
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
