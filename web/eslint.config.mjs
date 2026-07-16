import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    // Marketing-only build output (sibling to .next).
    ".next-marketing/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Electron packaging output and the plain-CJS Electron entrypoint /
    // build scripts (CommonJS, run under Node — not part of the Next app).
    "dist/**",
    "desktop/electron/**",
    "desktop/scripts/**",
  ]),
]);

export default eslintConfig;
