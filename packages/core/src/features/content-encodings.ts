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
  PardonExecutionContext,
  PardonFetchExecution,
} from "../core/pardon/pardon.js";
import { hookExecution } from "../core/execution/execution-hook.js";
import { brotliDecompressSync } from "node:zlib";

export default function contentEncodings(
  execution: typeof PardonFetchExecution,
): typeof PardonFetchExecution {
  return hookExecution<PardonExecutionContext, typeof PardonFetchExecution>(
    execution,
    {
      async fetch(request, next) {
        const response = await next(request);

        if (response.headers.get("content-encoding") == "br") {
          response.body = response.rawBody
            ? brotliDecompressSync(response.rawBody).toString("utf-8")
            : "";
        }

        return response;
      },
    },
  );
}
