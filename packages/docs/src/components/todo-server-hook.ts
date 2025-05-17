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
import { makeTodoServiceRouter } from "../../../../examples/todo/server/todo-service.js";

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
  async fetch({ egress: { request } }) {
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

const TODOServer = makeTodoServiceRouter({
  users,
  setUsers,
  todos,
  setTodos,
  generateTodoId,
});

async function serve(url: URL, init: RequestInit): Promise<Response> {
  const result = await TODOServer({
    url: url.pathname + url.search,
    method: init.method ?? "GET",
    body: init.body as string,
    headers: new Headers(init.headers),
  });

  return result ?? new Response(null, { status: 404 });
}
