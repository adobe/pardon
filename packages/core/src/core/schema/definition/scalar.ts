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

import { mapObject } from "../../../util/mapping.js";
import { JSON } from "../../json.js";
import { DEBUG } from "../core/debugging.js";
import { isPatternSimple, patternize } from "../core/pattern.js";
import { SchemaMergingContext } from "../core/types.js";

export type Scalar =
  | string
  | number
  | boolean
  | bigint
  | null
  // eslint-disable-next-line @typescript-eslint/no-wrapper-object-types
  | Number
  // eslint-disable-next-line @typescript-eslint/no-wrapper-object-types
  | BigInt;

export type ScalarType = "string" | "number" | "boolean" | "bigint" | "null";

export function convertScalar(
  value?: Scalar | unknown,
  type?: ScalarType,
  anull?: boolean,
): Scalar | unknown {
  if (value === undefined) {
    return anull ? null : undefined;
  }

  switch (type) {
    case "null":
      return value === "null" ? null : undefined;
    case "boolean":
      return value === "false" ? false : Boolean(value);
    case "number":
      if (value && value instanceof Number) {
        return value;
      }

      if (value && value instanceof BigInt) {
        return createNumber(value["source"]);
      }

      return createNumber(String(value));
    case "string":
      return String(value);
    case "bigint":
      if (value && value instanceof Number) {
        return createBigInt(value["source"]);
      }

      if (value && value instanceof BigInt) {
        return value;
      }

      return value !== undefined ? createBigInt(String(value)) : undefined;
    default:
      return value;
  }
}

export function isScalar(value: unknown): value is Scalar {
  switch (typeof value) {
    case "string":
    case "number":
    case "bigint":
    case "boolean":
      return true;
    case "object":
      if (value === null) {
        return true;
      }

      if (value instanceof Number) {
        return true;
      }

      if (value instanceof BigInt) {
        return true;
      }

      break;
  }
  return false;
}

export function scalarTypeOf(value?: unknown): ScalarType | undefined {
  return !isScalar(value)
    ? undefined
    : value === undefined
      ? undefined
      : value === null
        ? "null"
        : value instanceof Number
          ? "number"
          : value instanceof BigInt
            ? "bigint"
            : (typeof value as ScalarType);
}

export function createNumber(source: string, value?: number) {
  const numberObject = Object.assign(new Number(value ?? source), { source });

  if (DEBUG) {
    Object.defineProperty(numberObject, "valueOf", {
      value() {
        return Number(value ?? source);
      },
    });
  }

  Object.defineProperty(numberObject, "toString", {
    value() {
      return String(source);
    },
  });

  Object.defineProperty(numberObject, "toJSON", {
    value() {
      return JSON.rawJSON(source);
    },
  });

  return numberObject;
}

export function createBigInt(source: string, value?: bigint) {
  const bigintObject = Object.assign(Object(BigInt(value ?? source)), {
    source,
  });

  Object.defineProperty(bigintObject, "toJSON", {
    value() {
      return JSON.rawJSON(source);
    },
  });

  JSON.stringify({ test: bigintObject });

  return bigintObject;
}

export function scalarFuzzyTypeOf<T>(
  context: SchemaMergingContext<T>,
  value?: NoInfer<T> | string,
): ScalarType | undefined {
  if (
    context.mode !== "match" &&
    typeof value === "string" &&
    isPatternSimple(patternize(value))
  ) {
    return undefined;
  }

  return scalarTypeOf(value);
}

export function boxScalar<T>(value: T): T {
  if (!isScalar(value)) {
    return value;
  }

  if (typeof value === "number") {
    return createNumber(String(value)) as T;
  }

  if (typeof value === "bigint") {
    return createBigInt(String(value)) as T;
  }

  return value;
}

export function boxObject<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(boxObject) as T;
  }

  if (
    value &&
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    return mapObject(value as Record<string, unknown>, (value) =>
      boxObject(value),
    ) as T;
  }

  return boxScalar(value);
}

export function unboxValue<T>(value: T): T {
  if (value instanceof Number || value instanceof BigInt) {
    return value?.valueOf ? (value.valueOf() as T) : value;
  }
  return value;
}

export function unboxObject<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(unboxObject) as T;
  }

  if (
    value &&
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    return mapObject(value as Record<string, unknown>, (value) =>
      unboxObject(value),
    ) as T;
  }

  return unboxValue(value);
}
