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

import { app } from "electron";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "path";

const appDataDir = join(app.getPath("appData"), app.getName());

mkdirSync(appDataDir, { recursive: true });

const settingsFile = join(appDataDir, "pardon.json");
console.info("settings file:", settingsFile);

let settings: Preferences;

export function preferences() {
  return (settings ??= loadPreferences());
}

function loadPreferences(): Preferences {
  if (existsSync(settingsFile)) {
    try {
      return JSON.parse(readFileSync(settingsFile, "utf-8"));
    } catch (error) {
      console.warn(`error loading settings from: ${settingsFile}`, error);
      return {};
    }
  }
  return {};
}

let savingSettings: Promise<unknown>;

export function savePreferences(newSettings: Preferences) {
  settings = { ...settings, ...newSettings };

  const thisSave = (savingSettings = Promise.allSettled([savingSettings]).then(
    () => {
      // debounce by only accepting the last set one.
      if (savingSettings === thisSave) {
        return writeFile(
          settingsFile,
          JSON.stringify(settings, null, 2),
          "utf-8",
        );
      }
    },
  ));
}
