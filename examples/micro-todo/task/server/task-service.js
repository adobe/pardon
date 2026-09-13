import { createMiniRouter } from "../../../lib/mini-router.js";

/*
 * task service — stores and updates the state of todo tasks.
 *
 * Tasks are scoped per owner; the owner is passed in the `x-owner` header by the
 * caller (the todo API, after it has validated the caller's token against the
 * identity service). This service trusts that header — it is an internal
 * downstream, never exposed to end users directly.
 *
 * - POST   /tasks       create a task for the owner
 * - GET    /tasks       list the owner's tasks
 * - GET    /tasks/:id   fetch one task
 * - PUT    /tasks/:id   update a task (e.g. toggle done)
 * - DELETE /tasks/:id   remove a task
 */
export const makeTaskServiceRouter = ({ tasks, setTasks, generateTaskId }) =>
  createMiniRouter({
    "GET /health-check"() {
      return new Response("ok");
    },
    "POST /tasks": withOwner(({ req, owner }) => {
      const { task, done = false } = parseBodyJson(req);
      const id = generateTaskId();

      setTasks(({ [owner]: owned = {}, ...rest }) => ({
        [owner]: { ...owned, [id]: { task, done } },
        ...rest,
      }));

      return json({ id, task, done });
    }),
    "GET /tasks": withOwner(({ owner }) =>
      json(
        Object.entries(tasks()[owner] ?? {}).map(([id, task]) => ({
          id,
          ...task,
        })),
      ),
    ),
    "GET /tasks/:id": withOwner(({ owner, slug: { id } }) => {
      const task = (tasks()[owner] ?? {})[id];
      if (!task) {
        return new Response("not found", { status: 404 });
      }

      return json({ id, ...task });
    }),
    "PUT /tasks/:id": withOwner(({ req, owner, slug: { id } }) => {
      const patch = parseBodyJson(req);

      let updated;
      setTasks(({ [owner]: owned = {}, ...rest }) => {
        if (!owned[id]) {
          throw new Error("task not found");
        }

        updated = { ...owned[id], ...patch };
        return { [owner]: { ...owned, [id]: updated }, ...rest };
      });

      return json({ id, ...updated });
    }),
    "DELETE /tasks/:id": withOwner(({ owner, slug: { id } }) => {
      if (!(tasks()[owner] ?? {})[id]) {
        return new Response(null, { status: 404 });
      }

      setTasks(({ [owner]: owned, ...rest }) => {
        const { [id]: _removed, ...remaining } = owned;
        return { [owner]: remaining, ...rest };
      });

      return new Response(null, { status: 204 });
    }),
  });

/** require the `x-owner` header, passing it through to the action. */
function withOwner(action) {
  /** @param {import("../../../lib/mini-router.js").RouteInput} input */
  return (input) => {
    const owner = input.req.headers.get("x-owner");
    if (!owner) {
      return new Response("missing x-owner", { status: 400 });
    }

    return action({ ...input, owner });
  };
}

/** @param {import("../../../lib/mini-router.js").MiniRequest} req */
function parseBodyJson(req) {
  if (req.headers.get("content-type") !== "application/json") {
    throw new Error("missing content type");
  }

  return JSON.parse(String(req.body));
}

function json(json, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(json), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}
