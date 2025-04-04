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
import { PardonError } from "../../core/error.js";
import { depatternize, patternize } from "../schema/core/pattern.js";
import {
  FetchObject,
  ResponseObject,
  SimpleRequestInit,
  intoFetchParams,
} from "../request/fetch-pattern.js";
import { intoURL, parseURL } from "../request/url-pattern.js";
import { CURL } from "./curl-fmt.js";
import { KV } from "./kv-fmt.js";

export type RequestObject = FetchObject & {
  values?: Record<string, unknown>;
};

export const HTTP = {
  parse,
  stringify: requestObjectStringify,
  requestObject: {
    json: requestObjectJson,
    fromJSON: fromRequestObjectJson,
  },
  responseObject: {
    parse: parseResponseObject,
    stringify: responseObjectStringify,
    json: responseObjectJson,
    fromJSON: fromResponseObjectJson,
  },
};

function requestObjectStringify({
  values,
  ...request
}: Partial<RequestObject>) {
  const { origin, pathname, searchParams } = intoURL(request);
  return `${KV.stringify(values ?? {}, "\n", 2, "\n")}${origin?.trim() ? (request.method ?? "GET") : ""} ${origin ?? ""}${pathname ?? ""}${
    searchParams ?? ""
  }${[...Object.entries(request.meta ?? {})]
    .map(([k, v]) => `\n[${k}]: ${v}`)
    .join("")}${[...new Headers(request.headers)]
    .map(([k, v]) => `\n${k}: ${v}`)
    .join("")}${request.body ? `\n\n${request.body}` : ""}`.trim();
}

function responseObjectStringify(response: ResponseObject) {
  const { status, statusText, headers } = response;
  return `${status}${statusText ? ` ${statusText}` : ""}${[...headers.entries()]
    .map(([header, value]) => `\n${header}: ${value}`)
    .join("")}${response.body ? `\n\n${response.body}` : ""}
`.trim();
}

export type ResponseJSON = {
  status: number;
  statusText?: string;
  headers: [string, string][];
  body?: string;
};

export { type ResponseObject };

function responseObjectJson(response: Partial<ResponseObject>): ResponseJSON {
  return {
    status: Number(response.status ?? 0),
    statusText: response.statusText,
    headers: [...(response.headers || [])],
    body: response.body,
  };
}

function fromResponseObjectJson(
  response: ReturnType<typeof responseObjectJson>,
): ResponseObject {
  return {
    status: response.status,
    statusText: response.statusText,
    headers: new Headers(response.headers),
    body: response.body,
  };
}

function parse(
  file: string,
  options: { acceptcurl?: boolean } = {},
): Partial<RequestObject> {
  const { [KV.unparsed]: rest, ...values } = KV.parse(file, "stream");
  const lines = (rest ?? "").split("\n");

  if (options.acceptcurl && /^curl\s/.test(lines[0].trim())) {
    const {
      request: { values, ...request },
    } = CURL.parse(lines.join("\n"))!;
    const [url, { headers, ...init }] = intoFetchParams(request);

    return {
      ...parseURL(url),
      headers: new Headers(headers),
      ...init,
      values,
    };
  }

  const requestLine = lines.shift()!;
  if (!requestLine.trim()) {
    return { values };
  }
  const urltemplate = patternize(requestLine);

  const urlMatch = /^\s*(?:([A-Z]+)\s+)?((?:https?:)?[/][/].*)?/
    .exec(urltemplate.template!)!
    .slice(0, 4)
    .map((group) => group && depatternize(group, urltemplate));

  if (!urlMatch) {
    throw new PardonError(
      "failed to parse http request, expected maybe a method and url: " +
        requestLine,
    );
  }

  let [, method = "GET", url = ""] = urlMatch;

  scanComments(lines);
  while (lines.length > 0 && /^\s*[/?&]/.test(lines[0])) {
    url += trimComment(lines.shift()!.trim());
    scanComments(lines);
  }

  const { headers, meta } = scanHeaders(lines);

  const body: SimpleRequestInit["body"] = scanBody(lines);

  return {
    ...parseURL(url),
    method,
    meta,
    headers: new Headers(headers),
    ...(body && { body }),
    values,
  };
}

function parseResponseObject(response: string): ResponseObject {
  const lines = response.split("\n");

  scanComments(lines, { andBlankLines: true });
  const [, status, statusText] = /\s*(\d+)(?:\s*(.*))?$/.exec(lines.shift()!)!;

  const { headers, meta } = scanHeaders(lines);

  const body = scanBody(lines);

  return { status, statusText, headers: new Headers(headers), meta, body };
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

export type RequestJSON = {
  method: string;
  url: string;
  meta?: Record<string, string>;
  headers: [string, string][];
  body?: string;
  values?: Record<string, unknown>;
};

function requestObjectJson(request: Partial<RequestObject>): RequestJSON {
  return {
    method: request.method ?? "GET",
    url: intoURL(request).toString(),
    headers: [...(request.headers || [])],
    body: request.body,
    values: request.values,
    meta: request.meta,
  };
}

function fromRequestObjectJson(
  request: ReturnType<typeof requestObjectJson>,
): RequestObject {
  const { origin, pathname, searchParams } = intoURL(request.url);
  return {
    method: request.method,
    origin,
    pathname,
    searchParams,
    meta: request.meta,
    headers: new Headers(request.headers),
    body: request.body,
    values: request.values,
  };
}

function trimComment(line: string) {
  return line.replace(/\s*(?:#.*)?$/, "");
}

function scanComments(
  lines: string[],
  { andBlankLines: andBlanks = false } = {},
) {
  while (
    lines.length &&
    (/^#/.test(lines[0]) || (andBlanks && !lines[0].trim()))
  ) {
    lines.shift();
  }
}

function scanBody(lines: string[]) {
  const bodyLines: string[] = [];

  while ((scanComments(lines, { andBlankLines: false }), lines.length)) {
    bodyLines.push(lines.shift()!);
  }

  return bodyLines.join("\n").trim();
}
