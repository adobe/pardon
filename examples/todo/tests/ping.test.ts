import { flow } from "pardon";
import { PardonTestConfiguration, trial } from "pardon/testing";

export default {
  setup({ defi, each, debug }) {
    debug("init");
    defi("env", "local", each("stage", "prod"));
    debug("setup");
  },
  prefix: "%env",
} as PardonTestConfiguration;

trial("ping", async ({ env }) => {
  flow({ env })`
    >>>
    GET https://todo.example.com/health-check

    <<<
    2xx OK
  `;
});
