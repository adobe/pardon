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
import {
  type ReferenceSchematicOps,
  referenceTemplate,
} from "../schema/definition/structures/reference.js";
import type { FetchObject, ResponseObject } from "./fetch-object.js";
import { queryEncodingType } from "../schema/definition/encodings/url-encoded.js";
import { headersTemplate } from "../schema/definition/encodings/headers-encoding.js";
import { datums } from "../schema/definition/datum.js";
import { mvKeyedTuples, scopedFields } from "../schema/scheming.js";
import { hiddenTemplate } from "../schema/definition/structures/hidden.js";
import { diagnostic } from "../schema/core/context-util.js";
import { stubSchema } from "../schema/definition/structures/stub.js";
import type {
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
import { type EncodingTypes, encodings } from "./body-template.js";
import { JSON } from "../raw-json.js";
import { merging } from "../schema/core/contexts.js";
import { encodingTemplate } from "../schema/definition/encodings/encoding.js";
import { guessContentType } from "../formats/https-fmt.js";
import { mergedSchematic } from "../schema/definition/structures/merge.js";

export type HttpsRequestObject = FetchObject & {
  computations?: Record<string, string>;
  values?: Record<string, unknown>;
};

export function bodyReference(template: Template<string>): Schematic<string> {
  return mergedSchematic(
    template,
    referenceTemplate({
      ref: "body",
      hint: "-?",
    }),
  );
}

export function searchReference(
  template: Template<URLSearchParams>,
): Schematic<URLSearchParams> {
  return mergedSchematic(
    template,
    referenceTemplate({
      ref: "search",
      hint: "-",
    }),
  );
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

        const merged = context.expand(encodings[`$${encoding}`](matchTemplate));

        return merged;
      }

      if (encoding && encoding !== "json") {
        const encodedTemplate = encodings[`$${encoding}`](template);

        const encodedMergeContext = {
          ...context,
          template: encodedTemplate,
          encoding,
        };

        const merged = merge(schema ?? stubSchema(), encodedMergeContext);

        if (merged) {
          return merged;
        }
      }

      try {
        const templateEncoded = encodings.$template(template, encoding);

        const isSingleReference =
          schema &&
          isSchematic(templateEncoded) &&
          exposeSchematic<ReferenceSchematicOps<unknown>>(templateEncoded)
            .reference;

        // special case to enable "xyz=123" single-value forms that otherwise parse as valid
        // templates to be still treated as forms.
        if (!isSingleReference) {
          const merged = merge(schema ?? stubSchema(), {
            ...context,
            template: templateEncoded,
          });

          if (merged) {
            return merged;
          }
        }
      } catch (error) {
        void error;
      }

      // on error, final fallback to any existing schema with no template encoding.
      if (schema) {
        const merged = merge(schema, context);
        if (merged) {
          return merged;
        }
      }

      // if that fails and there wasn't an encoding, encode as raw
      if (!encoding) {
        const merged = merge(stubSchema(), {
          ...context,
          template: encodings.$raw(template),
        });

        if (merged) {
          return merged;
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
          return /$/;
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

export function httpsRequestSchema(): Schema<HttpsRequestObject> {
  return merging<HttpsRequestObject>({
    method: "{{method = 'GET'}}",
    origin: originTemplate("{{-...origin}}"),
    pathname: pathnameTemplate("{{-...pathname}}"),
    searchParams: searchReference(
      encodingTemplate(queryEncodingType, mvKeyedTuples),
    ),
    headers: headersTemplate(),
    body: bodyReference(bodyTemplate()),
    computations: hiddenTemplate<Record<string, string>>(),
  })!;
}

export function httpsResponseSchema(): Schema<ResponseObject> {
  return merging<ResponseObject>({
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
  })!;
}
