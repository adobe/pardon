import { createMiniRouter } from "../../../lib/mini-router.js";

/*
 * todo API (a bff - backend-for-frontend) — the public API, shaped like the original todo service minus
 * the /users management surface (that now lives in the identity service).
 *
 * The API holds no state. For every /todos call it:
 *   1. validates the caller's token against the identity service, and
 *   2. relays the operation to the task service, scoped to the resolved user.
 *
 * Both downstream calls go through `connectors` (see ./connectors.js), which is
 * how they get pointed at the pardon recording proxy in a test composition.
 */
export const makeApiServiceRouter = ({ connectors }) => {
  async function resolveUser(req) {
    const authorization = req.headers.get("authorization");
    const token = authorization?.replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      return undefined;
    }

    const response = await fetch(`${connectors.identity}/validate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });

    if (!response.ok) {
      return undefined;
    }

    const { username } = await response.json();
    return username;
  }

  function taskService(method, path, { owner, body } = {}) {
    return fetch(`${connectors.task}${path}`, {
      method,
      headers: {
        "x-owner": owner,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  /** wrap a route so it only runs for a validated caller, injecting `username`. */
  function authed(action) {
    /** @param {import("../../../lib/mini-router.js").RouteInput} input */
    return async (input) => {
      const username = await resolveUser(input.req);
      if (!username) {
        return new Response("unauthorized", { status: 401 });
      }

      return action({ ...input, username });
    };
  }

  return createMiniRouter({
    "GET /health-check"() {
      return new Response("ok");
    },
    "POST /todos": authed(async ({ req, username }) => {
      const { task } = parseBodyJson(req);
      return relay(
        await taskService("POST", "/tasks", {
          owner: username,
          body: { task },
        }),
      );
    }),
    "GET /todos": authed(async ({ username }) =>
      relay(await taskService("GET", "/tasks", { owner: username })),
    ),
    "GET /todos/:todo": authed(async ({ username, slug: { todo } }) =>
      relay(await taskService("GET", `/tasks/${todo}`, { owner: username })),
    ),
    "PUT /todos/:todo": authed(async ({ req, username, slug: { todo } }) => {
      const patch = parseBodyJson(req);
      return relay(
        await taskService("PUT", `/tasks/${todo}`, {
          owner: username,
          body: patch,
        }),
      );
    }),
    "DELETE /todos/:todo": authed(async ({ username, slug: { todo } }) =>
      relay(await taskService("DELETE", `/tasks/${todo}`, { owner: username })),
    ),
  });
};

/** relay a downstream (task-service) response back out as the API response. */
async function relay(response) {
  const body = await response.text();
  const contentType = response.headers.get("content-type");
  return new Response(body || null, {
    status: response.status,
    headers: contentType ? { "content-type": contentType } : {},
  });
}

/** @param {import("../../../lib/mini-router.js").MiniRequest} req */
function parseBodyJson(req) {
  if (req.headers.get("content-type") !== "application/json") {
    throw new Error("missing content type");
  }

  return JSON.parse(String(req.body));
}
