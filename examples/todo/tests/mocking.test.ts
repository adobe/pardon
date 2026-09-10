import { PardonTestConfiguration } from "pardon/testing";

/**
 * Proxy / mocking harness for the todo service.
 *
 * Stand up the reverse proxy and leave it running (capture mode):
 *
 *   pardon-runner tests/mocking.test.ts --proxy
 *
 * Then send traffic through it, e.g.
 *
 *   curl http://127.0.0.1:<port>/proxy:todo/health-check
 *
 * The chosen port is printed on startup and published at
 * `environment.proxy.port`; each proxied exchange is captured into the trace DB.
 */
export default {
  setup({ defi }) {
    defi("env", "local");
  },
  proxy: {
    port: 3001,
    upstreams: {
      // /proxy:todo/... forwards to the local todo service.
      // (a future `mocks: "mocks/todo/**"` key will bind the mock suite here.)
      todo: { origin: "http://localhost:3000" },
    },
  },
} as PardonTestConfiguration;
