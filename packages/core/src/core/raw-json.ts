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

import * as CoreJSON from "core-js-pure/actual/json/index.js";

type CoreJSONModule = Omit<typeof global.JSON, "parse"> & {
  rawJSON(_: string): RawJSON;
  isRawJSON(obj: any): obj is RawJSON;
  parse(
    value: string,
    receiver?: (
      key: string,
      value: any,
      context: { source: string },
    ) => unknown,
  ): any;
};

export type RawJSON = { rawJSON: string };

const { rawJSON, isRawJSON } = CoreJSON.default as CoreJSONModule;

export function createNumber(source: string, value?: number) {
  const numberObject = Object.assign(new Number(value ?? source), { source });

  value ??= Number(source);

  Object.defineProperty(numberObject, "valueOf", {
    value: () => value,
  });

  Object.defineProperty(numberObject, "toString", {
    value: () => source,
  });

  Object.defineProperty(numberObject, "toJSON", {
    value: () => rawJSON(source),
  });

  return numberObject;
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace JSON {
  export type RawJSON = { rawJSON: string };
}

export const JSON: typeof global.JSON &
  Pick<typeof CoreJSON.default, "rawJSON" | "isRawJSON"> & {
    rfc8259: typeof global.JSON;
  } = {
  rfc8259: globalThis.JSON,
  parse(text, reviver) {
    return CoreJSON.default.parse(text, (key, value, { source }) => {
      value = reviver ? reviver(key, value) : value;

      if (typeof value === "number") {
        return createNumber(source, value);
      }

      return value;
    });
  },
  stringify(
    value: any,
    replacer?:
      | ((key: string, value: any) => any)
      | readonly (string | number)[]
      | null,
    space?: string | number,
  ) {
    return CoreJSON.default.stringify(
      value,
      (key, data) => {
        if (Array.isArray(replacer) && !replacer.includes(key)) {
          return;
        }

        if (typeof replacer === "function") {
          data = replacer(key, data);
        }

        if (typeof data?.toJSON === "function") {
          data = data.toJSON();
        }

        if (typeof data === "bigint") {
          return JSON.rawJSON(String(data));
        }

        return data;
      },
      space,
    );
  },
  rawJSON,
  isRawJSON,
  [Symbol.toStringTag]: CoreJSON.default[Symbol.toStringTag],
};
