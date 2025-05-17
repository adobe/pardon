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
  exposeSchematic,
  isSchematic,
  merge,
} from "../../core/schema-ops.js";
import { Schema, SchematicOps, Template } from "../../core/types.js";
import { stubSchema } from "./stub.js";

type HiddenSchematicOps<T> = SchematicOps<T> & {
  readonly hidden: true;
  readonly template?: Template<T>;
};

function defineHiddenSchema<T>(schema: Schema<T>) {
  return defineSchema<T>({
    merge(context) {
      let { template } = context;

      if (template !== undefined) {
        if (isSchematic(template)) {
          const ops = exposeSchematic<HiddenSchematicOps<T>>(template);
          if (ops.hidden) {
            template = ops.template;
          }
        }

        const merged = merge(schema, { ...context, template });
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
export function hiddenTemplate<T = any>(template?: Template<T>) {
  return defineSchematic<HiddenSchematicOps<T>>({
    expand(context) {
      const schema = template ? context.expand(template) : stubSchema();

      return schema && defineHiddenSchema(schema);
    },
    hidden: true,
    template,
  });
}
