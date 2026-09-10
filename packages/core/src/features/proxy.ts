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
import { proxiedUrlParts } from "../core/request/proxy-meta.js";

/**
 * `[proxy]` meta-header support — reroute an egress request through a pardon
 * capture proxy.
 *
 * When a request carries a `[proxy]` meta header, e.g.
 *
 *     >>>
 *     [proxy]: http://localhost:8080/proxy:todo
 *     GET https://todo.example.com/todos
 *
 * the request is sent to the proxy instead of the origin: its origin becomes the
 * proxy's (`http://localhost:8080`) and its path is prefixed with the upstream
 * selector (`/proxy:todo`), so the wire request is
 * `GET http://localhost:8080/proxy:todo/todos`. The proxy then forwards to the
 * real upstream (chosen by the `todo` name) and captures the exchange.
 *
 * Only the wire destination moves. Matching, rendering, and the recorded
 * (redacted) request are untouched — this hook runs just inside persist/trace —
 * so the logical request (`https://todo.example.com/todos`) is what gets
 * recorded, and the feature composes cleanly with capture/replay.
 */
export default function proxy(
  execution: typeof PardonFetchExecution,
): typeof PardonFetchExecution {
  return hookExecution<PardonExecutionContext, typeof PardonFetchExecution>(
    execution,
    {
      fetch({ egress: { request } }) {
        const target = request.meta?.proxy;
        if (!target) {
          // no [proxy] header: defer to the normal fetch mechanism.
          return undefined!;
        }

        const { origin, pathname } = proxiedUrlParts(
          target,
          request.pathname ?? "/",
        );

        request.origin = origin;
        request.pathname = pathname;

        // fall through: the (now rewritten) request is sent as usual.
        return undefined!;
      },
    },
  );
}
