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
import { arrayIntoObject } from "../../util/mapping.js";
import type { CaseHelpers } from "../../core/testcases/index.js";

export type SmokeConfig = {
  smoke: number | Record<string, number>;
  shuffle?: number;
  per?: string[];
};

export function parseSmokeConfig(smokeSpec?: string): SmokeConfig | undefined {
  if (!smokeSpec) {
    return;
  }

  const [, keys, per, shuffle] = /^([^~%]*)(?:%([^~]*))?(?:~([0-9]+))?$/.exec(
    smokeSpec,
  )!;

  const parts = keys.split(",");
  let defaultLimit: number | undefined;
  if (/^[0-9]+$/.test(parts[0] as string)) {
    defaultLimit = Number(parts.splice(0, 1));
  }

  const kn = (parts as string[]).map((part) =>
    /^(.*?)(?::([0-9]+))?$/.exec(part),
  );

  const smokeLimits = arrayIntoObject(kn as string[][], ([, k, n]) => ({
    [k]: n ? Number(n) : (defaultLimit ?? 1),
  }));
  return {
    smoke:
      Object.keys(smokeLimits).length === 0 ? (defaultLimit ?? 1) : smokeLimits,
    shuffle: shuffle ? Number(shuffle) : undefined,
    per: per !== undefined ? per.split(",").filter(Boolean) : undefined,
  };
}

export function applySmokeConfig(
  helpers: CaseHelpers,
  smokeConfig?: SmokeConfig,
) {
  if (!smokeConfig) {
    return;
  }

  (({ smoke, exe, config }) => {
    smoke(config.smoke)
      .per(
        ...(config.per ?? ["trial"]).map((per) =>
          per !== "trial" ? per : exe("trial"),
        ),
      )
      .shuffled(config.shuffle);
  })({
    ...helpers,
    config: smokeConfig,
  });
}
