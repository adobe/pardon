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
import { type Generation, fi } from "./core.js";

export function stop(): Generation;

export function stop(key: string, value: unknown): Generation;

export function stop(
  test: (environment: Record<string, any>) => boolean,
): Generation;

export function stop(values: Record<string, any>): Generation;

export function stop(
  condition?:
    | string
    | Record<string, any>
    | ((environment: Record<string, any>) => boolean),
  value?: unknown,
) {
  return condition
    ? (typeof condition === "string"
        ? fi(condition, value)
        : fi(condition)
      ).then(fi(false))
    : fi(false);
}
