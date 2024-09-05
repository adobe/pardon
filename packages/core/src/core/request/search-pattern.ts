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
import { depatternize, patternize } from "../schema/core/pattern.js";
import { mapObject } from "../../util/mapping.js";

function PardonSearchParams() {}

export function intoSearchParams(
  params:
    | string
    | Record<string, string>
    | [string, string][]
    | URLSearchParams = "",
): URLSearchParams {
  const entries = (
    Array.isArray(params)
      ? params
      : typeof params === "string" || params.entries
        ? parseSearchParams(String(params))
        : params && typeof params === "object"
          ? Object.entries(params)
          : []
  ).filter(([, v]) => v != null);

  const prototype = {
    toString() {
      return entries.length
        ? `?${entries
            .map((kv) =>
              kv
                .filter((kv) => kv != null)
                .map(encode)
                .join("="),
            )
            .join("&")}`
        : "";
    },
    get(k: string) {
      const found = entries.find(([key]) => key == k);
      return found ? (found[1] ?? "") : null;
    },
    append(name: string, value: string) {
      entries.push([name, value]);
    },
    delete(name: string) {
      let next = 0;
      for (;;) {
        next = entries.findIndex(([n]) => n == name, next);
        if (next == -1) {
          break;
        }
        entries.splice(next, 1);
      }
    },
    entries() {
      return entries[Symbol.iterator]();
    },
    has(name, value?: string) {
      return entries.some(([k, v]) => {
        return k === name && (value === undefined || value === v);
      });
    },
    getAll(name) {
      return entries.filter(([key]) => key == name).map(([, v]) => v);
    },
    forEach(callbackfn, thisArg) {
      entries.forEach(([k, v], index) =>
        callbackfn.call(thisArg, k, v, index, this),
      );
    },
    keys() {
      return new Set(entries.map(([k]) => k)).keys();
    },
    set(name, value) {
      const first = entries.findIndex(([k]) => {
        return k === name;
      });
      this.delete(name);
      entries.splice(first, 0, [name, value]);
    },
    sort() {
      entries.sort(
        ([k, v], [j, w]) => k.localeCompare(j) || v.localeCompare(w),
      );
    },
    values() {
      return entries.map(([v]) => v)[Symbol.iterator]();
    },
    get size() {
      return entries.length;
    },
    [Symbol.iterator]() {
      return entries[Symbol.iterator]();
    },
  } satisfies URLSearchParams;

  const urlSearchParams = Object.create(
    PardonSearchParams.prototype,
  ) as URLSearchParams;

  Object.defineProperties(
    urlSearchParams,
    mapObject(
      Object.getOwnPropertyDescriptors(prototype),
      (descriptor) => ({
        ...descriptor,
        enumerable: false,
        configurable: false,
      }),
      true,
    ),
  );

  return urlSearchParams;
}

function encode(s: string) {
  const pattern = patternize(s);

  return depatternize(
    pattern.template.replace(/[ +=&#%]/g, (m) =>
      m === " " ? "+" : encodeURIComponent(m),
    ),
    pattern,
  );
}

function parseSearchParams(params: string): [string, string][] {
  if (!params || params[0] != "?") {
    return [];
  }

  const pattern = patternize(params.slice(1));

  return pattern.template
    .replace(/&$/, "")
    .split("&")
    .map((kv) =>
      (/([^=]*)=?(.*)/.exec(kv)?.slice(1) || [kv]).map((s) =>
        depatternize(decodeURIComponent(s.replace(/[+]/g, " ")), pattern),
      ),
    )
    .map(([k, v]) => [k, v ?? ""]);
}
