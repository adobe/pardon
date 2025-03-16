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
import dns from "node:dns/promises";
import consumers from "node:stream/consumers";
import { request } from "undici";

import {
  PardonExecutionContext,
  PardonFetchExecution,
} from "../core/pardon/pardon.js";
import { hookExecution } from "../core/execution/execution-hook.js";
import { PardonError } from "../core/error.js";
import { intoFetchParams } from "../modules/formats.js";
import {
  ResponseObject,
  SimpleRequestInit,
} from "../core/request/fetch-pattern.js";

export default function undici(
  execution: typeof PardonFetchExecution,
): typeof PardonFetchExecution {
  return hookExecution<PardonExecutionContext, typeof PardonFetchExecution>(
    execution,
    {
      async fetch({
        context: { timestamps },
        outbound: { request, redacted },
      }) {
        timestamps.request = Date.now();

        const [url, init] = intoFetchParams(request);

        init.headers ??= new Headers();
        (init.headers as Headers).append("Connection", "close");

        try {
          return await fetchSNI(url, init);
        } catch (error) {
          console.error("fetch failure", error);
          const [url, init] = intoFetchParams(redacted);
          throw new PardonError(
            `failed to fetch: ${init.method ?? "GET"} ${url}`,
            error as Error,
          );
        }
      },
    },
  );
}

async function fetchSNI(
  url: URL,
  { meta, method, headers, body }: SimpleRequestInit,
) {
  const serverhost = meta?.resolve;
  const hostip =
    serverhost &&
    url.protocol === "https:" &&
    (/^(\d+[.]){3}(\d+)$/.test(serverhost)
      ? serverhost
      : (await dns.resolve(serverhost, "A"))[0]);

  const servername = hostip ? url.host : undefined;
  const requestUrl = `${hostip ? `${url.protocol}//${hostip}` : url.origin}${url.pathname}${url.search}`;

  const rheaders = new Headers(headers);
  if (hostip && !rheaders.has("host")) {
    rheaders.append("host", servername!);
  }

  // note: returns undici response, not fetch response.
  const response = await request(requestUrl, {
    hostname: url.hostname,
    servername: hostip ? servername : undefined,

    method:
      (method as Exclude<Parameters<typeof request>[1], undefined>["method"]) ??
      "GET",
    headers: rheaders,
    body,
  } as Parameters<typeof request>[1] & { servername: string });

  return {
    status: response.statusCode,
    headers: new Headers(
      Object.entries(response.headers).flatMap(([k, v]) =>
        Array.isArray(v)
          ? v.map((w) => [k, w] as [string, string])
          : typeof v === "string"
            ? [[k, v] as [string, string]]
            : [],
      ),
    ),
    body: await consumers.text(response.body),
  } satisfies ResponseObject;
}
