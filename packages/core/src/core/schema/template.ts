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
import { mapObject } from "../../util/mapping.js";
import { arrays, scalars, objects } from "./definition/index.js";
import {
  Template,
  Schema,
  SchemaMergingContext,
  defineSchema,
  SchematicOps,
  extractOps,
} from "./core/schema.js";
import { createMergingContext, keyContext } from "./core/context.js";
import { stubSchema } from "./definition/structures/stub-schema.js";
import { isScalar } from "./definition/scalars.js";
import { TrampolineModeOps } from "./scheming.js";

export type TrampolineOps<T, S> = SchematicOps<T> & {
  trampoline(context: SchemaMergingContext<T>): Schema<S>;
};

export function templateTrampoline<
  T,
  S = T,
  E extends Record<string, unknown> = Record<never, never>,
>(trampoline: (context: SchemaMergingContext<T>) => Schema<S>, extension?: E) {
  return defineSchema<TrampolineOps<T, S>>(
    Object.assign(
      {
        trampoline(context: SchemaMergingContext<T>) {
          return trampoline(context);
        },
        merge() {
          throw new Error("unbounced trampoline");
        },
        render() {
          throw new Error("unbounced trampoline");
        },
        scope() {
          throw new Error("unbounced trampoline");
        },
      },
      extension ?? {},
    ),
  );
}

export function templateInContext<T>(
  context: SchemaMergingContext<T>,
): Schema<T> {
  const { mode, stub: template } = context;

  if (Array.isArray(template)) {
    if (mode === "mix") {
      // auto arrays of length == 1 are
      // treated as rules to apply to all
      // elements.
      return expandTemplate(
        arrays.auto(
          template.map(
            (item, idx) => expandTemplate(item, keyContext(context, idx))!,
          ),
        ) as Template<T>,
        context,
      ) as any;
    }

    // otherwise treat them as a tuple
    return arrays.tuple(
      template.map(
        (item, idx) => expandTemplate(item, keyContext(context, idx))!,
      ),
    ) as any;
  }

  if (template && typeof template == "object") {
    // special case for {}, treat as an untyped stub.
    // this prevents {} matched with [{...}] from becoming { "0": { ... } }
    // or being an error.
    if (Object.keys(template).length === 0) {
      return stubSchema(objects.object({}));
    }

    return objects.object(
      mapObject(
        template as Record<string, unknown>,
        (value, key) => expandTemplate(value, keyContext(context, key))!,
      ),
    ) as any;
  }

  if (typeof template === "function") {
    const ops = extractOps<TrampolineOps<unknown, unknown>>(
      template as Schema<unknown>,
    );
    if (ops.trampoline) {
      return expandTemplate(ops.trampoline(context) as Template<T>, context);
    } else {
      return template as Schema<T>;
    }
  }

  if (isScalar(template)) {
    if (mode === "match") {
      return scalars.antipattern(template);
    } else {
      return scalars.any(template);
    }
  }

  return stubSchema(); // scalars.any(schema as string | number | boolean);
}

export function expandTemplate<T>(
  template: Template<T>,
  context: SchemaMergingContext<T>,
): Schema<T> {
  // sometimes we need to trampoline without losing the context stub
  if (typeof template === "function") {
    const ops = extractOps<TrampolineOps<T, unknown>>(template as Schema<T>);

    if (ops.trampoline) {
      return expandTemplate(ops.trampoline(context), context) as Schema<T>;
    }
  }

  // is this good enough?
  // Okay to just discard the context.stub here if template is passed?
  return templateInContext({ ...context, stub: template }) as Schema<T>;
}

export function applyModeTrampoline<T>(
  context: SchemaMergingContext<T>,
): SchemaMergingContext<T> {
  while (typeof context.stub === "function") {
    const { trampoline, mode, template } = extractOps<
      SchematicOps<unknown> &
        Partial<TrampolineModeOps & TrampolineOps<unknown, unknown>>
    >(context.stub as Schema<T>);

    if (trampoline) {
      context = {
        ...context,
        ...(mode && { mode: mode() }),
        stub: template?.() as T,
      };
      continue;
    }

    break;
  }

  return context;
}

// TODO: remove these or can we pass phase in from context at call site?
export function mixing<T>(template: Template<T>) {
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
