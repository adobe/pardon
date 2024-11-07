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
import { builtinModules } from "node:module";
import type { AddressInfo } from "node:net";
import {
  UserConfigExport,
  ViteDevServer,
  mergeConfig,
  type ConfigEnv,
  type Plugin,
  type UserConfig,
} from "vite";
import pkg from "./package.json";

type VitePluginConfig = ConstructorParameters<
  typeof import("@electron-forge/plugin-vite").VitePlugin
>[0];

interface ForgedConfigEnv<
  K extends keyof VitePluginConfig = keyof VitePluginConfig,
> extends ConfigEnv {
  root: string;
  forgeConfig: VitePluginConfig;
  forgeConfigSelf: VitePluginConfig[K][number];
}

export function extendMainConfig(
  config: UserConfigExport,
  target?: "es" | "cjs"
): UserConfigExport {
  return async (env: ConfigEnv) =>
    await applyBaseBuildConfig(
      env as ForgedConfigEnv<"build">,
      config,
      "main",
      target ?? "es"
    );
}

export function extendPreloadConfig(
  config: UserConfigExport,
  target?: "cjs" | "es",
): UserConfigExport {
  return async (env: ConfigEnv) =>
    await applyBaseBuildConfig(
      env as ForgedConfigEnv<"build">,
      config,
      "preload",
      target ?? "cjs",
    );
}

export function extendRendererConfig(
  config: UserConfigExport,
): UserConfigExport {
  return async (env: ConfigEnv) =>
    await applyBaseRendererConfig(env as ForgedConfigEnv<"renderer">, config);
}

const builtins = [
  "electron",
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
];

const external = [...builtins, ...Object.keys(pkg["dependencies"] ?? {})];

// not quite sure why we need to smuggle this value via a global object.
const viteDevServers = ((process as any).viteDevServers ??= {}) as Record<
  string,
  ViteDevServer
>;

function isPromiseForUserConfig(
  config: UserConfigExport,
): config is Promise<UserConfig> {
  return typeof (config as Promise<UserConfig>)?.then === "function";
}

async function resolveConfigExport(config: UserConfigExport, env: ConfigEnv) {
  if (typeof config === "function") {
    config = config(env);
  }

  if (isPromiseForUserConfig(config)) {
    config = await config;
  }

  return config;
}

async function applyBaseBuildConfig(
  env: ForgedConfigEnv<"build">,
  config: UserConfigExport,
  type: "main" | "preload",
  target: "es" | "cjs",
) {
  const { root, mode, command } = env;
  const { entry } = env.forgeConfigSelf;
  const format = target;
  const esExt = pkg.type === "module" ? "js" : "mjs";
  const cjsExt = pkg.type === "module" ? "cjs" : "js";
  const targetExt =
    target === "cjs"
      ? type === "preload"
        ? "cjs"
        : cjsExt
      : type === "preload"
        ? "mjs"
        : esExt;

  const define = env.forgeConfig.renderer
    .map(({ name }) => name)
    .filter(Boolean)
    .reduce<Record<string, string>>((define, name) => {
      const devServerUrlKey = `${name!.toUpperCase()}_VITE_DEV_SERVER_URL`;
      const viteName = `${name!.toUpperCase()}_VITE_NAME`;

      define[devServerUrlKey] = JSON.stringify(
        command === "serve"
          ? `http://localhost:${
              (viteDevServers[name!].httpServer?.address?.() as AddressInfo)
                ?.port
            }`
          : undefined,
      );

      define[viteName] = JSON.stringify(name);

      return define;
    }, {});

  const mergedConfig = mergeConfig(
    {
      root,
      mode,
      ...(type === "main" && {
        resolve: {
          mainFields: ["module", "jsnext:main", "jsnext"],
        },
      }),
      build: {
        outDir: ".vite/build",
        emptyOutDir: false,
        watch: command === "serve" ? {} : null,
        minify: command === "build",
        ...(type === "main" && {
          lib: {
            entry: entry!,
            fileName: () => `[name].${targetExt}`,
            formats: [format],
          },
        }),
        rollupOptions: {
          external,
          ...(type === "preload" && {
            input: entry,
            output: {
              format: target,
              inlineDynamicImports: true,
              entryFileNames: `[name].${targetExt}`,
              chunkFileNames: `[name].${targetExt}`,
              assetFileNames: "[name].[ext]",
            },
          }),
        },
      },
      clearScreen: false,
      define,
    } satisfies UserConfig,
    await resolveConfigExport(config, env),
  );

  (mergedConfig.plugins ??= []).push(pluginHotRestart("restart"));

  return mergedConfig;
}

async function applyBaseRendererConfig(
  env: ForgedConfigEnv<"renderer">,
  config: UserConfigExport,
) {
  const {
    root,
    mode,
    forgeConfigSelf: { name },
  } = env;

  const mergedConfig = mergeConfig(
    {
      root,
      mode,
      base: "./",
      build: {
        outDir: `.vite/renderer/${name}`,
      },
      resolve: {
        preserveSymlinks: true,
      },
      clearScreen: false,
    } as UserConfig,
    await resolveConfigExport(config, env),
  );

  (mergedConfig.plugins ??= []).push(pluginExposeRenderer(name!));

  return mergedConfig;
}

export function pluginExposeRenderer(name: string): Plugin {
  return {
    name: "./plugin-vite:expose-renderer",
    configureServer(server) {
      viteDevServers[name] = server;
    },
  };
}

export function pluginHotRestart(command: "reload" | "restart"): Plugin {
  return {
    name: "./plugin-vite:hot-restart",
    closeBundle() {
      if (command === "reload") {
        for (const server of Object.values(viteDevServers)) {
          // Preload scripts hot reload.
          server.hot.send({ type: "full-reload" });
        }
      } else {
        // Main process hot restart.
        // https://github.com/electron/forge/blob/v7.2.0/packages/api/core/src/api/start.ts#L216-L223
        process.stdin.emit("data", "rs");
      }
    },
  };
}
