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
  defineSchema,
  defineSchematic,
  executeOp,
  merge,
} from "../../core/schema-ops.js";
import { Schema, Template } from "../../core/types.js";
import { expandTemplate } from "../../template.js";
import { stubSchema } from "./stub.js";

function defineHiddenSchema<T>(schema: Schema<T>) {
  return defineSchema<T>({
    merge(context) {
      const { template } = context;

      if (template !== undefined) {
        const merged = merge(schema, context);
        return merged && defineHiddenSchema(merged);
      }

      return defineHiddenSchema(schema);
    },
    async render() {
      return undefined!;
    },
    scope(context) {
      return executeOp(schema, "scope", context);
    },
  });
}

/**
 * Hidden schemas provide a way to place computed values into the scope
 * that won't try to evaluate or render unless needed.
 */
export function hiddenTemplate<T = any>(template?: Template<T>): Template<T> {
  return defineSchematic({
    expand(context) {
      const schema = template
        ? expandTemplate(template, context)
        : stubSchema();

      return defineHiddenSchema(schema);
    },
  });
}
