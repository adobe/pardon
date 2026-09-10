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
  type PardonExecutionContext,
  PardonFetchExecution,
} from "../core/pardon/pardon.js";
import { hookExecution } from "../core/execution/execution-hook.js";
import zlib from "node:zlib";

const decoders: Record<string, (buffer: Buffer) => Buffer> = {
  br: (buffer) => zlib.brotliDecompressSync(buffer),
  gzip: (buffer) => zlib.gunzipSync(buffer),
  deflate: (buffer) => zlib.inflateSync(buffer),
  zstd: (buffer) => zlib.zstdDecompressSync(buffer),
};

export default function contentEncodings(
  execution: typeof PardonFetchExecution,
): typeof PardonFetchExecution {
  return hookExecution<PardonExecutionContext, typeof PardonFetchExecution>(
    execution,
    {
      async fetch(request, next) {
        const response = await next(request);

        // a native-fetch Response exposes an immutable Headers, so rewrite a
        // mutable copy that downstream consumers see instead.
        response.headers = new Headers(response.headers);

        // Depending on the transport (native fetch/undici vs. our SNI path),
        // some or all content-encoding layers may already be decoded by the
        // time we see the body, while the original headers are preserved
        // faithfully. Rather than guess per-transport, attempt each layer and
        // detect whether it was actually still encoded, then rewrite the
        // headers to describe the bytes we actually hold so downstream
        // consumers (reports, replay, devtools import) render consistently.
        const encodings = (response.headers.get("content-encoding") ?? "")
          .split(/,\s*/)
          .filter(Boolean);

        const unresolved: string[] = [];
        for (const contentEncoding of [...encodings].reverse()) {
          if (!response.rawBody) {
            break;
          }

          const decode = decoders[contentEncoding];
          if (!decode) {
            unresolved.unshift(contentEncoding);
            continue;
          }

          try {
            response.rawBody = decode(response.rawBody);
          } catch {
            // hopefully the transport already decoded this layer; keep the bytes and
            // drop the (now inaccurate) label.
          }
        }

        // headers now describe the body we hold.
        if (unresolved.length) {
          response.headers.set("content-encoding", unresolved.join(", "));
        } else {
          response.headers.delete("content-encoding");
        }

        if (response.rawBody) {
          response.headers.set(
            "content-length",
            String(response.rawBody.length),
          );
        }

        response.body = response.rawBody?.toString("utf-8") ?? "";

        return response;
      },
    },
  );
}
