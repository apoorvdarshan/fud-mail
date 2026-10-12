import js from "@eslint/js";
import globals from "globals";
export default [js.configs.recommended, {
  files: ["**/*.js", "**/*.mjs"],
  languageOptions: { globals: globals.node },
  // Underlying credential-process errors may contain secrets; do not attach causes.
  rules: { "preserve-caught-error": "off", "no-unused-vars": ["error", { varsIgnorePattern: "^_", argsIgnorePattern: "^_" }] },
}];
