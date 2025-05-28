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

import { makePersisted } from "@solid-primitives/storage";
import { batch, createSignal } from "solid-js";
import {
  PardonFetchExecution,
  hookExecution,
  intoFetchParams,
} from "pardon/playground";

const [, nextTodoId] = makePersisted(createSignal(1000), { name: "todo-id" });

type Todo = { done: boolean; task: string };
const [todos, setTodos] = makePersisted(
  createSignal<Record<string, Record<string, Todo>>>({}),
  { name: "todos" },
);

const [users, setUsers] = makePersisted(
  createSignal<Record<string, string>>({}),
  { name: "users" },
);

export { users, todos };
export function reset() {
  batch(() => {
    nextTodoId(1000);
    setUsers({});
    setTodos({});
  });
}

function generateTodoId() {
  return `T${nextTodoId((id) => id + 1)}`;
}

export const TodoServerExecution = hookExecution(PardonFetchExecution, {
  async fetch({ outbound: { request } }) {
    const [url, init] = intoFetchParams(request);

    try {
      const response = await serve(url, init);

      const { status, statusText, headers } = response;

      return {
        status,
        statusText,
        headers,
        body: await response.text(),
      };
    } catch (error) {
      return {
        status: 500,
        headers: new Headers(),
        body: String(error),
      };
    }
  },
});

function parseToken(token?: string | null) {
  if (!token) return;
  const [header, payload] = token.split(".");
  if (!/^User\s+jwt/i.test(header.trimStart())) {
    throw new Error("invalid header");
  }
  return JSON.parse(atob(payload));
}

type RouteMap = Record<
  string,
  (info: {
    url: URL;
    req: RequestInit;
    slug: Record<string, string>;
  }) => Response | Promise<Response>
>;

function server(routemap: RouteMap) {
  function route(path: string, action: RouteMap[string]) {
    const re = new RegExp(
      `^${path
        .replaceAll(/::([a-z]*)/g, `(?<$1>.+)`)
        .replaceAll(/:([a-z]*)/g, `(?<$1>[^/]+)`)}/?$`,
    );

    return { re, action };
  }

  return async (url: URL, req: RequestInit) => {
    const routes = Object.entries(routemap).map(([path, action]) =>
      route(path, action),
    );

    try {
      for (const route of routes) {
        const match = route.re.exec(`${req.method} ${url.pathname}`);

        if (match) {
          return await route.action({ url, req, slug: match.groups ?? {} });
        }
      }
    } catch (error) {
      return new Response(String(error), { status: 500 });
    }
  };
}

function json(
  json: any,
  {
    status = 200,
    headers = {},
  }: {
    status?: number;
    headers?: Record<string, string>;
  } = {},
) {
  return new Response(JSON.stringify(json), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

const TODOServer = server({
  "GET /health-check"() {
    return new Response("ok");
  },
  "PUT /users"({ req: { body } }) {
    const { username, password } = JSON.parse(String(body));
    if (users()[username] === password) {
      return json({
        token: `jwt.${btoa(JSON.stringify({ username }))}`,
      });
    }

    return new Response("no", { status: 401 });
  },
  "PUT /todos/:todo"({ req, slug: { todo: id } }) {
    const { username } = parseToken(
      new Headers(req.headers).get("authorization"),
    );

    let todo = JSON.parse(String(req.body));

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
    const { username, password } = JSON.parse(String(req.body));
    const authority = parseToken(
      new Headers(req.headers).get("authorization"),
    )?.username;

    setUsers(({ [username]: current, ...users }) => {
      if (current && authority !== username) {
        throw new Error("cannot update existing user");
      }

      return { ...users, [username]: password };
    });

    return new Response("ok");
  },
  "POST /todos"({ req }) {
    const { username } = parseToken(
      new Headers(req.headers).get("authorization"),
    );

    const id = generateTodoId();
    const todo = { done: false, ...JSON.parse(String(req.body)) };
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
  "GET /todos"({ req }) {
    const { username } = parseToken(
      new Headers(req.headers).get("authorization"),
    );

    return json(
      Object.entries(todos()[username] ?? {}).map(([id, todo]) => ({
        id,
        ...todo,
      })),
    );
  },
  "DELETE /users"({ req }) {
    const { username } = parseToken(
      new Headers(req.headers).get("authorization"),
    );

    if (!username) {
      return new Response("no", { status: 401 });
    }

    if (!users()[username]) {
      return new Response("not found", { status: 404 });
    }

    setUsers(({ [username]: _, ...users }) => users);
    setTodos(({ [username]: _, ...todos }) => todos);

    return new Response(null, { status: 204 });
  },
  "DELETE /todos/:todo"({ req, slug: { todo: id } }) {
    const { username } = parseToken(
      new Headers(req.headers).get("authorization"),
    );

    if (!todos()[username]?.[id]) {
      return new Response(null, { status: 404 });
    }

    let todo: any;

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

async function serve(url: URL, init: RequestInit): Promise<Response> {
  return (await TODOServer(url, init)) ?? new Response(null, { status: 404 });
}
