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
import { PardonRuntime } from "../core/pardon/types.js";
import { cacheOps, type CacheEntry } from "../db/entities/cache-entity.js";
import { pardonRuntime } from "../runtime/runtime-deferred.js";

export type { CacheEntry };

let runtime: PardonRuntime;
pardonRuntime().then((runtime_) => (runtime = runtime_));

export function cached<T>(
  ...[key, loader]: Parameters<ReturnType<typeof cacheOps>["cached"]>
) {
  if (!runtime) {
    throw new Error("cached: no pardon runtime context loaded");
  }

  return cacheOps(runtime.database).cached<T>(
    key,
    loader as () => Promise<CacheEntry<T>>,
  );
}
