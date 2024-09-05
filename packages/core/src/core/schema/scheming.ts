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
  Schema,
  SchemaMergingContext,
  Template,
  executeOp,
} from "./core/schema.js";
import {
  expandTemplate,
  mixing,
  muxing,
  templateInContext,
  templateTrampoline,
} from "./template.js";
import { stubSchema } from "./definition/structures/stub-schema.js";
import { redactSchema } from "./definition/structures/redact-schema.js";
import * as KeyedList from "./definition/structures/keyed-list-schema.js";
import {
  createMergingContext,
  keyContext,
  tempContext,
} from "./core/context.js";
import { isLookupValue } from "./core/scope.js";
import { objects } from "./definition/objects.js";
import { arrays } from "./definition/arrays.js";
import { patternize } from "./core/pattern.js";
import { ScopedOptions, defineScoped } from "./definition/scoped.js";
import { mapObject } from "../../util/mapping.js";
import { PardonError } from "../error.js";
import { loc } from "./core/schema-utils.js";

export function redact(templ = stubSchema()) {
  return redactSchema(mixing(templ));
}

export type TrampolineModeOps = {
  mode(): SchemaMergingContext<unknown>["mode"];
  template(): Template<unknown>;
};

function modeTrampoline(
  template: Template<unknown>,
  mode: SchemaMergingContext<unknown>["mode"],
) {
  return templateTrampoline(
    (context) => templateInContext({ ...context, stub: template, mode }),
    {
      mode() {
        return mode;
      },
      template() {
        return template;
      },
    } satisfies TrampolineModeOps,
  );
}

export function muxTrampoline(template: Template<unknown>) {
  return modeTrampoline(template, "mux");
}

export function mixTrampoline(template: Template<unknown>) {
  return modeTrampoline(template, "mix");
}

export function matchTrampoline(template: Template<unknown>) {
  return modeTrampoline(template, "match");
}

export function keyed<T extends object>(
  keyTemplate: Template<T>,
  valueTemplate: Template<T>[],
) {
  return templateTrampoline((context) => {
    const keySchema = muxing(keyTemplate);

    const { values, archetype } = valueTemplate.reduce<{
      values: Record<string, Schema<unknown>>;
      archetype?: Schema<unknown>;
    }>(
      (parsed, item) => {
        const keyCtx = createMergingContext(context, keySchema, item as T);
        const lookup = keyCtx.scope.lookup("key");
        const field = isLookupValue(lookup) ? String(lookup.value) : undefined;

        if (field != undefined) {
          const itemContext = {
            ...keyContext(context, field),
            stub: item as T,
          };
          const schema = executeOp(
            parsed.archetype ?? stubSchema(),
            "merge",
            itemContext,
          );
          parsed.values[field] = expandTemplate(schema, itemContext);
        } else if (parsed.archetype === undefined) {
          parsed.archetype = expandTemplate(item, tempContext(context));
        } else {
          throw new PardonError(
            `${loc(context)}: multiple archetypes found in keyed structure`,
          );
        }

        return parsed;
      },
      { values: {} },
    );

    if (context.mode === "mux" || Object.keys(values).length) {
      return KeyedList.keyed(keySchema, objects.object(values, archetype));
    }

    return KeyedList.keyed(keySchema, objects.scoped(values, archetype));
  });
}

keyed.mv = function mvkeyed<T extends object>(
  keyTemplate: Template<T>,
  valueTemplate: Template<T>[],
) {
  return templateTrampoline((context) => {
    const keySchema = muxing(keyTemplate);

    const { values, archetype } = valueTemplate.reduce<{
      values: Record<string, Schema<unknown>[]>;
      archetype?: Schema<unknown>;
    }>(
      (parsed, item) => {
        const keyCtx = createMergingContext(context, keySchema, item as T);
        const lookup = keyCtx.scope.lookup("key");
        const field = isLookupValue(lookup) ? String(lookup.value) : undefined;

        if (field !== undefined) {
          const itemContext = {
            ...keyContext(context, field),
            stub: item as T,
          };

          const schema = executeOp(
            parsed.archetype ?? stubSchema(),
            "merge",
            itemContext,
          );

          (parsed.values[field] ??= []).push(
            expandTemplate(schema, itemContext),
          );
        } else if (parsed.archetype === undefined) {
          parsed.archetype = expandTemplate(item, tempContext(context));
        } else {
          throw new PardonError(
            `${loc(context)}: multiple archetypes found in multi-valued keyed structure`,
          );
        }

        return parsed;
      },
      { values: {} },
    );

    if (context.mode === "mux" || Object.keys(values).length) {
      const multivalues = mapObject(values, (schemas) => arrays.tuple(schemas));

      return KeyedList.keyed.mv(
        keySchema,
        objects.object(multivalues, archetype),
      );
    }

    const multivalues = mapObject(values, (schemas) =>
      arrays.template(schemas),
    );

    return KeyedList.keyed.mv(
      keySchema,
      objects.scoped(multivalues, archetype),
    );
  });
};

export function tuple<T>(template: Template<T>[]): Schema<T[]> {
  return templateTrampoline((context) =>
    arrays.tuple(
      template.map((item, idx) =>
        expandTemplate(item, keyContext(context, idx)),
      ),
    ),
  );
}

export function unwrapSingle<T>(template: Template<T>): Schema<T | T[]> {
  return templateTrampoline((context) =>
    arrays.lenient(expandTemplate(template, context)),
  );
}

export function scoped<T>(
  keyTemplate: string | Template<Partial<T>>,
  template: Template<T>,
  options: ScopedOptions = {},
): Schema<T> {
  if (
    typeof keyTemplate !== "string" ||
    !patternize(keyTemplate).vars.find(({ param }) => param === "key")
  ) {
    return templateTrampoline((context) => {
      return defineScoped<T>(
        typeof keyTemplate == "string"
          ? keyTemplate
          : expandTemplate(keyTemplate, context),
        expandTemplate(template, context),
        options,
      );
    });
  }

  return templateTrampoline((context) => {
    return defineScoped(
      expandTemplate(keyTemplate as Template<T>, context),
      expandTemplate(template, context),
      options,
    );
  });
}

export function scopedFields<M extends object & Record<string, unknown>>(
  keyTemplate: string,
  fields: M,
): M {
  return mapObject(fields, (field) =>
    scoped(keyTemplate, field, { field: true }),
  ) as M;
}
