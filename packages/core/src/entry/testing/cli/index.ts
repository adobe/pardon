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
  writeResultSummary,
} from "./runner.js";
import { extractKVs } from "../../../util/kv-options.js";
import remember from "../../../features/remember.js";
import failfast, { executeWithFastFail } from "./failfast.js";
import { parseSmokeConfig } from "../smoking.js";
import { initEnvironment } from "../../../runtime/environment.js";

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
      test: {
        type: "string",
        short: "c",
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
       * --smoke=env (selects one variant of each test per environment, default shuffle=1)
       * --smoke=env~3 (selects one test per environment shuffled 3)
       * --smoke=env~0 (selects the first test per environment unshuffled)
       * --smoke=2,env (selects 2 tests per environment)
       * --smoke=2,env,country (selects at least 2 tests per environment and country)
       * --smoke=env:3,country:2 (selects at least 3 tests per environment and 2 per country)
       * --smoke=env:3,country:2~3 (selects at least 3 tests per environment and 2 per country, different shuffle)
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

  console.info("pardon: loading " + resolvedTest);

  const baseEnvironment = extractKVs(positionals, true);

  const { testplanner, configuration } = await loadTests(context, {
    testPath: resolvedTest,
  });

  const testplan = testplanner(
    baseEnvironment,
    parseSmokeConfig(smoke),
    ...positionals,
  );

  await initEnvironment({});

  if (plan) {
    console.info(
      `--- TEST PLAN ---
${testplan
  .map(
    ({ testcase, environment }) =>
      `${testcase}\n${JSON.stringify(environment, null, 2)
        .split("\n")
        .slice(1, -1)
        .join("\n")}\n`,
  )
  .join("\n")}`,
    );

    return 0;
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
