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
import { Pattern } from "./pattern.js";
import { loc } from "./schema-utils.js";
import {
  SchemaContext,
  SchemaMergingContext,
  SchemaRenderContext,
} from "./schema.js";

type Reason = {
  loc?: string;
  note?: string;
  cause?: Error | unknown;
};

export class SchemaError<Context extends SchemaContext> extends Error {
  loc?: string;
  note?: string;
  mode?: string;
  tag?: string;

  constructor(
    context: Context,
    {
      mode,
      tag,
      note,
      cause,
    }: {
      mode?:
        | SchemaMergingContext<unknown>["mode"]
        | SchemaRenderContext["mode"];
      tag?: string;
      note?: string;
      cause?: Error;
    } = {},
  ) {
    const location = loc(context);
    super(`${location}: ${note ?? ""}`, {
      ...(cause && { cause }),
    });
    Error.captureStackTrace(this, this.constructor);

    this.loc = location;
    this.note = note;
    this.mode = mode;
    this.tag = tag;
  }

  isMatchError(): this is SchemaError<SchemaMergingContext<unknown>> {
    return this.note?.startsWith("match:") || false;
  }

  isMixError(): this is SchemaError<SchemaMergingContext<unknown>> {
    return this.note?.startsWith("mix:") || false;
  }

  isRenderError(): this is SchemaError<SchemaRenderContext> {
    return this.note?.startsWith("render:") || false;
  }

  static scope = {
    inconsistent(context: SchemaContext, reason?: Reason) {
      return error(context, "inconsistent", reason);
    },
    mismatch(context: SchemaContext, pattern: Pattern, value: unknown) {
      return error(context, "mismatch", {
        note: `${pattern.source}:${value}`,
      });
    },
  };

  static match = {
    missing(context: SchemaMergingContext<unknown>, reason?: Reason) {
      return error(context, "missing", reason);
    },
    mismatch(context: SchemaMergingContext<unknown>, reason?: Reason) {
      return error(context, "mismatch", reason);
    },
  };

  static render = {
    reject(context: SchemaRenderContext, reason?: Reason) {
      return error(context, "reject", reason);
    },
    unevaluated(context: SchemaRenderContext, reason?: Reason) {
      return error(context, "unevaluated", reason);
    },
    undefined(context: SchemaRenderContext, reason?: Reason) {
      return error(context, "undefined", reason);
    },
    unidentified(context: SchemaRenderContext, reason?: Reason) {
      return error(context, "unidentified", reason);
    },
  };

  static incompatible(
    context: SchemaMergingContext<unknown> | SchemaRenderContext,
    reason?: Reason,
  ) {
    return error(context, "incompatible", reason);
  }

  static type(context: SchemaMergingContext<unknown>, reason?: Reason) {
    return error(context, "type", reason);
  }

  static error(context: SchemaContext, reason?: Reason) {
    return error(context, "error", reason);
  }
}

Object.defineProperties(SchemaError.prototype, {
  context: {
    configurable: false,
    enumerable: false,
    writable: true,
  },
});

function error(context: SchemaContext, tag: string, reason?: Reason) {
  if (reason?.cause instanceof SchemaError) {
    return reason.cause;
  }

  return new SchemaError(context, {
    mode: context.mode,
    tag,
    note: reason?.note,
    cause: reason?.cause as Error | undefined,
  });
}
