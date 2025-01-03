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
  Schematic,
  SchematicOps,
  Template,
} from "../../core/types.js";
import {
  defineSchema,
  defineSchematic,
  executeOp,
  exposeSchematic,
  merge,
} from "../../core/schema-ops.js";

export type EncodingType<T, S> = {
  as: T extends string ? "string" : Exclude<string, "string">;
  decode(context: SchemaMergingContext<T>): S | undefined;
  encode(output: S | undefined, context: SchemaRenderContext): T | undefined;
};

function decode<T, S>(
  context: SchemaMergingContext<T>,
  encoding: EncodingType<T, S>,
): SchemaMergingContext<S> | undefined {
  if (typeof context.template === "function") {
    const ops = exposeSchematic<EncodingSchematicOps<T, S>>(
      context.template as Schematic<T>,
    );

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
): Schematic<T> {
  return defineSchematic<EncodingSchematicOps<T, S>>({
    expand(context) {
      return encodingSchema(encoding, context.expand(template));
    },
    encoding() {
      return encoding;
    },
    template() {
      return template;
    },
  });
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
        throw diagnostic(context, error);
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
