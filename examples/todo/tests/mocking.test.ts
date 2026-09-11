import assert from "node:assert";

import { flow } from "pardon";
import { PardonTestConfiguration, trial } from "pardon/testing";

/**
 * Proxy / mocking harness for the todo service.
 *
 * The `proxy` config below is stood up automatically for the duration of a
 * normal test run (mock-backed, from `mocks/todo/**`), so the trials in this
 * file exercise the whole `.mock.https` suite end-to-end through the reverse
 * proxy. The chosen port is published at `environment['proxy-port']`.
 *
 * To instead run the proxy standalone (e.g. to drive it with curl), use:
 *
 *   pardon-runner tests/mocking.test.ts --proxy
 *
 * then send traffic through it, e.g.
 *
 *   curl http://127.0.0.1:<port>/proxy:todo/health-check
 */
export default {
  setup({ defi }) {
    defi("env", "local");
  },
  proxy: {
    upstreams: {
      // /proxy:todo/... is served synthetically from the mock suite; no
      // upstream call is made and nothing is captured.
      todo: {
        origin: "http://localhost:3000",
        mode: "mock",
        mocks: "./mocks/todo/**",
      },
    },
  },
} as PardonTestConfiguration;

trial("health-check", async () => {
  await flow()`
>>>
env=local
GET https://todo.example.com/health-check
[proxy]: auto

<<< 
200

ok`;
});

trial("auth-failures", async () => {
  // `todo` is a path variable, so it is passed as flow input rather than a `>>>`
  // KV line (KV-line path variables currently collapse the path).
  await flow()`
>>>
env=local
todo=T404
username=ghost
password=nope
PUT https://todo.example.com/users
[proxy]: auto

<<<
401

>>>
token=not-a-real-token
task=nope
POST https://todo.example.com/todos
[proxy]: auto

<<<
401

>>>
auth-type=none
GET https://todo.example.com/todos/{{todo}}
[proxy]: auto

<<<
401
`;
});

trial("user-crud", async () => {
  // register, then re-register -> conflict (the store persists across requests).
  await flow({ env: "local", username: "crud-user", password: "s3cret" })`
>>>
POST https://todo.example.com/users
[proxy]: auto

<<<
200

>>>
POST https://todo.example.com/users
[proxy]: auto

<<<
409
`;

  // login with the wrong password -> unauthorized.
  await flow({ env: "local", username: "crud-user", password: "wrong" })`
>>>
PUT https://todo.example.com/users
[proxy]: auto

<<<
401
`;

  // login -> invents an opaque bearer token. The secret `@token` doesn't
  // propagate between flow steps, so we capture it from the flow result (as a
  // plain value) and feed it back as input to the authed requests below.
  const { token } = await flow({
    env: "local",
    username: "crud-user",
    password: "s3cret",
  })`
>>>
PUT https://todo.example.com/users
[proxy]: auto

<<<
200

{ token }
`;
  assert.match(token, /^jwt\./, "token invented from the duality expression");

  // delete the user, then the same token no longer resolves.
  await flow({ env: "local", token })`
>>>
DELETE https://todo.example.com/users
[proxy]: auto

<<<
204

>>>
GET https://todo.example.com/todos
[proxy]: auto

<<<
401
`;
});

trial("todo-crud", async () => {
  // register + login -> token (threaded into the authed requests below).
  const { token } = await flow({
    env: "local",
    username: "todo-user",
    password: "hunter2",
  })`
>>>
POST https://todo.example.com/users
[proxy]: auto

<<<
200

>>>
PUT https://todo.example.com/users
[proxy]: auto

<<<
200

{ token }
`;

  // an empty list to start.
  await flow({ env: "local", token })`
>>>
GET https://todo.example.com/todos
[proxy]: auto

<<<
200

[]
`;

  // create -> monotonic invented id.
  const { id } = await flow({ env: "local", token, task: "write tests" })`
>>>
POST https://todo.example.com/todos
[proxy]: auto

<<<
200

{ id }
`;
  assert.match(id, /^T\d+$/, "id invented from the store counter");

  // read it back, and confirm it shows up in the list (`todo` is a path
  // variable, so it is passed as input rather than a KV line).
  await flow({ env: "local", token, todo: id })`
>>>
GET https://todo.example.com/todos/{{todo}}
[proxy]: auto

<<<
200

{ id: "{{todo}}", task: "write tests", done: false }

>>>
GET https://todo.example.com/todos
[proxy]: auto

<<<
200

[{ id: "{{todo}}", task: "write tests", done: false }]
`;

  // partial update (toggle done).
  await flow({ token, todo: id })`
>>>
env=local
PUT https://todo.example.com/todos/{{todo}}
[proxy]: auto

{ done: true }

<<<
200

{ id: "{{todo}}", task: "write tests", done: true }
`;

  // delete it; it is gone; deleting again -> not found.
  await flow({ env: "local", token, todo: id })`
>>>
DELETE https://todo.example.com/todos/{{todo}}
[proxy]: auto

<<<
204

>>>
GET https://todo.example.com/todos/{{todo}}
[proxy]: auto

<<<
404

>>>
DELETE https://todo.example.com/todos/{{todo}}
[proxy]: auto

<<<
404
`;
});
