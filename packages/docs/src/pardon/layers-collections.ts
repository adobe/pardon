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

function tap(imports: Record<string, string>) {
  return Object.entries(imports).reduce(
    (tapped, [k, v]) =>
      Object.assign(tapped, {
        [k.replace(/^[.][/][^/]*/, "")]: v,
      }),
    {},
  );
}

const baseLayers = tap(
  import.meta.glob("./layers/**/*", {
    query: "?raw",
    eager: true,
    import: "default",
  }),
);

export const simpleLayers = {
  layers: ["/collection/", "/extension/"],
  config: { ...baseLayers },
} as const;
