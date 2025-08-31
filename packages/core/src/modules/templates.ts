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
  ScriptEnvironment,
  ScriptOptions,
} from "../core/schema/core/script-environment.js";

export type { Schema, Template } from "../core/schema/core/types.js";
export { jsonEncoding as json } from "../core/request/body-template.js";
export { bodyTemplate as body } from "../core/request/https-template.js";
export { scalars } from "../core/schema/definition/index.js";
export { expandTemplate } from "../core/schema/template.js";
export {
  mergeSchema as merge,
  renderSchema as render,
} from "../core/schema/core/schema-utils.js";
export { stubSchema as seed } from "../core/schema/definition/structures/stub.js";

export function createScriptEnvironment({
  values: input = {},
  options,
}: {
  values?: Record<string, any>;
  options?: ScriptOptions;
} = {}) {
  return new ScriptEnvironment({ input, options });
}
