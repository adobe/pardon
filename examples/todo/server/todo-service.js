import { createMiniRouter } from "../../lib/mini-router.js";

export const makeTodoServiceRouter = ({
  todos,
  setTodos,
  users,
  setUsers,
  generateTodoId,
}) =>
  createMiniRouter({
    "GET /health-check"() {
      return new Response("ok");
    },
    "PUT /users"({ req }) {
      const { username, password } = parseBodyJson(req);
      if (users()[username] === password) {
        return json({
          token: `jwt.${btoa(JSON.stringify({ username }))}`,
        });
      }

      return new Response("wrong username or password", { status: 401 });
    },
    "PUT /todos/:todo"({ req, slug: { todo: id } }) {
      const { username } = validateAuth(req);

      let todo = parseBodyJson(req);

      setTodos(({ [username]: todos, ...others }) => {
        if (!todos[id]) {
          throw new Error("todo not found");
        }

        todo = { ...todos[id], ...todo };
        return {
          [username]: {
            ...todos,
            [id]: todo,
          },
          ...others,
        };
      });

      return json({
        id,
        ...todo,
      });
    },
    "POST /users"({ req }) {
      const { username, password } = parseBodyJson(req);
      const { username: authority } = validateAuth(req) ?? {};

      setUsers(({ [username]: current, ...users }) => {
        if (current && authority !== username) {
          throw new Error("cannot update existing user");
        }

        return { ...users, [username]: password };
      });

      return new Response("ok");
    },
    "POST /todos"({ req }) {
      const { username } = validateAuth(req);

      if (!(username in users())) {
        throw new Error("user not registered");
      }

      const id = generateTodoId();
      const todo = { done: false, ...parseBodyJson(req) };
      setTodos(({ [username]: todos, ...others }) => {
        return {
          [username]: {
            ...todos,
            [id]: todo,
          },
          ...others,
        };
      });

      return json({
        id,
        ...todo,
      });
    },
    "GET /todos/:todo"({ req, slug: { todo: id } }) {
      const { username } = validateAuth(req);

      const todo = (todos()[username] ?? {})[id];
      if (!todo) {
        return new Response("not found", { status: 404 });
      }

      return json({
        id,
        ...todo,
      });
    },
    "GET /todos"({ req }) {
      const { username } = validateAuth(req);

      return json(
        Object.entries(todos()[username] ?? {}).map(([id, todo]) => ({
          id,
          ...todo,
        })),
      );
    },
    "DELETE /users"({ req }) {
      const { username } = validateAuth(req);

      if (!username) {
        return new Response("unauthorized", { status: 401 });
      }

      if (!users()[username]) {
        return new Response("not found", { status: 404 });
      }

      setUsers(({ [username]: _, ...users }) => users);
      setTodos(({ [username]: _, ...todos }) => todos);

      return new Response(null, { status: 204 });
    },
    "DELETE /todos/:todo"({ req, slug: { todo: id } }) {
      const { username } = validateAuth(req);

      if (!todos()[username]?.[id]) {
        return new Response(null, { status: 404 });
      }

      let todo;

      setTodos(({ [username]: todos, ...others }) => {
        if (!todos[id]) {
          throw new Error("todo not found");
        }

        ({ [id]: todo, ...todos } = todos);

        return {
          [username]: todos,
          ...others,
        };
      });

      return json({ id, ...todo });
    },
  });

/** @param {import("../../lib/mini-router.js").MiniRequest} req */
function parseBodyJson(req) {
  if (req.headers.get("content-type") !== "application/json") {
    throw new Error("missing content type");
  }

  return JSON.parse(String(req.body));
}

/** @param {import("../../lib/mini-router.js").MiniRequest} req */
function validateAuth(req) {
  const token = req.headers.get("authorization");
  if (!token) return;
  const [header, payload] = token.split(".");
  if (!/^User\s+jwt/i.test(header.trimStart())) {
    throw new Error("invalid auth");
  }
  return JSON.parse(atob(payload));
}

function json(json, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(json), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}
