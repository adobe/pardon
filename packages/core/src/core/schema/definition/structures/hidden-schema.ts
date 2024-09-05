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
} from "../../core/schema.js";
import { stubSchema } from "./stub-schema.js";

export type HiddenSchemaOps<T = unknown> = SchematicOps<T> & {
  schema(): Schema<T>;
  norender(): true;
};

/**
 * Hidden schemas provide a way to place computed values into the scope
 * that won't try to evaluate or render unless needed.
 */
export function hiddenSchema<T = any>(
  schema: Schema<T> = stubSchema(),
): Schema<T> {
  return defineSchema<HiddenSchemaOps<T>>({
    merge(context) {
      const { stub } = context;

      if (stub !== undefined) {
        return hiddenSchema(executeOp(schema, "merge", context));
      }

      return hiddenSchema(schema);
    },
    async render() {
      return undefined!;
    },
    scope(context) {
      return executeOp(schema, "scope", context);
    },
    norender() {
      return true;
    },
    schema() {
      return schema;
    },
  });
}
