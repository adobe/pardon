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
import assert from "node:assert";

function filterActual(actual: unknown, expected: any) {
  if (
    !actual ||
    typeof actual !== "object" ||
    !expected ||
    typeof expected !== "object"
  ) {
    return actual;
  }

  if (Array.isArray(actual) && Array.isArray(expected)) {
    return actual.map((item, idx) => {
      if (idx < expected.length) {
        return filterActual(item, expected[item]);
      }
    });
  }

  return Object.entries(actual)
    .map(([key, value]) => {
      return key in expected
        ? [key, filterActual(value, expected[key])]
        : undefined;
    })
    .filter(Boolean)
    .reduce(
      (map, [key, value]) =>
        Object.assign(map, {
          [key]: value,
        }),
      {},
    );
}

export function deepMatchEqual(
  actual: unknown,
  expected: any,
  message?: string,
) {
  return assert.deepEqual(filterActual(actual, expected), expected, message);
}

export function deepStrictMatchEqual(
  actual: unknown,
  expected: any,
  message?: string,
) {
  return assert.deepStrictEqual(
    filterActual(actual, expected),
    expected,
    message,
  );
}
