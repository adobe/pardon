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
import { intoSearchParams } from "../../../request/search-pattern.js";
import { arrays } from "../arrays.js";
import { keyed } from "../structures/keyed-list.js";
import { EncodingType, encodingTemplate } from "./encoding.js";
import { objects } from "../objects.js";
import { arrayIntoObject } from "../../../../util/mapping.js";
import { diagnostic } from "../../core/context-util.js";
import { Schematic, Template } from "../../core/types.js";

const formEncodingType: EncodingType<string, URLSearchParams> = {
  as: "string",
  decode({ template }) {
    return template !== undefined
      ? intoSearchParams(`?${template}`)
      : undefined;
  },
  encode(output) {
    return output !== undefined ? output.toString().slice(1) : undefined;
  },
};

const queryEncodingType: EncodingType<string, URLSearchParams> = {
  as: "string",
  decode({ template }) {
    return template !== undefined
      ? intoSearchParams(template as string)
      : undefined;
  },
  encode(output) {
    return output !== undefined ? output.toString() : undefined;
  },
};

const urlSearchParamsType: EncodingType<URLSearchParams, [string, string][]> = {
  as: "string",
  decode(context) {
    const { template } = context;
    if (typeof template === "function") {
      throw diagnostic(context, "unknown template in urlsearchparams");
    }

    return template !== undefined
      ? [...(template as URLSearchParams)]
      : undefined;
  },
  encode(output) {
    return output !== undefined ? intoSearchParams(output) : undefined;
  },
};

export function urlEncodedTemplate({
  params,
  multivalue = typeof params == "string" || Array.isArray(params),
}: {
  params?: string | Record<string, string> | [string, string][];
  multivalue?: boolean;
} = {}): Template<URLSearchParams> {
  const searchParamTemplate = params
    ? [...intoSearchParams(params).entries()]
    : [];

  return encodingTemplate(
    urlSearchParamsType,
    multivalue
      ? keyed.mv<[string, string]>(
          arrays.tuple(["{{key}}", undefined!]) as Template<[string, string]>,
          objects.object(
            {} as Record<string, [string, string][]>,
            arrays.multivalue(
              searchParamTemplate,
              arrays.tuple([undefined, undefined]) as unknown as Template<
                [string, string]
              >,
            ),
          ),
        )
      : keyed<[string, string]>(
          arrays.tuple(["{{key}}", undefined!]) as Template<[string, string]>,
          objects.object(
            arrayIntoObject(searchParamTemplate, ([k, v]) => ({
              [k]: [k, v],
            })),
          ),
        ),
  );
}

// assume multivalue unless initialized with a {...object}.
export function urlEncodedFormTemplate(
  template?: string | Record<string, string> | [string, string][],
  multivalue: boolean = typeof template === "undefined" ||
    typeof template !== "object" ||
    Array.isArray(template),
): Schematic<string> {
  return encodingTemplate(
    formEncodingType,
    urlEncodedTemplate({
      params: typeof template === "string" ? `?${template}` : template,
      multivalue,
    }),
  );
}

export function urlEncodedQueryTemplate(
  template?: string | Record<string, string> | [string, string][],
  multivalue?: boolean,
): Schematic<string> {
  return encodingTemplate(
    queryEncodingType,
    urlEncodedTemplate({ params: template, multivalue }),
  );
}
