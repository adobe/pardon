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
import { isMergingContext } from "../../core/schema.js";
import { diagnostic } from "../../core/context-util.js";
import {
  Schema,
  SchemaMergingContext,
  SchemaRenderContext,
  SchematicOps,
  Template,
} from "../../core/types.js";
import {
  defineSchema,
  executeOp,
  exposeSchematic,
  isSchematic,
  merge,
} from "../../core/schema-ops.js";
import { templateSchematic } from "../../template.js";

export type EncodingType<Outer, Inner> = {
  as: Outer extends string ? "string" : Exclude<string, "string">;
  decode(context: SchemaMergingContext<Outer>): Template<Inner> | undefined;
  encode(
    value: Inner | undefined,
    context: SchemaRenderContext,
  ): Outer | undefined;
};

function decode<T, S>(
  context: SchemaMergingContext<T>,
  encoding: EncodingType<T, S>,
): SchemaMergingContext<S> | undefined {
  if (isSchematic(context.template)) {
    const ops = exposeSchematic<EncodingSchematicOps<T, S>>(context.template);

    if (!ops.encoding) {
      throw diagnostic(
        context,
        `cannot merge encoding with non-encoding template (${Object.keys(ops).join("/")})`,
      );
    }

    if (ops.encoding() !== encoding) {
      diagnostic(context, "cannot merge with different encoding");
      return undefined;
    }

    return { ...context, template: ops.template!() };
  }

  return { ...context, template: encoding.decode(context) };
}

export type EncodingSchematicOps<T, S> = SchematicOps<T> & {
  encoding(): EncodingType<T, S>;
  template(): Template<S> | undefined;
};

export function encodingTemplate<T, S>(
  encoding: EncodingType<T, S>,
  template?: Template<S>,
  source?: NoInfer<S>,
): Template<T> {
  return templateSchematic(
    (context) => {
      let inner: Schema<S> | undefined = context.expand(template);
      if (inner && source !== undefined) {
        inner = merge(inner, { ...context, template: source });
      }
      return (inner && encodingSchema(encoding, inner))!;
    },
    {
      encoding() {
        return encoding;
      },
      template() {
        return template;
      },
    },
  );
}

export function encodingSchema<T, S>(
  encoding: EncodingType<T, S>,
  schema: Schema<S>,
): Schema<T> {
  return defineSchema<T>({
    merge(context) {
      try {
        const decoded = decode(context, encoding);
        const result = decoded && merge(schema, decoded);

        return result && encodingSchema(encoding, result);
      } catch (error) {
        diagnostic(context, error);
        return undefined;
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
      if (!isMergingContext(context)) {
        executeOp(schema, "scope", context);
        return;
      }

      // would be nice to combine scope and merge operations
      // to avoid decoding here and in merge.
      const decoded = decode(context, encoding);
      if (decoded) {
        executeOp(schema, "scope", decoded);
      }
    },
  });
}
