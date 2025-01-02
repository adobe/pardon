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
import { createMergingContext } from "./core/context.js";
import { diagnostic, loc } from "./core/context-util.js";
import { stubSchema } from "./definition/structures/stub.js";
import { expandArray } from "./definition/arrays.js";
import { expandObject } from "./definition/objects.js";
import {
  Schema,
  SchemaMergingContext,
  SchemaOps,
  Schematic,
  SchematicOps,
  Template,
} from "./core/types.js";
import {
  defineSchematic,
  exposeSchematic,
  isSchema,
  isSchematic,
} from "./core/schema-ops.js";
import { datums } from "./definition/datum.js";
import { isScalar } from "./definition/scalar.js";

export function templateSchematic<
  T,
  E extends Record<string, unknown> = Record<never, never>,
>(
  expand: (context: SchemaMergingContext<T>) => Schema<T> | Template<T>,
  extension: E,
): Schematic<T> {
  return defineSchematic({
    expand(context) {
      const schemaOrTemplate = expand(context);

      if (isSchematic(schemaOrTemplate)) {
        return expandTemplate(schemaOrTemplate, context) as Schema<T>;
      } else if (isSchema(schemaOrTemplate)) {
        return schemaOrTemplate;
      }

      throw diagnostic(
        context,
        "error expanding template schematic, got: " + schemaOrTemplate,
      );
    },
    ...extension,
  });
}

export function expandInContext<T>(
  context: SchemaMergingContext<T>,
): Schema<T> {
  let { mode, template } = context;

  if (isScalar(template)) {
    if (mode === "match") {
      template = datums.antipattern(template);
    } else {
      template = datums.datum(template);
    }
  }

  if (Array.isArray(template)) {
    return expandArray(
      context as SchemaMergingContext<T extends unknown[] ? T : never>,
    ) as Schema<T>;
  }

  if (template && typeof template == "object") {
    return expandObject(
      context as SchemaMergingContext<
        T extends Record<string, unknown> ? T : never
      >,
    );
  }

  if (typeof template === "function") {
    const ops = exposeSchematic<SchematicOps<T> & SchemaOps<T>>(
      template as Schematic<T>,
    );

    if (ops.expand && !ops.render) {
      return ops.expand(context);
    } else {
      return template as Schema<T>;
    }
  }

  return stubSchema(); // scalars.any(schema as string | number | boolean);
}

export function expandTemplate<T>(
  template: Template<T> | undefined,
  context: SchemaMergingContext<T>,
): Schema<T> {
  if (isSchematic(template)) {
    const schema = template().expand(context);
    if (isSchematic(schema)) {
      const templateKeys = Object.keys(template()).join("/");
      const schemaKeys = Object.keys(template()).join("/");

      console.error(
        `${loc(context)} expanding template produced a template (${templateKeys}) -> (${schemaKeys})`,
      );

      throw new Error("expand produced a template");
    }

    return schema;
  }

  return expandInContext({ ...context, template }) as Schema<T>;
}

// TODO: remove these or can we pass phase in from context at call site?
export function mixing<T>(template: Template<T>): Schema<T> {
  return expandTemplate<T>(
    template,
    createMergingContext(
      { mode: "mix", phase: "build" },
      stubSchema(),
      undefined,
    ),
  );
}

export function matching<T>(template: Template<T>) {
  return expandTemplate<T>(
    template,
    createMergingContext(
      { mode: "match", phase: "build" },
      stubSchema(),
      undefined,
    ),
  );
}

export function muxing<T>(template: Template<T>) {
  return expandTemplate<T>(
    template,
    createMergingContext(
      { mode: "mux", phase: "build" },
      stubSchema(),
      undefined,
    ),
  );
}
