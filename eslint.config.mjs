import path from "node:path";
import { fileURLToPath } from "node:url";
import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const typedFiles = ["src/**/*.{ts,tsx,mts,cts}", "background/**/*.{ts,tsx,mts,cts}", "injected/**/*.{ts,tsx,mts,cts}", "workers/**/*.{ts,tsx,mts,cts}", "testing/**/*.{ts,tsx,mts,cts}"];
const scriptFiles = [
  "eslint.config.mjs",
  "scripts/**/*.mjs"
];

const typedConfigs = tseslint.configs.recommendedTypeChecked.map((config) => ({
  ...config,
  files: typedFiles,
  languageOptions: {
    ...config.languageOptions,
    parserOptions: {
      project: "./tsconfig.json",
      tsconfigRootDir: rootDir
    }
  }
}));

export default [
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      ".build/**",
      ".local-dev/**",
      ".playwright-cli/**"
    ]
  },
  {
    ...js.configs.recommended,
    files: ["**/*.{js,mjs,cjs}"]
  },
  {
    files: scriptFiles,
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: globals.node
    },
    rules: {
      "no-unreachable": "error",
      "no-duplicate-imports": "error"
    }
  },
  ...typedConfigs,
  {
    files: typedFiles,
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
        chrome: "readonly"
      }
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-unreachable": "error",
      "no-duplicate-imports": "error",
      "react-refresh/only-export-components": [
        "error",
        { allowConstantExport: true }
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports" }
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_"
        }
      ]
    }
  }
];
