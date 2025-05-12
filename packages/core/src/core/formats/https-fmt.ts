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
  type Configuration,
  type EncodingTypes,
  type ResourceProcessingPhase,
} from "../../config/collection-types.js";
import { PardonError } from "../error.js";
import {
  fetchIntoObject,
  type FetchObject,
  type ResponseObject,
  type SimpleRequestInit,
} from "../request/fetch-object.js";
import { parseVariable } from "../schema/core/pattern.js";
import YAML from "yaml";
import { KV } from "./kv-fmt.js";
import { JSON } from "../raw-json.js";

import MIME from "whatwg-mimetype";
import { createHeaders } from "../request/header-object.js";

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

export type HttpsScriptStep = {
  type: "script";
  label: string;
  script: string;
  source?: string;
};

export type HttpsSteps<Mode extends string> = Mode extends "flow"
  ? (HttpsRequestStep | HttpsResponseStep | HttpsScriptStep)[]
  : (HttpsRequestStep | HttpsResponseStep)[];

export type HttpsMode = "mix" | "mux" | "flow" | "log";

export type FlowName = `${string}.flow`;

export type HttpsFlowContext =
  | string
  | (HttpsFlowContext | Record<string, HttpsFlowContext>)[];

type ValueMapping = (string | Record<string, ValueMapping>)[];

export type HttpsFlowConfig = {
  context?: HttpsFlowContext;
  provides?: string | ValueMapping;
  use?: UseFlow[];
  import?: HttpsTemplateConfiguration["import"];
  defaults?: HttpsTemplateConfiguration["defaults"];
  attempts?: number;
};

export type UseFlow = {
  flow: FlowName;
  context?: HttpsFlowContext;
  provides?: string | ValueMapping;
};

export type HttpsSchemeType<Mode extends string, Configuration> = {
  mode: Mode;
  configuration: Configuration;
  steps: HttpsSteps<Mode>;
};

export type HttpsScheme<Phase extends ResourceProcessingPhase> =
  | HttpsFlowScheme
  | HttpsTemplateScheme<Phase>;

export type HttpsTemplateConfiguration<
  Phase extends ResourceProcessingPhase = "runtime",
> = Pick<
  Configuration<Phase>,
  | "name"
  | "config"
  | "mixin"
  | "defaults"
  | "path"
  | "import"
  | "type"
  | "export"
>;

export type HttpsFlowScheme = HttpsSchemeType<"flow", HttpsFlowConfig>;

export type HttpsTemplateScheme<
  Phase extends ResourceProcessingPhase = "runtime",
> = HttpsSchemeType<"mix" | "mux", HttpsTemplateConfiguration<Phase>>;

export const HTTPS = { parse };

function parse(file: string, mode: HttpsMode = "mix"): HttpsScheme<"source"> {
  const lines = file.split("\n");
  const steps: HttpsSteps<typeof mode> = [];
  const inlineConfiguration: string[] = [];

  try {
    while (lines.length) {
      scanComments(lines, { allowBlank: true });
      if (/^\s*(?:>>>|<<<|!!!)/.test(lines[0])) {
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

      if (mode === "flow") {
        if (/^\s*!!!/.test(lines[0])) {
          (steps as HttpsSteps<"flow">).push(scanScript(lines, lines.shift()!));
          continue;
        }
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
  } as HttpsFlowScheme;
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
  if (/^\s*(?:<<<|>>>|!!!)/.test(requestLine)) {
    return {
      type: "request",
      request: fetchIntoObject("//", {
        method: "ANY",
      }),
      computations,
      values,
      name,
      source: [first, ...linesCopy.slice(0, -lines.length)].join("\n"),
    };
  }

  const requestMatch = /^\s*([A-Z]+)\s+((?:https?:)?[/][/].*)/.exec(
    requestLine!,
  )!;

  if (!requestMatch) {
    return {
      type: "request",
      computations,
      values,
      request: { headers: new Headers() },
    };
  }

  let [, method, url] = requestMatch;

  lines.shift();

  scanComments(lines);
  while (lines.length > 0 && /^\s*[?&/]/.test(lines[0])) {
    url += trimComment(lines.shift()!.trim());
    scanComments(lines);
  }

  const { headers, meta } = scanHeaders(lines);

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
    request: { ...request, meta },
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
    !/^\s*(?:<<<|>>>|!!!)/.test(lines[0])
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

  const { headers } = scanHeaders(lines);

  const schemaSource = scanSchema(lines);

  return {
    type: "response",
    status: /^\d+$/.test(status)
      ? Number(status)
      : status.replace(/[x?*]+/gi, (xs) => `{{${xs.replace(/./g, "?")}}}`),
    statusText,
    headers: createHeaders(headers),
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

function scanScript(lines: string[], first: string): HttpsScriptStep {
  const linesCopy = lines.slice();

  const [, label] = /^<<<\s*(.*?)\s*$/.exec(first) ?? [];
  const script = scanSchema(lines);

  return {
    type: "script",
    script,
    label,
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
  const meta: Record<string, string> = {};

  while ((scanComments(lines), lines.length > 0)) {
    const headerline = trimComment(lines.shift()!);

    if (!headerline) {
      break;
    }

    const metaMatch = /^\s*\[(\s*[^:\]]+)\s*\]\s*:\s*(.*)$/.exec(headerline)!;

    if (metaMatch) {
      const [, metaKey, metaValue] = metaMatch;
      meta[metaKey] = metaValue;

      continue;
    }

    const match = /^\s*([^:]+):\s*(.*)$/.exec(headerline)!;

    if (!match) {
      throw new PardonError("invalid headerline: " + headerline);
    }

    const [, header, value] = match;

    headers.push([header.trimEnd(), value]);
  }

  return { headers, meta };
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
