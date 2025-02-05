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

import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { rebuild } from "@electron/rebuild";
import { execSync } from "node:child_process";
import { PluginBase } from "@electron-forge/plugin-base";
import type {
  ForgeRebuildOptions,
  ResolvedForgeConfig,
} from "@electron-forge/shared-types";

/** this should probably be improved and contributed back to forge */
export class NativeDepsPlugin extends PluginBase<Partial<ForgeRebuildOptions>> {
  name: "forge-native-deps";

  rebuildConfig: ForgeRebuildOptions;

  constructor(config: Partial<ForgeRebuildOptions>) {
    super(config);
  }

  init(_dir: string, config: ResolvedForgeConfig): void {
    this.rebuildConfig = config.rebuildConfig;
    config.rebuildConfig = undefined!;

    config.packagerConfig.afterCopy = [
      ...(config.packagerConfig.afterCopy ?? []),
      async (buildPath, electronVersion, platform, arch, callback) => {
        try {
          const appPackageJsonPath = join(buildPath, "package.json");

          const {
            scripts,
            devDependencies,
            engines,
            overrides,
            ...packageJson
          } = JSON.parse(readFileSync(appPackageJsonPath, "utf-8"));

          writeFileSync(
            appPackageJsonPath,
            JSON.stringify(packageJson, null, 2),
          );

          const appPackageLockPath = join(buildPath, "package-lock.json");
          cpSync("./package-lock.json", appPackageLockPath);
          execSync("npm install", { cwd: buildPath });
          rmSync(appPackageLockPath);

          await rebuild({
            buildPath,
            electronVersion,
            platform: platform as NodeJS.Platform,
            arch,
            ...this.rebuildConfig,
            ...this.config,
          });

          callback(null);
        } catch (error) {
          callback(error);
        }
      },
    ];
  }
}
