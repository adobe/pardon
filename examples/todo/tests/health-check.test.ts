import { flow } from "pardon";
import { PardonTestConfiguration, trial } from "pardon/testing";
import { allure } from "pardon/testing/allure";

export default {
  setup({ defi, each, debug }) {
    debug("init");
    defi("env", "local", each("stage", "prod"));
    debug("setup");
  },
  prefix: "%env",
  report: allure(),
} as PardonTestConfiguration;

trial("health-check", async ({ env }) => {
  flow({ env })`
    >>>
    GET https://todo.example.com/health-check

    <<<
    2xx OK
  `;
});

trial("health-check-flow", async ({ env }) => {
  flow("./health-check.flow.https");
});
