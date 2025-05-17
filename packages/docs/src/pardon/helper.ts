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

export function service(...imports: Record<string, string>[]) {
  const filesystem = imports.reduce(
    (filesystem, imported) => Object.assign(filesystem, imported),
    {},
  );

  function layers(...layers: string[]) {
    return {
      layers,
      config: filesystem,
    };
  }

  return {
    layers,
  };
}

const tap_pattern = /^[.][/](?:[^/]*[/]){N}/;

/**
 * removes `./first-path-segment/` from each key in the map, (or more).
 */
export function tap(imports: Record<string, string>, depth = 1) {
  return Object.entries(imports).reduce(
    (tapped, [k, v]) =>
      Object.assign(tapped, {
        [k.replace(tapping(depth), "")]: v,
      }),
    {},
  );
}

const taps: Record<number, RegExp> = {};
function tapping(depth: number) {
  return (taps[depth] ??= new RegExp(
    tap_pattern.source.replace("N", String(depth)),
  ));
}
