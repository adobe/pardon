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
import MIME from "whatwg-mimetype";
import { syncEvaluation } from "../expression.js";
import { captureSchema } from "../schema/definition/structures/capture-schema.js";
import { jsonTrampoline } from "../schema/definition/encodings/json-schema.js";
import { base64Trampoline } from "../schema/definition/encodings/base64-schema.js";
import { Schema, Template, extractOps } from "../schema/core/schema.js";
import { referenceSchema } from "../schema/definition/structures/reference-schema.js";
import { FetchObject, ResponseObject } from "./fetch-pattern.js";
import {
  expandTemplate,
  mixing,
  templateTrampoline,
} from "../schema/template.js";
import { stubSchema } from "../schema/definition/structures/stub-schema.js";
import { deferredSchema } from "../schema/definition/structures/deferred-schema.js";
import {
  urlEncodedSchema,
  urlEncodedFormSchema,
} from "../schema/definition/encodings/url-encoded-schema.js";
import { headersSchema } from "../schema/definition/encodings/headers-schema.js";
import { scalars } from "../schema/definition/scalars.js";
import {
  muxTrampoline,
  redact,
  tuple,
  unwrapSingle,
  scopedFields,
  keyed,
  mixTrampoline,
  matchTrampoline,
} from "../schema/scheming.js";
import { EncodingOps } from "../schema/definition/encodings/encoding-schema.js";
import {
  textEncoding,
  textTrampoline,
} from "../schema/definition/encodings/text-encoding-schema.js";
import { isPatternSimple, patternize } from "../schema/core/pattern.js";
import { hiddenSchema } from "../schema/definition/structures/hidden-schema.js";

function looksLikeJson(template: unknown): template is string {
  if (typeof template !== "string") {
    return false;
  }

  // https://github.com/microsoft/TypeScript/issues/27706 !!!
  // template = template.trim()
  const trimmed = template.trim();
  if (trimmed === "null" || /[{["1-9]/.test(trimmed)) {
    try {
      JSON.parse(template);
      return true;
    } catch (error) {
      // oops.
      void error;
    }
  }
  return false;
}

const encodings = {
  json(value: unknown | Template<unknown>) {
    return jsonTrampoline(value);
  },
  anyTemplate(value: unknown) {
    return templateTrampoline((context) => {
      const template = expandTemplate(value, context);

      if (
        extractOps<EncodingOps<unknown, unknown>>(template).encoding !==
        undefined
      ) {
        return template;
      }

      // (this handles non-JSON ping / pong response bodies when response template is empty).
      //
      // but if value is defined then anyTemplate(...) value is assumed to be JSON.
      if (value === undefined && context.mode === "match") {
        return template;
      }

      return jsonTrampoline(template);
    });
  },
  form(value: string | Record<string, string> | [string, string][]) {
    return urlEncodedFormSchema(value) as Schema<string>;
  },
  base64(value: string | Schema<string>) {
    return base64Trampoline(value);
  },
  text(value: string) {
    return textTrampoline(value);
  },
  raw(value: string) {
    return textEncoding(scalars.antipattern<string>(value));
  },
} satisfies Record<string, (...args: any) => Schema<string>>;

export type EncodingTypes = Exclude<keyof typeof encodings, "anyTemplate">;

export function getContentEncoding(encoding: EncodingTypes) {
  return encodings[encoding]!;
}

const bodyGlobals: Record<string, unknown> = {
  false: false,
  true: true,
  null: null,
  ...encodings,
  bigint: scalars.bigint,
  nullish: scalars.null,
  string: scalars.string,
  number: scalars.number,
  bool: scalars.boolean,
  redact,
  mux: muxTrampoline,
  mix: mixTrampoline,
  match: matchTrampoline,
  keyed,
  tuple,
  unwrapSingle,
};

export function guessContentType(
  headers: Headers,
  body: string,
): EncodingTypes | undefined {
  const contentType = MIME.parse(headers.get("Content-Type")!);

  switch (contentType?.essence) {
    case "application/json":
      return looksLikeJson(body) ? "json" : "raw";
    case "application/x-www-form-urlencoded":
      return "form";
    case "text/plain":
      return "text";
    default:
      if (contentType?.essence.endsWith("+json")) {
        return looksLikeJson(body) ? "json" : "raw";
      }

      return "text";
  }
}

export function evalSchema(schemaSource: string): any {
  return syncEvaluation(`${schemaSource}`, {
    binding(identifier) {
      if (identifier in bodyGlobals) {
        return bodyGlobals[identifier];
      }

      if (identifier.startsWith("$")) {
        const ident = identifier.slice(1);

        return referenceSchema(ident);
      }

      return undefined;
    },
  });
}

export function evalBodySchema(schemaSource: string): Schema<string> {
  return evalSchema(`$body.noexport.of(${schemaSource})`) as Schema<string>;
}

export type HttpsRequestObject = FetchObject & {
  computations?: Record<string, unknown>;
  values?: Record<string, unknown>;
};

function bodyTemplate(encoding?: EncodingTypes) {
  return deferredSchema<string>((context) => {
    const { stub: value } = context;

    if (typeof value === "string") {
      if (encoding) {
        if (encoding === "json") {
          if (looksLikeJson(value)) {
            return evalBodySchema(`${encoding}(${value})`);
          }
          // fall through in the case that `value` is invalid JSON
        } else {
          return evalBodySchema(`${encoding}(${JSON.stringify(value)})`);
        }
      }

      if (isPatternSimple(patternize(value.trim()))) {
        return evalBodySchema(`text(${JSON.stringify(value.trim())})`);
      }

      return evalBodySchema(`anyTemplate(${value})`);
    }

    if (typeof value === "function") {
      return value as Schema<string>;
    }

    if (value !== undefined) {
      return encodings[encoding ?? "json"](value as any) as Schema<string>;
    }

    return bodyTemplate(encoding);
  }, stubSchema());
}

const originSchema = (base: string) =>
  scalars.pattern<string>(base, {
    re: ({ hint }) => {
      switch (true) {
        // origin is defined as `"{{?:origin}}"`
        case hint?.includes("?:"):
          return /.*/;
        // we also allow `"{{...}}"` components to have dots.
        case hint?.includes("..."):
          return /.*/;
        // normally we disallow dots in origin variables, like we disallow slashes in path variables.
        default:
          return /[^.]+/;
      }
    },
  });

const pathnameSchema = (base: string) =>
  scalars.pattern<string>(base, {
    re: ({ hint }) => {
      switch (true) {
        case hint?.includes("!/"):
          return "";
        case hint?.includes("?/") && hint?.includes("..."):
          return /(?:[/].*)?/;
        case hint?.includes("?/"):
          return /[/]?/;
        case hint?.includes("..."):
          return /.*/;
        default:
          return /[^/]+/;
      }
    },
  });

export function httpsRequestSchema(
  encoding?: EncodingTypes,
  { search: { multivalue } = {} }: { search?: { multivalue?: boolean } } = {},
) {
  return mixing<HttpsRequestObject>({
    method: "{{method = 'GET'}}",
    origin: originSchema("{{?:origin}}"),
    pathname: pathnameSchema("{{...pathname}}"),
    searchParams: captureSchema("search", urlEncodedSchema({ multivalue })),
    headers: headersSchema(),
    body: bodyTemplate(encoding),
    computations: hiddenSchema<Record<string, unknown>>(),
  });
}

export function httpsResponseSchema(encoding?: EncodingTypes) {
  return mixing<ResponseObject>({
    ...scopedFields("res", {
      status: scalars.pattern<string>("{{status}}", {
        re: ({ hint }) => (hint === "?" ? /\d/ : /\d+/),
        type: "number",
      }),
      statusText: scalars.string("{{?statusText}}"),
    }),
    headers: headersSchema(),
    body: bodyTemplate(encoding),
  });
}
