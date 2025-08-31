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
  type FetchObject,
  type ResponseObject,
  type SimpleRequestInit,
  intoFetchParams,
} from "../request/fetch-object.js";
import { intoURL, parseURL } from "../request/url-object.js";
import { CURL } from "./curl-fmt.js";
import { type KeyValueStringifyOptions, KV } from "./kv-fmt.js";
import { encodeSearchComponent } from "../request/search-object.js";
import { createHeaders } from "../request/header-object.js";
import { mapObject } from "../../util/mapping.js";

export type RequestObject = FetchObject & {
  values?: Record<string, unknown>;
  computations?: Record<string, string>;
};

export type HttpFormatOptions = {
  limit?: number;
  indent?: number;
  kv?: KeyValueStringifyOptions;
};

type Lines = {
  peek(): string;
  next(): string;
  rest(): string[];
  eof: boolean;
};

function intoLines(text: string): Lines {
  const lines = text.split("\n");
  let index = 0;

  return {
    peek() {
      return lines[index];
    },
    next() {
      return lines[index++];
    },
    rest() {
      return lines.slice(index);
    },
    get eof() {
      return index >= lines.length;
    },
  };
}

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

function formatUrl(
  base: string,
  pathname: string,
  searchParams: URLSearchParams,
  options?: HttpFormatOptions,
) {
  const limit = options?.limit ?? Infinity;
  let url = base;
  let offset = url.length;

  const dent = `${" ".repeat(options?.indent ?? 2)}`;

  for (const part of pathname?.split("/").slice(1) || []) {
    if (offset + 1 + part.length > limit) {
      offset = dent.length;
      url += `\n${dent}`;
    }
    url += `/${part}`;
    offset += 1 + part.length;
  }

  if (!searchParams.size) {
    return url;
  }

  if (offset + String(searchParams).length <= limit) {
    return url + searchParams;
  }

  let index = 0;
  for (const [key, value] of searchParams.entries()) {
    url += `\n${dent}${index++ == 0 ? "?" : "&"}${encodeSearchComponent(key)}=${encodeSearchComponent(value)}`;
  }

  return url;
}

function requestObjectStringify(
  { values, ...request }: Partial<RequestObject>,
  options?: HttpFormatOptions,
) {
  const { origin, pathname, searchParams } = intoURL(request);
  const formattedValues = KV.stringify(
    values ?? {},
    options?.kv ?? {
      indent: 2,
      limit: options?.limit ?? 80,
      split: true,
      trailer: "\n",
    },
  );
  const formattedBase = `${origin?.trim() ? `${request.method ?? "GET"} ` : ""}${origin ?? ""}`;
  const formattedUrl = formatUrl(
    formattedBase,
    pathname,
    searchParams,
    options,
  );

  return `${formattedValues}${formattedUrl}${[
    ...Object.entries(request.meta ?? {}),
  ]
    .map(([k, v]) => `\n[${k}]: ${v}`)
    .join("")}${[...(createHeaders(request.headers) ?? [])]
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
    headers: createHeaders(response.headers),
    body: response.body,
  };
}

function parse(
  file: string,
  options: { acceptcurl?: boolean } = {},
): Partial<RequestObject> {
  const { [KV.unparsed]: rest, ...data } = KV.parse(file, "stream", {
    allowExpressions: true,
  });
  const lines = intoLines(rest ?? "");

  const computations: Record<string, string> = {};
  const values = Object.assign(
    {},
    mapObject(data, {
      select(value, key) {
        if (KV.isExprValue(value)) {
          computations[key as string] =
            `{{ -${key as string} = $$expr(${JSON.stringify(KV.loadExprValue(value))}) }}`;
          return false;
        }

        return true;
      },
    }),
  );

  if (options.acceptcurl && /^curl\s/.test(lines.peek().trim())) {
    const {
      request: { values: curlValues, ...request },
    } = CURL.parse(lines.rest().join("\n"))!;
    const [url, { headers, ...init }] = intoFetchParams(request);

    return {
      ...parseURL(url),
      headers: createHeaders(headers),
      ...init,
      values: { ...curlValues, ...values },
    };
  }

  const requestLine = lines.next()!;
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
  while (!lines.eof && /^\s*[/?&]/.test(lines.peek())) {
    url += trimComment(lines.next()!.trim());
    scanComments(lines);
  }

  const { headers, meta } = scanHeaders(lines);

  const body: SimpleRequestInit["body"] = scanBody(lines);

  return {
    ...parseURL(url),
    method,
    meta,
    headers: createHeaders(headers),
    ...(body && { body }),
    values,
    computations,
  };
}

function parseResponseObject(response: string): ResponseObject {
  const lines = intoLines(response ?? "");

  scanComments(lines, { andBlankLines: true });
  const [, status, statusText] = /\s*(\d+?)(?:\s+(.*))?$/.exec(
    lines.next()!.trim(),
  )!;

  const { headers, meta } = scanHeaders(lines);

  const body = scanBody(lines);

  return { status, statusText, headers: createHeaders(headers), meta, body };
}

function scanHeaders(lines: Lines) {
  const headers: [string, string][] = [];
  const meta: Record<string, string> = {};

  while ((scanComments(lines), !lines.eof)) {
    const headerline = trimComment(lines.next()!);

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
    headers: createHeaders(request.headers),
    body: request.body,
    values: request.values,
  };
}

function trimComment(line: string) {
  return line.replace(/\s*(?:#.*)?$/, "");
}

function scanComments(lines: Lines, { andBlankLines: andBlanks = false } = {}) {
  while (
    !lines.eof &&
    (/^#/.test(lines.peek()) || (andBlanks && !lines.peek().trim()))
  ) {
    lines.next();
  }
}

function scanBody(lines: Lines) {
  const bodyLines: string[] = [];

  while ((scanComments(lines, { andBlankLines: false }), !lines.eof)) {
    bodyLines.push(lines.next()!);
  }

  return bodyLines.join("\n").trim();
}
