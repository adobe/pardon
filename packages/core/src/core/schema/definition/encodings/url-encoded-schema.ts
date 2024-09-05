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
import { Schema, executeOp } from "../../core/schema.js";
import { intoSearchParams } from "../../../request/search-pattern.js";
import { arrays } from "../arrays.js";
import { keyed } from "../structures/keyed-list-schema.js";
import { stubSchema } from "../structures/stub-schema.js";
import { EncodingType, encodingSchema } from "./encoding-schema.js";
import { createMergingContext } from "../../core/context.js";
import { scalars } from "../scalars.js";
import { objects } from "../objects.js";

const formEncodingType: EncodingType<string, URLSearchParams> = {
  decode({ stub }) {
    return stub !== undefined ? intoSearchParams(`?${stub}`) : undefined;
  },
  encode(output) {
    return output !== undefined ? output.toString().slice(1) : undefined;
  },
};

const queryEncodingType: EncodingType<string, URLSearchParams> = {
  decode({ stub }) {
    return stub !== undefined ? intoSearchParams(stub) : undefined;
  },
  encode(output) {
    return output !== undefined ? output.toString() : undefined;
  },
};

const urlSearchParamsType: EncodingType<URLSearchParams, [string, string][]> = {
  decode({ stub }) {
    return stub !== undefined ? [...stub] : undefined;
  },
  encode(output) {
    return output !== undefined ? intoSearchParams(output) : undefined;
  },
};

export function urlEncodedSchema({
  params,
  multivalue = typeof params == "string" || Array.isArray(params),
}: {
  params?: string | Record<string, string> | [string, string][];
  multivalue?: boolean;
} = {}): Schema<URLSearchParams> {
  const querySchema = encodingSchema(
    urlSearchParamsType,
    multivalue
      ? keyed.mv<[string, string]>(
          arrays.tuple([scalars.string("{{key}}"), stubSchema()]) as Schema<
            [string, string]
          >,
          objects.object(
            {},
            arrays.multivalue([], arrays.tuple([stubSchema(), stubSchema()])),
          ) as Schema<Record<string, [string, string][]>>,
        )
      : keyed<[string, string]>(
          arrays.tuple([scalars.string("{{key}}"), stubSchema()]) as Schema<
            [string, string]
          >,
          objects.object(
            {},
            arrays.tuple([stubSchema(), stubSchema()]),
          ) as Schema<Record<string, [string, string]>>,
        ),
  );

  if (params === undefined) {
    return querySchema;
  }

  const searchParamTemplate = intoSearchParams(params);

  const withTemplate = executeOp(
    querySchema,
    "merge",
    createMergingContext(
      { mode: "mix", phase: "build" },
      querySchema,
      searchParamTemplate,
    ),
  );

  if (!withTemplate) {
    throw new Error("failed to template query params");
  }

  return withTemplate;
}

// assume multivalue unless initialized with a {...object}.
export function urlEncodedFormSchema(
  template?: string | Record<string, string> | [string, string][],
  multivalue: boolean = typeof template !== "object" || Array.isArray(template),
): Schema<string> {
  return encodingSchema(
    formEncodingType,
    urlEncodedSchema({
      params: typeof template === "string" ? `?${template}` : template,
      multivalue,
    }),
  );
}

export function urlEncodedQuerySchema(
  template?: string | Record<string, string> | [string, string][],
  multivalue?: boolean,
): Schema<string> {
  return encodingSchema(
    queryEncodingType,
    urlEncodedSchema({ params: template, multivalue }),
  );
}
