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
import type { Schema, SchematicOps, Template } from "../../core/types.js";
import {
  defineSchema,
  defineSchematic,
  executeOp,
  merge,
} from "../../core/schema-ops.js";

export type RedactedOps<T> = SchematicOps<T> & {
  readonly redacted: true;
  readonly template?: Template<T>;
};

export function redact<T>(template?: Template<T>) {
  return defineSchematic<RedactedOps<T>>({
    blend(context, next) {
      const applied = next({ ...context, template });
      return applied && redactSchema(applied);
    },
    expand(context) {
      const schema = context.expand(template);
      return schema && redactSchema(schema);
    },
    redacted: true,
    template,
  });
}

function redactSchema<T = unknown>(schema: Schema<T>): Schema<T> {
  return defineSchema<T>({
    merge(context) {
      const merged = merge(schema, context);

      return merged && redactSchema(merged);
    },
    async render(context) {
      return context.environment.redact({
        value: await executeOp(schema, "render", context),
        context,
        patterns: null,
      }) as T;
    },
    scope(context) {
      executeOp(schema, "scope", context);
    },
  });
}
