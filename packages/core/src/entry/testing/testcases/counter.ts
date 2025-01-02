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
import { type Alternation, type Generation, computed } from "./core.js";
import { set } from "./set.js";

export function counter(key: string, n?: number): Generation;
export function counter(n?: number): Alternation;

export function counter(
  key?: string | number,
  n?: number,
): Generation | Alternation {
  if (typeof n === "number" || typeof key === "string") {
    n ??= 0;
    return set(
      key as string,
      computed(() => n!++),
    );
  }

  n = (key as number) ?? 0;
  return computed(() => n!++);
}
