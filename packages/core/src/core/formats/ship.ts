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

import { mapObject } from "../../util/mapping.js";
import { createBigInt, createNumber } from "../json.js";

export function ship<T>(value: T): T {
  switch (true) {
    case typeof value === "function":
      return undefined!;
    case !value || typeof value !== "object": {
      return value;
    }
    case Array.isArray(value):
      return value.map(ship) as T;
    case value instanceof Number:
    case value instanceof BigInt: {
      return {
        $$$type: value instanceof Number ? "number" : "bigint",
        source: value["source"],
      } as T;
    }
    default:
      return mapObject(value as any, ship) as T;
  }
}

export function recv<T>(value: T): T {
  switch (true) {
    case !value || typeof value !== "object":
      return value;
    case Array.isArray(value):
      return value.map(recv) as T;
    case value?.["$$$type"] === "number": {
      return createNumber(value["source"] as string) as T;
    }
    case value?.["$$$type"] === "bigint": {
      return createBigInt(value["source"] as string) as T;
    }
    default:
      return mapObject(value as any, recv) as T;
  }
}
