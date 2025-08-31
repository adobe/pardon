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
import type { TestcaseOptions } from "@components/playgrounds/testcase/testcase-playground-shared.ts";
import {
  For,
  Match,
  Show,
  Switch,
  createMemo,
  createResource,
  createSignal,
  untrack,
  type VoidProps,
} from "solid-js";
import {
  type CaseContext,
  cases,
  describeCases,
  flushTrialRegistry,
  runRegistrationTask,
  survey,
  withSurveyConfiguration,
  trial,
  applySmokeConfig,
  parseSmokeConfig,
} from "pardon/playground";
import CodeMirror from "@components/codemirror/CodeMirror.tsx";
import { TestcaseTable } from "./TestcaseTable.tsx";
import { Testcases } from "@components/playgrounds/testcase/Testcases.tsx";

export default function TestcasePlayground(props: VoidProps<TestcaseOptions>) {
  const [script, setScript] = createSignal(
    untrack(() => props.example ?? "").trim(),
  );

  const [smoke, setSmoke] = createSignal(
    Array.isArray(props.smoker) ? props.smoker[0] : (props.smoker as string),
  );

  const [caseResource] = createResource(
    () => ({ mode: props.mode, script: script(), smoke: smoke() }),
    async ({ mode, script, smoke }) => {
      try {
        return {
          cases:
            mode === "trials"
              ? await evalTrials(script, smoke)
              : await evalCases(script, smoke),
        };
      } catch (error) {
        return { error };
      }
    },
  );

  const caseMemo = createMemo(
    ({ cases }: { cases?: CaseContext["environment"][] } = {}) => {
      switch (caseResource.state) {
        case "pending":
          return { state: caseResource.state };
        case "unresolved":
        case "errored":
        case "refreshing":
        case "ready":
          return {
            cases: caseResource.latest?.cases ?? cases,
            error: caseResource?.latest?.error,
            state: caseResource.state,
          };
      }
    },
  );

  return (
    <>
      <Show when={props.smoker}>
        <span class="text-sm">smoke</span>
        <div class="flex w-full flex-row">
          <CodeMirror
            class="grow bg-stone-300 dark:bg-stone-600"
            readwrite
            value={smoke()}
            onValueChange={setSmoke}
          />
          <Show when={Array.isArray(props.smoker)}>
            <select
              class="ml-2 w-32"
              value="try it"
              onChange={(event) => {
                setSmoke(event.target.value);
              }}
            >
              <For each={props.smoker as string[]}>
                {(each) => <option value={each}>{each}</option>}
              </For>
            </select>
          </Show>
        </div>
      </Show>
      <Show when={props.mode !== "trials"}>
        <pre class="text-base opacity-50">
          {"cases(({ set, each, ... }) => {"}
        </pre>
      </Show>
      <CodeMirror
        readwrite
        value={untrack(script)}
        onValueChange={setScript}
        class="rounded-md bg-zinc-50 p-2 shadow-md dark:bg-stone-700"
        javascript
      />
      <Switch
        fallback={
          <TestcaseTable
            rows={caseMemo()?.cases ?? []}
            error={caseMemo()?.error}
          />
        }
      >
        <Match when={props.mode === "trials"}>
          <Testcases
            rows={
              (caseMemo()?.cases as {
                testcase: string;
                [_: string]: unknown;
              }[]) ?? []
            }
            error={caseMemo()?.error}
          />
        </Match>
      </Switch>
    </>
  );
}

async function evalCases(script: string, smoke: string) {
  return (
    await describeCases((helpers) => {
      const helperEntries = Object.entries(helpers);

      new Function(...helperEntries.map(([k]) => k), script)(
        ...helperEntries.map(([, v]) => v),
      );

      const { fun, get } = helpers;

      fun("trial", get("trial", "stub"));
      applySmokeConfig(helpers, parseSmokeConfig(smoke));
    })
  ).map((ctx) => ctx.environment);
}

async function evalTrials(script: string, smoke: string) {
  const helperEntries = Object.entries({
    stop: undefined, // undefine window.stop()
    cases,
    trial,
    gamut(...args: Parameters<typeof survey>) {
      try {
        environments.unshift({ ...environments[0] });
        survey(...args);
      } finally {
        environments.shift();
      }
    },
  });

  try {
    await runRegistrationTask(() =>
      withSurveyConfiguration(() =>
        new Function(...helperEntries.map(([k]) => k), script)(
          ...helperEntries.map(([, v]) => v),
        ),
      ),
    );

    const trialRegistry = await flushTrialRegistry({});

    const allTrials = (
      await Promise.all(
        trialRegistry.flatMap(async ({ descriptions }) => {
          let cases: CaseContext[] | undefined = undefined;

          for (const description of descriptions) {
            cases = await describeCases(description, cases);
          }

          return cases ?? [];
        }),
      )
    ).flat(1);

    const smoked = await describeCases(
      (helpers) => applySmokeConfig(helpers, parseSmokeConfig(smoke)),
      allTrials,
    );

    return smoked.map(
      ({
        environment: { "::testexecution": _, testcase, ...environment },
      }) => ({
        testcase,
        ...environment,
      }),
    );
  } catch (error) {
    console.warn("error generating testcases", error);
    throw error;
  } finally {
    environments.splice(0, environments.length, {});
    await flushTrialRegistry({});
  }
}

const environments: any[] = [{}];

const environmentProxy = new Proxy(
  {},
  {
    ownKeys() {
      return Object.getOwnPropertyNames(environments[0]);
    },
    getOwnPropertyDescriptor(_, p) {
      return Object.getOwnPropertyDescriptor(environments[0], p);
    },
    has(_, p) {
      return p in environments[0];
    },
    set(_, p, value) {
      environments[0][p] = value;
      return true;
    },
    get(_, p) {
      return environments[0][p];
    },
    deleteProperty(_, p) {
      delete environments[0][p];
      return true;
    },
  },
);

Object.defineProperty(globalThis, "environment", {
  configurable: false,
  enumerable: true,
  get() {
    return environmentProxy;
  },
  set(values: Record<string, unknown> | null) {
    Object.assign(environments[0], values);
  },
});
