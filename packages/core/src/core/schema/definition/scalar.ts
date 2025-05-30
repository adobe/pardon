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

import { mapObject } from "../../../util/mapping.js";
import { createNumber } from "../../raw-json.js";
import { isPatternSimple, patternize } from "../core/pattern.js";
import { SchemaMergingContext } from "../core/types.js";

export type Scalar =
  | string
  | number
  | boolean
  | bigint
  | null
  // eslint-disable-next-line @typescript-eslint/no-wrapper-object-types
  | Number;

export type ScalarType = "string" | "number" | "boolean" | "bigint" | "null";

export function convertScalar(
  value?: Scalar | unknown,
  type?: ScalarType,
  { anull, unboxed }: { anull?: boolean; unboxed?: boolean } = {},
): Scalar | unknown {
  if (value === undefined) {
    return anull ? null : undefined;
  }

  switch (type) {
    case "null":
      return value === "null" ? null : undefined;
    case "boolean":
      return value === "false"
        ? false
        : value === "true"
          ? true
          : typeof value === "boolean" || typeof value === "string"
            ? value
            : Boolean(value);
    case "string":
      return String(value);
    case "number":
      if (value && value instanceof Number) {
        return value;
      }

      if (typeof value === "bigint") {
        value = String(value);
      } else if (typeof value === "string" && !isValidNumberToken(value)) {
        return value;
      }

      return unboxed ? Number(value) : createNumber(String(value));
    case "bigint":
      if (typeof value === "bigint") {
        return value;
      }

      if (value instanceof Number) {
        value = String(value["source"] ?? value);
      } else if (typeof value === "string" && !isValidBigInt(value)) {
        return value;
      }

      return value !== undefined ? BigInt(String(value)) : undefined;
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

      if (typeof value === "bigint") {
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
          : typeof value === "bigint"
            ? "bigint"
            : (typeof value as ScalarType);
}

// 0, 100, 1.1e+10, 1.1e-10
const numberRegex = /^[+-]?(?:0|[1-9][0-9]*(?:[.][0-9]+)?)(?:e[-+]?[0-9]+)?$/;

export function isValidNumberToken(n: string) {
  return numberRegex.test(n);
}

// 0, 100, 1.1e+10, 1.1e-10
const bigIntRegex = /^[+-]?(?:0|[1-9][0-9]*)?$/;

export function isValidBigInt(n: string) {
  return bigIntRegex.test(n);
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

export function unboxValue<T>(value: T): T {
  if (value instanceof Number) {
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
