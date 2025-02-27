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

import { Schema, SchemaContext, SchemaMergingContext } from "./types.js";

/** Given a type with Schema\<T> nested in it, try to unwrap all Schema\<T>s into T */
export type Render<R> =
  R extends Schema<infer V>
    ? Render<V>
    : R extends Array<infer I>
      ? Render<I>[]
      : R extends object
        ? {
            [K in keyof R]: Render<R[K]>;
          }
        : R;

export function isMergingContext(
  context: SchemaContext<unknown>,
): context is SchemaMergingContext<unknown> {
  switch (context.mode) {
    case "match":
    case "mix":
    case "mux":
    case "meld":
      return true;
  }
  return false;
}
