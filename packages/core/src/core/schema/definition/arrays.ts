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
  keyContext,
  elementScopeContext,
  diagnostic,
} from "../core/context.js";
import {
  SchematicOps,
  Schema,
  defineSchema,
  executeOp,
  SchemaMergingContext,
  SchemaContext,
  SchemaCaptureContext,
  SchemaRenderContext,
  extractOps,
  Template,
} from "../core/schema.js";
import { SchemaError } from "../core/schema-error.js";
import { stubSchema } from "./structures/stub-schema.js";
import { valueId } from "../../../util/value-id.js";
import { applyModeTrampoline } from "../template.js";

type ArraySchemeOptions<T> = {
  // disable creating a subscope for each item, for arrays representing tuples or other
  // non-enumerated data.
  unscoped?: boolean;

  // multivalue-mode matching, this allows for mismatched array lengths,
  // matches each new values into the first compatible slot or adds a new one.
  // used for things like headers where multiple values apply to the same key.
  multivalue?: boolean;

  // Jackson "UNWRAP_SINGLE_VALUE_ARRAYS" support
  lenient?: boolean;
  // indicates the array was derived from a single value, (and should render as one.)
  single?: boolean;

  // a schema to apply to each item.
  itemSchema?: Schema<T>;
};

export type ArrayOps<T> = SchematicOps<T | T[]> & {
  array(): Schema<T> | Schema<T>[];
  options(): ArraySchemeOptions<T>;
};

function defineArray<T>(
  array: Schema<T> | Schema<T>[],
  options: ArraySchemeOptions<T>,
): Schema<T | T[]> {
  return defineSchema<ArrayOps<T>>({
    scope(context) {
      const { itemSchema, len } = resolveArrayLength(context);

      for (let idx = 0; idx < len; idx++) {
        const elementContext = itemContext(
          context,
          idx,
        ) as SchemaCaptureContext<T>;

        if (itemSchema) {
          executeOp(itemSchema, "scope", elementContext);
        }

        executeOp(arrayElementAt(idx), "scope", elementContext);
      }
    },
    merge(context) {
      let { stub } = applyModeTrampoline(context);
      let single = options.single ?? false;

      // need to test this code path.
      if (typeof stub === "function") {
        const ops = extractOps<ArrayOps<T>>(stub as Schema<T[]>);

        if (!ops.array || !ops.options) {
          // todo: lenient handling here too?
          diagnostic(context, "array expected");

          return undefined;
        }

        stub = ops.array() as Template<T> | Template<T[]> as T | T[];

        if (typeof stub === "function" && typeof array === "function") {
          if (valueId(options) !== valueId(ops.options())) {
            // TODO: reconcile options better
            return;
          }

          const merged = executeOp(array, "merge", {
            ...itemContext(context, -1),
            stub,
          } as SchemaMergingContext<T>);

          return merged && defineArray(merged, options);
        } else if (
          Array.isArray(stub) &&
          Array.isArray(array) &&
          stub.length === array.length
        ) {
          // continue
        } else {
          return undefined;
        }
      }

      if (stub !== undefined && !Array.isArray(stub)) {
        if (!options.lenient) {
          diagnostic(context, "array expected");
          return undefined;
        }

        stub = [stub];
        single = true;
      }

      if (options.multivalue && Array.isArray(array)) {
        if (stub !== undefined) {
          if (Array.isArray(stub)) {
            return matchMultivalue({
              ...context,
              stub,
            } as SchemaMergingContext<T[]>);
          } else {
            return matchMultivalue({
              ...context,
              stub: [stub],
            } as SchemaMergingContext<T[]>);
          }
        }

        return matchMultivalue(context as SchemaMergingContext<T[]>);
      }

      if (Array.isArray(array) && Array.isArray(stub)) {
        if (stub !== undefined && array.length != stub.length) {
          throw SchemaError.match.mismatch(context, {
            note: `length:${array.length} and ${stub.length}`,
          });
        }

        const mapped = array.map(
          (scheme, idx) =>
            executeOp(
              scheme,
              "merge",
              itemContext(
                { ...context, stub } as SchemaMergingContext<T[]>,
                idx,
              ),
            )!,
        );

        if (!mapped.every(Boolean)) {
          return undefined;
        }

        return defineArray(mapped, { ...options, single });
      }

      if (stub === undefined) {
        return defineArray(array, { ...options, single });
      }

      const matchedWithTemplate = (stub as T[]).map(
        (_, idx) =>
          executeOp(
            array as Schema<T>,
            "merge",
            itemContext({ ...context, stub } as SchemaMergingContext<T[]>, idx),
          )!,
      );

      return defineArray(
        matchedWithTemplate.length === 1 && context.mode === "mix"
          ? matchedWithTemplate[0]
          : matchedWithTemplate,
        { ...options, single: single },
      );
    },
    async render(context) {
      const { itemSchema, len } = await renderArrayLength(context);
      void itemSchema; // TODO?

      const result =
        len === -1
          ? undefined
          : await Promise.all(
              [...new Array(len)].map(
                (_, idx) =>
                  executeOp(
                    arrayElementAt(idx),
                    "render",
                    itemContext(context, idx),
                  ) as Promise<T>,
              ),
            );

      if (result?.every((value) => value !== undefined)) {
        if (result.length === 1 && options.single) {
          return result[0];
        }

        return result;
      }

      return undefined;
    },
    array() {
      return array;
    },
    options() {
      return options;
    },
  });

  function itemContext<C extends SchemaContext>(context: C, idx: number) {
    const { unscoped } = options;

    context = unscoped
      ? keyContext(context, idx)
      : elementScopeContext(context, idx);

    return context as C extends SchemaMergingContext<infer A>
      ? A extends Array<infer T>
        ? SchemaMergingContext<T>
        : C
      : C;
  }

  function matchMultivalue(context: SchemaMergingContext<T[]>) {
    const matched: Record<number, Schema<T>> = {};
    const extra: T[] = [];
    const { stub } = context;

    if (stub) {
      for (const prime of stub) {
        let i = 0;
        let match: Schema<T> | undefined;
        for (const item of array as Schema<T>[]) {
          if (matched[i]) {
            i++;
            continue;
          }

          try {
            match = executeOp(item, "merge", {
              ...itemContext(context, -1),
              stub: prime,
            });

            if (match) {
              matched[i] = executeOp(item, "merge", {
                ...itemContext(context, i),
                stub: prime,
              })!;
              break;
            }
          } catch (error) {
            void error;
            // ...
          }
          i++;
        }

        if (!match) {
          extra.push(prime);
        }
      }
    }

    const items = [
      ...(array as Schema<T>[]).map((schema, idx) => matched[idx] ?? schema),
      ...extra.map((item, idx) =>
        executeOp(options.itemSchema ?? stubSchema(null), "merge", {
          ...keyContext(context, idx + array.length),
          stub: item,
        }),
      ),
    ];

    if (items.some((value) => value === undefined)) {
      return undefined;
    }

    return defineArray<T>(items as Schema<T>[], options);
  }

  function arrayElementAt(idx: number): Schema<T> {
    return !Array.isArray(array) ? array : (array[idx] ?? stubSchema<T>());
  }

  function resolveArrayLength(context: SchemaCaptureContext<T | T[]>) {
    const { itemSchema = !Array.isArray(array) ? array : undefined } = options;

    const templateContext = itemContext(context, -1) as SchemaCaptureContext<T>;

    if (itemSchema) {
      executeOp(itemSchema, "scope", templateContext);
    }

    const { environment } = context;

    const len = Math.max(
      Array.isArray(array) ? array.length : options.single ? 1 : -1,
      ...((templateContext.scope.index?.struts
        ?.map((strut) => environment.resolve({ context, ident: strut }))
        ?.map((strut) => (Array.isArray(strut) ? strut.length : undefined))
        ?.filter((n) => typeof n === "number") as number[]) || []),
    );

    return { itemSchema, len };
  }

  async function renderArrayLength(context: SchemaRenderContext) {
    const { itemSchema = !Array.isArray(array) ? array : undefined } = options;

    const templateContext = itemContext(context, -1) as SchemaRenderContext;

    const { environment } = context;

    const len = Math.max(
      Array.isArray(array) ? array.length : options.single ? 1 : -1,
      ...((
        await Promise.all(
          templateContext.scope.index?.struts.map((strut) =>
            environment.evaluate({ context, ident: strut }),
          ) ?? [],
        )
      )
        .map((strut) => (Array.isArray(strut) ? strut.length : undefined))
        .filter((n) => typeof n === "number") as number[]),
    );

    return { itemSchema, len };
  }
}

export const arrays = {
  auto: <T>(template: Schema<T>[]) =>
    defineArray<T>(
      Array.isArray(template) && template.length === 1 ? template[0] : template,
      { unscoped: template.length !== 1 },
    ) as Schema<T[]>,

  // Jackson UNWRAP_SINGLE_VALUE_ARRAYS
  lenient: <T>(template: Schema<T> | Schema<T>[]) =>
    defineArray<T>(
      Array.isArray(template) && template.length == 1 ? template[0] : template,
      {
        lenient: true,
      },
    ) as Schema<T | T[]>,

  template: <T>(template: Schema<T>[]) =>
    defineArray<T>(template, {}) as Schema<T[]>,

  tuple: <T>(template: Schema<T>[]) =>
    defineArray<T>(template, { unscoped: true }) as Schema<T[]>,

  multivalue: <T>(
    template: Schema<T>[],
    itemSchema: Schema<T> = stubSchema(),
  ) =>
    defineArray<T>(template, {
      multivalue: true,
      unscoped: true,
      itemSchema,
    }) as Schema<T[]>,
};
