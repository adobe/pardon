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

import {
  Accessor,
  createEffect,
  createMemo,
  createResource,
  createRoot,
  createSignal,
  For,
  Index,
  on,
  Show,
  startTransition,
  Suspense,
} from "solid-js";
import ValuesInput from "./ValuesInput.tsx";
import LoadingSplash from "./LoadingSplash.tsx";
import { TbChartArrows, TbChartDots3, TbRun, TbTrash } from "solid-icons/tb";
import Resizable from "corvu/resizable";
import {
  cleanObject,
  parseSmokeConfig,
  type SmokeConfig,
} from "pardon/formats";
import { makePersisted } from "@solid-primitives/storage";
import { InfoDrawer } from "./InfoDrawer.tsx";
import Drawer from "corvu/drawer";
import KeyValueCopier from "./KeyValueCopier.tsx";
import { AwaitedJsonSequences } from "../../electron/pardon-worker.ts";
import { RequestSummaryTree } from "./RequestSummaryTree.tsx";
import { traces } from "./request-history.ts";
import { RequestSummaryInfoDrawerWrapper } from "./RequestHistory.tsx";
import { arrayIntoObject } from "pardon/utils";
import localforage from "localforage";
import InProgressBanner from "./InProgressBanner.tsx";
import { displayHttp } from "./display-util.ts";

type TestEvent = any;

const [testEvents, setTestEvents] = makePersisted(
  createSignal<TestEvent[]>([]),
  {
    name: "testrun:events",
    storage: localforage,
  },
);

const [testRun, setTestRun] = makePersisted(createSignal<`T${string}`>(), {
  name: "testrun:id",
  storage: localStorage,
});

type TestEventForwarder = Parameters<
  typeof window.pardon.registerTestSystemForwarder
>[0];

type TestEventTypes = {
  [type in keyof TestEventForwarder]: Parameters<TestEventForwarder[type]>[0];
};
type TestEventType = TestEventTypes[keyof TestEventTypes];

createRoot(() => {
  createEffect(() => {
    window.pardon.registerTestSystemForwarder({
      ["test:run:start"](info) {
        setTestEvents(([...events]) => [...events, info]);
        setTestRun(info.run);
      },
      ["test:case:start"](info) {
        setTestEvents(([...events]) => [...events, info]);
      },
      ["test:case:complete"](info) {
        setTestEvents(([...events]) => [...events, info]);
      },
      ["test:sequence:start"](info) {
        setTestEvents(([...events]) => [...events, info]);
      },
      ["test:sequence:complete"](info) {
        setTestEvents(([...events]) => [...events, info]);
      },
      ["test:step:start"](info) {
        setTestEvents(([...events]) => [...events, info]);
      },
      ["test:step:end"](info) {
        setTestEvents(([...events]) => [...events, info]);
      },
    });
  });
});

const [values, setValues] = createSignal<Record<string, unknown>>({});
const [smoke, setSmoke] = createSignal<string>("");
const [testInput, setTestInput] = createSignal("");
const [testcase, setTestcase] = createSignal<string>();

export default function TestcaseSystem(props: {
  onRestore: (history: ExecutionHistory) => void;
}) {
  const [valuesError, setValuesError] = createSignal<boolean>();
  const [filter, setFilter] = createSignal<string[]>([]);
  const [concurrency, setConcurrency] = createSignal<string | undefined>();

  const currentSmokeConfig = createMemo(() => {
    try {
      return parseSmokeConfig(smoke());
    } catch (error) {
      void error;
    }
  });

  const activeSmokeConfig = createMemo((previousSmokeConfig?: SmokeConfig) => {
    if (!smoke().trim()) return undefined;
    return currentSmokeConfig() ?? previousSmokeConfig;
  });

  const smokeInvalid = createMemo(
    () => Boolean(smoke().trim()) && !currentSmokeConfig(),
  );

  const [testcases] = createResource(
    () => ({ env: values(), smoke: activeSmokeConfig(), filter: filter() }),
    async ({ env, smoke, filter }) => {
      return await window.pardon.testcases(env, {
        smoke,
        filter,
      });
    },
  );

  const testReport = createMemo(() => compileTestReport(testEvents()));
  const testRunInfo = createMemo(() => testReport()?.runs[testRun()]);
  createEffect(on(testRun, () => setTestcase(undefined), { defer: true }));

  return (
    <div class="flex w-0 flex-1 flex-col">
      <Suspense
        fallback={
          <div class="flex flex-1 place-content-center align-middle">
            <LoadingSplash class="my-auto" />
          </div>
        }
      >
        <Resizable>
          <Resizable.Panel class="flex w-0 flex-1 flex-col" initialSize={0.3}>
            <Resizable orientation="vertical">
              <Resizable.Panel
                class="flex w-0 flex-1 flex-col"
                initialSize={0.7}
              >
                <div class="flex flex-row gap-0 p-1">
                  <ValuesInput
                    nowrap
                    readwrite
                    config={{
                      options: {
                        smoke: {
                          type: "string",
                        },
                        concurrency: {
                          type: "string",
                        },
                      },
                    }}
                    value={testInput()}
                    onValueChange={setTestInput}
                    onDataChange={({ positionals, values, options }) =>
                      startTransition(() => {
                        setValues(values);
                        setFilter(positionals);
                        setSmoke(options.smoke ?? "");
                        setConcurrency(options.concurrency);
                      })
                    }
                    signals={(props) => {
                      createEffect(() => setValuesError(Boolean(props.error)));
                    }}
                    class="w-0 flex-1 overflow-auto rounded-l-lg bg-stone-300 px-0.5 dark:bg-stone-700"
                    classList={{
                      "!bg-amber-400 dark:!bg-red-900": valuesError(),
                    }}
                    text="10px"
                  />
                  <button
                    class="flex flex-initial rounded-l-none p-0.5 text-center text-lg"
                    disabled={smokeInvalid() || valuesError()}
                    onClick={async () => {
                      const results = await window.pardon.executeTestcases(
                        values(),
                        testInput(),
                        testcases().map(({ testcase }) => testcase),
                        {
                          concurrency: concurrency(),
                        },
                      );

                      setTestEvents(([...events]) => [...events, { results }]);
                    }}
                  >
                    <TbRun class="my-auto flex-1" />
                  </button>
                </div>
                <div class="flex-1 overflow-auto">
                  <ul class="m-1 flex flex-1 flex-col text-sm">
                    <For each={testcases()}>
                      {(item) => (
                        <li class="m-0 flex flex-1 flex-row gap-0.5">
                          <InfoDrawer
                            side="bottom"
                            class="flex max-h-[80%] flex-col bg-lime-300 dark:bg-lime-700"
                            content={
                              <div class="flex flex-initial flex-col overflow-auto">
                                <KeyValueCopier data={item.environment} />
                              </div>
                            }
                          >
                            <Drawer.Trigger class="my-0.5 inline aspect-square flex-initial p-0.5">
                              <TbChartArrows />
                            </Drawer.Trigger>
                          </InfoDrawer>
                          <InfoDrawer
                            class="flex max-h-[80%] flex-col bg-lime-300 dark:bg-lime-700"
                            content={
                              <div class="flex flex-initial overflow-auto">
                                <KeyValueCopier
                                  data={cleanObject({
                                    ...testRunInfo()?.testcases[item.testcase]
                                      ?.result,
                                    errors:
                                      testRunInfo()?.testcases[item.testcase]
                                        ?.errors,
                                  })}
                                />
                              </div>
                            }
                          >
                            <Drawer.Trigger
                              class="my-0.5 inline aspect-square flex-initial p-0.5"
                              disabled={
                                !testRunInfo()?.testcases[item.testcase]?.result
                              }
                              classList={{
                                "bg-red-300 dark:bg-red-700": Boolean(
                                  testRunInfo()?.testcases[item.testcase]
                                    ?.errors?.length,
                                ),
                              }}
                            >
                              <TbChartArrows class="rotate-90" />
                            </Drawer.Trigger>
                          </InfoDrawer>
                          <button
                            class="w-0 flex-1 overflow-hidden overflow-ellipsis text-nowrap rounded-none bg-inherit p-0 text-left font-mono tracking-tight"
                            onClick={() => setTestcase(item.testcase)}
                            classList={{
                              "bg-gray-500": item.testcase === testcase(),
                            }}
                            draggable="true"
                            onDragStart={(event) => {
                              event.dataTransfer.setData(
                                "text/plain",
                                item.testcase,
                              );
                            }}
                          >
                            {item.testcase}
                          </button>
                        </li>
                      )}
                    </For>
                  </ul>
                </div>
              </Resizable.Panel>
              <Resizable.Handle />
              <Resizable.Panel
                class="flex w-0 flex-1 flex-col"
                collapsible
                collapsedSize={"30px"}
                minSize={"40px"}
                collapseThreshold={"5px"}
                initialSize={0.3}
              >
                <div class="flex flex-1 flex-col overflow-auto">
                  <Index
                    each={Object.entries(compileTestReport(testEvents()).runs)}
                  >
                    {(data) => {
                      const run = createMemo<`T${string}`>(
                        () => data()[0] as `T${string}`,
                      );
                      const info = createMemo(() => data()[1]);
                      return (
                        <button
                          class="flex flex-row gap-2 rounded-none bg-slate-200 p-0 px-2 text-sm dark:bg-stone-700 dark:text-white"
                          onClick={() => {
                            setTestInput(info().input);
                            setTestRun(run());
                          }}
                          classList={{
                            "!bg-slate-300 dark:!bg-stone-500":
                              testRun() === run(),
                          }}
                        >
                          <span class="w-10">
                            {info().counts.testcases.completed -
                              info().counts.testcases.failed}
                            /{info().counts.testcases.started}
                          </span>
                          <span class="flex-1 overflow-hidden overflow-ellipsis text-left">
                            {info().input}
                          </span>
                          {info().counts.testcases.failed ? (
                            <span class="ml-auto">
                              {" "}
                              ({info().counts.testcases.failed} FAILED)
                            </span>
                          ) : (
                            <></>
                          )}
                        </button>
                      );
                    }}
                  </Index>
                </div>
                <button
                  class="absolute bottom-1 right-1 m-0.5 ml-auto flex aspect-square flex-initial p-0.5 text-center text-sm"
                  disabled={smokeInvalid() || valuesError()}
                  onClick={async () => {
                    setTestEvents([]);
                  }}
                >
                  <TbTrash />
                </button>
              </Resizable.Panel>
            </Resizable>
          </Resizable.Panel>
          <Resizable.Handle />
          <Resizable.Panel class="flex flex-1" initialSize={0.7}>
            <div class="flex-1 overflow-auto">
              <RequestSummaryInfoDrawerWrapper>
                <TestReport
                  testcase={
                    testReport()?.runs[testRun()]?.testcases[testcase()]
                  }
                  onRestore={props.onRestore}
                />
              </RequestSummaryInfoDrawerWrapper>
            </div>
            <InProgressBanner />
          </Resizable.Panel>
        </Resizable>
      </Suspense>
    </div>
  );
}

type CompiledTestcase = ReturnType<
  typeof compileTestReport
>["runs"][`T${string}`]["testcases"][string];

function compileTestReport(events: TestEventType[]) {
  type TestRunRecord = Record<
    TestEventTypes["test:run:start"]["run"],
    {
      events: TestEventType[];
      sequences: TestSequenceRecord[];
      input: string;
      tests: { testcase: string; environment: Record<string, unknown> }[];
      testcases: Record<
        string,
        {
          start: number;
          end?: number;
          result?: Record<string, unknown>;
          awaited?: TestEventTypes["test:case:complete"]["awaited"];
          sequences?: TestSequenceRecord;
          steptraces?: Record<
            number,
            TestEventTypes["test:step:start"]["info"] &
              TestEventTypes["test:step:end"]["info"]
          >;
          errors?: string[];
        }
      >;
      counts: {
        testcases: {
          started: number;
          completed: number;
          succeeded: number;
          failed: number;
        };
        seqs: {
          started: number;
          completed: number;
        };
        steps: {
          started: number;
          completed: number;
        };
      };
    }
  >;

  type TestSequenceRecord = Record<
    TestEventTypes["test:sequence:start"]["key"],
    {
      run: TestRunRecord[`T${string}`];
      events: TestEventType[];
      steps: (TestEventTypes["test:step:start"]["info"] &
        Partial<TestEventTypes["test:step:end"]["info"]>)[];
    }
  >;

  return events.reduce<{
    runs: TestRunRecord;
    sequences: TestSequenceRecord;
  }>(
    (info, event) => {
      switch (event.type) {
        case "test:run:start":
          info.runs[event.run] = {
            events: [event],
            sequences: [],
            tests: event.tests,
            input: event.input,
            testcases: {},
            counts: {
              testcases: {
                started: 0,
                completed: 0,
                succeeded: 0,
                failed: 0,
              },
              seqs: { started: 0, completed: 0 },
              steps: { started: 0, completed: 0 },
            },
          };
          break;
        case "test:case:start":
          {
            const run = info.runs[event.run];

            run.events.push(event);
            run.counts.testcases.started++;
            run.testcases[event.testcase] = {
              start: Date.now(),
            };
          }
          break;
        case "test:case:complete": {
          const run = info.runs[event.run];

          run.events.push(event);
          const now = Date.now();
          const testcase = run.testcases[event.testcase];
          testcase.end = now;
          testcase.errors = event.errors;
          testcase.result = event.environment;
          testcase.awaited = event.awaited;

          testcase.sequences = arrayIntoObject(event.awaited, ({ key }) => ({
            [key]: info.sequences[key],
          }));

          testcase.steptraces = arrayIntoObject(
            Object.values(testcase.sequences)
              .filter(Boolean)
              .flatMap(({ steps }) => steps),
            (step) => ({
              [step.trace!]: step as (typeof testcase.steptraces)[number],
            }),
          );

          run.counts.testcases.completed++;
          if (!event.errors.length) {
            run.counts.testcases.succeeded++;
          } else {
            run.counts.testcases.failed++;
          }
          break;
        }
        case "test:sequence:start":
          info.runs[event.run].events.push(event);
          info.runs[event.run].counts.seqs.started++;
          info.sequences[event.key] = {
            events: [event],
            run: info.runs[event.run],
            steps: [],
          };
          break;
        case "test:sequence:complete":
          info.runs[event.run].counts.seqs.completed++;
          info.sequences[event.key].events.push(event);
          break;
        case "test:step:start":
          info.sequences[event.sequence].events.push(event);
          info.sequences[event.sequence].steps.push({ ...event.info });
          break;
        case "test:step:end":
          info.sequences[event.sequence].events.push(event);
          Object.assign(
            info.sequences[event.sequence].steps.slice(-1)[0],
            event.info,
          );
          break;
      }
      return info;
    },
    { runs: {}, sequences: {} },
  );
}

function reportTree(
  report: Accessor<CompiledTestcase>,
): Accessor<{ tree: AwaitedJsonSequences }> {
  return createMemo(() => {
    const visited = new Set<number | string>();

    return { tree: mapSequence(report()?.awaited || []) };

    function mapSequence(awaited: AwaitedJsonSequences) {
      return [...awaited]
        .reverse()
        .map((seq) => {
          const { deps, executions, name, type, values, result, error, key } =
            seq;

          if (visited.has(key)) {
            return undefined;
          }
          visited.add(key);

          return {
            name,
            key,
            deps: mapSequence(deps),
            executions: [...executions]
              .reverse()
              .filter(({ context: { trace } }) => {
                if (visited.has(trace)) {
                  return false;
                }
                visited.add(trace);
                return true;
              }),
            type,
            values,
            result,
            error,
          };
        })
        .filter(Boolean);
    }
  });
}

function TestReport(props: {
  testcase: CompiledTestcase;
  onRestore: (history: ExecutionHistory) => void;
}) {
  const report = reportTree(() => props.testcase);

  function Sequences(p: { awaited: AwaitedJsonSequences }) {
    return (
      <div class="flex flex-col">
        <For each={p.awaited}>
          {({ name, type, executions, deps, values, result }) => (
            <div class="flex flex-col">
              <span>
                <InfoDrawer
                  side="bottom"
                  class="max-h-[80%] bg-purple-300 dark:bg-purple-700"
                  content={
                    <div class="flex flex-col gap-2">
                      <span class="flex-initial rounded-sm bg-purple-400 p-1 font-mono dark:bg-purple-600">
                        {name}.{type}
                      </span>
                      <div class="flex flex-1 flex-col overflow-auto">
                        <div class="relative flex flex-1 p-1">
                          <TbChartArrows class="absolute right-2 top-2" />
                          <KeyValueCopier data={values ?? {}} />
                        </div>
                        <hr />
                        <div class="relative flex flex-1 p-1">
                          <TbChartArrows class="absolute right-2 top-2 rotate-90" />
                          <KeyValueCopier data={result ?? {}} />
                        </div>
                      </div>
                    </div>
                  }
                >
                  <Drawer.Trigger class="rounded-full bg-inherit p-0.5">
                    <TbChartDots3 />
                  </Drawer.Trigger>
                </InfoDrawer>
                {name}.{type}
              </span>
              <div class="flex flex-col text-nowrap pl-2">
                <For each={executions}>
                  {(execution) => (
                    <span class="flex flex-row text-xs">
                      <InfoDrawer
                        side="bottom"
                        class="max-h-[80%] bg-purple-300 dark:bg-purple-700"
                        content={
                          <div class="flex flex-col gap-2">
                            <div class="flex flex-initial flex-col gap-1 rounded-sm bg-purple-400 p-1 font-mono dark:bg-purple-600">
                              <span>{`${name}.${type}`}</span>
                              <span class="overflow-hidden overflow-ellipsis text-sm">
                                {displayHttp(execution.outbound.request).url}
                              </span>
                            </div>
                            <div class="flex-1 flex-col overflow-auto">
                              <div class="relative flex flex-1 p-1 pr-10">
                                <TbChartArrows class="absolute right-2 top-2" />
                                <KeyValueCopier
                                  data={
                                    props.testcase.steptraces[
                                      execution.context.trace
                                    ]?.values ?? {}
                                  }
                                />
                              </div>
                              <hr />
                              <div class="relative flex flex-1 p-1 pr-10">
                                <TbChartArrows class="absolute right-2 top-2 rotate-90" />
                                <KeyValueCopier
                                  data={
                                    props.testcase.steptraces[
                                      execution.context.trace
                                    ]?.result ?? {}
                                  }
                                />
                              </div>
                            </div>
                          </div>
                        }
                      >
                        <Drawer.Trigger class="my-auto rounded-full bg-inherit p-0.5">
                          <TbChartDots3 />
                        </Drawer.Trigger>
                      </InfoDrawer>
                      <RequestSummaryTree
                        traces={traces()}
                        deps={[]}
                        expandedSet={new Set()}
                        onRestore={props.onRestore}
                        trace={execution.context.trace}
                        isCurrent={() => false}
                      />
                      <Show
                        when={
                          props.testcase.steptraces[execution.context.trace]
                            ?.outcome
                        }
                      >
                        (
                        {
                          props.testcase.steptraces[execution.context.trace]
                            ?.outcome
                        }
                        )
                      </Show>
                    </span>
                  )}
                </For>
              </div>
              <div class="pl-2">
                <Sequences awaited={deps} />
              </div>
            </div>
          )}
        </For>
      </div>
    );
  }

  return <Sequences awaited={report().tree} />;
}
