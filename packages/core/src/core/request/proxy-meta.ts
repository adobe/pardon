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
import { PardonError } from "../error.js";

/**
 * Given a `[proxy]` meta target (e.g. `http://localhost:8080/proxy:todo`) and a
 * request pathname (e.g. `/todos`), compute the rerouted origin and pathname
 * (`http://localhost:8080` + `/proxy:todo/todos`).
 *
 * Shared by the `proxy` fetch feature (which mutates the wire request) and the
 * curl renderer (which shows the same rerouted URL), so they can't drift.
 */
export function proxiedUrlParts(
  target: string,
  pathname: string = "/",
): { origin: string; pathname: string } {
  let proxyUrl: URL;
  try {
    proxyUrl = new URL(target);
  } catch {
    throw new PardonError(
      `proxy: invalid [proxy] target (not a URL): ${target}`,
    );
  }

  const prefix = proxyUrl.pathname.replace(/\/+$/, "");

  return {
    origin: proxyUrl.origin,
    pathname: `${prefix}${pathname.startsWith("/") ? "" : "/"}${pathname}`,
  };
}
