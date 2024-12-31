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
import { Configuration } from "../../config/collection-types.js";
import { PardonError } from "../error.js";
import {
  fetchIntoObject,
  type FetchObject,
  type ResponseObject,
  type SimpleRequestInit,
} from "../request/fetch-pattern.js";
import { parseVariable } from "../schema/core/pattern.js";
import YAML from "yaml";
import { KV } from "./kv-fmt.js";

export type HttpsResponseStep = {
  type: "response";
  outcome?: string;
  source?: string;
} & ResponseObject;

export type HttpsRequestStep = {
  type: "request";
  request: FetchObject;
  computations: Record<string, string>;
  values: Record<string, unknown>;
  name?: string;
  source?: string;
};

export type HttpsSteps = (HttpsRequestStep | HttpsResponseStep)[];
export type HttpsMode = "mix" | "mux" | "flow" | "unit" | "log";

export type UnitOrFlowName = `${string}.unit` | `${string}.flow`;

export type HttpsFlowContext =
  | string
  | (HttpsFlowContext | Record<string, HttpsFlowContext>)[];

type ValueMapping = (string | Record<string, ValueMapping>)[];

export type HttpsFlowConfig = {
  import?: HttpsTemplateConfiguration["import"];
  defaults?: HttpsTemplateConfiguration["defaults"];
  context?: HttpsFlowContext;
  provides?: string | ValueMapping;
};

export type HttpsUnitConfig = HttpsFlowConfig & {
  use?: UseUnitOrFlow[];
  attempts?: number;
};

export type UseUnitOrFlow = {
  sequence: UnitOrFlowName;
  provides?: string | ValueMapping;
  context?: HttpsFlowContext;
};

export type HttpsSchemeType<Mode extends string, Config> = {
  mode: Mode;
  configuration: Config;
  steps: HttpsSteps;
};

export type HttpsScheme = HttpsUnitScheme | HttpsTemplateScheme;

export type HttpsTemplateConfiguration = Pick<
  Configuration,
  | "name"
  | "config"
  | "mixin"
  | "defaults"
  | "path"
  | "import"
  | "search"
  | "type"
  | "encoding"
>;

export type HttpsUnitScheme = HttpsSchemeType<"unit", HttpsUnitConfig>;
export type HttpsFlowScheme = HttpsSchemeType<"flow", HttpsFlowConfig>;

export type HttpsSequenceScheme = HttpsUnitScheme | HttpsFlowScheme;
export type HttpsTemplateScheme = HttpsSchemeType<
  "mix" | "mux",
  HttpsTemplateConfiguration
>;

export const HTTPS = { parse };

function parse(file: string, mode: HttpsMode = "mix"): HttpsScheme {
  const lines = file.split("\n");
  const steps: HttpsSteps = [];
  const inlineConfiguration: string[] = [];

  try {
    while (lines.length) {
      scanComments(lines, { allowBlank: true });
      if (/^\s*(?:>>>|<<<)/.test(lines[0])) {
        break;
      }
      if (lines.length) {
        inlineConfiguration.push(lines.shift()!);
      }
    }

    while (lines.length) {
      scanComments(lines, { allowBlank: true });
      if (/^\s*>>>/.test(lines[0])) {
        steps.push(scanRequest(lines, lines.shift()!));
        continue;
      }

      if (/^\s*<<</.test(lines[0])) {
        steps.push(scanResponse(lines, lines.shift()!));
        continue;
      }

      throw new PardonError("invalid HTTPS flow start: " + lines[0]);
    }
  } catch (error) {
    console.warn("parse error on: " + lines[0], error);

    throw error;
  }

  return {
    steps,
    ...(inlineConfiguration.length > 0 && {
      configuration: YAML.parse(inlineConfiguration.join("\n")),
    }),
    mode,
  } as HttpsUnitScheme;
}

function scanRequestComputations(file: string) {
  const computations: HttpsRequestStep["computations"] = {};
  const values: Record<string, unknown> = {};

  for (;;) {
    if (file.trim().startsWith(":")) {
      const [, expression, rest] = /\s*(:[^\n]*)\n(.*)/s.exec(file)!;
      const parsed = parseVariable(expression);
      if (!parsed) break;
      computations[parsed.param] = `{{${parsed.variable.source}}}`;
      file = rest;
    } else {
      const {
        [KV.unparsed]: rest,
        [KV.eoi]: _eoi,
        [KV.upto]: _upto,
        ...data
      } = KV.parse(file, "stream");
      if (Object.keys(data).length === 0) {
        break;
      }
      Object.assign(values, data);
      file = rest ?? "";
    }
  }

  return { computations, values, rest: file };
}

function scanRequest(lines: string[], first: string): HttpsRequestStep {
  const linesCopy = lines.slice();

  const [, name] = /^>>>\s*(.*?)\s*$/.exec(first) ?? [];

  // Horribly inefficient code here, but it only runs on load so...
  const { computations, values, rest } = scanRequestComputations(
    lines.join("\n"),
  );

  lines.splice(0, lines.length, ...rest.split("\n"));
  // end horrible code alert.

  scanComments(lines, { allowBlank: true });

  const requestLine = lines[0];
  const requestMatch = /^\s*([A-Z]+)\s+((?:https?:)?[/][/].*)/.exec(
    requestLine!,
  )!;

  if (!requestMatch) {
    throw new PardonError("illegal https-request line: " + requestLine);
  }

  let [, method, url] = requestMatch;

  lines.shift();

  scanComments(lines);
  while (lines.length > 0 && /^\s*[?&/]/.test(lines[0])) {
    url += trimComment(lines.shift()!.trim());
    scanComments(lines);
  }

  const headers = scanHeaders(lines);

  const body: SimpleRequestInit["body"] = scanSchema(lines);

  // delete method for mixin requests
  if (method == "ANY") {
    method = undefined!;
  }

  const request = fetchIntoObject(url, {
    method,
    headers,
    ...(body && { body }),
  });

  return {
    type: "request",
    request,
    computations,
    values,
    name,
    source: [first, ...linesCopy.slice(0, -lines.length)].join("\n"),
  };
}

function scanSchema(lines: string[]): string {
  const bodyLines: string[] = [];

  while (
    (scanComments(lines), lines.length) &&
    !lines[0].startsWith("<<<") &&
    !lines[0].startsWith(">>>")
  ) {
    bodyLines.push(trimComment(lines.shift()!));
  }

  return bodyLines.join("\n");
}

function scanResponse(lines: string[], first: string): HttpsResponseStep {
  const linesCopy = lines.slice();
  const match = /^\s*([\dX*]+|[{][{][^}]+[}][}])(?:\s+(.*))?\s*$/i.exec(
    lines[0],
  );

  if (!match) {
    throw new PardonError(
      "invalid https response match header line: " + JSON.stringify(lines[0]),
    );
  }

  const [, outcome] = /^<<<\s*(.*?)\s*$/.exec(first) ?? [];

  const [, status, statusText] = match;
  lines.shift();

  const headers = scanHeaders(lines);

  const schemaSource = scanSchema(lines);

  return {
    type: "response",
    status: /^\d+$/.test(status)
      ? Number(status)
      : status.replace(/[x?*]+/gi, (xs) => `{{${xs.replace(/./g, "?")}}}`),
    statusText,
    headers: new Headers(headers),
    body: schemaSource,
    outcome,
    source: [
      first,
      ...(lines.length ? linesCopy.slice(0, -lines.length) : linesCopy),
    ]
      .join("\n")
      .trim(),
  };
}

function scanHeaders(lines: string[]) {
  const headers: [string, string][] = [];

  while ((scanComments(lines), lines.length > 0)) {
    const headerline = trimComment(lines.shift()!);

    if (!headerline) {
      break;
    }

    const match = /^\s*([^:]+):\s*(.*)$/.exec(headerline)!;

    if (!match) {
      throw new PardonError("invalid header: " + headerline);
    }

    const [, header, value] = match;

    headers.push([header.trimEnd(), value]);
  }

  return headers;
}

function trimComment(line: string) {
  return line.replace(/\s*(?:#.*)?$/, "");
}

function scanComments(lines: string[], { allowBlank = false } = {}) {
  while (
    lines.length &&
    (/^#/.test(lines[0]) || (allowBlank && !lines[0].trim()))
  ) {
    lines.shift();
  }
}
