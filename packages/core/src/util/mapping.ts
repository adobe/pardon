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

// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="../tsreset.d.ts" />

export function arrayIntoObject<E, T>(
  arr: E[],
  mapper: (
    item: E,
    idx: number,
  ) => Record<string, T> | false | null | "" | undefined,
  merger: (
    acc: Record<string, T>,
    values: Record<string, T>,
  ) => Record<string, T> = (map, values) => Object.assign(map, values),
): Record<string, T> {
  if (!Array.isArray(arr)) {
    throw new Error("wrong type for array: " + arr);
  }

  return arr
    .map((item, idx) => mapper(item, idx))
    .filter(Boolean)
    .reduce(merger, {});
}

export async function arrayIntoObjectAsync<E, T>(
  arr: E[],
  mapper: (
    item: E,
    idx: number,
  ) => Promise<Record<string, T> | false | null | undefined>,
  merger: (
    acc: Record<string, T>,
    values: Record<string, T>,
  ) => Record<string, T> = (map, values) => Object.assign(map, values),
): Promise<Record<string, T>> {
  return (await Promise.all(arr.map((item, idx) => mapper(item, idx))))
    .filter(Boolean)
    .reduce(merger, {} as Record<string, T>);
}

type ObjectMapper<T, S> = {
  values(value: T, key: string): S;
  select(value: T, key: string | symbol): boolean;
  keys(key: string, value: T, mapped: S): string;
  filter: { (key: string, mapped: S): boolean | undefined | void } | RegExp;
};

export function definedObject<M extends Record<string, unknown>>(
  map: M,
): { [k in keyof Partial<M>]: Exclude<M[k], undefined> } {
  return mapObject(map, {
    select(value) {
      return value !== undefined;
    },
  }) as { [k in keyof Partial<M>]: Exclude<M[k], undefined> };
}

export function mapObject<T, S = T>(
  map: Record<string, T>,
  mapper: Partial<ObjectMapper<T, S>> | ObjectMapper<T, S>["values"],
  includeSymbols = false,
) {
  const {
    values = typeof mapper == "function" ? mapper : (v) => v,
    keys = (k) => k,
    select = () => true,
    filter,
  } = typeof mapper !== "function" ? mapper : ({} as ObjectMapper<T, S>);

  const filterfn =
    filter &&
    (typeof filter === "function" ? filter : (key: string) => filter.test(key));

  return arrayIntoObject(
    includeSymbols
      ? [
          ...Object.entries(map || {}).filter(
            ([k, v]) => typeof k === "string" && select(v, k),
          ),
          ...(Object.getOwnPropertySymbols(map)
            .filter((k) => select(map[k as any], k))
            .map((k) => [k, map[k as any]]) as [string, any]),
        ]
      : Object.entries(map || {}).filter(
          ([k, v]) => typeof k === "string" && select(v, k),
        ),
    ([k, v]) => {
      const nv = values(v, k) as S;
      const nk = keys(k, v, nv);

      if (!(!filterfn || filterfn(nk, nv))) {
        return {};
      }

      return { [nk]: nv };
    },
  );
}

type ObjectMapperAsync<T, S> = {
  values(value: T, key: string): S | Promise<S>;
  select(value: T, key: string): boolean;
  keys(key: string, value: T, mapped: S): string | Promise<string>;
  filter: { (key: string, mapped: S): boolean | Promise<boolean> } | RegExp;
};

export async function mapObjectAsync<T, S = T>(
  map: Record<string, T>,
  mapper:
    | Partial<ObjectMapperAsync<T, S>>
    | ObjectMapperAsync<T, S>["values"] = {},
) {
  const {
    values = typeof mapper == "function" ? mapper : (v) => v,
    keys = (k) => k,
    select = () => true,
    filter,
  } = typeof mapper !== "function" ? mapper : ({} as ObjectMapperAsync<T, S>);

  const filterfn =
    filter &&
    (typeof filter === "function" ? filter : (key: string) => filter.test(key));

  return arrayIntoObjectAsync(
    Object.entries(map || {}).filter(
      ([k, v]) => typeof k === "string" && select(v, k),
    ),
    async ([k, v]) => {
      const nv = (await values(v, k)) as S;
      const nk = await keys(k, v, nv);

      if (!(!filterfn || (await filterfn(nk, nv)))) {
        return;
      }

      return { [nk]: nv };
    },
  );
}
