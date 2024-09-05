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
import { arrayIntoObject, mapObject } from "../../../../util/mapping.js";
import { keyContext, tempContext } from "../../core/context.js";
import {
  SchematicOps,
  Schema,
  defineSchema,
  executeOp,
  SchemaCaptureContext,
} from "../../core/schema.js";
import { isLookupValue } from "../../core/scope.js";
import { arrays } from "../arrays.js";
import { objects } from "../objects.js";
import { stubSchema } from "./stub-schema.js";

type KeyedListOps<T, Multivalued = false> = SchematicOps<T[]> & {
  keySchema(): Schema<T>;
  valueSchema(): Schema<
    Multivalued extends false ? Record<string, T> : Record<string, T[]>
  >;
  multivalued(): Multivalued;
};

function keyedList<T>(
  keySchema: Schema<T>,
  keyed: Schema<Record<string, T>> = objects.object({}),
): Schema<T[]> {
  return defineSchema<KeyedListOps<T, false>>({
    merge(context) {
      const { stub } = context;

      const kv = stub?.map((_element, i) => {
        const tempcontext = tempContext(keyContext(context, i));

        executeOp(keySchema, "scope", tempcontext);
        const merged = executeOp(keySchema, "merge", tempcontext);

        if (!merged) {
          return undefined;
        }

        const keyValue = tempcontext.scope.lookup("key");

        if (!isLookupValue(keyValue)) {
          return undefined;
        }

        return String(keyValue.value);
      });

      const mapped = kv?.every(Boolean)
        ? arrayIntoObject(kv, (key, idx) => ({
            [key!]: stub![idx],
          }))
        : undefined;

      const merged = executeOp(keyed, "merge", { ...context, stub: mapped });
      return merged && keyedList(keySchema, merged);
    },
    async render(context) {
      const output = await executeOp(keyed, "render", context);

      return output && Object.values(output);
    },
    scope(context) {
      executeOp(
        keyed,
        "scope",
        context as SchemaCaptureContext<Record<string, T>>,
      );
    },
    keySchema() {
      return keySchema;
    },
    valueSchema() {
      return keyed;
    },
    multivalued() {
      return false;
    },
  });
}

function mvKeyedList<T>(
  keySchema: Schema<T>,
  valueSchema: Schema<Record<string, T[]>> = objects.object(
    {},
    arrays.multivalue([], stubSchema()),
  ),
): Schema<T[]> {
  return defineSchema<KeyedListOps<T, true>>({
    merge(context) {
      const { stub, scope } = context;

      const kv =
        stub &&
        stub.map((element) => {
          const tempscope = scope.tempscope().subscope("{}", {
            context,
            type: "field",
            struts: [],
          });
          const tempcontext = { ...context, scope: tempscope, stub: element };

          executeOp(keySchema, "scope", tempcontext);
          const merged = executeOp(keySchema, "merge", tempcontext);

          if (!merged) {
            return undefined;
          }

          const key = tempscope.lookup("key");

          if (!isLookupValue(key)) {
            return undefined;
          }

          return String(key.value);
        });

      const mapped = kv?.every(Boolean)
        ? arrayIntoObject(
            kv,
            (key, idx) => {
              return {
                [key!]: [stub![idx]],
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

      const merged = executeOp(valueSchema, "merge", {
        ...context,
        stub: mapped,
      });

      return merged && mvKeyedList(keySchema, merged);
    },
    async render(context) {
      const output = await executeOp(valueSchema, "render", context);

      return output && Object.values(output).flat(1);
    },
    scope(context) {
      executeOp(
        valueSchema,
        "scope",
        context as SchemaCaptureContext<Record<string, T[]>>,
      );
    },
    keySchema() {
      return keySchema;
    },
    valueSchema() {
      return valueSchema;
    },
    multivalued() {
      return true;
    },
  });
}

keyed.mv = function mv<T>(
  schema: Schema<Partial<NoInfer<T>>>,
  structure?: Schema<Record<string, T[]>>,
): Schema<T[]> {
  return mvKeyedList(schema, structure) as Schema<T[]>;
};

export function keyed<T>(
  schema: Schema<Partial<NoInfer<T>>>,
  structure?: Schema<Record<string, T>>,
): Schema<T[]> {
  return keyedList(schema, structure) as Schema<T[]>;
}
