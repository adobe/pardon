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
export {
  HTTPS,
  type HttpsScheme,
  type HttpsRequestStep,
  type HttpsResponseStep,
} from "../core/formats/https-fmt.js";

export {
  fetchIntoObject,
  intoFetchParams,
  intoResponseObject,
  type ResponseObject,
  type FetchObject,
} from "../core/request/fetch-pattern.js";

export {
  HTTP,
  type RequestObject,
  type RequestJSON,
  type ResponseJSON,
} from "../core/formats/http-fmt.js";

export { CURL } from "../core/formats/curl-fmt.js";
export { KV } from "../core/formats/kv-fmt.js";
export { valueId } from "../util/value-id.js";
export { cleanObject } from "../util/clean-object.js";

export { intoSearchParams } from "../core/request/search-pattern.js";
export { intoURL } from "../core/request/url-pattern.js";

export { extractKVs, intoArgs } from "../util/kv-options.js";

export {
  applySmokeConfig,
  parseSmokeConfig,
  type SmokeConfig,
} from "../entry/testing/smoke.js";

export { JSON } from "../core/json.js";
