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

declare global {
  interface ImportMeta {
    /**
     * this is only present within the "pardon" script when loaded
     * by the pardon runtime, and is replaced with the resolved
     * moduleSpecifier of the importing script.
     *
     * It allows flows to refer to files with a path relative to the importing
     * script, rather than relative to the current directory of the runtime.
     */
    parent?: string;
  }
}

import { flow as _flow } from "../core/execution/flow/index.js";
import { FILE as _FILE } from "../runtime/file.js";

export const flow = _flow.rebase(import.meta.parent);
export const FILE = _FILE.rebase(import.meta.parent);

export { pardon, template, type PardonOptions } from "../api/pardon-wrapper.js";

export {
  type Flow,
  type FlowContext,
  type FlowResult,
  type FlowFileName,
  type FlowFunction,
  type FlowParams,
  type FlowParamsDict,
  type FlowParamsList,
  type FlowParamsItem,
} from "../core/execution/flow/index.js";
export { executeHttpsFlowInContext } from "../core/execution/flow/https-flow.js";
export {
  type HttpsFlowConfig,
  type HttpsRequestStep,
  type HttpsResponseStep,
} from "../core/formats/https-fmt.js";
export { type HttpsSequenceInteraction } from "../core/execution/flow/https-flow-types.js";

export { cached, type CacheEntry } from "../api/cached.js";
export { disconnected, shared } from "../core/tracking.js";

export { HTTP } from "../core/formats/http-fmt.js";
export { CURL } from "../core/formats/curl-fmt.js";
export { KV } from "../core/formats/kv-fmt.js";

export { type ScopeData } from "../core/schema/core/types.js";

export { HTTPS, type HttpsScheme } from "../core/formats/https-fmt.js";
export { PardonError } from "../core/error.js";
