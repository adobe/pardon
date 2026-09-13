import { flow } from "pardon";
import { PardonTestConfiguration, trial } from "pardon/testing";

// Contract test — isomorphic across record and replay. Run with `--mode record`
// (the `todo` upstream forwards `replay()` calls to the real server on :3000 and
// writes ./recordings/todo/<testcase>.log.https) or `--mode replay` (the same
// calls resolve from that per-testcase log). The recording path is chosen
// automatically from the testcase name, so nothing here changes between modes.
export default {
  setup({ defi }) {
    defi("env", "local");
  },
  proxy: {
    recordings: "./recordings",
    upstreams: {
      todo: {
        origin: "http://localhost:3000",
        mocks: "./mocks-record/todo/**",
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

trial("user-flow", async () => {
  await flow()`
>>>
username=test
password=test
POST https://todo.example.com/users
[proxy]: auto

<<<
200

>>>
username=test
password=test
PUT https://todo.example.com/users
[proxy]: auto

<<<
200
`;
});
