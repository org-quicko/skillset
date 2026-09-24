import js from "@eslint/js";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tsdoc from "eslint-plugin-tsdoc";
import globals from "globals";
import tseslint from "typescript-eslint";

const unusedVarsRule = [
  "error",
  { args: "all", argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
];

export default tseslint.config(
  {
    // `_ds` is a vendored design-system bundle, not source: 424 of the 429
    // problems this config reported came from that one file, which is enough
    // noise to hide every real finding and to leave `bun run lint` — and so
    // `prebuild` — failing as its normal state.
    ignores: ["**/dist/**", "**/node_modules/**", "**/.claude/**", "apps/api/src/db/database.ts", "_ds/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["apps/api/**/*.ts", "apps/cli/**/*.ts", "packages/shared/**/*.ts"],
    // A program to ask, so the rules below can see types. Not the whole
    // `recommendedTypeChecked` preset: its `no-unsafe-*` rules fire on every
    // `bun:test` call in this repo, whose types ESLint's program cannot
    // resolve even though `tsc` does — a thousand findings, none of them real,
    // which is how a lint config gets ignored.
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    plugins: { tsdoc },
    rules: {
      "@typescript-eslint/no-unused-vars": unusedVarsRule,
      "tsdoc/syntax": "error",
      // The two type-aware rules worth the program: a promise nobody awaited,
      // and one passed where a boolean or a void callback was wanted. Neither
      // is visible without types, or in review, and both are silent at
      // runtime until the day the timing matters.
      //
      // `await-thenable` and `no-unnecessary-condition` are deliberately left
      // off, not overlooked. Both report only false positives here today:
      // ESLint's program does not resolve `bun:test`'s types (so every
      // `await expect(...)` reads as awaiting a non-promise), and both
      // `process.stdout.columns` and `Object.values` over an all-optional
      // object are typed more narrowly than they behave. Turning them on would
      // buy about fifty suppressions and no defects.
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
    },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    plugins: { react, "react-hooks": reactHooks, "react-refresh": reactRefresh },
    languageOptions: { globals: globals.browser },
    settings: { react: { version: "detect" } },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": unusedVarsRule,
    },
  },
);
