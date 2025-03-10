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
import MIME from "whatwg-mimetype";
import { jsonEncoding } from "../schema/definition/encodings/json-encoding.js";
import { referenceTemplate } from "../schema/definition/structures/reference.js";
import { FetchObject, ResponseObject } from "./fetch-pattern.js";
import {
  urlEncodedTemplate,
  urlEncodedFormTemplate,
} from "../schema/definition/encodings/url-encoded.js";
import { headersTemplate } from "../schema/definition/encodings/headers-encoding.js";
import { datums } from "../schema/definition/datum.js";
import { scopedFields } from "../schema/scheming.js";
import { textTemplate } from "../schema/definition/encodings/text-encoding.js";
import { hiddenTemplate } from "../schema/definition/structures/hidden.js";
import { diagnostic } from "../schema/core/context-util.js";
import { stubSchema } from "../schema/definition/structures/stub.js";
import {
  Schema,
  Schematic,
  SchematicOps,
  Template,
} from "../schema/core/types.js";
import {
  defineSchema,
  defineSchematic,
  executeOp,
  merge,
} from "../schema/core/schema-ops.js";
import { InternalEncodingTypes, evalBodyTemplate } from "./body-template.js";
import { JSON } from "../json.js";
import { mixing } from "../schema/core/contexts.js";

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

export function guessContentType(
  headers: Headers,
  body: string,
): InternalEncodingTypes | undefined {
  const contentType = MIME.parse(headers.get("Content-Type")!);

  switch (contentType?.essence) {
    case "application/json":
      return looksLikeJson(body) ? "$$json" : "$$raw";
    case "application/x-www-form-urlencoded":
      return "$$form";
    case "text/plain":
      return "$$text";
    default:
      if (contentType?.essence.endsWith("+json")) {
        return looksLikeJson(body) ? "$$json" : "$$raw";
      }

      return "$$text";
  }
}

export type HttpsRequestObject = FetchObject & {
  computations?: Record<string, unknown>;
  values?: Record<string, unknown>;
};

export function bodyReference(template: Template<string>): Schematic<string> {
  return referenceTemplate({
    ref: "body",
  }).$noexport.$optional.$(template);
}

type BodySchematicOps = SchematicOps<string> & {
  readonly body: { readonly encoding?: InternalEncodingTypes };
};

export function bodySchema(
  encoding?: InternalEncodingTypes,
  schema?: Schema<string>,
): Schema<string> {
  return defineSchema<string>({
    scope(context) {
      if (schema) {
        executeOp(schema, "scope", context);
      }
    },
    async render(context) {
      return schema
        ? await executeOp(schema ?? stubSchema(), "render", context)
        : undefined;
    },
    merge(context) {
      const { template: source } = context;

      if (source === undefined || source === "") {
        return bodySchema(encoding, schema);
      }

      if (typeof source === "function") {
        throw diagnostic(
          context,
          `body schema only works with strings not (${Object.keys(source()).join("/")})`,
        );
      }

      if (typeof source !== "string") {
        throw diagnostic(
          context,
          `body schema only works with strings not (${typeof source})`,
        );
      }

      if (context.mode === "match") {
        if (schema) {
          return bodySchema(encoding, merge(schema, { ...context }));
        }

        const merged = merge(stubSchema(), {
          ...context,
          template:
            encoding === "$$json"
              ? jsonEncoding(JSON.parse(source))
              : encoding === "$$form"
                ? urlEncodedFormTemplate(source)
                : textTemplate(source),
        }) as Schema<string>;

        return merged && bodySchema(encoding ?? "$$json", merged);
      }

      try {
        if (/^[a-z]+(?<!^mix|^mux|^match)\s*[(]/i.test(source.trim())) {
          const merged = merge(stubSchema(), {
            ...context,
            template: evalBodyTemplate(`${source}`),
          }) as Schema<string>;

          return merged && bodySchema(encoding, merged);
        }
      } catch (error) {
        //... oops?
        console.warn(error);
        void error;
      }

      try {
        if (
          /^([0-9]|[[{"'+-]|null|(?:mix|mix|match)[(])/i.test(source.trim())
        ) {
          const merged = merge(schema ?? stubSchema(), {
            ...context,
            template: evalBodyTemplate(`$$json(${source})`),
          }) as Schema<string>;

          return merged && bodySchema(encoding, merged);
        }
      } catch (error) {
        //... oops?
        console.warn(error);
        void error;
      }

      const effectiveEncoding = encoding ?? "$$json";

      const merged = merge(schema ?? stubSchema(), {
        ...context,
        template: evalBodyTemplate(
          `${effectiveEncoding}(${effectiveEncoding === "$$json" ? source : JSON.stringify(source)})`,
        ) as Template<string>,
      });

      return merged && bodySchema(effectiveEncoding, merged);
    },
  });
}

export function bodyTemplate(
  encoding?: InternalEncodingTypes,
): Schematic<string> {
  return defineSchematic<BodySchematicOps>({
    body: { encoding },
    expand(context) {
      return merge(bodySchema(encoding), context)!;
    },
  });
}

const originTemplate = (base: string) =>
  datums.pattern<string>(base, {
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

const pathnameTemplate = (base: string) =>
  datums.pattern<string>(base, {
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
  encoding?: InternalEncodingTypes,
  { search: { multivalue } = {} }: { search?: { multivalue?: boolean } } = {},
) {
  return mixing<HttpsRequestObject>({
    method: "{{method = 'GET'}}",
    origin: originTemplate("{{?:origin}}"),
    pathname: pathnameTemplate("{{...pathname}}"),
    searchParams: referenceTemplate<URLSearchParams>({
      ref: "search",
    }).$(urlEncodedTemplate({ multivalue })),
    headers: headersTemplate(),
    body: bodyReference(bodyTemplate(encoding)),
    computations: hiddenTemplate<Record<string, unknown>>(),
  });
}

export function httpsResponseSchema(
  encoding?: InternalEncodingTypes,
): Schema<ResponseObject> {
  return mixing<ResponseObject>({
    ...scopedFields("res", {
      status: datums.pattern<string>("{{status}}", {
        re: ({ hint }) => (hint === "?" ? /\d/ : /\d+/),
        type: "number",
        unboxed: true,
      }),
      statusText: datums.datum("{{?statusText}}"),
    }),
    headers: headersTemplate(),
    body: bodyReference(bodyTemplate(encoding)),
  });
}
