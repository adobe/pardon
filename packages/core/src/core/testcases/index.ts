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
  type CaseContext,
  shuffle,
  sort,
  exe,
  fun,
  generateCases,
  local,
  fi,
  debug,
  normalize,
  get,
} from "./core.js";

import { set } from "./set.js";
import { def } from "./def.js";
import { defi } from "./defi.js";
import { counter } from "./counter.js";
import { robin } from "./robin.js";
import { each } from "./each.js";
import { format } from "./format.js";
import { stop } from "./stop.js";
import { repeat } from "./repeat.js";
import { unique } from "./unique.js";
import { unset } from "./unset.js";
import { page, skip, take } from "./page.js";
import { smoke } from "./smoke.js";

export { CaseContext };

const CaseHelpers = Object.freeze({
  set,
  get,
  def,
  defi,
  unset,
  each,
  repeat,
  robin,
  fi,
  stop,
  fun,
  exe,
  counter,
  format,
  unique,
  local,
  page,
  skip,
  take,
  smoke,
  shuffle,
  sort,
  debug,
});

export type CaseHelpers = typeof CaseHelpers;

// hint that description() itself cannot be async
export default async function describeCases(
  description: (arg: CaseHelpers) => Promise<void>,
  contexts?: CaseContext[],
): Promise<never>;
export default async function describeCases(
  description: (arg: CaseHelpers) => void,
  contexts?: CaseContext[],
): Promise<CaseContext[]>;
export default async function describeCases(
  description: (arg: CaseHelpers) => void,
  contexts?: CaseContext[],
) {
  try {
    return (await generateCases(() => description(CaseHelpers), contexts)).map(
      normalize,
    );
  } catch (error) {
    console.warn("error describing testcases", error);
    throw error;
  }
}
