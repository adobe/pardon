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
import { resolve, sep } from "node:path";

import { GlobOptionsWithFileTypesFalse, glob } from "glob";
import { readFile } from "node:fs/promises";

export async function globfiles<T = string>(
  cwd: string,
  pattern: string | string[],
  mapper: (content: string, path: string, name: string) => T = (content) =>
    content as T,
  {
    key,
    ...options
  }: GlobOptionsWithFileTypesFalse & { key?: (k: string) => string } = {},
): Promise<Record<string, Awaited<T>>> {
  const matches = await glob(pattern, { cwd, nodir: true, ...options });

  const kv = await Promise.all(
    matches.map(async (path) => {
      const posixPath = path.split(sep).join("/");
      const name = key ? key(posixPath) : posixPath;
      const asset = resolve(cwd, path);

      return [
        name,
        await mapper(await readFile(asset, "utf-8"), name, asset),
      ] as const;
    }),
  );

  return kv.reduce((map, [k, v]) => Object.assign(map, { [k]: v }), {});
}
