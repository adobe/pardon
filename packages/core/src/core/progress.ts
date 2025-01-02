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
import { mergeSchema } from "./schema/core/schema-utils.js";
import { ScriptEnvironment } from "./schema/core/script-environment.js";
import { Schema, SchemaMergingContext, Template } from "./schema/core/types.js";

export interface ProgressiveMatchData<T> {
  object: Template<T>;
  schema: Schema<T>;
  context?: SchemaMergingContext<T>;
  values: Record<string, unknown>;
  match?: boolean;
}

/**
 * Progressive matching is about repeatedly extending a schema and checking if the extended
 * schema matches the object in question.
 *
 * Both the extended schema and the schema with the object matched are returned.
 */
export class ProgressiveMatch<T> implements ProgressiveMatchData<T> {
  object: Template<T>;
  schema: Schema<T>;
  context?: SchemaMergingContext<T>;
  values: Record<string, unknown>;
  match?: boolean;

  constructor({
    schema,
    object,
    context,
    values,
    match,
  }: ProgressiveMatchData<T>) {
    this.schema = schema;
    this.object = object;
    this.context = context;
    this.values = values;
    this.match = match;
  }

  extend(
    extension: T,
    options: {
      mode?: "mix" | "mux";
      environment: ScriptEnvironment;
      values?: Record<string, unknown>;
    },
  ) {
    const extended = mergeSchema(
      { mode: options.mode ?? "mix", phase: "build" },
      this.schema,
      extension,
      options.environment,
    );

    // here we either match or mux the object in question, we use match for non-script
    // sources like actual response objects.
    const matching =
      extended.schema &&
      mergeSchema(
        { mode: this.match ? "match" : "mux", phase: "validate" },
        extended.schema,
        this.object,
        options.environment,
      );

    if (matching && !matching.context.environment.exhausted()) {
      return {
        matching,
        progress: new ProgressiveMatch<T>({
          schema: extended.schema!,
          context: extended.context,
          object: this.object,
          // would we want options.values present in the previous matches or is this enough?
          values: { ...options.values, ...this.values },
        }),
      };
    }

    return {
      matching: { ...extended, schema: undefined },
    };
  }
}
