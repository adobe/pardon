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
  SchemaRenderContext,
} from "../../core/schema.js";
import { rescope } from "../../core/schema-utils.js";
import { stubSchema } from "./stub-schema.js";

type CaptureOps<T> = SchematicOps<T> & {
  capture(): string;
  schema(): Schema<T>;
};

export function captureSchema<T>(
  capture: string,
  schema: Schema<T> = stubSchema(),
): Schema<T> {
  return defineSchema<CaptureOps<T>>({
    merge(context) {
      const merged = executeOp(schema, "merge", context);

      return merged && captureSchema(capture, merged);
    },
    async render(context) {
      return await renderCapture(context);
    },
    scope(context) {
      const { scope } = context;

      scope.declare(capture, {
        context,
        source: `$${capture}`,
        expr: null,
        hint: "@",
        async rendered(context) {
          return renderCapture(rescope(context, scope));
        },
      });

      executeOp(schema, "scope", context);
    },
    capture() {
      return capture;
    },
    schema() {
      return schema;
    },
  });

  async function renderCapture(context: SchemaRenderContext) {
    const value = await executeOp(schema, "render", context);

    // review this: how does the resulting evaluation not identically match the value here?
    if (!context.scope.evaluating(capture)) {
      context.scope.define(context, capture, value);
    }

    return value;
  }
}
