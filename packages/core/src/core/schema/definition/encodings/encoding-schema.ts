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
  SchemaCaptureContext,
  SchemaRenderContext,
  SchemaMergingContext,
  Template,
  extractOps,
} from "../../core/schema.js";
import { SchemaError } from "../../core/schema-error.js";
import {
  expandTemplate,
  templateTrampoline,
  TrampolineOps,
} from "../../template.js";
import { StubOps } from "../structures/stub-schema.js";

export type EncodingType<T, S> = {
  decode(context: SchemaMergingContext<T>): S | undefined;
  encode(output: S | undefined, context: SchemaRenderContext): T | undefined;
};

export type EncodingOps<T, S> = SchematicOps<T> & {
  encoding(): EncodingType<T, S>;
  schema(): Schema<S>;
};

export type EncodingTrampolineOps<T, S> = {
  encoding(): EncodingType<T, S>;
  template(): Template<S>;
};

export function encodingTrampoline<T, S>(
  encoding: EncodingType<T, S>,
  template: Template<S>,
): Schema<T> {
  return templateTrampoline(
    (context) =>
      encodingSchema<T, S>(
        encoding,
        expandTemplate<S>(template, context as SchemaMergingContext<S & T>),
      ),
    {
      encoding() {
        return encoding;
      },
      template() {
        return template;
      },
    } satisfies EncodingTrampolineOps<T, S>,
  );
}

function decode<T, S>(
  context: SchemaMergingContext<T>,
  encoding: EncodingType<T, S>,
) {
  while (typeof context.stub === "function") {
    const ops = extractOps(context.stub as Schema<T>) as Partial<
      EncodingTrampolineOps<T, S> &
        StubOps &
        TrampolineOps<T, S> & {
          mode(): SchemaMergingContext<unknown>["mode"];
        }
    >;

    if (ops.trampoline && ops.template && ops.encoding?.() === encoding) {
      return ops.template();
    }

    if (ops.stub) {
      context = { ...context, stub: undefined };
    }

    break;
  }

  return encoding.decode(context);
}

export function encodingSchema<T, S>(
  encoding: EncodingType<T, S>,
  schema: Schema<S>,
): Schema<T> {
  return defineSchema<EncodingOps<T, S>>({
    merge(context) {
      try {
        const stub = decode(context, encoding) as S;
        const result = executeOp(schema, "merge", { ...context, stub });

        return result && encodingSchema(encoding, result);
      } catch (error) {
        throw SchemaError.match.mismatch(context, {
          cause: error,
        });
      }
    },

    async render(context) {
      const rendered = await executeOp(schema, "render", context);

      if (rendered !== undefined) {
        return encoding.encode(rendered, context);
      }

      return undefined;
    },

    scope(context) {
      executeOp(schema, "scope", context as SchemaCaptureContext<S>);
    },

    encoding() {
      return encoding;
    },

    schema() {
      return schema;
    },
  });
}
