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

import { isNumberObject } from "node:util/types";
import { JSON } from "../core/raw-json.js";

export function valueId(value: unknown): string {
  switch (typeof value) {
    case "undefined":
      return "";
    case "symbol":
      return "s" + JSON.stringify(value.description);
    case "boolean":
    case "number":
      return String(value);
    case "string":
      return JSON.stringify(value);
    case "bigint":
      return value + "n";
    case "function":
      throw new Error("unexpected function in cache key: " + value);
    case "object":
      if (!value) {
        return String(value);
      }
      if (Array.isArray(value)) {
        return value.map(valueId).join(",");
      }

      if (isNumberObject(value)) {
        return valueId(value["source"] ?? (value.valueOf() as number));
      }

      return `{${Object.entries(value)
        .filter(([k]) => typeof k !== "symbol")
        .sort(([k1], [k2]) => k1.localeCompare(k2))
        .map(([k, v]) => `${k}:${valueId(v)}`)
        .join("-")}}`;
    default:
      return "?";
  }
}
