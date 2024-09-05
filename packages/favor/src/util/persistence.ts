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

import { type PersistenceOptions } from "@solid-primitives/storage";
import { JSON } from "pardon/formats";
import { mapObject } from "pardon/utils";

export const persistJson: Pick<
  PersistenceOptions<any, any>,
  "serialize" | "deserialize"
> = {
  serialize(data) {
    return JSON.stringify(data, (_key, value) => {
      if (value instanceof BigInt || typeof value === "bigint") {
        return JSON.rawJSON(String(value));
      }

      if (value instanceof Number) {
        return JSON.rawJSON(value["source"]);
      }

      return value;
    });
  },
  deserialize(data) {
    return JSON.parse(data, (key, value, { source }) => {
      if (typeof value === "number") {
        return Object.assign(new Number(value), {
          source,
          toJSON() {
            return JSON.rawJSON(source);
          },
        });
      }
    });
  },
};

export function recv<T>(value: T): T {
  switch (true) {
    case !value || typeof value !== "object":
      return value;
    case Array.isArray(value):
      return value.map(recv) as T;
    case value?.["$$$type"] === "number":
      return Object.assign(new Number(value["value"]), {
        source: value["source"],
        toJSON() {
          return value["source"];
        },
      }) as T;
    case value?.["$$$type"] === "bigint":
      return Object.assign(Object(BigInt(value["value"])), {
        source: value["source"],
        toJSON() {
          return value["source"];
        },
      }) as T;
    default:
      return mapObject(value as any, recv) as T;
  }
}
