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
import { diagnostic } from "../core/context-util.js";
import {
  keyContext,
  elementScopeContext,
  tempContext,
} from "../core/context.js";
import {
  defineSchema,
  defineSchematic,
  executeOp,
  exposeSchematic,
  merge,
} from "../core/schema-ops.js";
import { isMergingContext } from "../core/schema.js";
import {
  Schema,
  SchemaContext,
  SchemaMergingContext,
  SchemaRenderContext,
  Schematic,
  SchematicOps,
  Template,
} from "../core/types.js";
import { stubSchema } from "./structures/stub.js";

type ArrayRepresentation<T> = {
  item: Schema<T>;
  elements?: Schema<T>[];
  multivalue: boolean;
  lenient?: boolean;
  single?: boolean;
  scoped: boolean;
};

type ArraySchematic<T> = {
  array?: Template<T>[];
  mux?: boolean;
  item?: Template<T>;
  multivalue?: boolean;
  lenient?: boolean;
  single?: boolean;
  scoped?: boolean;
};

type ArraySchematicOps<T> = SchematicOps<T | T[]> & {
  array(context: SchemaMergingContext<T | T[]>): ArraySchematic<T>;
};

function itemContext<C extends SchemaContext>(
  context: C,
  scoped: boolean,
  idx: number,
) {
  context = scoped
    ? elementScopeContext(context, idx)
    : keyContext(context, idx);

  return context as C extends SchemaMergingContext<infer A>
    ? A extends Array<infer T>
      ? SchemaMergingContext<T>
      : C
    : C;
}

function expandInfo<T>(
  context: SchemaMergingContext<T | T[]>,
  self: ArrayRepresentation<T>,
): ArraySchematic<T> | undefined {
  let template = context.template;
  let single = false;
  if (template === undefined) {
    return undefined;
  }

  if (typeof template === "function") {
    const ops = exposeSchematic<ArraySchematicOps<T>>(
      template as Schematic<T | T[]>,
    );

    if (!ops.array) {
      throw diagnostic(context, "merge array with unknown schematic");
    }

    return ops.array(context);
  }

  if (self.lenient && !Array.isArray(template)) {
    template = [template];
    single = true;
  }

  if (Array.isArray(template)) {
    const { multivalue, scoped, lenient } = self;

    return {
      array: template as Template<T>[],
      multivalue,
      scoped,
      lenient,
      single,
    };
  }

  throw diagnostic(context, "could not merge array with non-array");
}

// just merges the item template representation
function mergeRepresentation<T>(
  context: SchemaMergingContext<T | T[]>,
  rep: ArrayRepresentation<T>,
  info?: ArraySchematic<T>,
): ArrayRepresentation<T> | undefined {
  if (!info) {
    return rep;
  }

  if (rep.scoped !== (info.scoped ?? rep.scoped)) {
    throw diagnostic(context, "cannot merge scoped and unscoped arrays");
  }

  if (rep.multivalue !== (info.multivalue ?? rep.multivalue)) {
    throw diagnostic(context, "cannot merge multivalue and regular arrays");
  }

  if (info.item !== undefined) {
    rep = mergeArchtype(context, rep, info.item);
  }

  if (
    context.mode === "mix" &&
    info.array?.length === 1 &&
    !info.mux &&
    !rep.multivalue &&
    !info.single
  ) {
    return mergeArchtype(context, rep, info.array[0]);
  }

  return rep.multivalue
    ? mvMergeElements(context, rep, info)
    : mergeElements(context, rep, info);
}

function mergeArchtype<T>(
  context: SchemaMergingContext<T | T[]>,
  rep: ArrayRepresentation<T>,
  archetype: Template<T>,
) {
  const item = merge(rep.item, {
    ...itemContext(context, rep.scoped, -1),
    phase: "build",
    template: archetype,
  } as SchemaMergingContext<T>);

  if (item === undefined) {
    throw diagnostic(context, "could not merge archetype");
  }

  const elements = rep.elements?.map((element, idx) =>
    merge(element, {
      ...itemContext(context, rep.scoped, idx),
      template: archetype,
    } as SchemaMergingContext<T>),
  );

  if (elements?.some((v) => v === undefined)) {
    throw diagnostic(context, "could not merge archetype with elements");
  }

  return { ...rep, item, elements: elements as Schema<T>[] | undefined };
}

function mergeElements<T>(
  context: SchemaMergingContext<T | T[]>,
  rep: ArrayRepresentation<T>,
  info: ArraySchematic<T>,
): ArrayRepresentation<T> | undefined {
  if (rep.elements && info.array) {
    if (rep.elements.length !== info.array.length) {
      throw diagnostic(
        context,
        `array: mismatched length: ${rep.elements.length} and ${info.array.length}`,
      );
    }

    const mergedElements = rep.elements.map(
      (scheme, idx) =>
        merge(scheme, {
          ...itemContext(context as SchemaMergingContext<T[]>, rep.scoped, idx),
          template: info.array![idx],
        })!,
    );

    if (!mergedElements.every(Boolean)) {
      return undefined;
    }

    return {
      ...rep,
      elements: mergedElements,
      single: rep.single && info.single,
    };
  }

  const mergedElements = info.array?.map(
    (element, idx) =>
      merge(rep.item, {
        ...itemContext(context as SchemaMergingContext<T[]>, rep.scoped, idx),
        template: element,
      })!,
  );

  if (mergedElements && !mergedElements.every(Boolean)) {
    return undefined;
  }

  return {
    ...rep,
    elements: mergedElements,
    single: (!rep.elements || rep.single) && info.single,
  };
}

function mvMergeElements<T>(
  context: SchemaMergingContext<T | T[]>,
  rep: ArrayRepresentation<T>,
  info: ArraySchematic<T>,
): ArrayRepresentation<T> | undefined {
  const matched: Record<number, Schema<T>> = {};
  const extra: Template<T>[] = [];

  const scoped = Boolean(rep.scoped || info.scoped);

  if (!scoped) {
    context = { ...context, mode: "mux" };
  }

  if (context.mode === "mix" && info.array?.length === 1) {
    const mergedItem = merge(rep.item ?? stubSchema(), {
      ...(tempContext(
        itemContext(context, scoped, -1),
      ) as SchemaMergingContext<T>),
      template: info.array[0],
    });

    if (!mergedItem) {
      return;
    }

    const mergedElements = rep.elements?.map((element, idx) =>
      merge(element, {
        ...(tempContext(
          itemContext(context, scoped, idx),
        ) as SchemaMergingContext<T>),
        template: info.array![0],
      }),
    );

    if (rep.elements && !mergedElements!.every(Boolean)) {
      return;
    }

    return {
      ...rep,
      item: mergedItem,
      elements: mergedElements as Schema<T>[],
      single: rep.single && info.single,
    };
  }

  if (info.array) {
    for (const prime of info.array) {
      let i = 0;
      let match: Schema<T> | undefined;

      for (const item of rep.elements ?? []) {
        if (matched[i]) {
          i++;
          continue;
        }

        try {
          match = merge(
            item,
            tempContext({
              ...itemContext(context, scoped, -1),
              mode: "meld",
              template: prime,
            }) as SchemaMergingContext<T>,
          );

          if (match) {
            matched[i] = merge(item, {
              ...itemContext(context, scoped, i),
              mode: "meld",
              template: prime,
            } as SchemaMergingContext<T>)!;

            break;
          }
        } catch (error) {
          console.warn("error in trial merging of mv elements", error);
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
    ...(rep.elements || []).map((schema, idx) => matched[idx] ?? schema),
    ...extra.map((item, idx) =>
      merge(rep.item, {
        ...itemContext(context, scoped, idx + (rep.elements?.length ?? 0)),
        template: item,
      } as SchemaMergingContext<T>),
    ),
  ];

  const firstMismatch = items.findIndex((value) => value === undefined);

  if (firstMismatch !== -1) {
    diagnostic(context, `mismatch in multivalue merge: ${firstMismatch}`);
    return undefined;
  }

  return {
    ...rep,
    elements: items as Schema<T>[],
    single: rep.single && info.single,
  };
}

function defineArray<T>(self: ArrayRepresentation<T>): Schema<T | T[]> {
  return defineSchema<T | T[]>({
    scope(context) {
      const len = resolveArrayLength(context, self);

      if (
        isMergingContext(context) &&
        len === 1 &&
        self.single &&
        self.lenient &&
        !Array.isArray(context.template)
      ) {
        const elementContext = {
          ...itemContext({ ...context, template: undefined }, self.scoped, 0),
          template: context.template,
        } as SchemaContext<T>;

        executeOp(self.elements?.[0] ?? self.item, "scope", elementContext);

        return;
      }

      for (let idx = 0; idx < len; idx++) {
        const elementContext = itemContext(
          context,
          self.scoped,
          idx,
        ) as SchemaContext<T>;

        executeOp(self.elements?.[idx] ?? self.item, "scope", elementContext);
      }
    },
    merge(context) {
      const merged = mergeRepresentation(
        context,
        self,
        expandInfo(context, self),
      );

      return merged && defineArray(merged);
    },
    async render(context) {
      const len = await renderArrayLength(context);

      const result =
        len === -1
          ? undefined
          : await Promise.all(
              [...new Array(len)].map(
                (_, idx) =>
                  executeOp(
                    arrayElementAt(idx),
                    "render",
                    itemContext(context, self.scoped, idx),
                  ) as Promise<T>,
              ),
            );

      if (result?.every((value) => value !== undefined)) {
        if (result.length === 1 && self.lenient && self.single) {
          return result[0];
        }

        return result;
      }

      return undefined;
    },
  });

  function arrayElementAt(idx: number): Schema<T> {
    const { item, elements } = self;
    return !elements ? item : elements[idx];
  }

  function resolveArrayLength(
    context: SchemaContext<T | T[]>,
    merged: ArrayRepresentation<T>,
  ) {
    const { item, elements, scoped } = merged;

    const templateContext = itemContext(
      context,
      scoped,
      -1,
    ) as SchemaContext<T>;

    executeOp(item, "scope", templateContext);

    const { environment } = context;

    const len = Math.max(
      elements ? elements.length : -1,
      ...((templateContext.scope.index?.struts
        ?.map((strut) => environment.resolve({ context, ident: strut }))
        ?.map((strut) => (Array.isArray(strut) ? strut.length : undefined))
        ?.filter((n) => typeof n === "number") as number[]) || []),
    );

    return len;
  }

  async function renderArrayLength(context: SchemaRenderContext) {
    const templateContext = itemContext(
      context,
      self.scoped,
      -1,
    ) as SchemaRenderContext;

    const { environment } = context;

    const len = Math.max(
      self.elements?.length ?? -1,
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

    return len;
  }
}

function defineArraySchematic<T>(
  base: (context: SchemaMergingContext<T | T[]>) => ArrayRepresentation<T>,
  schematic: (context: SchemaMergingContext<T | T[]>) => ArraySchematic<T>,
) {
  return defineSchematic<ArraySchematicOps<T>>({
    array(context) {
      return schematic(context);
    },
    expand(context) {
      const array = mergeRepresentation(
        context,
        base(context),
        schematic(context),
      );
      return defineArray(array!);
    },
  });
}

export const arrays = {
  auto: <T>(template: Template<T>[]) =>
    defineArraySchematic<T>(
      () => ({
        item: stubSchema(),
        multivalue: false,
        scoped: template?.length === 1,
      }),
      ({ mode }) =>
        mode === "mix" && template?.length == 1
          ? {
              item: template[0],
            }
          : {
              array: template,
            },
    ) as Schematic<T[]>,

  scoped: <T>(template: Template<T>[]) =>
    defineArraySchematic<T>(
      () => ({
        item: stubSchema(),
        multivalue: false,
        scoped: true,
      }),
      () => ({
        array: template,
        mux: true,
      }),
    ) as Schematic<T[]>,

  // Jackson UNWRAP_SINGLE_VALUE_ARRAYS
  lenient: <T>(template: Template<T> | Template<T>[]) =>
    defineArraySchematic<T>(
      () => ({
        item: stubSchema(),
        multivalue: false,
        scoped: true,
        lenient: true,
      }),
      () => ({
        array: Array.isArray(template)
          ? (template as Template<T>[])
          : undefined,
        item: Array.isArray(template) ? undefined : template,
        single: !Array.isArray(template),
      }),
    ) as Schematic<T | T[]>,

  tuple: <A extends unknown[]>(template: Template<A>) =>
    defineArraySchematic<A>(
      () => ({
        item: stubSchema(),
        multivalue: false,
        scoped: false,
      }),
      () => ({
        array: template as Template<A>[],
        scoped: false,
        mux: true,
      }),
    ) as Schematic<A>,

  multivalue: <T>(template: Template<T>[], item?: Template<T>) =>
    defineArraySchematic<T>(
      () => ({
        item: stubSchema(),
        multivalue: true,
        scoped: false,
      }),
      () => ({
        array: template,
        item,
        multivalue: true,
        scoped: false,
      }),
    ) as Schematic<T[]>,

  multiscope: <T>(template: Template<T>[], item?: Template<T>) =>
    defineArraySchematic<T>(
      () => ({
        item: stubSchema(),
        multivalue: true,
        scoped: true,
      }),
      () => ({
        array: template,
        item,
        multivalue: true,
        scoped: true,
      }),
    ) as Schematic<T[]>,
};

export function expandArray<T>(
  context: SchemaMergingContext<T[]>,
): Schema<T | T[]> {
  const { mode, template } = context;

  if (!Array.isArray(template)) {
    throw diagnostic(context, "count not expand non-array");
  }

  if (mode === "mix") {
    // auto arrays of length == 1 are
    // treated as rules to apply to all
    // elements.
    return arrays.auto(template)().expand(context);
  }

  // otherwise treat them as a tuple
  return arrays.tuple(template)().expand(context) as Schema<T | T[]>;
}
