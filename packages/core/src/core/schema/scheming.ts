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
import { templateSchematic } from "./template.js";
import * as KeyedList from "./definition/structures/keyed-list.js";
import { createMergingContext } from "./core/context.js";
import { isLookupValue } from "./core/scope.js";
import { objects } from "./definition/objects.js";
import { arrays, ArraySchematicOps } from "./definition/arrays.js";
import { patternize } from "./core/pattern.js";
import { ScopedOptions, defineScoped } from "./definition/scoped.js";
import { mapObject } from "../../util/mapping.js";
import { PardonError } from "../error.js";
import { diagnostic, loc } from "./core/context-util.js";
import {
  defineSchematic,
  exposeSchematic,
  isSchematic,
  merge,
} from "./core/schema-ops.js";
import {
  Schema,
  SchemaMergingContext,
  Schematic,
  SchematicOps,
  Template,
} from "./core/types.js";
import { merging } from "./core/contexts.js";
import { ReferenceSchematicOps } from "./definition/structures/reference.js";

function modeContextBlend<T>(mode: SchemaMergingContext<unknown>["mode"]) {
  return (template: Template<T>) =>
    defineSchematic({
      blend(context, next) {
        return next({ ...context, mode, template });
      },
      expand(context) {
        return context.expand(template);
      },
    });
}

export function blendEncoding<T>(
  blending: Template<any> | undefined,
  wrapper: (template?: Template<any>) => Template<T>,
): Template<T> {
  if (!isSchematic(blending)) {
    return wrapper(blending);
  }

  // don't blend with references or the
  // reference captures the wrong encoding layer.
  const schematic = exposeSchematic<ReferenceSchematicOps<any>>(blending);
  if (schematic.reference || !schematic.blend) {
    return wrapper(blending);
  }

  return defineSchematic<SchematicOps<any>>({
    blend(context, next) {
      return blending().blend!(context, (context) => {
        return next({
          ...context,
          template: wrapper(context.template),
        });
      });
    },
    expand(context) {
      return blending().expand({
        ...context,
        template: wrapper(context.template),
      });
    },
  });
}

export function mergeTemplate(template: Template<unknown>) {
  return modeContextBlend("merge")(template);
}

export function matchTemplate(template: Template<unknown>) {
  return modeContextBlend("match")(template);
}

export function meldTemplate(template: Template<unknown>) {
  return modeContextBlend("meld")(template);
}

type KeyedTemplate<T, Multivalued extends boolean> = {
  keyTemplate: Template<T>;
  valueTemplate: Template<T[]> | Template<T>[];
  multivalued: Multivalued;
};

export type KeyedTemplateOps<T> = SchematicOps<T[]> & {
  keyed(context: SchemaMergingContext<T[]>): Schematic<T[]>;
};

function makeKeymapTemplate<T>(
  template: KeyedTemplate<T, false>,
  context: SchemaMergingContext<T[]>,
) {
  const { keyTemplate, valueTemplate } = template;
  const keySchema = merging(keyTemplate);

  if (!keySchema) {
    throw diagnostic(context, "failed to build keymap key schema");
  }

  const { values, archetype } = parseKeyedArrayTemplate(
    context,
    keySchema,
    valueTemplate,
  );

  if (!archetype) {
    return KeyedList.keyed(
      keyTemplate,
      objects.object(values) as Schematic<Record<string, T>>,
    );
  }

  return KeyedList.keyed(
    keyTemplate,
    objects.scoped(values, archetype as any) as Schematic<Record<string, T>>,
  );
}

function makeMvKeymapTemplate<T>(
  template: KeyedTemplate<T, true>,
  context: SchemaMergingContext<T[]>,
) {
  const { keyTemplate, valueTemplate } = template;

  const keySchema = merging(keyTemplate);
  if (!keySchema) {
    diagnostic(context, "failed to build keymap key schema");
    throw new PardonError("failed to create mv keymap key schema");
  }

  const { values, archetype } = parseKeyedArrayTemplate(
    context,
    keySchema,
    valueTemplate,
  );

  if (Object.keys(values).length) {
    const multivalues = mapObject(values, (items) =>
      arrays.multivalue(items as unknown[]),
    );

    return KeyedList.keyed.mv(
      keyTemplate,
      objects.object(
        multivalues,
        mergeTemplate(arrays.multiscope(archetype!)),
      ) as Schematic<Record<string, T[]>>,
    );
  }

  const multivalues = mapObject(values, (items) =>
    arrays.multivalue(items as unknown[]),
  ) as Record<string, Schematic<T[keyof T][]>>;

  return KeyedList.keyed.mv(
    keyTemplate,
    objects.scoped(
      multivalues,
      mergeTemplate(arrays.multiscope(archetype!)),
    ) as Schematic<Record<string, T[]>>,
  );
}

function parseKeyedArrayTemplate<T>(
  context: SchemaMergingContext<T[]>,
  keySchema: Schema<T>,
  valueTemplate: Template<T>[] | Template<T[]>,
) {
  if (isSchematic(valueTemplate)) {
    const { array, item } =
      exposeSchematic<ArraySchematicOps<T>>(valueTemplate).array?.(context) ??
      {};

    if (item) {
      if (array) {
        throw new Error(
          "multivalue array cannot merge archetype-with-values schematic",
        );
      }
      return { values: {}, archetype: item as Template<T> };
    }

    if (!array) {
      throw new Error(
        "multivalue template cannot merge non-archetype/non-valued array",
      );
    }

    valueTemplate = array;
  }

  return (valueTemplate as Template<T>[]).reduce<{
    values: Record<string, Template<T>>;
    archetype?: Template<T>;
  }>(
    (parsed, item) => {
      const { mode, phase, meta } = context;
      const keyCtx = createMergingContext(
        { mode, phase, ...meta },
        keySchema,
        item as T,
      );
      merge(keySchema, keyCtx);
      const lookup = keyCtx.evaluationScope.lookup("key");
      const field = isLookupValue(lookup) ? String(lookup.value) : undefined;

      if (field === undefined) {
        throw new PardonError(
          `${loc(context)}: archetype not supported in unscoped keyed object`,
        );
      }

      if (parsed.values[field] !== undefined) {
        throw new PardonError(
          `${loc(context)}: multiple definitions of keyed field=${field}`,
        );
      }

      parsed.values[field] = item;

      return parsed;
    },
    { values: {} },
  );
}

export function makeKeyed<T extends object>(
  keyTemplate: Template<T>,
  valueTemplate: Template<T[]>,
) {
  return defineSchematic<KeyedTemplateOps<T>>({
    expand(context) {
      return context.expand(
        makeKeymapTemplate(
          {
            keyTemplate,
            valueTemplate,
            multivalued: false,
          },
          context,
        ),
      );
    },
    keyed(context) {
      return makeKeymapTemplate(
        {
          keyTemplate,
          valueTemplate,
          multivalued: false,
        },
        context,
      );
    },
  });
}

makeKeyed.mv = function makeMultivalueKeyed<T extends unknown[]>(
  keyTemplate: Template<T[keyof T]>,
  valueTemplate: Template<T>,
) {
  return defineSchematic<KeyedTemplateOps<T[0]>>({
    expand(context) {
      return context.expand(
        makeMvKeymapTemplate(
          {
            keyTemplate,
            valueTemplate,
            multivalued: true,
          },
          context,
        ),
      );
    },
    keyed(context) {
      return makeMvKeymapTemplate(
        {
          keyTemplate,
          valueTemplate,
          multivalued: true,
        },
        context,
      );
    },
  });
};

export function itemOrArray<T>(template: Template<T>): Template<T | T[]> {
  return arrays.lenient(template);
}

export function scoped<T>(
  keyTemplate: string | Template<Partial<T>>,
  template: Template<T>,
  options: ScopedOptions = {},
): Schematic<T> {
  if (
    typeof keyTemplate !== "string" ||
    !patternize(keyTemplate).vars.find(({ param }) => param === "key")
  ) {
    return templateSchematic<T>(
      (context) => {
        const keySchema =
          typeof keyTemplate == "string"
            ? keyTemplate
            : context.expand(keyTemplate as Template<T>);

        const valueSchema = context.expand(template);

        if (keySchema === undefined || valueSchema === undefined) {
          return undefined;
        }

        return defineScoped<T>(keySchema, valueSchema, options);
      },
      { type: "scoped" },
    );
  }

  return templateSchematic<T>(
    (context) => {
      const keySchema = context.expand(keyTemplate) as Schema<T> | undefined;

      const valueSchema = context.expand(template);

      if (keySchema === undefined || valueSchema === undefined) {
        return undefined;
      }

      return defineScoped(keySchema, valueSchema, options);
    },
    { type: "scoped" },
  );
}

export function scopedFields<M extends object & Record<string, unknown>>(
  keyTemplate: string,
  fields: M,
): M {
  return mapObject(fields, (field) =>
    scoped(keyTemplate, field, { field: true }),
  ) as M;
}

export const mvKeyedTuples = KeyedList.keyed.mv<[string, string]>(
  arrays.tuple(["{{key}}", undefined!]) as Template<[string, string]>,
  objects.object<Record<string, [string, string][]>>(
    {},
    arrays.multivalue(
      [],
      arrays.tuple([undefined! as string, undefined!] as [string, string]),
    ),
  ),
);
