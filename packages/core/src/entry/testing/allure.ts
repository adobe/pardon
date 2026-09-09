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

/**
 * An optional Allure (https://allurereport.org) report generator for the pardon
 * test runner.
 *
 * This is a client-side helper built entirely on the public `report()` hook of
 * {@link PardonTestConfiguration} — no Allure-specific code lives in the runner
 * core. Wire it into your `pardon.test.ts`:
 *
 * ```ts
 * import { PardonTestConfiguration } from "pardon/testing";
 * import { allure } from "pardon/testing/allure";
 *
 * export default {
 *   prefix: "%env",
 *   report: allure(),
 * } satisfies PardonTestConfiguration;
 * ```
 *
 * It emits Allure result files into `<report>/allure-results`.
 * Point the Allure CLI at that directory:
 *
 * ```
 * allure generate <report>/allure-results --clean -o <report>/allure-report
 * ```
 */
import { createHash, randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

import type {
  PardonTestConfiguration,
  TestTraceOperation,
  TestTraceReport,
} from "./runner.js";

const HTTP_EXCHANGE_TYPE = "application/vnd.allure.http+json";

type NameValue = { name: string; value: string };
type AllureStatus = "passed" | "failed" | "broken" | "skipped";
type AllureAttachment = { name: string; source: string; type: string };
type AllureStep = {
  name: string;
  status: AllureStatus;
  stage: "finished";
  start?: number;
  stop?: number;
  statusDetails?: { message?: string; trace?: string };
  attachments: AllureAttachment[];
};

export type AllureReporterOptions = {
  /**
   * directory to write allure results into. If relative, it is resolved
   * against the runner's report directory. Defaults to `allure-results`.
   */
  dir?: string;
};

type ReportResult = {
  testcase: string;
  environment: Record<string, unknown>;
  errors: any[];
  trace?: TestTraceReport;
};

function url(op: TestTraceOperation) {
  const { origin, pathname, query } = op.request;
  const qs = query.length
    ? `?${query.map(({ name, value }) => `${name}=${value}`).join("&")}`
    : "";
  return `${origin ?? ""}${pathname ?? ""}${qs}`;
}

function splitCookiePair(pair: string): NameValue {
  const eq = pair.indexOf("=");
  return eq === -1
    ? { name: pair.trim(), value: "" }
    : { name: pair.slice(0, eq).trim(), value: pair.slice(eq + 1).trim() };
}

function cookiesFrom(headers: NameValue[], header: string): NameValue[] {
  const values = headers
    .filter(({ name }) => name.toLowerCase() === header)
    .map(({ value }) => value);

  if (header === "cookie") {
    return values
      .flatMap((v) => v.split(/;\s*/).filter(Boolean))
      .map(splitCookiePair);
  }

  // set-cookie: one cookie per header line, name=value is the first segment
  return values.map((v) => splitCookiePair(v.split(/;\s*/)[0]));
}

function withoutCookies(headers: NameValue[], header: string) {
  return headers.filter(({ name }) => name.toLowerCase() !== header);
}

/** Build the `application/vnd.allure.http+json` payload for one operation. */
function httpExchange(op: TestTraceOperation) {
  const exchange: Record<string, unknown> = {
    schemaVersion: 1,
    start: op.timestamps.request ?? op.timestamps.intent,
    stop: op.timestamps.response,
    request: {
      method: op.request.method?.toUpperCase() ?? "GET",
      url: url(op),
      headers: withoutCookies(op.request.headers, "cookie"),
      query: op.request.query,
      cookies: cookiesFrom(op.request.headers, "cookie"),
      ...(op.request.body != null ? { body: op.request.body } : {}),
    },
  };

  if (op.response) {
    const status =
      typeof op.response.status === "string"
        ? Number(op.response.status) || op.response.status
        : op.response.status;
    exchange.response = {
      status,
      ...(op.response.statusText ? { statusText: op.response.statusText } : {}),
      headers: withoutCookies(op.response.headers, "set-cookie"),
      cookies: cookiesFrom(op.response.headers, "set-cookie"),
      ...(op.response.body != null ? { body: op.response.body } : {}),
    };
  }

  if (op.error) {
    exchange.error = {
      message: op.error.message,
      ...(op.error.stack ? { trace: op.error.stack } : {}),
    };
  }

  return exchange;
}

function fmtTraceId(trace: number) {
  return `000${trace}`.slice(-3);
}

function stepName(op: TestTraceOperation) {
  const prefix = `${fmtTraceId(op.trace)} ${op.request.method ?? "GET"} ${op.request.origin ?? ""}${op.request.pathname ?? ""}`;
  if (op.response) {
    return `${prefix} ~ ${op.response.status}${op.outcome ? ` (${op.outcome})` : ""}`;
  }
  return `${prefix} ~ ERR`;
}

function paramValue(value: unknown): string {
  if (value == null) return String(value);
  if (typeof value === "object") {
    const text = JSON.stringify(value);
    return text.length > 512 ? `${text.slice(0, 509)}...` : text;
  }
  return String(value);
}

function suiteLabels(testcase: string): NameValue[] {
  const segments = testcase.split("/").filter(Boolean);
  const labels: NameValue[] = [];
  if (segments.length > 1)
    labels.push({ name: "parentSuite", value: segments[0] });
  if (segments.length > 2) labels.push({ name: "suite", value: segments[1] });
  if (segments.length > 3) {
    labels.push({ name: "subSuite", value: segments.slice(2, -1).join("/") });
  }
  return labels;
}

/**
 * Build a `report()` hook that emits Allure result files for each testcase.
 */
export function allure(
  options: AllureReporterOptions = {},
): NonNullable<PardonTestConfiguration["report"]> {
  return async function report(reportdir, results) {
    const allureDir = options.dir
      ? join(reportdir, options.dir)
      : join(reportdir, "allure-results");

    await mkdir(allureDir, { recursive: true });

    const host = hostname();

    await Promise.all(
      (results as ReportResult[]).map(async (result) => {
        const writes: Promise<void>[] = [];

        const attach = (
          name: string,
          extension: string,
          type: string,
          content: string,
        ): AllureAttachment => {
          const source = `${randomUUID()}-attachment.${extension}`;
          writes.push(writeFile(join(allureDir, source), content, "utf-8"));
          return { name, source, type };
        };

        const trace = result.trace;
        const operations = trace?.operations ?? [];

        const steps: AllureStep[] = operations.map((op) => {
          const failed = Boolean(op.error);
          return {
            name: stepName(op),
            status: failed ? "broken" : "passed",
            stage: "finished",
            start: op.timestamps.intent,
            stop: op.timestamps.response,
            ...(failed
              ? { statusDetails: { message: op.error!.message } }
              : {}),
            attachments: [
              attach(
                "HTTP exchange",
                "httpexchange",
                HTTP_EXCHANGE_TYPE,
                JSON.stringify(httpExchange(op)),
              ),
            ],
          };
        });

        const attachments: AllureAttachment[] = [];

        const failed = result.errors.length > 0;
        const message = failed
          ? String(
              result.errors[0]?.formatted ??
                result.errors[0]?.message ??
                result.errors[0],
            )
          : undefined;
        const traceText = failed
          ? result.errors.map((e) => String(e?.stack ?? e)).join("\n\n")
          : undefined;

        const parameters = Object.entries(
          trace?.parameters ?? result.environment ?? {},
        )
          .filter(([name]) => !name.startsWith("::"))
          .map(([name, value]) => ({ name, value: paramValue(value) }));

        const uuid = randomUUID();
        const allureResult = {
          uuid,
          historyId: createHash("md5").update(result.testcase).digest("hex"),
          name: result.testcase,
          fullName: result.testcase,
          status: failed ? "failed" : "passed",
          ...(failed ? { statusDetails: { message, trace: traceText } } : {}),
          stage: "finished",
          start: trace?.start ?? Date.now(),
          stop: trace?.stop ?? Date.now(),
          labels: [
            { name: "framework", value: "pardon" },
            { name: "host", value: host },
            // one Timeline lane per testcase so concurrent runs overlap visibly
            { name: "thread", value: result.testcase },
            ...suiteLabels(result.testcase),
          ],
          parameters,
          steps,
          attachments,
        };

        writes.push(
          writeFile(
            join(allureDir, `${uuid}-result.json`),
            JSON.stringify(allureResult),
            "utf-8",
          ),
        );

        await Promise.all(writes);
      }),
    );
  };
}
