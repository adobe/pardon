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
import { type Generation, type CaseValues, fi } from "./core.js";
import { def } from "./def.js";
import { each } from "./each.js";

export function defi(
  key: string,
  value: unknown,
  allowed?: unknown,
): Generation;
export function defi(
  mapping: CaseValues | ((env: CaseValues) => CaseValues),
  allowed?: CaseValues | ((env: CaseValues) => CaseValues),
): Generation;

export function defi(
  values: string | CaseValues | { (env: CaseValues): CaseValues },
  value?: unknown,
  allowed?: unknown,
) {
  if (typeof values === "string") {
    allowed = { [values]: allowed };
    values = { [values]: value! };
    value = undefined;
  } else {
    allowed = value;
  }

  return each(() => {
    def(values);
    fi(values).else(() => {
      fi(allowed ?? false);
    });
  });
}
