import { flow } from "pardon";
import { PardonTestConfiguration, trial } from "pardon/testing";

// Contract test for the micro-todo `api` service (the system-under-test).
//
// Unlike examples/todo — where the proxy sits *in front of* the SUT — here the
// proxy sits *between* the api and its downstreams. The test drives the api
// directly, while the api's calls to `identity`/`task` (and the test's own
// identity login) flow through the recording proxy declared below.
//
// Isomorphic across modes. Run with `--mode record` (identity + task + api all
// running; the proxy forwards downstream calls to the real services and writes
// ./recordings/<testcase>.log.https) or `--mode replay` (identity + task are
// down; the same calls resolve from that per-testcase log). Nothing here changes
// between modes.
//
// The proxy binds a *fixed* port so the separately-started api process can point
// its connectors at it:
//   IDENTITY_ORIGIN=http://localhost:4099/proxy:identity
//   TASK_ORIGIN=http://localhost:4099/proxy:task
export default {
  setup({ defi }) {
    defi("env", "local");
  },
  proxy: {
    port: 4099,
    recordings: "./recordings",
    upstreams: {
      identity: {
        origin: "http://localhost:4001",
        mocks: "./record/identity/**",
      },
      task: {
        origin: "http://localhost:4002",
        mocks: "./record/task/**",
      },
    },
  },
} as PardonTestConfiguration;

trial("todo-lifecycle", async () => {
  await flow({ env: "local" })`
>>>
username=poc
password=poc
POST https://identity.example.com/users

<<<
200

>>>
username=poc
task="buy milk"
POST https://api.example.com/todos

<<<
200

{ id: todo }

>>>
username=poc
GET https://api.example.com/todos

<<<
200

{ id: key } * [{ id: todo, task: "buy milk" }]

>>>
username=poc
done=true
PUT https://api.example.com/todos/{{todo}}

<<<
200

{ done: true }

>>>
username=poc
GET https://api.example.com/todos/{{todo}}

<<<
200

{ done: true }

>>>
username=poc
DELETE https://api.example.com/todos/{{todo}}

<<<
204
`;
});
