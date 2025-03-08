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
export { pardon, template, type PardonOptions } from "../api/pardon-wrapper.js";
export {
  flow,
  type FlowContext,
  type FlowResult,
  type FlowName,
} from "../core/execution/flow/index.js";

export { cached, type CacheEntry } from "../api/cached.js";
export { disconnected, shared } from "../core/tracking.js";

export { HTTP } from "../core/formats/http-fmt.js";
export { CURL } from "../core/formats/curl-fmt.js";
export { KV } from "../core/formats/kv-fmt.js";

export { type ScopeData } from "../core/schema/core/types.js";
export {
  unredactedValues,
  unredactedScalarValues,
} from "../core/schema/core/schema-utils.js";

export { HTTPS, type HttpsScheme } from "../core/formats/https-fmt.js";
export { PardonError } from "../core/error.js";

import { readFile } from "node:fs/promises";
import { homely } from "../util/resolvehome.js";

export const FILE = {
  text,
  json,
};

async function text(path: string) {
  return (await readFile(homely(path), "utf-8")).trimEnd();
}

async function json(path: string) {
  return JSON.parse(await text(path));
}
