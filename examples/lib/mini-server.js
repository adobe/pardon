/* shared bootstrap for the mini services: wraps a mini-router in a node http
 * server, reading the port from `--port` (standalone) or `$PORT` (compose).
 */

import { createServer } from "node:http";
import { buffer, text } from "node:stream/consumers";
import { parseArgs } from "node:util";

/**
 * @param {(req: import("./mini-router.js").MiniRequest) => Promise<Response|undefined>} router
 * @param {{ name: string, defaultPort: number }} options
 */
export function serveRouter(router, { name, defaultPort }) {
  const {
    values: { port },
  } = parseArgs({
    options: {
      port: {
        short: "p",
        type: "string",
        default: process.env.PORT ?? String(defaultPort),
      },
    },
  });

  const server = createServer(async (req, res) => {
    const response = await router({
      url: req.url,
      method: req.method,
      headers: new Headers(req.headers),
      body: await text(req),
    });

    if (!response) {
      console.info(`${name}: 404: no route for ${req.method} ${req.url}`);
      res.statusCode = 404;
      return res.end("no response");
    }

    console.info(`${name}: ${response.status}: ${req.method} ${req.url}`);
    res.statusCode = response.status;
    res.setHeaders(response.headers);
    res.end(response.body ? await buffer(response.body) : undefined);
  });

  server.listen(Number(port), () => {
    console.log(`${name} service started: http://localhost:${port}`);
  });

  return server;
}
