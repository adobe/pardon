/*
Copyright 2025 Adobe. All rights reserved.
This file is licensed to you under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License. You may obtain a copy
of the License at http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed under
the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
OF ANY KIND, either express or implied. See the License for the specific language
governing permissions and limitations under the License.
*/

import esbuild from "rollup-plugin-esbuild";
import dts from "rollup-plugin-dts";
import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import hashbang from "rollup-plugin-hashbang";

const executables = {
  main: "src/entry/main/cli/index.ts",
  runner: "src/entry/testing/cli/index.ts",
  server: "src/entry/proxy/cli.ts",
};

const input = {
  // exported modules
  api: "src/modules/api.ts",
  utils: "src/modules/utils.ts",
  runtime: "src/modules/runtime.ts",
  database: "src/modules/database.ts",
  playground: "src/modules/playground.ts",
  // runtime/puntime loader
  loader: "src/modules/loader.ts",
  // testing - defining
  testing: "src/modules/testing.ts",
  // testing - running
  running: "src/modules/running.ts",
  // just format parsing (should be browser-compatible deps only)
  formats: "src/modules/formats.ts",
  // built-in features
  "features/trace": "src/features/trace.ts",
  "features/remember": "src/features/remember.ts",
};

export default [
  { dir: "dist/", types: false, input: { ...input, ...executables } },
  { dir: "dist/types", types: true, input },
].map(
  ({ dir, types, input }) =>
    /** @type {import("rollup").RollupOptions} */ ({
      input,
      output: {
        dir,
        format: "es",
        sourcemap: true,
        exports: "named",
        ...(!types && {
          entryFileNames: ({ name }) =>
            `[name].${executables[name] ? "mjs" : "js"}`,
        }),
      },
      plugins: [
        hashbang.default(),
        resolve({
          preferBuiltins: true,
        }),
        ...(types
          ? [
              dts({
                respectExternal: true,
              }),
            ]
          : [
              esbuild({
                exclude: ["tests/**", "ux/**", "node_modules/**"],
              }),
              commonjs({
                esmExternals: true,
              }),
            ]),
      ],
      external: ["better-sqlite3", "@types/better-sqlite3", "fsevents"],
    }),
);
