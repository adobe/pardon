import { makeApiServiceRouter } from "./api-service.js";
import { resolveConnectors } from "./connectors.js";
import { serveRouter } from "../../../lib/mini-server.js";

const connectors = resolveConnectors();
console.log(
  `api connectors: identity=${connectors.identity} task=${connectors.task}`,
);

serveRouter(makeApiServiceRouter({ connectors }), {
  name: "api",
  defaultPort: 4000,
});
