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

import { readFile } from "node:fs/promises";
import { homely } from "../util/resolvehome.js";
import { JSON } from "../core/raw-json.js";

function fileAPI(relative?: string) {
  return {
    text,
    json,
    rebase(path?: string) {
      return fileAPI(path);
    },
  };

  async function text(path: string) {
    return (await readFile(homely(path, relative), "utf-8")).trimEnd();
  }

  async function json(path: string) {
    return JSON.parse(await text(path));
  }
}

export const FILE = fileAPI();
