// ESLint flat config: recommended JS + TypeScript rules, plus React hooks rules for the frontend.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  { ignores: ["dist", "node_modules", ".aws-sam"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Allow `const { PK, ...rest } = item` (dropping fields) and `_unused` names.
      "@typescript-eslint/no-unused-vars": ["error", { ignoreRestSiblings: true, varsIgnorePattern: "^_", argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["web/src/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    files: ["backend/**/*.ts", "scripts/**/*.ts", "shared/**/*.ts", "*.config.{ts,js}"],
    languageOptions: { globals: globals.node },
  },
);
