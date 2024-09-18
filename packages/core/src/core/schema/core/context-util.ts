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
import { SchemaContext } from "./types.js";

export function diagnostic(
  context: SchemaContext<unknown>,
  error: string | Error,
) {
  const location = loc(context);

  if (typeof error === "string") {
    const warning = `${location}: ${error}`;
    error = new Error(`${location}: ${error}`);
    const [message /* ignore 1 frame */, , ...stack] = error.stack?.split(
      "\n",
    ) || [warning];
    error.stack = [message, ...stack].join("\n");
  }

  context.diagnostics.push({
    loc: location,
    err: error,
  });

  return error;
}

export function loc({ environment, scopes, keys }: SchemaContext) {
  const name = environment?.name?.();
  return `${name ? `${name}: ` : ""}${scopes.map((s) => `:${s}`).join("")}|${keys
    .map((k) => `.${k}`)
    .join("")}`;
}

export function isAbstractContext(context: SchemaContext<unknown>) {
  return context.scope.path.some(
    (part) => part.endsWith("[]") || part.endsWith("{}"),
  );
}
