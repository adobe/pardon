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
import { expandTemplate } from "../template.js";
import { executeOp } from "./schema-ops.js";
import { Scope } from "./scope.js";
import { ScriptEnvironment } from "./script-environment.js";
import {
  ResolvedValueOptions,
  Schema,
  SchemaContext,
  SchemaMergingContext,
  SchemaRenderContext,
  SchemaScriptEnvironment,
  Template,
} from "./types.js";

export function createRenderContext<T>(
  schema: Schema<T>,
  environment: SchemaScriptEnvironment = new ScriptEnvironment(),
): SchemaRenderContext {
  const ctx = {
    mode: "render",
    keys: [],
    evaluationScopePath: [],
    environment,
    evaluationScope: Scope.createRootScope(),
    diagnostics: [],
  } satisfies SchemaRenderContext;

  executeOp(schema, "scope", ctx);

  return ctx;
}

export function createPreviewContext<T>(
  scheme: Schema<T>,
  environment: SchemaScriptEnvironment = new ScriptEnvironment(),
): SchemaRenderContext {
  const ctx = {
    mode: "preview",
    keys: [],
    evaluationScopePath: [],
    environment,
    evaluationScope: Scope.createRootScope(),
    diagnostics: [],
  } satisfies SchemaRenderContext;

  executeOp(scheme, "scope", ctx);

  return ctx;
}

export function createPrerenderContext<T>(
  scheme: Schema<T>,
  environment: SchemaScriptEnvironment = new ScriptEnvironment(),
): SchemaRenderContext {
  const ctx = {
    mode: "prerender",
    keys: [],
    evaluationScopePath: [],
    environment,
    evaluationScope: Scope.createRootScope(),
    diagnostics: [],
  } satisfies SchemaRenderContext;

  executeOp(scheme, "scope", ctx);

  return ctx;
}

export function createPostrenderContext<T>(
  scheme: Schema<T>,
  environment: SchemaScriptEnvironment = new ScriptEnvironment(),
): SchemaRenderContext {
  const ctx = {
    mode: "postrender",
    keys: [],
    evaluationScopePath: [],
    diagnostics: [],
    environment,
    evaluationScope: Scope.createRootScope(),
  } satisfies SchemaRenderContext;

  executeOp(scheme, "scope", ctx);

  return ctx;
}

export type ContextMeta = {
  mode: SchemaMergingContext<unknown>["mode"];
  phase: SchemaMergingContext<unknown>["phase"];
} & Record<string, string>;

export function createMergingContext<T>(
  { mode, phase, ...meta }: ContextMeta,
  schema: Schema<T>,
  template: Template<NoInfer<T>> | undefined,
  environment: SchemaScriptEnvironment = new ScriptEnvironment(),
): SchemaMergingContext<T> {
  const context = {
    mode,
    phase,
    meta,
    keys: [],
    evaluationScopePath: [],
    environment,
    evaluationScope: Scope.createRootScope(),
    template,
    diagnostics: [],
    expand(template) {
      return expandTemplate(template, this);
    },
  } satisfies SchemaMergingContext<T>;

  context.environment.reset();
  executeOp(schema, "scope", {
    ...context,
    template: undefined,
    phase: "build",
  });

  return context;
}

export function getContextualValues(
  context: SchemaContext<unknown>,
  options: ResolvedValueOptions = {},
) {
  return {
    ...context.environment.implied(),
    ...context.evaluationScope.resolvedValues(options),
  };
}

export function contextMeta({
  mode,
  phase,
  meta,
}: SchemaMergingContext<unknown> & SchemaContext) {
  return { mode, phase, ...meta };
}
