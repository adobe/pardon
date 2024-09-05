/*
Copyright 2024 Adobe. All rights reserved.
This file is licensed to you under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License. You may obtain a copy
of the License at http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed under
the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
OF ANY KIND, either express or implied. See the License for the specific language
governing permissions and limitations under the License.
*/
import {
  SchematicOps,
  Schema,
  defineSchema,
  executeOp,
  Template,
  SchemaMergingContext,
} from "../../core/schema.js";
import { expandTemplate } from "../../template.js";

export type DeferredSchemaRule<T> = (
  context: SchemaMergingContext<unknown>,
) => Schema<T> | undefined;

type DeferredSchemaOps<T = unknown> = SchematicOps<T> & {
  rule(): DeferredSchemaRule<T>;
  schema(): Schema<T>;
};

export function deferredSchema<T = unknown>(
  rule: DeferredSchemaRule<T>,
  schema: Schema<T>,
): Schema<T> {
  return defineSchema<DeferredSchemaOps<T>>({
    merge(context) {
      const result = rule(context) ?? context.stub;

      if (typeof result === "function") {
        return expandTemplate(result as Template<T>, context);
      }

      const merged = executeOp(schema, "merge", {
        ...context,
        stub: result,
      });

      return merged && deferredSchema(rule, merged);
    },
    async render(context) {
      return await executeOp(schema, "render", context);
    },
    scope(context) {
      executeOp(schema, "scope", context);
    },
    schema() {
      return schema;
    },
    rule() {
      return rule;
    },
  });
}
