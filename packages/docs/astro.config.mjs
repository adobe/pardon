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

import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import solid from "@astrojs/solid-js";
import { pluginFrames } from "astro-expressive-code";
import { copypastePlugin } from "./src/code/copypaste-plugin";
import Icons from "unplugin-icons/vite";
import AutoImportVite from "unplugin-auto-import/vite";
import AutoImportAstro from "unplugin-auto-import/astro";
import IconsResolver from "unplugin-icons/resolver";

import tailwindcss from "@tailwindcss/vite";

// https://astro.build/config
export default defineConfig({
  site: process.env.SITE_ORIGIN,
  base: process.env.SITE_ROOT ?? "/",
  output: "static",
  integrations: [
    AutoImportAstro({
      resolvers: [IconsResolver({ prefix: "Icon", extension: "jsx" })],
    }),
    starlight({
      title: "Pardon",
      customCss: ["./src/styles/global.css"],
      sidebar: [
        { label: "Welcome", link: "/" },
        {
          label: "Introduction to Pardon",
          items: [
            { label: "Overview", link: "/intro/" },
            { label: "Quickstart", link: "/intro/quickstart" },
            { label: "Templates", link: "/intro/templates" },
            { label: "Endpoints", link: "/intro/endpoints" },
            { label: "Pardon for Testing", link: "/intro/testcases" },
          ],
        },
        {
          label: "Reference",
          items: [
            { label: "Overview", link: "/reference" },
            { label: "The HTTPS format", link: "/reference/https-format" },
            { label: "Template Runtime", link: "/reference/template-runtime" },
            { label: "Built-in values", link: "/reference/builtin-values" },
          ],
        },
        {
          label: "Technology",
          items: [
            { label: "Overview", link: "/tech" },
            { label: "Causality Tracking", link: "/tech/causality" },
            { label: "The KV format", link: "/tech/kv" },
          ],
        },
        {
          label: "FAQ",
          link: "faq",
        },
      ],
      components: {
        PageFrame: "@components/starlight/PageFrame.astro",
        Footer: "@components/starlight/Footer.astro",
        PageSidebar: "@components/starlight/PageSidebar.astro",
        //TwoColumnContent: "@components/starlight/TwoColumnContent.astro",
      },
      expressiveCode: {
        frames: false,
        plugins: [
          copypastePlugin(),
          pluginFrames({ showCopyToClipboardButton: false }),
        ],
      },
    }),
    solid({}),
  ],
  vite: {
    build: {
      target: "esnext",
    },

    define: {
      process: { env: {}, versions: process.versions, version: "v1.0.0" },
      "globalThis.fetch": true, // skips import of node-fetch which breaks build
    },

    optimizeDeps: {
      exclude: ["util", "node:util"],
    },

    /*
     * All this is as-needed stubbing out node:deps to allow parts
     * of pardon to run in-browser.
     *
     * (there has to be a better way to do this!)
     */
    resolve: {
      alias: Object.entries({
        "node:async_hooks": "./src/polyfill/async_hooks.ts",
        "node:buffer": "./src/polyfill/buffer.ts",
        events: "./node_modules/events",
        "node:events": "./node_modules/events",
        "fs/promises": "./src/polyfill/fs_promises.ts",
        "node:fs/promises": "./src/polyfill/fs_promises.ts",
        fs: "./src/polyfill/fs.ts",
        "node:fs": "./src/polyfill/fs.ts",
        os: "./src/polyfill/os.ts",
        "node:os": "./src/polyfill/os.ts",
        "util/types": "./src/polyfill/util-types.ts",
        "node:util/types": "./src/polyfill/util-types.ts",
        util: "./src/polyfill/util.ts",
        "node:util": "./src/polyfill/util.ts",
        path: "./src/polyfill/path.ts",
        "node:path": "./src/polyfill/path.ts",
        url: "./src/polyfill/url.ts",
        "node:url": "./src/polyfill/url.ts",
        string_decoder: "./src/polyfill/string_decoder.ts",
        "node:string_decoder": "./src/polyfill/string_decoder.ts",
        stream: "node_modules/stream-browserify",
        "node:stream": "node_modules/stream-browserify",
        module: "./src/polyfill/module.ts",
        "node:module": "./src/polyfill/module.ts",
        net: "./src/polyfill/net",
        "node:net": "./src/polyfill/net",
        "source-map-support": "./src/polyfill/empty.ts",
      }).map(([find, replacement]) => ({
        find,
        replacement: resolve(replacement),
      })),
    },

    plugins: [
      tailwindcss(),
      AutoImportVite({
        resolvers: [
          IconsResolver({
            prefix: "Icon",
            extension: "jsx",
          }),
        ],
      }),
      Icons({ compiler: "solid" }),
      Icons({ compiler: "astro" }),
    ],
  },
  experimental: {
    clientPrerender: true,
  },
});
