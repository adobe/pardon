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
import {
  type Generation,
  type Alternation,
  type CaseValues,
  generation,
  apply,
  normalize,
} from "./core.js";

export function set(key: string, value: unknown): Generation;
export function set(
  values: CaseValues | ((env: CaseValues) => CaseValues),
): Generation;

export function set(
  values: string | CaseValues | { (env: CaseValues): CaseValues } | Alternation,
  value?: unknown,
) {
  if (typeof values === "string") {
    values = { [values]: value! };
  }

  if (typeof values === "function") {
    return generation((context) =>
      apply(context, (values as any)(normalize(context).environment)),
    );
  }

  return generation((context) =>
    apply(context, values as Exclude<typeof values, string>),
  );
}
