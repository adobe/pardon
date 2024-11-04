#!/usr/bin/env -S node --enable-source-maps --stack-trace-limit=69
/*
Copyright 2024 Adobe. All rights reserved.
This file is licensed to you under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License. You may obtain a copy
of the License at http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed under
the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
OF ANY KIND, either express or implied. See the License for the specific language
governing permissions and limitations under the License.
*/

import { parseArgs } from "node:util";
import { resolve } from "node:path";

import trace from "../../../features/trace.js";
import { initializePardon } from "../../../runtime/runtime.js";
import {
  chooseReportOutput,
  executeSelectedTests,
  loadTests,
  PardonTestConfiguration,
  writeResultSummary,
} from "./runner.js";
import { extractKVs } from "../../../util/kv-options.js";
import remember from "../../../features/remember.js";
import failfast, { executeWithFastFail } from "./failfast.js";
import { parseSmokeConfig } from "../smoking.js";
import { initTrackingEnvironment } from "../../../runtime/environment.js";
import { JSON } from "../../../core/json.js";
import { mapObject } from "../../../util/mapping.js";

// execute tests
main().then(
  (code) => process.exit(code ?? 0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);

async function main() {
  const {
    positionals,
    values: {
      report: reportFormat = "reports/report-%date--%num",
      plan,
      verbose,
      root = ".",
      concurrency,
      ff,
      smoke,
    },
  } = parseArgs({
    allowPositionals: true,
    options: {
      report: {
        type: "string",
        short: "o",
      },
      plan: {
        type: "boolean",
      },
      verbose: {
        type: "boolean",
      },
      root: {
        type: "string",
      },
      concurrency: {
        type: "string",
      },
      ff: {
        type: "boolean",
      },
      /**
       * --smoke=env (selects one variant of each test per testcase "env" value, default shuffle=1)
       * --smoke=env~3 (selects one test per env shuffled 3)
       * --smoke=env~0 (selects the first test per env, unshuffled)
       * --smoke=2,env (selects 2 tests per env)
       * --smoke=2,env,country (selects at least 2 tests per env and country)
       * --smoke=env:3,country:2 (selects at least 3 tests per env and 2 per country)
       * --smoke=env:3,country:2~3 (selects at least 3 tests per env and 2 per country, different shuffle)
       */
      smoke: {
        type: "string",
      },
    },
  });

  const context = await initializePardon({ cwd: root }, [
    ff && failfast,
    trace,
    remember,
  ]);

  const resolvedTest = resolve(context.config.root, "pardon.test.ts");

  const argEnvironment = extractKVs(positionals, true);

  const { testplanner, configuration } = await loadTests(context, {
    testPath: resolvedTest,
  });

  await initTrackingEnvironment();
  environment = argEnvironment;

  const updates = await loadEnvironment(configuration);
  if (Object.keys(updates).length > 0) {
    environment = updates;
  }

  const { cases, patterns, antipatterns } = await testplanner(
    parseSmokeConfig(smoke),
    ...positionals,
  );

  const testplan = cases.filter(
    ({ testcase }) =>
      !patterns ||
      (patterns.some((p) => p.test(testcase)) &&
        !antipatterns.some((p) => p.test(testcase))),
  );

  if (testplan.length === 0) {
    console.warn(`
-----------------------------
FAIL

no testcases configured and/or
all testcases filtered out.${
      patterns?.some((p) => p.source.includes("package\\.json"))
        ? `

(Hint: You may need to put your ** filter in quotes.)
`
        : ""
    }
---------------------------`);
    return 1;
  }

  if (plan || !patterns) {
    if (plan) {
      console.info(`--- TEST PLAN ---`);
    } else {
      console.info(`
No testcases were specified!

--- TESTCASES AVAILABLE ---
`);
    }
    console.info(
      `${testplan
        .map(
          ({ testcase, environment }) =>
            `${testcase}${
              plan || verbose
                ? `\n` +
                  JSON.stringify(environment, null, 2)
                    .split("\n")
                    .slice(1, -1)
                    .join("\n") +
                  `\n`
                : ""
            }`,
        )
        .join("\n")}`,
    );

    if (!plan) {
      console.warn(`
---
No testcases were specified!

You can run all the previous testcases by adding "**"
> pardon-runner "**"
or select a subset of them with selective glob pattern(s).
`);
    }

    return plan ? 0 : 1; // fail by default if there was no --plan
  }

  const report = await chooseReportOutput(reportFormat);

  console.info(`report> ${report}`);
  console.info();

  if (concurrency != undefined) {
    configuration.concurrency = parseInt(concurrency);
  }

  const testResults = await executeWithFastFail(() =>
    executeSelectedTests(configuration, testplan, report, ff),
  );

  await configuration.report?.(report, testResults);

  await writeResultSummary(testResults, report);

  console.info();
  console.info("--- see test report ---");
  console.info(report);
  console.info();

  if (testResults.some(({ errors }) => errors.length > 0)) {
    return 1;
  }

  return 0;
}
async function loadEnvironment(configuration: PardonTestConfiguration) {
  if (typeof configuration.loading === "function") {
    const environmentLayer = Object.create(environment);
    const returnedEnvironment =
      (await configuration.loading(environmentLayer)) ?? {};
    const overridden = Object.getOwnPropertyNames(environmentLayer);

    return {
      ...mapObject(returnedEnvironment as typeof environment, {
        filter(key) {
          return environmentLayer[key] == null;
        },
      }),
      ...overridden,
    };
  }

  return {};
}
