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
import { extractKVs, intoArgs } from "../../util/kv-options.js";
import { FetchObject } from "../request/fetch-pattern.js";
import { parseArgs } from "node:util";
import { intoSearchParams } from "../request/search-pattern.js";
import { arrayIntoObject } from "../../util/mapping.js";
import { intoURL } from "../request/url-pattern.js";
import { RequestObject } from "./http-fmt.js";
import { PardonError } from "../error.js";

export const CURL = {
  parse,
  stringify,
};

function quot(s: string | unknown) {
  return String(s ?? "").replace(/["\\]/g, (m) => `\\${m}`);
}

function squot(s: string | unknown) {
  return String(s ?? "").replace(/'/g, `'"'"'`);
}

function headerList(headers: HeadersInit = []) {
  if (Array.isArray(headers)) {
    return headers;
  }

  if (headers instanceof Headers) {
    return [...headers.entries()];
  }

  return Object.entries(headers);
}

function stringify(
  request: FetchObject,
  { include, location }: { include?: boolean; location?: boolean } = {},
) {
  const { method, headers, body } = request;
  const url = intoURL(request);

  return [
    `curl ${method !== "GET" ? `--request ${method} ` : ""}${location ? "--location " : ""}"${quot(url)}"${
      include ? " --include" : ""
    }`,
    ...headerList(headers).map(
      ([key, value]) => `--header "${quot(key)}: ${quot(value)}"`,
    ),
    ...(body ? [`--data-raw '${squot(body)}'`] : []),
  ].join(" \\\n  ");
}

// subset of https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Connection
const hopByHopAndOtherForbiddenHeaders = [
  "Connection",
  "Content-Length",
  "Keep-Alive",
  "TE",
  "Transfer-Encoding",
  "Trailer",
  "Upgrade",
  "Proxy-Authorization",
  "Proxy-Authenticate",
];

function parse(command: string): {
  options: { include?: boolean };
  request: RequestObject;
} {
  const args = intoArgs(command);

  if (args[0] !== "curl") {
    throw new Error(`not a curl command: ${args[0]} ...`);
  }

  const { values: opts, positionals } = parseArgs({
    args: args.slice(1),
    allowPositionals: true,
    options: {
      request: {
        short: "X",
        type: "string",
      },
      header: {
        type: "string",
        short: "H",
        multiple: true,
      },
      include: {
        short: "i",
        type: "boolean",
      },
      location: {
        /* ignored by pardon */
        short: "L",
        type: "boolean",
      },
      data: {
        short: "d",
        type: "string",
      },
      "data-ascii": {
        type: "string",
      },
      "data-binary": {
        type: "string",
      },
      "data-raw": {
        type: "string",
      },
      json: {
        type: "string",
      },
      form: {
        short: "F",
        type: "string",
        multiple: true,
      },
      compressed: {
        /* ignored by pardon */
        type: "boolean",
      },
      url: {
        type: "string",
      },
    },
  });

  const include = opts.include;
  const values = extractKVs(positionals);
  const url = opts.url ?? positionals.shift();

  if (!url) {
    throw new PardonError("curl-fmt: no positional arguments or --url");
  }

  const { origin, pathname, searchParams } = intoURL(url);

  const headers = new Headers(
    opts.header?.map((header) => {
      const [, name, value] = /^([^:]*?):(.*)$/.exec(header) || [];
      return [name.trim(), value.trim()] as [string, string];
    }),
  );

  // delete Connection: keep-alive and other hop-by-hop headers, if present.
  for (const forbidden of hopByHopAndOtherForbiddenHeaders) {
    headers.delete(forbidden);
  }

  if (opts.json) {
    headers.append("Content-Type", "application/json");
    headers.append("Accept", "application/json");
  }

  const bodyAndEncoding: {
    body?: string;
    encoding?: FetchObject["encoding"];
  } =
    opts.data !== undefined
      ? { body: opts.data }
      : opts.json !== undefined
        ? { body: opts.json, encoding: "form" }
        : opts["data-raw"] !== undefined
          ? { body: opts["data-raw"] }
          : opts["data-ascii"] !== undefined
            ? { body: opts["data-ascii"] }
            : opts["data-binary"] !== undefined
              ? { body: opts["data-binary"], encoding: "raw" }
              : opts.form
                ? {
                    body: intoSearchParams(
                      arrayIntoObject(opts.form ?? [], (kv) => {
                        const [, key, value] = /^([^=]*?)=(.*)$/.exec(kv) || [
                          undefined,
                          kv,
                        ];
                        return {
                          [decodeURIComponent(key)]: value
                            ? decodeURIComponent(value)
                            : "",
                        };
                      }),
                    ).toString(),
                    encoding: "form",
                  }
                : {};

  const method =
    opts.request ?? (bodyAndEncoding.body !== undefined ? "POST" : "GET");

  return {
    options: {
      include,
    },
    request: {
      method,
      origin,
      pathname: pathname ?? (origin ? "/" : undefined),
      searchParams,
      meta: {},
      headers,
      values,
      ...bodyAndEncoding,
    },
  };
}
