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
import os from "node:os";
import { dirname, join, resolve } from "node:path";
import { PardonError } from "../core/error.js";

export function homely(path: string, relative?: string): string {
  if (/^~[/\\]/.test(path)) {
    return join(os.homedir(), ...path.split(/[\\/]/).slice(1));
  }

  if (path !== "." && !path.startsWith("./") && !path.startsWith("../")) {
    throw new PardonError(
      "non-relative paths are reserved for a node resolution import strategy: " +
        path,
    );
  }

  return resolve(relative ? dirname(relative) : ".", path);
}
