import { makeIdentityServiceRouter } from "./identity-service.js";
import { createSignal } from "../../../lib/mini-signal.js";
import { serveRouter } from "../../../lib/mini-server.js";

const [users, setUsers] = createSignal({});

serveRouter(makeIdentityServiceRouter({ users, setUsers }), {
  name: "identity",
  defaultPort: 4001,
});
