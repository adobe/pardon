#!/usr/bin/env -S node --enable-source-maps --stack-trace-limit=69

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
import { parseArgs } from "node:util";
import { initializePardon } from "../../runtime/runtime.js";
import { HTTP } from "../../core/formats/http-fmt.js";
import HttpProxy from "http-proxy";
import { IncomingMessage, createServer } from "node:http";
import { gunzipSync } from "node:zlib";

const { createProxyServer } = HttpProxy;

server();

export async function server() {
  const context = await initializePardon({});

  const {
    values: { port, env },
  } = parseArgs({
    allowPositionals: true,
    options: {
      port: {
        type: "string",
        short: "p",
        default: "7000",
      },
      env: {
        type: "string",
        default: "local",
      },
    },
  });

  startProxyServer({
    port: Number(port!),
    route(req) {
      if (!req.url?.startsWith("/pardon:")) {
        return null;
      }

      const [, service, rest] = /[/]pardon:([^/]+)([/].*)?/.exec(req.url)!;

      // QUICK HACK ALERT

      const origin =
        context.collection.configurations[service]?.config?.["origin"]?.[
          "env"
        ]?.[env!];

      if (!origin) {
        return null;
      }

      return `${origin}${rest}`;
    },
  });

  return 0;
}

type ProxyConfig = {
  port: number;
  route: (req: IncomingMessage) => string | null | Promise<string | null>;
};

let sync: Promise<void> | undefined;

function startProxyServer({ port, route }: ProxyConfig) {
  const proxy = createProxyServer();

  console.info("# starting server on port");

  return createServer(async (req, res) => {
    await sync;
    const target = await route(req);

    if (!target) {
      res.writeHead(404);
      res.end();
      return;
    }

    const url = new URL(target);
    const requestBody: any[] = [];
    req.on("data", (chunk) => requestBody.push(chunk));
    req.on("close", () => {});

    // hacky synchronization of proxyRes and req?
    let resolveSync: () => void;
    sync = new Promise((resolve) => (resolveSync = resolve));
    proxy.once("proxyRes", (res) => {
      resolveSync();

      const responseBody: any[] = [];
      res.on("data", (chunk) => responseBody.push(chunk));
      res.on("close", () => {
        console.info(
          `
>>>
${HTTP.stringify({
  method: req.method,
  origin: url.origin,
  pathname: url.pathname,
  searchParams: url.searchParams,
  headers: new Headers(
    Object.entries(req.headers).flatMap(([key, values]) =>
      [values ?? []].flat(1).map((value) => [key, value] as [string, string]),
    ),
  ),
  body: Buffer.concat(requestBody).toString("utf-8"),
})}
<<<
${HTTP.responseObject.stringify({
  status: res.statusCode!,
  statusText: res.statusMessage,
  headers: new Headers(
    Object.entries(res.headers).flatMap(([key, values]) =>
      [values ?? []].flat(1).map((value) => [key, value] as [string, string]),
    ),
  ),
  body: decodeBody(Buffer.concat(responseBody), res),
})}`.trim() + "\n",
        );
      });
    });

    proxy.web(req, res, {
      target,
      ignorePath: true,
      changeOrigin: true,
    });
  }).listen({ port }, () => {
    console.info(`started logging proxy server on port ${port}`);
  });
}

function decodeBody(buffer: Buffer, res: IncomingMessage) {
  if (res.headers["content-encoding"] == "gzip") {
    buffer = gunzipSync(buffer);
  }
  return buffer.toString("utf-8");
}
