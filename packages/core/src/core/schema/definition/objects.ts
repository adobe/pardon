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
import { mapObjectAsync } from "../../../util/mapping.js";
import { isMergingContext } from "../core/schema.js";
import { stubSchema } from "./structures/stub.js";
import {
  Schema,
  SchemaContext,
  SchemaMergingContext,
  SchemaRenderContext,
  SchematicOps,
  Template,
} from "../core/types.js";
import {
  defineSchema,
  defineSchematic,
  executeOp,
  exposeSchematic,
  merge,
} from "../core/schema-ops.js";
import {
  diagnostic,
  fieldScopeContext,
  keyContext,
} from "../core/context-util.js";
import { DEBUG } from "../core/debugging.js";

type ObjectSchematicInfo<M extends Record<string, unknown>> = {
  object?: { [K in keyof M]: Template<M[K]> };
  value?: Template<M[keyof M]>;
  scoped?: boolean;
};

type ObjectSchematicOps<M extends Record<string, unknown>> = SchematicOps<M> & {
  object(): ObjectSchematicInfo<M>;
};

type ObjectRepresentation<M extends Record<string, unknown>> = {
  object: { [K in keyof M]: Schema<M[K]> };
  value: Schema<M[keyof M]>;
  scoped: boolean;
};

function fieldContext<M extends Record<string, unknown>>(
  context: SchemaMergingContext<M>,
  scoped: boolean,
  key?: string,
): SchemaMergingContext<M[keyof M]>;
function fieldContext(
  context: SchemaRenderContext,
  scoped: boolean,
  key?: string,
): SchemaRenderContext;
function fieldContext<M extends Record<string, unknown>>(
  context: SchemaContext<M>,
  scoped: boolean,
  key?: string,
): SchemaContext<M[keyof M]>;
function fieldContext<M extends Record<string, unknown>>(
  context: SchemaContext<M>,
  scoped: boolean,
  key?: string,
) {
  return scoped
    ? fieldScopeContext(context, key)
    : keyContext(context, key ?? "{}");
}

function extractObject<M extends Record<string, unknown>>(
  context: SchemaMergingContext<M>,
  scoped?: boolean,
): ObjectSchematicInfo<M> | undefined {
  const template = context.template;

  if (template === undefined) {
    return undefined;
  }

  if (typeof template === "function") {
    const ops = exposeSchematic<ObjectSchematicOps<M>>(template);

    if (!ops.object) {
      throw diagnostic(
        context,
        `merge object with unknown schematic: ${Object.keys(ops).join("/")}`,
      );
    }

    return ops.object();
  }

  if (typeof template !== "object") {
    throw diagnostic(context, "merging object with non-object");
  }

  if (Array.isArray(template)) {
    throw diagnostic(context, "merging object with array");
  }

  return { object: template as M, scoped };
}

function mergeRepresentation<M extends Record<string, unknown>>(
  context: SchemaMergingContext<M>,
  rep: ObjectRepresentation<M>,
  info?: ObjectSchematicInfo<M>,
): ObjectRepresentation<M> | undefined {
  if (info && rep.scoped !== info.scoped && Object.keys(rep.object).length) {
    throw diagnostic(
      context,
      `cannot match a scoped and unscoped object template`,
    );
  }

  const scoped = Boolean(rep.scoped || info?.scoped);

  let value = rep.value ?? stubSchema();
  if (info?.value) {
    const merged = merge(value!, {
      ...fieldContext(context, scoped),
      phase: "build",
      template: info?.value,
    });
    if (!merged) {
      throw diagnostic(context, `could not match archetype value`);
    }
    value = merged;
  }

  const object = inflatedObject(context, { ...rep, scoped, value }, info);

  return (
    object && {
      object,
      value,
      scoped,
    }
  );
}

function defineObject<M extends Record<string, unknown>>(
  self: ObjectRepresentation<M>,
) {
  return defineSchema<M>({
    scope(context) {
      const { scoped, value } = self;
      if (isMergingContext(context)) {
        executeOp(
          value ?? stubSchema(),
          "scope",
          fieldContext({ ...context, phase: "validate" }, scoped, undefined),
        );

        for (const [key, item] of Object.entries(self.object)) {
          executeOp(item, "scope", fieldContext(context, scoped, key));
        }
      } else {
        inflateScope(context, self);

        const inflated = inflatedObject(context, self);

        for (const [key, value] of Object.entries(inflated!)) {
          executeOp(value!, "scope", fieldContext(context, scoped, key));
        }
      }
    },
    merge(context) {
      const info = extractObject(context, self.scoped);
      const mergedSelf = mergeRepresentation(context, self, info);

      if (!mergedSelf) {
        return;
      }

      return defineObject(mergedSelf);
    },
    async render(context) {
      const { scoped } = self;
      const inflated = inflatedObject(context, self);

      const rendered = (await mapObjectAsync(
        inflated as Record<string, Schema<M[keyof M]>>,
        {
          values(field, key) {
            return executeOp(
              field,
              "render",
              fieldContext(context, scoped, key) as SchemaRenderContext,
            );
          },
          filter(_key, mapped) {
            return mapped !== undefined;
          },
        },
      )) as M;

      return rendered;
    },
  });

  function inflateScope(
    context: SchemaContext<M>,
    { value }: ObjectRepresentation<M>,
  ) {
    const inflationSchema = fieldScopeContext(context, undefined);

    executeOp(
      value ?? stubSchema(),
      "scope",
      inflationSchema as SchemaContext<M[keyof M]>,
    );
  }
}

function objectTemplate<M extends Record<string, unknown>>(
  object: { [K in keyof M]: Template<M[K]> },
  {
    scoped = false,
    value,
  }: { scoped?: boolean; value?: Template<M[keyof M]> } = {},
) {
  return defineSchematic<ObjectSchematicOps<M>>({
    object() {
      return { object, scoped, value };
    },
    expand(context) {
      const rep = mergeRepresentation(
        context,
        {
          object: {} as any,
          scoped,
          value: stubSchema(),
        },
        {
          object,
          scoped,
          value,
        },
      );

      return rep && (defineObject(rep) as Schema<M>);
    },
  });
}

function inflatedObject<M extends Record<string, unknown>>(
  context: SchemaContext<M>,
  { object, scoped, value }: ObjectRepresentation<M>,
  info?: ObjectSchematicInfo<M>,
) {
  const inflationContext = {
    ...fieldContext(context, scoped, undefined),
    phase: "build",
  };

  const keys = new Set([
    ...Object.keys(object),
    ...Object.keys(info?.object ?? {}),
    ...(inflationContext.evaluationScope.index?.struts
      ?.map((strut) => {
        return context.environment.resolve({
          context,
          identifier: strut,
        });
      })
      .flatMap((data) => Object.keys(data || {})) || []),
  ]);

  const result = {} as { [K in keyof M]: Schema<M[K]> };

  if (DEBUG) {
    Object.defineProperty(result, Symbol.for("created-at"), {
      enumerable: false,
      configurable: false,
      value: new Error("created-at"),
    });
  }

  if (!isMergingContext(context)) {
    for (const key of keys) {
      result[key as keyof M] = object[key] ?? value;
    }

    return result;
  }

  for (const key of keys) {
    const merged = merge(object[key] ?? value, {
      ...fieldContext({ ...context, template: undefined }, scoped, key),
      template: info?.object?.[key] as Template<M[keyof M]>,
    });

    if (!merged) {
      diagnostic(context, `unmatched field: ${key}`);
      return undefined;
    }

    result[key as keyof M] = merged;
  }

  return result;
}

export const objects = {
  object: <M extends Record<string, unknown>>(
    object: { [K in keyof M]: Template<M[K]> },
    value?: Template<M[keyof M]>,
  ) => {
    return objectTemplate(object, { value, scoped: false });
  },

  scoped: <M extends Record<string, unknown>>(
    object: { [K in keyof M]: Template<M[K]> },
    value?: Template<M[keyof M]>,
  ) => {
    return objectTemplate(object, { value, scoped: true });
  },
};

export function expandObject<M extends Record<string, unknown>>(
  context: SchemaMergingContext<M>,
) {
  const { mode, template } = context;
  // special case for {}. treat as an untyped stub.
  // this prevents {} matched with [{...}] from becoming { "0": { ... } }
  // or being an error.
  if (mode !== "match" && Object.keys(template!).length === 0) {
    return stubSchema(
      defineObject({ object: {}, value: stubSchema(), scoped: false }),
    );
  }

  return objects
    .object(template! as M)()
    .expand(context);
}
