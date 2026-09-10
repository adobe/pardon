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
import {
  intoFetchParams,
  intoResponseObject,
  type FetchObject,
  type ResponseObject,
} from "../request/fetch-object.js";

/**
 * A single reverse-proxy upstream. `origin` is the scheme://host[:port] that
 * `proxy:<name>` requests are forwarded to. Further keys (mocks, mode, ...) are
 * layered on in later chunks.
 */
export type UpstreamConfig = {
  origin: string;
};

export type ProxyUpstreams = Record<string, UpstreamConfig>;

/**
 * The `proxy` export shape read from `pardon.test.ts`. `port` is optional — when
 * omitted the listener auto-picks an unused port, discoverable at
 * `environment.proxy.port`.
 */
export type ProxyConfig = {
  port?: number;
  upstreams: ProxyUpstreams;
};

/**
 * Connection-scoped headers a proxy must not forward. Filtering these keeps
 * forwarding faithful to the *message* while dropping hop-by-hop framing that
 * belongs to the client<->proxy connection, not the proxy<->upstream one.
 * `fetch` derives host and recomputes content-length/encoding itself.
 * https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Connection
 */
export const hopByHopHeaders = new Set([
  "accept-encoding",
  "transfer-encoding",
  "te",
  "keep-alive",
  "trailer",
  "upgrade",
  "proxy-authorization",
  "proxy-authenticate",
  // not strictly hop-by-hop, but a proxy must not forward the client's host
  "host",
  "connection",
  "content-encoding",
  "content-length",
]);

/**
 * Split a `/proxy:<name>/rest...` pathname into the upstream name and the
 * remaining path to forward. Pure; returns undefined when the path does not
 * carry a proxy prefix.
 */
export function parseProxyPath(
  pathname: string | undefined,
): { name: string; pathname: string } | undefined {
  const match = /^[/]proxy:([^/]+)(.*)$/.exec(pathname ?? "");
  if (!match) {
    return undefined;
  }

  const [, name, rest] = match;
  return { name, pathname: rest || "/" };
}

/**
 * Rewrite an inbound request for its upstream: strip the `proxy:<name>` prefix
 * and swap the origin. This is deliberately *faithful* — nothing else about the
 * request is rendered, computed, or enriched. Only the routing prefix and the
 * origin change; method, query, body, and headers are forwarded as received
 * (except `host`, which fetch derives from the new origin).
 */
export function rewriteForUpstream(
  inbound: FetchObject,
  upstreams: ProxyUpstreams,
): { name: string; request: FetchObject } {
  const route = parseProxyPath(inbound.pathname);
  if (!route) {
    throw new PardonError(
      `proxy: request path ${inbound.pathname} is missing a /proxy:<name>/ prefix`,
    );
  }

  const upstream = upstreams[route.name];
  if (!upstream) {
    throw new PardonError(`proxy: no upstream configured named ${route.name}`);
  }

  const headers = new Headers(inbound.headers);
  for (const name of hopByHopHeaders) {
    headers.delete(name);
  }

  return {
    name: route.name,
    request: {
      ...inbound,
      origin: upstream.origin,
      pathname: route.pathname,
      headers,
    },
  };
}

/**
 * Forward a rewritten request to its upstream using the low-level serialization
 * helpers only (not the pardon render pipeline), returning the response object.
 */
export async function forwardRequest(
  request: FetchObject,
): Promise<ResponseObject> {
  const [url, init] = intoFetchParams(request);
  return intoResponseObject(await fetch(url, init));
}
