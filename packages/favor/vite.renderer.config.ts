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
import { resolve } from "node:path";
import { extendRendererConfig } from "./vite.base.config.ts";
import solid from "vite-plugin-solid";
import Icons from "unplugin-icons/vite";
import AutoImport from "unplugin-auto-import/vite";
import IconsResolver from "unplugin-icons/resolver";
import tailwindcss from "@tailwindcss/vite";

// https://vitejs.dev/config
export default extendRendererConfig({
  resolve: {
    preserveSymlinks: true,
    alias: Object.entries({
      "util/types": "./src/poly/util-types.ts",
      "node:util/types": "./src/poly/util-types.ts",
      util: "node_modules/@pkgjs/parseargs",
      "node:util": "node_modules/@pkgjs/parseargs",
    }).map(([find, replacement]) => ({
      find,
      replacement: resolve(replacement),
    })),
  },
  define: {
    global: "globalThis",
  },
  plugins: [
    solid(),
    AutoImport({
      resolvers: [
        IconsResolver({
          prefix: "Icon",
          extension: "jsx",
        }),
      ],
    }),
    Icons({ compiler: "solid" }),
    tailwindcss(),
  ],
  build: {
    sourcemap: "inline",
    minify: false,
  },
});
