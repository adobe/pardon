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
import {
  referenceTemplate,
  ReferenceTemplateOps,
} from "../schema/definition/structures/reference.js";
import { FetchObject, ResponseObject } from "./fetch-pattern.js";
import { queryEncodingType } from "../schema/definition/encodings/url-encoded.js";
import { headersTemplate } from "../schema/definition/encodings/headers-encoding.js";
import { datums } from "../schema/definition/datum.js";
import { mvKeyedTuples, scopedFields } from "../schema/scheming.js";
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
  exposeSchematic,
  isSchematic,
  merge,
} from "../schema/core/schema-ops.js";
import { encodings, EncodingTypes } from "./body-template.js";
import { JSON } from "../json.js";
import { mixing } from "../schema/core/contexts.js";
import { encodingTemplate } from "../schema/definition/encodings/encoding.js";

function isJson(body: string) {
  try {
    JSON.parse(body);
    return true;
  } catch (ignore) {
    void ignore;
    return false;
  }
}

export function guessContentType(
  body: string,
  headers?: Headers,
): EncodingTypes | undefined {
  if (!headers) {
    if (isJson(body)) {
      return "json";
    }

    return "raw";
  }

  const contentType = MIME.parse(headers.get("Content-Type")!);

  switch (contentType?.essence) {
    case "application/json":
      return isJson(body) ? "json" : "raw";
    case "application/x-www-form-urlencoded":
      return "form";
    case "text/plain":
      return "text";
    default:
      if (contentType?.essence.endsWith("+json")) {
        return isJson(body) ? "json" : "raw";
      }

      return "raw";
  }
}

export type HttpsRequestObject = FetchObject & {
  computations?: Record<string, unknown>;
  values?: Record<string, unknown>;
};

export function bodyReference(template: Template<string>): Schematic<string> {
  return referenceTemplate({
    ref: "body",
    hint: ":?",
  }).$of(template);
}

export function searchReference(
  template: Template<URLSearchParams>,
): Schematic<URLSearchParams> {
  return referenceTemplate({
    ref: "search",
    hint: ":?",
  }).$of(template);
}

type BodySchematicOps = SchematicOps<string> & {
  readonly body: object;
};

export function bodySchema(schema?: Schema<string>): Schema<string> {
  return defineSchema<string>({
    scope(context) {
      if (schema) {
        executeOp(schema, "scope", context);
      }
    },
    async render(context) {
      const result = schema
        ? await executeOp(schema, "render", context)
        : undefined;

      return result;
    },
    merge(context) {
      const { template } = context;

      if (template === undefined || template === "") {
        return bodySchema(schema);
      }

      if (typeof template !== "string") {
        throw diagnostic(
          context,
          `body schema only works with strings not (${typeof template})`,
        );
      }

      let encoding = context.meta?.body as EncodingTypes | undefined;

      if (context.mode === "match") {
        if (schema) {
          return bodySchema(merge(schema, { ...context }));
        }

        encoding ??= guessContentType(template) ?? "raw";
        const matchTemplate =
          encoding === "json" ? JSON.parse(template) : template;

        const merged = merge(schema ?? stubSchema(), {
          ...context,
          template: encodings[`$${encoding}`](matchTemplate),
        });

        return merged && bodySchema(merged);
      }

      if (encoding) {
        const encodedTemplate = encodings[`$${encoding}`](template);

        const encodedMergeContext = {
          ...context,
          template: encodedTemplate,
        };

        const merged = merge(schema ?? stubSchema(), encodedMergeContext);

        if (merged) {
          return bodySchema(merged);
        }
      }

      try {
        const templateEncoded = encodings.$template(template);

        // special case to enable "xyz=123" single-value forms that otherwise parse as valid
        // templates to be still treated as forms.
        if (
          schema &&
          isSchematic(templateEncoded) &&
          exposeSchematic<ReferenceTemplateOps<unknown>>(templateEncoded)
            .reference
        ) {
          throw new Error("cannot merge body reference template encodings");
        }

        const merged = merge(schema ?? stubSchema(), {
          ...context,
          template: templateEncoded,
        });
        if (merged) {
          return merged && bodySchema(merged);
        }
      } catch (error) {
        void error;
      }

      // on error, final fallback to any existing schema with no template encoding.
      if (schema) {
        const merged = merge(schema, context);
        if (merged) {
          return bodySchema(merged);
        }
      }

      // if that fails and there wasn't an encoding, encode as raw
      if (!encoding) {
        const merged = merge(stubSchema(), {
          ...context,
          template: encodings.$raw(template),
        });
        if (merged) {
          return bodySchema(merged);
        }
      }
    },
  });
}

export function bodyTemplate(): Schematic<string> {
  return defineSchematic<BodySchematicOps>({
    expand(context) {
      return merge(bodySchema(), context)!;
    },
    body: {},
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

export function httpsRequestSchema() {
  return mixing<HttpsRequestObject>({
    method: "{{method = 'GET'}}",
    origin: originTemplate("{{?:origin}}"),
    pathname: pathnameTemplate("{{...pathname}}"),
    searchParams: searchReference(
      encodingTemplate(queryEncodingType, mvKeyedTuples),
    ),
    headers: headersTemplate(),
    body: bodyReference(bodyTemplate()),
    computations: hiddenTemplate<Record<string, unknown>>(),
  });
}

export function httpsResponseSchema(): Schema<ResponseObject> {
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
    body: bodyReference(bodyTemplate()),
  });
}
