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
import tailwind from "@astrojs/tailwind";
import starlight from "@astrojs/starlight";
import solid from "@astrojs/solid-js";

// https://astro.build/config
export default defineConfig({
  site: process.env.SITE_ORIGIN,
  base: process.env.SITE_ROOT ?? "/",
  output: "static",
  integrations: [
    starlight({
      title: "Pardon",
      customCss: ["./src/layouts/tailwind.pcss", "./src/layouts/tweaks.pcss"],
      sidebar: [
        {
          label: "Welcome",
          link: "/",
        },
        {
          label: "Introduction to Pardon",
          items: [
            {
              label: "Overview",
              link: "/intro/",
            },
            {
              label: "Quickstart",
              link: "/intro/quickstart",
            },
            {
              label: "Templates",
              link: "/intro/templates",
            },
            {
              label: "Collections (and Mixins)",
              link: "/intro/collections",
            },
            {
              label: "Dataflow",
              link: "/intro/dataflow",
            },
            {
              label: "Scripting",
              link: "/intro/scripting",
            },
            {
              label: "Collection Layers",
              link: "/intro/layers",
            },
            {
              label: "Patterns",
              link: "/intro/patterns",
            },
            {
              label: "Schemas",
              link: "/intro/schemas",
            },
            {
              label: "Pardon for Testing",
              link: "/intro/testcases",
            },
          ],
        },
        {
          label: "Technology",
          items: [
            {
              label: "Causality Tracking",
              link: "/tech/causality",
            },
            {
              label: "Template Schemas",
              link: "/tech/schema-tech",
            },
            {
              label: "The KV format",
              link: "/tech/kv",
            },
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
      },
    }),
    solid(),
    tailwind({ applyBaseStyles: false }),
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
        "source-map-support": "./src/polyfill/empty.ts",
      }).map(([find, replacement]) => ({
        find,
        replacement: resolve(replacement),
      })),
    },
  },
});
