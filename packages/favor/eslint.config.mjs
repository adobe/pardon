/*
Copyright 2024 Adobe. All rights reserved.
This file is licensed to you under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License. You may obtain a copy
of the License at http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed under
the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
OF ANY KIND, either express or implied. See the License for the specific language
governing permissions and limitations under the License.
*/

import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

import globals from "globals";
import tsParser from "@typescript-eslint/parser";
import js from "@eslint/js";
import { FlatCompat } from "@eslint/eslintrc";
import typescriptEslint from "@typescript-eslint/eslint-plugin";
import headersEslint from "eslint-plugin-headers";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
});

export default [
  { ignores: [".vite/**", "out/**"] },
  ...compat.extends("eslint:recommended", "prettier"),
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },

      ecmaVersion: 2020,
      sourceType: "module",
    },

    rules: {
      "prefer-const": [
        "error",
        {
          destructuring: "all",
        },
      ],
    },
  },
  {
    files: ["**/*.cjs"],

    languageOptions: {
      ecmaVersion: 2020,
      sourceType: "commonjs",
    },
  },
  ...compat
    .extends(
      "eslint:recommended",
      "plugin:@typescript-eslint/recommended",
      "prettier",
    )
    .map((config) => ({
      ...config,
      files: ["**/*.ts"],
    })),
  {
    files: ["**/*.ts", "**/*.tsx"],

    plugins: {
      "@typescript-eslint": typescriptEslint,
      headers: headersEslint,
    },

    languageOptions: {
      parser: tsParser,
    },

    rules: {
      "no-unused-vars": "off",
      "no-undef": "off",
      "@typescript-eslint/no-explicit-any": "off",

      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          ignoreRestSiblings: true,
        },
      ],

      "headers/header-format": [
        "error",
        {
          source: "string",
          linePrefix: "",
          blockPrefix: "\n",
          blockSuffix: "\n",
          content: readFileSync(
            path.join(__dirname, "../../.license-header"),
            "utf-8",
          ).trim(),
          variables: {
            year: `${new Date().getFullYear()}`,
          },
        },
      ],
    },
  },
];
