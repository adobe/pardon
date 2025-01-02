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
import { diagnostic } from "../../core/context-util.js";
import { defineSchema, executeOp } from "../../core/schema-ops.js";
import { Schema, Template } from "../../core/types.js";
import { expandTemplate } from "../../template.js";

export function stubSchema<T = any>(
  fallbackSchema?: Schema<T> | null,
): Schema<T> {
  return defineSchema<T>({
    merge(context) {
      const { template } = context;

      if (
        template === undefined &&
        fallbackSchema === null &&
        context.mode === "match"
      ) {
        throw diagnostic(context, "required");
      }

      if (template !== undefined) {
        return expandTemplate(template as Template<T>, {
          ...context,
          template: undefined,
        });
      }

      return stubSchema(fallbackSchema);
    },
    async render(context) {
      if (fallbackSchema === null) {
        throw diagnostic(context, "required stub");
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
  });
}
