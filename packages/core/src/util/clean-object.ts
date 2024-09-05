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
export function cleanObject(thing: unknown) {
  if (!thing) return thing;

  switch (typeof thing) {
    case "object": {
      if (Array.isArray(thing)) {
        if (thing.length === 0) {
          return undefined;
        }
        return thing.map(cleanObject);
      }
      if (Object.keys(thing).length === 0) {
        return undefined;
      }
      const entries = Object.entries(thing)
        .map(([key, value]) => [key, cleanObject(value)])
        .filter(([, v]) => v !== undefined);
      if (entries.length === 0) {
        return undefined;
      }
      return entries.reduce(
        (map, [key, value]) => Object.assign(map, { [key]: value }),
        {},
      );
    }
    default:
      return thing;
  }
}
