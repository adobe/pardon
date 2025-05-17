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
import { arrayIntoObject, mapObject } from "../../../../util/mapping.js";
import {
  diagnostic,
  fieldScopeContext,
  keyContext,
  tempContext,
} from "../../core/context-util.js";
import {
  defineSchema,
  defineSchematic,
  executeOp,
  exposeSchematic,
  merge,
} from "../../core/schema-ops.js";
import { isLookupValue } from "../../core/scope.js";
import {
  Schema,
  SchemaContext,
  SchemaMergingContext,
  Schematic,
  SchematicOps,
  Template,
} from "../../core/types.js";
import { KeyedTemplateOps } from "../../scheming.js";
import { objects } from "../objects.js";

type KeyedListOps<T, Multivalued extends boolean> = SchematicOps<T[]> & {
  keymap(): KeyedListTemplate<T, Multivalued>;
};

type KeyedListTemplate<T, Multivalued extends boolean> = {
  readonly key: Template<T>;
  readonly object: Template<
    Multivalued extends false ? Record<string, T> : Record<string, T[]>
  >;
  readonly multivalued: Multivalued;
};

type KeyedListRepresentation<T, Multivalued extends boolean> = {
  readonly key: Schema<T>;
  readonly object: Schema<
    Multivalued extends false ? Record<string, T> : Record<string, T[]>
  >;
  readonly multivalued: Multivalued;
};

function keyedList<T>(
  key: Template<T>,
  object: Template<Record<string, T>> = objects.object({}),
): Template<T[]> {
  return defineSchematic<KeyedListOps<T, false>>({
    keymap() {
      return {
        key,
        object,
        multivalued: false,
      };
    },
    expand(context) {
      return defineKeyedList({
        key: tempContext(context).expand(key)!,
        object: { ...context }.expand(object)!,
        multivalued: false,
      });
    },
  });
}

function mvKeyedList<T>(
  key: Template<T>,
  object: Template<Record<string, T[]>> = objects.object({}),
): Template<T[]> {
  return defineSchematic<KeyedListOps<T, true>>({
    keymap() {
      return {
        key,
        object,
        multivalued: true,
      };
    },
    expand(context) {
      return defineMvKeyedList({
        key: tempContext(
          fieldScopeContext({ ...context, template: undefined }, undefined),
        ).expand(key)!,
        object: context.expand(object)!,
        multivalued: true,
      });
    },
  });
}

function defineKeyedList<T>(self: KeyedListRepresentation<T, false>) {
  return defineSchema<T[]>({
    scope(context) {
      const { object } = self;
      executeOp(object, "scope", context as SchemaContext<Record<string, T>>);
    },
    merge(context) {
      const { key, object, multivalued } = self;
      let { template } = context;

      if (typeof template === "function") {
        const templateOps = exposeSchematic<KeyedTemplateOps<T>>(template);

        if (templateOps.keyed) {
          template = templateOps.keyed(context);
        }

        const ops = exposeSchematic<KeyedListOps<T, false>>(template);
        if (!ops.keymap) {
          diagnostic(
            context,
            `cannot merge keyed list with other schematic (${Object.keys(ops).join("/")})`,
          );
          return undefined;
        }

        const other = ops.keymap();

        // validate runtime matches
        if (other.multivalued) {
          diagnostic(
            context,
            `cannot merge multi-valued keyed list with single-valued keyed list`,
          );
          return undefined;
        }

        const keySchema = merge(key, {
          ...tempContext(
            fieldScopeContext({ ...context, template: undefined }, undefined),
          ),
          template: ops.keymap().key,
        });

        if (!keySchema) {
          diagnostic(context, "failed to merge key schema of keyed list");
          return undefined;
        }

        const objectSchema = merge(object, {
          ...context,
          template: ops.keymap().object,
        });

        if (!objectSchema) {
          return undefined;
        }

        return defineKeyedList({
          key: keySchema,
          object: objectSchema,
          multivalued,
        });
      }

      if (template === undefined) {
        return defineKeyedList(self);
      }

      const kv = (template as Template<T>[] | undefined)?.map((_element, i) => {
        const tempcontext = tempContext(
          keyContext(context, i),
        ) as SchemaMergingContext<T>;

        executeOp(key, "scope", tempcontext);
        const merged = merge(key, tempcontext);

        if (!merged) {
          return undefined;
        }

        const keyValue = tempcontext.evaluationScope.lookup("key");

        if (!isLookupValue(keyValue)) {
          return undefined;
        }

        return String(keyValue.value);
      });

      const mapped = kv?.every(Boolean)
        ? arrayIntoObject(kv, (key, idx) => ({
            [key!]: template![idx] as Template<T>,
          }))
        : undefined;

      const merged = mapped && merge(object, { ...context, template: mapped });
      return merged && defineKeyedList({ key, object: merged, multivalued });
    },
    async render(context) {
      const { object } = self;
      const output = await executeOp(object, "render", context);

      return output && Object.values(output);
    },
  });
}

function defineMvKeyedList<T>(self: KeyedListRepresentation<T, true>) {
  return defineSchema<T[]>({
    scope(context) {
      const { object } = self;
      executeOp(object, "scope", context as SchemaContext<Record<string, T[]>>);
    },
    merge(context) {
      const { key, object, multivalued } = self;
      const { template } = context;

      if (typeof template === "function") {
        const keyedOps = exposeSchematic<
          KeyedTemplateOps<T> & KeyedListOps<T, true>
        >(template);

        if (!keyedOps.keyed) {
          diagnostic(
            context,
            `cannot merge mv-keyed list with other schematic (${Object.keys(keyedOps).join("/")})`,
          );
          return undefined;
        }

        const ops = exposeSchematic<KeyedListOps<T, true>>(
          keyedOps.keyed!(context),
        );

        if (!ops.keymap) {
          diagnostic(
            context,
            `cannot merge mv-keyed list values non-keymap schematic (${Object.keys(ops).join("/")})`,
          );
          return undefined;
        }

        const other = ops.keymap();

        // validate runtime matches
        if (!other.multivalued) {
          diagnostic(
            context,
            `cannot merge single-valued keyed list with multi-valued keyed list`,
          );
          return undefined;
        }

        const keySchema = merge(key, {
          ...tempContext(
            fieldScopeContext({ ...context, template: undefined }, undefined),
          ),
          template: ops.keymap().key,
        });

        if (!keySchema) {
          diagnostic(context, "failed to merge key schema of keyed list");
          return undefined;
        }

        const objectSchema = merge(object, {
          ...context,
          template: ops.keymap().object,
        });

        if (!objectSchema) {
          return undefined;
        }

        return defineMvKeyedList({
          key: keySchema,
          object: objectSchema,
          multivalued,
        });
      }

      if (template === undefined) {
        return defineMvKeyedList(self);
      }

      const kv = (template as Template<T>[] | undefined)?.map((_element, i) => {
        const tempcontext = tempContext(
          keyContext(context, i),
        ) as SchemaMergingContext<T>;

        executeOp(key, "scope", tempcontext);
        const merged = merge(key, tempcontext);

        if (!merged) {
          diagnostic(tempcontext, "error merging element");
          return undefined;
        }

        const keyValue = tempcontext.evaluationScope.lookup("key");

        if (!isLookupValue(keyValue)) {
          diagnostic(tempcontext, "could not resolve key");
          return undefined;
        }

        return String(keyValue.value);
      });

      const mapped = kv?.every(Boolean)
        ? arrayIntoObject(
            kv,
            (key, idx) => {
              return {
                [key!]: [template![idx]],
              };
            },
            (acc, values) =>
              Object.assign(
                acc,
                mapObject(values, (value, key) => [
                  ...(acc[key] || []),
                  ...value,
                ]),
              ),
          )
        : undefined;

      const merged = mapped && merge(object, { ...context, template: mapped });
      return merged && defineMvKeyedList({ key, object: merged, multivalued });
    },
    async render(context) {
      const { object } = self;
      const output = await executeOp(object, "render", context);

      return output && Object.values(output).flat(1);
    },
  });
}

export function keyed<T>(
  keyTemplate: Template<Partial<T>>,
  structure?: Template<Record<string, T>>,
): Schematic<T[]> {
  return keyedList(keyTemplate, structure) as Schematic<T[]>;
}

keyed.mv = function keyed$mv<T>(
  keyTemplate: Template<Partial<NoInfer<T>>>,
  structure?: Template<Record<string, T[]>>,
): Schematic<T[]> {
  return mvKeyedList(keyTemplate, structure) as Schematic<T[]>;
};
