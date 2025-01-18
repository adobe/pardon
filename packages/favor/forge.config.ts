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
import type { ForgeConfig } from "@electron-forge/shared-types";
import { VitePlugin } from "@electron-forge/plugin-vite";
import { NativeDepsPlugin } from "./forge/plugins/forge-native-deps.ts";

const config: ForgeConfig = {
  packagerConfig: {
    name: "pardon",
    icon: "./electron-static/icon",
    derefSymlinks: true,
    darwinDarkModeSupport: true,
  },
  plugins: [
    new NativeDepsPlugin({ force: true }),
    new VitePlugin({
      build: [
        {
          entry: "electron/main.ts",
          config: "vite.main.config.ts",
          target: "main",
        },
        {
          entry: "electron/preload.ts",
          config: "vite.preload.config.ts",
          target: "preload",
        },
      ],
      renderer: [
        {
          name: "main_window",
          config: "vite.renderer.config.ts",
        },
      ],
    }),
  ],
};

export default config;
