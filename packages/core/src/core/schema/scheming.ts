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
import { expandTemplate, muxing, templateSchematic } from "./template.js";
import * as KeyedList from "./definition/structures/keyed-list.js";
import { createMergingContext } from "./core/context.js";
import { isLookupValue } from "./core/scope.js";
import { objects } from "./definition/objects.js";
import { arrays } from "./definition/arrays.js";
import { patternize } from "./core/pattern.js";
import { ScopedOptions, defineScoped } from "./definition/scoped.js";
import { mapObject } from "../../util/mapping.js";
import { PardonError } from "../error.js";
import { loc } from "./core/context-util.js";
import { defineSchematic, merge } from "./core/schema-ops.js";
import {
  Schema,
  SchemaMergingContext,
  Schematic,
  SchematicOps,
  Template,
} from "./core/types.js";

function modeContextBlend<T>(mode: SchemaMergingContext<unknown>["mode"]) {
  return (template: Template<T>) =>
    defineSchematic({
      blend(context, next) {
        return next({ ...context, mode, template });
      },
      expand(context) {
        return expandTemplate(template, context);
      },
    });
}

export function muxTemplate(template: Template<unknown>) {
  return modeContextBlend("mux")(template);
}

export function mixTemplate(template: Template<unknown>) {
  return modeContextBlend("mix")(template);
}

export function matchTemplate(template: Template<unknown>) {
  return modeContextBlend("match")(template);
}

type KeyedTemplate<T, Multivalued extends boolean> = {
  keyTemplate: Template<T>;
  valueTemplate: Template<T>[];
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
  const keySchema = muxing(keyTemplate);

  const { values, archetype } = valueTemplate.reduce<{
    values: Record<string, Template<unknown>>;
    archetype?: Template<unknown>;
  }>(
    (parsed, item) => {
      const keyCtx = createMergingContext(context, keySchema, item as T);
      merge(keySchema, keyCtx);
      const lookup = keyCtx.scope.lookup("key");
      const field = isLookupValue(lookup) ? String(lookup.value) : undefined;

      if (field != undefined) {
        parsed.values[field] = item;
      } else if (parsed.archetype === undefined) {
        parsed.archetype = item;
      } else {
        throw new PardonError(
          `${loc(context)}: multiple archetypes found in keyed structure`,
        );
      }

      return parsed;
    },
    { values: {} },
  );

  if (context.mode !== "mix" && !archetype) {
    return KeyedList.keyed(
      keyTemplate,
      objects.object(values, archetype) as Schematic<Record<string, T>>,
    );
  }

  return KeyedList.keyed(
    keyTemplate,
    objects.scoped(values, archetype) as Schematic<Record<string, T>>,
  );
}

function makeMvKeymapTemplate<T>(
  template: KeyedTemplate<T, true>,
  context: SchemaMergingContext<T[]>,
) {
  const { keyTemplate, valueTemplate } = template;

  const keySchema = muxing(keyTemplate);

  const { values, archetype } = valueTemplate.reduce<{
    values: Record<string, Template<unknown>[]>;
    archetype?: Template<T[keyof T][]>;
  }>(
    (parsed, item) => {
      const keyCtx = createMergingContext(context, keySchema, item as T);
      merge(keySchema, keyCtx);
      const lookup = keyCtx.scope.lookup("key");
      const field = isLookupValue(lookup) ? String(lookup.value) : undefined;

      if (field !== undefined) {
        (parsed.values[field] ??= []).push(item);
      } else if (parsed.archetype === undefined) {
        parsed.archetype = item as Template<T[keyof T][]>;
      } else {
        throw new PardonError(
          `${loc(context)}: multiple archetypes found in multi-valued keyed structure`,
        );
      }

      return parsed;
    },
    { values: {} },
  );

  if (context.mode !== "mix" || Object.keys(values).length) {
    const multivalues = mapObject(values, (items) => arrays.multivalue(items));

    return KeyedList.keyed.mv(
      keyTemplate,
      objects.object(
        multivalues,
        mixTemplate(arrays.multiscope([archetype])),
      ) as Schematic<Record<string, T[]>>,
    );
  }

  const multivalues = mapObject(values, (items) =>
    arrays.multivalue(items),
  ) as Record<string, Schematic<T[keyof T][]>>;

  return KeyedList.keyed.mv(
    keyTemplate,
    objects.scoped(
      multivalues,
      mixTemplate(arrays.multiscope([archetype])),
    ) as Schematic<Record<string, T[]>>,
  );
}

export function keyed<T extends object>(
  keyTemplate: Template<T>,
  valueTemplate: Template<T>[],
) {
  return defineSchematic<KeyedTemplateOps<T>>({
    expand(context) {
      return expandTemplate(
        makeKeymapTemplate(
          {
            keyTemplate,
            valueTemplate,
            multivalued: false,
          },
          context,
        ),
        context,
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

keyed.mv = function mvkeyed<T extends object>(
  keyTemplate: Template<T>,
  valueTemplate: Template<T>[],
) {
  return defineSchematic<KeyedTemplateOps<T>>({
    expand(context) {
      return expandTemplate(
        makeMvKeymapTemplate(
          {
            keyTemplate,
            valueTemplate,
            multivalued: true,
          },
          context,
        ),
        context,
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

export function tuple<T extends unknown[]>(template: T): Template<T> {
  return arrays.tuple(template);
}

export function unwrapSingle<T>(template: Template<T>): Template<T | T[]> {
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
        return defineScoped<T>(
          typeof keyTemplate == "string"
            ? keyTemplate
            : expandTemplate(keyTemplate as Template<T>, context),
          expandTemplate(template, context),
          options,
        );
      },
      { type: "scoped" },
    );
  }

  return templateSchematic<T>(
    (context) => {
      return defineScoped(
        expandTemplate(
          keyTemplate,
          context as SchemaMergingContext<string | T>,
        ) as Schema<T>,
        expandTemplate(template, context),
        options,
      );
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
