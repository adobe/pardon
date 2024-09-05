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
import { SchemaError } from "../../core/schema-error.js";
import {
  SchematicOps,
  Schema,
  defineSchema,
  Template,
  executeOp,
} from "../../core/schema.js";
import { expandTemplate } from "../../template.js";

export type StubOps<T = unknown> = SchematicOps<T> & {
  stub(): true;
  fallback(): Schema<T> | null | undefined;
};

export function stubSchema<T = any>(
  fallbackSchema?: Schema<T> | null,
): Schema<T> {
  return defineSchema<StubOps<T>>({
    merge(context) {
      const { stub } = context;

      if (
        stub === undefined &&
        fallbackSchema === null &&
        context.mode === "match"
      ) {
        throw SchemaError.match.missing(context, {
          note: "stub:required",
        });
      }

      if (stub !== undefined) {
        return expandTemplate(stub as Template<T>, context);
      }

      return stubSchema(fallbackSchema);
    },
    async render(context) {
      if (fallbackSchema === null) {
        throw SchemaError.render.undefined(context, {
          note: "unresolved stub",
        });
      }

      if (fallbackSchema !== undefined) {
        return executeOp(fallbackSchema, "render", context);
      }
    },
    scope(context) {
      if (fallbackSchema) {
        return executeOp(fallbackSchema, "scope", context);
      }
    },
    fallback() {
      return fallbackSchema;
    },
    stub() {
      return true;
    },
  });
}
