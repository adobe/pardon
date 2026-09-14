#!/usr/bin/env -S node --enable-source-maps --stack-trace-limit=69 --no-warnings=ExperimentalWarning
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

import { parseArgs } from "node:util";
import { resolve } from "node:path";

import trace from "../../../features/trace.js";
import { initializePardon } from "../../../runtime/initialize.js";
import {
  chooseReportOutput,
  executeSelectedTests,
  filterTestPlanning,
  loadTests,
  setupRunnerHooks,
  writeResultSummary,
  type PardonTestConfiguration,
} from "../runner.js";
import { extractKVs } from "../../../util/kv-options.js";
import { startProxyServer } from "../../../core/proxy/server.js";
import { createAmbientCapture } from "../../../core/proxy/capture.js";
import persist from "../../../features/persist.js";
import failfast, {
  executeWithFastFail,
} from "../../../core/execution/flow/failfast.js";
import { initTrackingEnvironment } from "../../../runtime/environment.js";
import { JSON } from "../../../core/raw-json.js";
import { parseSmokeConfig } from "../smoke-config.js";
import contentEncodings from "../../../features/content-encodings.js";
import undici from "../../../features/undici.js";
import proxyFeature from "../../../features/proxy.js";
import { createFlowContext } from "../../../core/execution/flow/flow-context.js";
import { isProxyMode, type ProxyMode } from "../../../core/proxy/forwarder.js";

// execute tests
main().then(
  (code) => process.exit(code ?? 0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);

async function main() {
  let {
    positionals,
    values: {
      report: reportFormat = "reports/report-%date--%num",
      plan,
      verbose,
      cwd = ".",
      concurrency,
      ff,
      smoke,
      all,
      proxy,
      mode,
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
      cwd: {
        type: "string",
      },
      concurrency: {
        type: "string",
      },
      ff: {
        type: "boolean",
      },
      all: {
        type: "boolean",
      },
      mode: {
        type: "string",
      },
      /**
       * --proxy: instead of running tests, stand up the reverse proxy from the
       * test file's `proxy` config and wait (Ctrl-C to stop). Captures each
       * proxied exchange into the trace DB.
       */
      proxy: {
        type: "string",
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

  mode ??= "mock";

  if (!isProxyMode(mode)) {
    throw new Error("unknown proxy mode: " + mode);
  }

  await initializePardon(
    {
      cwd,
      createFlowContext() {
        return createFlowContext(this, { ...environment });
      },
    },
    [ff && failfast, proxyFeature, undici, contentEncodings, trace, persist],
  );

  const testfile = positionals[0]?.endsWith(".test.ts")
    ? positionals.shift()!
    : "pardon.test.ts";

  const resolvedTest = resolve(cwd, testfile);

  const { testplanner, configuration } = await loadTests({
    testPath: resolvedTest,
  });

  await initTrackingEnvironment();

  if (proxy) {
    return await runProxyServer(mode ?? "mock", configuration, cwd);
  }

  const testenv = extractKVs(positionals, true);

  let showPlanOnly = plan;
  if (positionals.length === 0) {
    positionals.push("**");
    showPlanOnly = plan || !all;
  }

  const planning = await testplanner(
    testenv,
    parseSmokeConfig(smoke),
    ...positionals,
  );

  const testplan = filterTestPlanning(planning);

  const proxyServer = showPlanOnly
    ? undefined
    : configuration.proxy
      ? await startProxyServer(mode ?? "mock", configuration.proxy, {
          capture: createAmbientCapture(),
          cwd,
        })
      : undefined;

  if (proxyServer) {
    for (const plan of testplan) {
      plan.testenv["proxy-origin"] = environment["proxy-origin"];
      plan.testenv["proxy-port"] = environment["proxy-port"];
    }
  }

  if (!planning.patterns || showPlanOnly) {
    if (showPlanOnly) {
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
          ({ testcase, testenv }) =>
            `${testcase}${
              plan || verbose
                ? `\n` +
                  JSON.stringify(testenv, null, 2)
                    .split("\n")
                    .slice(1, -1)
                    .join("\n") +
                  `\n`
                : ""
            }`,
        )
        .join("\n")}`,
    );

    if (!showPlanOnly) {
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

  const reportOutput = await chooseReportOutput(resolve(cwd, reportFormat));

  console.info(`report> ${reportOutput}`);
  console.info();

  if (concurrency != undefined) {
    configuration.concurrency = parseInt(concurrency);
  }

  if (mode === "record" || mode === "replay") {
    // record/replay bind the proxy's mock upstreams to one recording at a time
    // (shared per-upstream state), so tests must run serially — otherwise one
    // test's `useRecording` clobbers another's and every exchange lands in the
    // last-bound log. Per-request routing (parallel replay) is future work.
    configuration.concurrency = 1;
  }

  setupRunnerHooks();

  let testResults;
  try {
    testResults = await executeWithFastFail(() =>
      executeSelectedTests(
        configuration,
        testplan,
        reportOutput,
        ff,
        proxyServer &&
          ((testcase) => {
            const session = proxyServer.useRecording(testcase);
            return () => session.finish();
          }),
      ),
    );
  } finally {
    await proxyServer?.close();
  }

  await configuration.report?.(reportOutput, testResults);

  await writeResultSummary(reportOutput, testResults);

  console.info();
  console.info("--- see test report ---");
  console.info(reportOutput);
  console.info();

  if (testResults.some(({ errors }) => errors.length > 0)) {
    return 1;
  }

  return 0;
}

/**
 * `--proxy` mode: stand up the reverse proxy declared in the test file's
 * `proxy` config, capturing each exchange, and block until interrupted.
 */
async function runProxyServer(
  mode: ProxyMode,
  configuration: PardonTestConfiguration,
  cwd?: string,
): Promise<number> {
  if (!configuration.proxy) {
    console.error(
      "no `proxy` configuration exported from the test file; nothing to serve.",
    );
    return 1;
  }

  const server = await startProxyServer(mode, configuration.proxy, {
    capture: createAmbientCapture(),
    cwd,
  });

  const base = `http://127.0.0.1:${server.port}`;
  console.info(`proxy listening on ${base}`);
  for (const [name, { origin }] of Object.entries(
    configuration.proxy.upstreams,
  )) {
    console.info(`  ${base}/proxy:${name}/  ->  ${origin}`);
  }
  console.info(`  health: GET  ${base}/runner/health`);
  if (mode === "record" || mode === "replay") {
    console.info(`  start:  POST ${base}/runner/recording/{slug}   (mode:${mode})`);
    console.info(`  finish: PUT  ${base}/runner/recording/{slug}`);
  }
  console.info("proxy running; press Ctrl-C to stop.");

  await new Promise<void>((resolve) => {
    const stop = () => resolve();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });

  console.info("\nproxy: shutting down.");
  await server.close();

  return 0;
}
