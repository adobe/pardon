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
import { metaScopeContext, tempContext } from "../core/context.js";
import {
  SchematicOps,
  Schema,
  defineSchema,
  SchemaCaptureContext,
  executeOp,
  SchemaContext,
} from "../core/schema.js";
import { isLookupValue } from "../core/scope.js";

export type ScopedOptions = {
  field?: boolean;
};

type ScopedOps<T> = SchematicOps<T> & {
  scopekey(): Schema<Partial<T>> | string;
  schema(): Schema<T>;
  options(): ScopedOptions;
};

function rescopedContext<C extends SchemaContext>(
  context: C,
  scope: string,
): C {
  return metaScopeContext(context, scope);
}

export function defineScoped<T>(
  scopekey: Schema<Partial<T>> | string,
  schema: Schema<T>,
  options: ScopedOptions,
) {
  return defineSchema<ScopedOps<T>>({
    scope(context) {
      const scope = resolveScope(context, scopekey);

      if (!scope) {
        return;
      }

      return executeOp(schema, "scope", rescopedContext(context, scope));
    },
    merge(context) {
      if (context.stub === undefined) {
        return defineScoped(scopekey, schema, options);
      }

      const scope = resolveScope(context, scopekey);

      if (!scope) {
        return undefined;
      }

      const match = executeOp(schema, "merge", rescopedContext(context, scope));
      if (!match) {
        return undefined;
      }

      return defineScoped(scopekey, match, options);
    },
    async render(context) {
      const scope = resolveScope(context, scopekey);

      if (!scope) {
        return undefined;
      }

      return await executeOp(schema, "render", rescopedContext(context, scope));
    },
    scopekey() {
      return scopekey;
    },
    schema() {
      return schema;
    },
    options() {
      return options;
    },
  });
}

function resolveScope<T>(
  context: SchemaCaptureContext<T>,
  scopekey: Schema<T> | string,
) {
  if (typeof scopekey === "string") {
    return scopekey;
  }

  const temp = tempContext(context);
  executeOp(scopekey, "scope", temp);
  const keyValue = temp.scope.lookup("key");

  if (!isLookupValue(keyValue)) {
    return undefined;
  }

  return String(keyValue.value);
}
