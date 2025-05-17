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

import Services, {
  CollectionItemInfo,
} from "../components/collection/Services.tsx";
import {
  batch,
  ComponentProps,
  createEffect,
  createMemo,
  createResource,
  createSelector,
  createSignal,
  Match,
  on,
  Show,
  Switch,
  untrack,
  VoidProps,
} from "solid-js";
import CodeMirror, {
  EditorView,
} from "../components/codemirror/CodeMirror.tsx";
import Resizable from "@corvu/resizable";
import PardonInput from "../components/PardonInput.tsx";
import { executionMemo } from "../signals/pardon-execution-signal.ts";

import {
  CURL,
  guessContentType,
  HTTP,
  HTTPS,
  HttpsRequestStep,
  HttpsResponseStep,
  KV,
} from "pardon/formats";
import Toggle from "../components/Toggle.tsx";

import { manifest } from "../signals/pardon-config.ts";
import AssetEditor from "../components/editor/AssetEditor.tsx";
import { ConfigurationDrawer } from "../components/ConfigurationDrawer.tsx";
import RequestHistory from "../components/RequestHistory.tsx";
import MultiView from "../components/MultiView.tsx";
import RecallSystem from "../components/RecallSystem.tsx";
import CornerControls from "../components/CornerControls.tsx";
import { makePersisted } from "@solid-primitives/storage";
import { secureData } from "../components/secure-data.ts";
import { Text } from "@codemirror/state";
import { persistJson } from "../util/persistence.ts";

import { animation } from "../components/animate.ts";
import KeyValueCopier, {
  KeyValueCopierWidget,
  KvCopierControl,
  KvEntry,
  makeKeyValueCopierContext,
} from "../components/KeyValueCopier.tsx";
import settle from "../util/settle.ts";
import { updateActiveTrace } from "../components/request-history.ts";

void animation; // used with use:animation

export default function Main(
  props: VoidProps<{
    manifest: ReturnType<typeof manifest>;
  }>,
) {
  const [subPanelView, setSubPanelView] = makePersisted(
    createSignal<"history" | "recall" | "scratch" | "editor">("history"),
    { name: "view" },
  );

  const [executionView, setExecutionView] = makePersisted(
    createSignal<"preview" | "egress" | "ingress">("preview"),
    { name: "execution-view" },
  );
  const [redacted, setRedacted] = createSignal(true);
  const [relock, setRelock] = createSignal(true);
  const [includeHeaders, setIncludeHeaders] = createSignal(true);
  const [curl, setCurl] = createSignal(false);

  const [values, setValues] = makePersisted(createSignal({}), {
    name: "values",
    ...persistJson,
  });

  const [http, setHttp] = makePersisted(
    createSignal<string>(props.manifest.example.request ?? ""),
    { name: "http", ...persistJson },
  );

  const [scratchValues, setScratchValues] = makePersisted(
    createSignal<KvEntry[]>([]),
    { name: "scratch", ...persistJson },
  );

  const [rawHistory, setHistory] = makePersisted(
    createSignal<ExecutionHistory>(),
    { name: "active-history", ...persistJson },
  );

  const history = createMemo(() => {
    const history = rawHistory();
    if (!history) {
      return undefined;
    }

    if (history?.ingress && history?.ingress) {
      return history;
    }

    const { inbound, outbound, ...rest } = history as any;

    if (inbound && outbound) {
      return {
        egress: outbound,
        ingress: inbound,
        ...rest,
      } as typeof history;
    }

    return undefined;
  });

  const [currentExecutionSource, setCurrentExecutionSource] =
    createSignal<PardonExecutionSource>({
      http: untrack(http),
      values: { ...values() },
    });

  const [isPardonInputValid, setPardonInputValid] = createSignal(true);

  createEffect(
    on(
      [http, values],
      ([http, values]) => {
        setCurrentExecutionSource({
          http,
          values,
        });
      },
      { defer: true },
    ),
  );

  createEffect(
    on(
      currentExecutionSource,
      ({ http, values }) => {
        setHistory();
        setHttp(http);
        setValues(values);
      },
      { defer: true },
    ),
  );

  createEffect(() => relock() && setRedacted(true));

  const displayedExecutionSource = createMemo(() => {
    const currentHistory = history();
    if (!currentHistory) {
      return currentExecutionSource();
    }

    const { [KV.unparsed]: http, ...values } = KV.parse(
      currentHistory.context.ask,
      "stream",
    );

    return { http, values };
  });

  const httpInitialValue = createMemo(
    () => props.manifest.example.request ?? "",
  );

  const [collectionItem, setCollectionItem] = createSignal<
    CollectionItemInfo & { key: string }
  >();

  function restoreFromLog(content: string) {
    const scheme = HTTPS.parse(content, "log");

    const requestStep = scheme.steps[0] as HttpsRequestStep;
    const responseStep = scheme.steps[1] as HttpsResponseStep;

    const request = HTTP.stringify(requestStep.request);

    const response = {
      ...responseStep,
      headers: [...new Headers(responseStep.headers)],
      status: Number(responseStep.status),
    };

    setHistory({
      context: {
        trace: -1,
        ask: request,
      },
      egress: {
        request: {
          ...HTTP.requestObject.json(HTTP.parse(request)),
          values: requestStep.values,
        },
      },
      ingress: {
        response,
        values: {},
        flow: {},
      },
      endpoint: undefined!,
      outcome: undefined!,
    });
  }

  function restoreFromHttp(content: string, values?: Record<string, unknown>) {
    const parsed = HTTP.parse(content, { acceptcurl: true });
    if (!parsed.origin && !parsed.values.endpoint) {
      return false;
    }

    if (guessContentType(parsed.body, parsed.headers) ?? "json" === "json") {
      try {
        parsed.body = KV.stringify(JSON.parse(parsed.body), {
          mode: "json",
          limit: 80,
          indent: 2,
          split: true,
        });
      } catch (ex) {
        void ex;
      }
    }

    const reformatted = HTTP.stringify(
      {
        ...parsed,
        values: { ...parsed.values, ...values },
      },
      { indent: 4, limit: 80 },
    );

    setHttpInput(reformatted);
    return true;
  }

  createEffect(
    on(
      manifest,
      () => {
        setCurrentExecutionSource(({ values: { ...values }, ...source }) => ({
          values,
          ...source,
        }));
      },
      { defer: true },
    ),
  );

  const currentExecution = executionMemo(currentExecutionSource);

  const [contextResource] = createResource(
    currentExecution,
    async ({ context }) => await settle(context),
  );

  const [previewResource, resetPreviewResource] = createResource(
    currentExecution,
    async ({ preview }) => await settle(preview),
  );

  const [displayValues, setDisplayValues] = createSignal(false);

  createEffect(
    on(history, (history) => {
      if (history) {
        resetPreviewResource.mutate({ status: "rejected", reason: "history" });
      } else {
        resetPreviewResource.refetch(currentExecution());
      }
    }),
  );

  const [requestResource, resetRequestResource] = createResource(
    currentExecution,
    async ({ request }) => {
      return await settle(request);
    },
  );

  createEffect(
    on(history, (history) => {
      if (history) {
        resetRequestResource.mutate({
          value: history as any,
          status: "fulfilled",
        });
      } else {
        resetRequestResource.refetch(currentExecution());
      }
    }),
  );

  const [pardonInputScratchControls, setPardonInputScratchControls] =
    createSignal<KvCopierControl>();

  const [pardonInputScratchValues, setPardonInputScratchValues] = makePersisted(
    createSignal<Record<string, unknown>>({}),
    {
      name: "input-scratch",
      ...persistJson,
    },
  );

  createEffect(
    on(
      () => pardonInputScratchControls()?.getValues(),
      (values) => {
        setPardonInputScratchValues(values ?? {});
      },
    ),
  );

  const [responseResource] = createResource(
    currentExecution,
    async ({ response }) => {
      return await settle(response);
    },
  );

  function restoreFromHistory(history: ExecutionHistory) {
    if (history && contextResource.state === "ready") {
      const activeContext = contextResource();

      if (activeContext.status === "fulfilled") {
        if (activeContext.value.trace === history.context.trace) {
          setHistory();

          return;
        }
      }
    }

    setHistory(history);
  }

  const latestRequest = createMemo<
    Partial<
      PardonExecutionRender & {
        http: string;
        error: any;
      }
    >
  >((previous) => {
    if (requestResource.state !== "ready") {
      return previous;
    }

    if (previewResource.latest.status === "rejected") {
      return previous;
    }

    const { error: previousError, ...previousRequest } = previous ?? {};

    const request = requestResource();

    if (request.status !== "fulfilled") {
      const error = request.reason;
      return { error, ...previousRequest };
    }

    return request.value;
  });

  function executionClipboardContent() {
    switch (executionView()) {
      case "ingress":
        return "";
    }

    if (previewResource.loading) {
      return "";
    }

    const preview = previewResource();
    if (preview.status === "rejected") {
      return "";
    }

    const previewEgress = HTTP.requestObject.json(
      HTTP.parse(preview.value.http),
    );

    const { egress, error } =
      executionView() === "egress"
        ? latestRequest()
        : { egress: { request: previewEgress } };

    if (error || !egress) {
      return;
    }

    const displayedValues = displayValues()
      ? KV.stringify(egress.values, { indent: 2, trailer: "\n\n" })
      : "";

    const requestJson = egress?.request;

    const requestObject = HTTP.requestObject.fromJSON(requestJson);

    if (curl()) {
      return (
        displayedValues +
        CURL.stringify(requestObject, {
          include: includeHeaders(),
        })
      );
    }

    return displayedValues + HTTP.stringify(requestObject);
  }

  const responseIngress = createMemo(() => {
    const historical = history();

    if (historical) {
      return historical;
    }

    if (responseResource.state !== "ready") {
      return { error: "loading" };
    }

    const response = responseResource();
    if (response.status === "rejected") {
      return {
        error: String(response.reason).replace(
          /^Error: Error invoking remote method 'pardon':\s+/,
          "",
        ),
      };
    }

    return response.value;
  });

  function isErrorResponse(x: any): x is { error: any } {
    return typeof x?.error !== "undefined";
  }

  const currentResponse = createMemo<{
    http?: string;
    values?: Record<string, unknown>;
    error?: any;
  }>(() => {
    const currentIngress = responseIngress();

    if (isErrorResponse(currentIngress)) {
      return { error: currentIngress.error };
    }

    const { ingress } = redacted()
      ? currentIngress
      : ((secureData()[currentIngress.context.trace] ??
          currentIngress) as typeof currentIngress);

    const { response, values } = ingress;

    if (!response) {
      return { error: "no response" };
    }

    const responseObject = HTTP.responseObject.fromJSON(response);

    const http = HTTP.responseObject.stringify({
      ...responseObject,
      ...(includeHeaders() ? {} : { headers: new Headers() }),
    });

    return { http, values };
  });

  const responseContent = createMemo(() => {
    const { http, error } = currentResponse();
    return error ?? http;
  });

  let httpInputEditorView: EditorView;
  let setHttpInput: (text: string) => void;

  const asset = createMemo(() => collectionItem()?.id);
  const selection = createMemo(() => collectionItem()?.key);
  const currentEndpoint = createMemo(() => {
    const resolved = previewResource.latest;
    if (resolved?.status === "fulfilled") {
      return `endpoint:${resolved.value.endpoint}`;
    }

    const key = collectionItem()?.key;

    if (key?.startsWith("endpoint:")) {
      return key;
    }
  });

  const scratchValuesContext = makeKeyValueCopierContext({
    initial: scratchValues(),
  });

  createEffect(
    on(scratchValuesContext.data, (data) => setScratchValues(data), {
      defer: true,
    }),
  );

  const scratchDropTarget: Pick<
    ComponentProps<"button">,
    "onDragOver" | "onDrop"
  > = {
    onDragOver(event) {
      if (scratchValuesContext.controls.drag(event.dataTransfer)) {
        event.preventDefault();
      }
    },
    onDrop(event) {
      if (scratchValuesContext.controls.drop(event.dataTransfer)) {
        event.preventDefault();
      }
    },
  };

  const active = createMemo(() => {
    const result = previewResource.latest;

    if (result?.status == "fulfilled") {
      return new Set(
        ([result.value.configuration.mixin].flat(1) || []).map(
          (mixin) => `mixin:${mixin}`,
        ),
      );
    }

    return new Set<string>();
  });

  const currentTrace = createMemo(() => {
    const currentHistory = history();
    if (currentHistory) {
      return Number(currentHistory.context.trace);
    }

    const context = contextResource.latest;
    if (context?.status !== "fulfilled") {
      return;
    }

    return context?.value.trace;
  });

  createEffect(() => {
    if (contextResource.state === "ready") {
      const contextValue = contextResource();
      if (contextValue.status === "fulfilled") {
        updateActiveTrace(contextValue.value?.trace);
      }
    }
  });

  const requestNotReady = createMemo(() => {
    return (
      requestResource.state !== "ready" ||
      requestResource().status !== "fulfilled" ||
      currentExecution().progress !== "pending"
    );
  });

  const requestDisabled = createMemo<boolean>((previous) => {
    switch (currentExecution().progress) {
      case "preview":
        return requestResource.latest?.status === "rejected";
      case "pending":
      case "complete":
      case "failed":
        return false;
      case "rendering":
        return previous;
      case "errored":
      case "inflight":
        return true;
    }
  });

  const newRequestDisabled = createMemo<boolean>((wasDisabled) => {
    if (history()) {
      return true;
    }

    if (!isPardonInputValid()) {
      return true;
    }

    switch (currentExecution()?.progress) {
      case "preview":
        if (previewResource.latest?.status === "rejected") {
          return true;
        }
        if (
          requestResource.state === "ready" &&
          requestResource.latest?.status === "rejected"
        ) {
          return true;
        }
        return false;
      case "pending":
        if (previewResource.loading) {
          return wasDisabled;
        }
        return untrack(() => previewResource.latest).status !== "fulfilled";
      case "rendering":
        return wasDisabled;
      case "errored":
      case "inflight":
      case "complete":
      case "failed":
      default:
        return true;
    }
  });

  function refreshRequest() {
    batch(() => {
      const { http, values } = displayedExecutionSource();

      setHttp(http);
      setValues({ ...values });
    });
  }

  return (
    <Resizable orientation="vertical">
      <Resizable.Panel
        class="flex size-full min-h-0 flex-1 flex-col [&:has(.reload-request:hover)_.reload-request-target]:blur-[2px]"
        initialSize={0.7}
      >
        <Resizable orientation="horizontal">
          <Resizable.Panel initialSize={0.2}>
            <Services
              selection={selection()}
              filters={{
                endpoint: true,
                other: true,
                flow: false,
              }}
              expanded={new Set()}
              endpoint={currentEndpoint()}
              active={active()}
              onClick={(key, info, event) => {
                const { type, archetype: preview } = info ?? {};

                setCollectionItem({ ...info, key });

                if (event.metaKey) {
                  setSubPanelView("editor");
                } else if (type === "endpoint") {
                  if (!http().trim()) {
                    setHttp(preview);
                  }
                }
              }}
              onDblClick={(key, info) => {
                const { type, archetype: preview } = info ?? {};

                batch(() => {
                  setCollectionItem({ ...info, key });
                  if (type === "endpoint") {
                    restoreFromHttp(preview, values());
                  }
                });
              }}
            />
          </Resizable.Panel>
          <Resizable.Handle />
          <Resizable.Panel initialSize={0.8}>
            <Resizable orientation="vertical">
              <Resizable.Panel
                class="flex flex-col bg-neutral-200 dark:bg-neutral-600"
                minSize={0.3}
                initialSize={0.35}
                collapsedSize={0.25}
                collapsible
              >
                <Resizable>
                  <Resizable.Panel
                    minSize={0.1}
                    initialSize={0.6}
                    class="reload-request-target flex flex-grow-0 flex-col transition-[filter] duration-100"
                  >
                    <PardonInput
                      class="w-0 min-w-full flex-1 overflow-auto bg-yellow-100 dark:bg-stone-700 [&_.cm-line]:pr-8"
                      editorViewRef={(view) => (httpInputEditorView = view)}
                      defaultValue={httpInitialValue()}
                      setTextRef={(setText) => (setHttpInput = setText)}
                      disabled={Boolean(history())}
                      data={{
                        values,
                        doc: http,
                      }}
                      nowrap
                      onDataChange={({ values, doc }) => {
                        setCurrentExecutionSource({
                          http: doc,
                          values,
                        });
                      }}
                      onDataValidChange={setPardonInputValid}
                      oncapture:paste={(event) => {
                        const text = event.clipboardData.getData("text/plain");

                        // try to delete all selected data from the doc
                        // if the result is empty, we will apply all the
                        // magic formatting.
                        let { doc, selection } = httpInputEditorView.state;
                        for (const range of [...selection.ranges].reverse()) {
                          doc = doc.replace(
                            range.from,
                            range.to,
                            Text.of([""]),
                          );
                        }

                        if (doc.toString().trim()) {
                          // skip magic paste formatting,
                          // doc not empty
                          return;
                        }

                        if (text) {
                          try {
                            if (text.trim().startsWith(">>>")) {
                              restoreFromLog(text);
                              event.preventDefault();
                            } else if (restoreFromHttp(text)) {
                              event.preventDefault();
                            }
                          } catch (error) {
                            console.warn(
                              "could not reformat pasted data",
                              error,
                            );
                          }
                        }
                      }}
                      dragDrop={{
                        onDragOver(event) {
                          if (history()) {
                            return false;
                          }

                          const { types } = event.dataTransfer;
                          if (
                            types.includes("text/http") ||
                            types.includes("text/log")
                          ) {
                            return true;
                          }
                        },
                        onDrop(event) {
                          const http = event.dataTransfer.getData("text/http");

                          if (http) {
                            restoreFromHttp(http, values());
                            event.preventDefault();
                            return;
                          }

                          const log = event.dataTransfer.getData("text/log");

                          if (log) {
                            restoreFromLog(log);
                            event.preventDefault();
                            return;
                          }
                        },
                      }}
                    >
                      <Show when={Boolean(history())}>
                        <div class="absolute inset-0 left-[40%] z-10">
                          <KeyValueCopier
                            editor
                            class="absolute inset-0 z-0 bg-neutral-200/40 p-2 dark:bg-neutral-800/50"
                            controls={setPardonInputScratchControls}
                            values={pardonInputScratchValues()}
                            noIcon
                            dedup
                          />
                          <div class="absolute top-10 left-0 grid translate-x-[-85%] place-content-center align-middle">
                            <button
                              class="relative z-10 p-2.5"
                              onclick={() => {
                                pardonInputScratchControls()?.flushEditor?.();

                                const inputScratchValues =
                                  pardonInputScratchControls()?.getValues() ??
                                  {};

                                pardonInputScratchControls()?.deleteAll();

                                if (Object.keys(inputScratchValues).length) {
                                  setExecutionView("preview");
                                  setCurrentExecutionSource(
                                    ({ http, values }) => ({
                                      http,
                                      values: {
                                        ...values,
                                        ...inputScratchValues,
                                      },
                                    }),
                                  );
                                  setHistory();
                                  return;
                                }

                                switch (currentExecution()?.progress) {
                                  case "complete":
                                  case "errored":
                                    break;
                                  case "failed":
                                  case "preview":
                                    setExecutionView("preview");
                                    break;
                                  case "inflight":
                                  case "rendering":
                                  case "pending":
                                    setExecutionView("egress");
                                    break;
                                }
                                setHistory();
                              }}
                            >
                              <IconTablerArrowLeft class="absolute top-1/2 left-0 -translate-x-1/2 -translate-y-1/2 text-xl" />
                              <IconTablerPencil class="text-xl" />
                            </button>
                          </div>
                        </div>
                      </Show>
                      <CornerControls
                        placement="tr"
                        flex="col"
                        class="z-10 gap-1 bg-stone-200 p-0.5 dark:bg-slate-600"
                        unbuttoned={["info"]}
                        actions={{
                          copy: () => {
                            navigator.clipboard.writeText(
                              `${KV.stringify({ ...currentExecutionSource().values }, { indent: 2, trailer: "\n" })}${http()}`,
                            );
                          },
                          format: () => {
                            const { http, values } = currentExecutionSource();
                            restoreFromHttp(http, values);
                          },
                        }}
                        icons={{
                          info: (
                            <ConfigurationDrawer
                              class="!text-md flex bg-inherit p-0"
                              title="configuration"
                              preview={createMemo(() => {
                                return previewResource?.state === "ready"
                                  ? previewResource()
                                  : undefined;
                              })()}
                            >
                              <IconTablerSettings2 />
                            </ConfigurationDrawer>
                          ),
                          copy: <IconTablerCopy />,
                          format: <IconTablerBraces />,
                        }}
                      />
                    </PardonInput>
                  </Resizable.Panel>
                </Resizable>
              </Resizable.Panel>
              <Resizable.Handle />
              <Resizable.Panel class="flex flex-col" initialSize={0.7}>
                {() => {
                  return (
                    <>
                      <div class="flex size-0 min-h-full min-w-full flex-row">
                        <MultiView
                          view={executionView()}
                          onChange={setExecutionView}
                          controls={{
                            preview: <IconTablerTemplate />,
                            egress: <IconTablerUpload />,
                            ingress: <IconTablerDownload />,
                          }}
                          disabled={{
                            preview: Boolean(history()),
                            ingress:
                              !history() &&
                              (responseResource.state !== "ready" ||
                                (responseResource.state === "ready" &&
                                  responseResource().status === "rejected" &&
                                  requestResource.state === "ready" &&
                                  requestResource().status === "rejected")),
                            egress:
                              !history() &&
                              previewResource.state === "ready" &&
                              previewResource().status === "rejected",
                          }}
                          defaulting={createMemo(() => {
                            switch (currentExecution()?.progress) {
                              case "rendering":
                              case "pending":
                                return ["egress", "preview"] as const;
                              case "complete":
                                return [
                                  "ingress",
                                  "egress",
                                  "preview",
                                ] as const;
                              case "preview":
                                return ["preview"] as const;
                              default:
                                return;
                            }
                          })}
                          class="flex size-full flex-col"
                        >
                          {([view, setView]) => {
                            createEffect(
                              on(
                                [currentExecution, view, history],
                                ([execution, view, history]) => {
                                  if (!history && view === "egress") {
                                    execution.render();
                                  }
                                },
                              ),
                            );

                            createEffect(
                              on([history], ([history]) => {
                                if (history && view() === "preview") {
                                  setView("egress");
                                }
                              }),
                            );

                            const currentPreview = createMemo<
                              | Partial<{
                                  preview?: Awaited<
                                    ReturnType<typeof window.pardon.preview>
                                  >;
                                  error?: any;
                                }>
                              | undefined
                            >((previous) => {
                              if (previewResource.loading) {
                                if (
                                  previewResource.state === "refreshing" ||
                                  previewResource.state === "pending"
                                ) {
                                  return previous ?? {};
                                }

                                return {};
                              }

                              const preview = previewResource();

                              if (preview.status === "fulfilled") {
                                return { preview: preview.value };
                              }

                              return { error: preview.reason };
                            });

                            const previewContent = createMemo(
                              (previousRequest: string) => {
                                const { preview, error } = currentPreview();

                                if (error) {
                                  if (error === "history") {
                                    return requestContent();
                                  }

                                  try {
                                    const { action, step, stack } =
                                      JSON.parse(error);
                                    if (step === "sync") {
                                      return previousRequest ?? "";
                                    }
                                    return `${action}@${step}\n${stack}`;
                                  } catch (oops) {
                                    void oops;
                                    return String(error);
                                  }
                                }

                                if (!preview) {
                                  return "";
                                }

                                if (curl()) {
                                  return CURL.stringify(
                                    HTTP.requestObject.fromJSON(
                                      HTTP.requestObject.json(
                                        HTTP.parse(preview.http),
                                      ),
                                    ),
                                    { include: includeHeaders() },
                                  );
                                }
                                return preview.http;
                              },
                            );

                            const requestInfo = createMemo(
                              (previousRequestInfo?: {
                                method: string;
                                url: string;
                              }) => {
                                const currentHistory = history();
                                if (currentHistory) {
                                  const { method, url } =
                                    currentHistory.egress.request;
                                  return { method, url };
                                }

                                let http: string;

                                if (
                                  view() === "preview" &&
                                  requestResource.loading
                                ) {
                                  if (
                                    previewResource.latest?.status ===
                                    "fulfilled"
                                  ) {
                                    http = previewResource.latest.value.http;
                                  } else {
                                    return previousRequestInfo ?? {};
                                  }
                                } else if (
                                  ["ready", "refreshing"].includes(
                                    requestResource.state,
                                  ) &&
                                  requestResource.latest?.status === "fulfilled"
                                ) {
                                  http = requestResource.latest.value.http;
                                } else if (
                                  ["ready", "refreshing"].includes(
                                    previewResource.state,
                                  ) &&
                                  previewResource.latest?.status === "fulfilled"
                                ) {
                                  http = previewResource.latest.value.http;
                                }

                                if (http) {
                                  const {
                                    method,
                                    origin,
                                    pathname,
                                    searchParams,
                                  } = HTTP.parse(http);

                                  return {
                                    method,
                                    url: `${origin}${pathname}${searchParams}`,
                                  };
                                }

                                if (
                                  !previewResource.loading &&
                                  previewResource.latest.status ===
                                    "rejected" &&
                                  previewResource.latest.reason === "history"
                                ) {
                                  return previousRequestInfo ?? {};
                                }

                                return { method: null, url: "" };
                              },
                            );

                            const currentRequest = createMemo<{
                              request?: string;
                              values?: Record<string, unknown>;
                              error?: any;
                            }>((previous = {}) => {
                              if (history()?.egress) {
                                const { request, values } = history().egress!;

                                return {
                                  request: HTTP.stringify(
                                    HTTP.requestObject.fromJSON({
                                      ...request,
                                    }),
                                    { limit: 100 },
                                  ),
                                  values,
                                };
                              }

                              const { egress, context, error } =
                                latestRequest() ?? {};

                              if (error) {
                                return { error };
                              }

                              if (!egress) {
                                if (
                                  requestResource.state === "refreshing" ||
                                  requestResource.state === "pending"
                                ) {
                                  return {
                                    request: previous.request,
                                    values: {},
                                  };
                                }

                                return { request: "" };
                              }

                              const { values: _, ...requestObject } =
                                HTTP.requestObject.fromJSON(
                                  (redacted()
                                    ? egress
                                    : (secureData()[context.trace]?.egress ??
                                      egress)
                                  )?.request ?? {},
                                );

                              if (curl()) {
                                return {
                                  request: CURL.stringify(requestObject, {
                                    include: includeHeaders(),
                                  }),
                                  values: egress.values,
                                };
                              }

                              return {
                                request: HTTP.stringify(requestObject, {
                                  limit: 80,
                                  indent: 2,
                                }),
                                values: egress.values,
                              };
                            });

                            const requestContent = createMemo(() => {
                              const { request, error } = currentRequest();
                              return error ?? request;
                            });

                            createEffect(() => {
                              if (
                                !history() &&
                                currentExecution().progress === "errored" &&
                                ["ingress"].includes(view())
                              ) {
                                if (
                                  requestResource.state === "ready" &&
                                  requestResource().status === "rejected"
                                ) {
                                  setView("egress");
                                }
                              }
                            });

                            return (
                              <>
                                <div class="flex w-full min-w-0 flex-initial flex-row gap-1 p-2 pr-8">
                                  <MultiView.Controls class="aspect-square flex-initial p-1 text-2xl [&.multiview-selected]:bg-lime-400 [&.multiview-selected]:dark:bg-cyan-500" />
                                  <button
                                    class="absolute right-2 bottom-2 z-10 rounded-md border-2 border-orange-500/75 bg-neutral-400/20 p-4 text-xl opacity-50 transition-opacity duration-300 hover:opacity-100"
                                    role="checkbox"
                                    onclick={() =>
                                      setDisplayValues((shown) => !shown)
                                    }
                                    classList={{
                                      "dark:!bg-teal-600 !bg-teal-400 dark:!border-orange-700 !border-orange-500 !shadow-none":
                                        displayValues(),
                                    }}
                                    {...scratchDropTarget}
                                  >
                                    <IconTablerReceipt />
                                  </button>
                                  <div></div>
                                  <button
                                    class="w-0 flex-1 border-1 border-gray-300 bg-transparent px-2 py-0 text-start text-neutral-700 dark:text-neutral-200 disabled:dark:text-neutral-400"
                                    disabled={newRequestDisabled()}
                                    classList={{
                                      "light:bg-orange-300 dark:bg-yellow-900":
                                        ["POST", "PUT", "DELETE"].includes(
                                          requestInfo()?.method,
                                        ),
                                      "light:bg-green-300 dark:bg-green-900": [
                                        "GET",
                                        "HEAD",
                                        "OPTIONS",
                                      ].includes(requestInfo().method),
                                      "light:bg-red-300 dark:bg-fuchsia-900": [
                                        "DELETE",
                                      ].includes(requestInfo()?.method),
                                    }}
                                    onClick={() => {
                                      if (requestNotReady()) {
                                        // return;
                                      }

                                      currentExecution()?.send();
                                      setView((tab) =>
                                        ["egress", "preview"].includes(tab)
                                          ? "ingress"
                                          : tab,
                                      );
                                    }}
                                  >
                                    <div class="flex flex-row place-content-start gap-2 font-mono">
                                      <span>{requestInfo()?.method}</span>
                                      <span class="my-1 w-[1px] bg-current"></span>
                                      <span class="no-scrollbar overflow-scroll whitespace-nowrap">
                                        {requestInfo()?.url}
                                      </span>
                                      <Show
                                        when={
                                          responseResource.state === "ready" &&
                                          responseResource.latest?.status ===
                                            "fulfilled"
                                        }
                                      >
                                        <span class="flex-1 text-end text-black dark:text-white">
                                          {responseResource.state === "ready" &&
                                          responseResource.latest?.status ===
                                            "fulfilled"
                                            ? String(
                                                responseResource.latest.value
                                                  .ingress.response.status,
                                              )
                                            : "???"}
                                        </span>
                                      </Show>
                                    </div>
                                  </button>

                                  <button
                                    class="ml-1.5 aspect-square flex-initial p-1 text-xl"
                                    disabled={
                                      !history() &&
                                      currentExecution()?.progress == "inflight"
                                    }
                                    onClick={() => {
                                      if (history()) {
                                        batch(() => {
                                          setView("preview");
                                          const { http, values } =
                                            displayedExecutionSource();

                                          restoreFromHttp(http, values);
                                          setHistory();
                                        });
                                      } else {
                                        refreshRequest();
                                        setView("egress");
                                      }
                                    }}
                                  >
                                    <Show
                                      when={!history()}
                                      fallback={
                                        <div class="reload-request relative">
                                          <IconTablerReload class="absolute top-0 left-0 -translate-x-1/4 -translate-y-1/4 text-xl" />
                                          <IconTablerPencil class="relative translate-x-1/4 translate-y-1/4 text-xl" />
                                        </div>
                                      }
                                    >
                                      <span
                                        use:animation={[
                                          "animate-cw-spin",
                                          () =>
                                            currentExecution()?.progress ===
                                            "rendering",
                                        ]}
                                        class="smoothed-backdrop"
                                      >
                                        <IconTablerReload />
                                      </span>
                                    </Show>
                                  </button>
                                </div>
                                <Switch>
                                  <Match when={view() === "preview"}>
                                    <Show
                                      fallback={
                                        <CodeMirror
                                          readonly
                                          nowrap
                                          value={previewContent()}
                                          class="flex-1 [--clear-start-opacity:0] [&_.cm-content]:pr-6"
                                        />
                                      }
                                      when={
                                        displayValues() &&
                                        Object.keys(
                                          currentPreview()?.preview?.values ??
                                            {},
                                        ).length
                                      }
                                    >
                                      <Resizable orientation="horizontal">
                                        <Resizable.Panel>
                                          <CodeMirror
                                            readonly
                                            nowrap
                                            value={previewContent()}
                                            class="size-full flex-1 [--clear-start-opacity:0] [&_.cm-content]:pr-6"
                                          />
                                        </Resizable.Panel>
                                        <Resizable.Handle />
                                        <Resizable.Panel>
                                          <KeyValueCopier
                                            class="fade-to-clear size-full bg-neutral-500/40 px-1.5 py-1 pb-3"
                                            readonly
                                            values={
                                              currentPreview()?.preview
                                                ?.values ?? {}
                                            }
                                          />
                                        </Resizable.Panel>
                                      </Resizable>
                                    </Show>
                                  </Match>
                                  <Match when={view() === "egress"}>
                                    <Show
                                      fallback={
                                        <CodeMirror
                                          readonly
                                          nowrap
                                          value={requestContent()}
                                          disabled={requestDisabled()}
                                          class="flex-1[&_.cm-content]:pr-6"
                                        />
                                      }
                                      when={
                                        displayValues() &&
                                        Object.keys(
                                          currentRequest().values ?? {},
                                        ).length
                                      }
                                    >
                                      <Resizable orientation="horizontal">
                                        <Resizable.Panel>
                                          <CodeMirror
                                            readonly
                                            nowrap
                                            value={requestContent()}
                                            disabled={requestDisabled()}
                                            class="flex-1[&_.cm-content]:pr-6 size-full"
                                          />
                                        </Resizable.Panel>
                                        <Resizable.Handle />
                                        <Resizable.Panel>
                                          <KeyValueCopier
                                            class="fade-to-clear size-full bg-neutral-500/40 px-1.5 py-1 pb-3"
                                            readonly
                                            values={
                                              currentRequest().values ?? {}
                                            }
                                          />
                                        </Resizable.Panel>
                                      </Resizable>
                                    </Show>
                                  </Match>
                                  <Match when={view() === "ingress"}>
                                    <Show
                                      fallback={
                                        <CodeMirror
                                          value={responseContent()}
                                          readonly
                                          nowrap
                                          class="flex-1 [&_.cm-content]:pr-6"
                                        />
                                      }
                                      when={
                                        displayValues() &&
                                        Object.keys(
                                          currentResponse().values ?? {},
                                        ).length
                                      }
                                    >
                                      <Resizable orientation="horizontal">
                                        <Resizable.Panel>
                                          <CodeMirror
                                            value={responseContent()}
                                            readonly
                                            nowrap
                                            class="size-full flex-1 [&_.cm-content]:pr-6"
                                          />
                                        </Resizable.Panel>
                                        <Resizable.Handle />
                                        <Resizable.Panel>
                                          <KeyValueCopier
                                            class="fade-to-clear size-full bg-neutral-500/40 px-1.5 py-1 pb-3"
                                            readonly
                                            values={
                                              currentResponse().values ?? {}
                                            }
                                          />
                                        </Resizable.Panel>
                                      </Resizable>
                                    </Show>
                                  </Match>
                                </Switch>
                              </>
                            );
                          }}
                        </MultiView>
                        <CornerControls
                          class="z-10 gap-1 bg-gray-300 p-0.5 dark:bg-gray-600"
                          placement="tr"
                          flex="col"
                          actions={{
                            redacted: () => setRedacted((value) => !value),
                            copy() {
                              navigator.clipboard.writeText(
                                executionClipboardContent(),
                              );
                            },
                            curl: () => setCurl((value) => !value),
                            include: () => setIncludeHeaders((value) => !value),
                          }}
                          icons={{
                            redacted: redacted() ? (
                              <IconTablerEyeClosed />
                            ) : (
                              <IconTablerEye />
                            ),
                            curl: curl() ? (
                              <IconTablerCopyright />
                            ) : (
                              <IconTablerSend />
                            ),
                            include: includeHeaders() ? (
                              <IconTablerInfoCircle />
                            ) : (
                              <span class="relative flex">
                                <IconTablerInfoOctagon class="z-10" />
                                <IconTablerInfoOctagonFilled class="absolute text-red-300 dark:text-red-800" />
                              </span>
                            ),
                            copy: <IconTablerCopy />,
                          }}
                          disabled={{
                            redacted: relock(),
                            copy:
                              executionView() === "preview"
                                ? previewResource.loading ||
                                  previewResource().status !== "fulfilled"
                                : executionView() === "egress"
                                  ? requestResource.latest?.status !==
                                    "fulfilled"
                                  : true,
                          }}
                        />
                      </div>
                    </>
                  );
                }}
              </Resizable.Panel>
            </Resizable>
          </Resizable.Panel>
        </Resizable>
      </Resizable.Panel>
      <Resizable.Handle />
      <Resizable.Panel initialSize={0.3}>
        <MultiView
          view={subPanelView()}
          onChange={setSubPanelView}
          controls={
            {
              history: <IconTablerMist />,
              recall: (
                <div class="relative">
                  <IconTablerQuestionMark class="absolute" />
                  <IconTablerExclamationMark />
                </div>
              ),
              scratch: <IconTablerReceipt />,
              editor: <IconTablerPencil />,
            } as const
          }
          controlProps={{
            scratch: scratchDropTarget,
          }}
          class="mih-h-0 size-full"
        >
          {([view]) => (
            <div class="relative flex size-full flex-1 flex-row">
              <div class="flex min-h-0 flex-col gap-1 border-r-1 border-neutral-300 p-2 dark:border-neutral-500">
                <MultiView.Controls class="flex flex-initial flex-col p-1 text-xl [&.multiview-selected]:bg-lime-400 [&.multiview-selected]:dark:bg-cyan-500" />
                <Toggle
                  class="relative mt-auto bg-inherit p-1 text-xl mix-blend-normal dark:active:!bg-neutral-500"
                  onChange={setRelock}
                  value={relock()}
                >
                  {(props) => (
                    <>
                      {props.value ? (
                        <IconTablerLock class="scale-150 dark:text-neutral-400" />
                      ) : (
                        <IconTablerLockOpen class="scale-150 dark:text-neutral-400" />
                      )}
                      <IconTablerEye class="absolute bottom-[-2px] scale-75" />
                    </>
                  )}
                </Toggle>
              </div>
              <Resizable class="">
                <Resizable.Panel
                  initialSize={0.8}
                  class="flex size-0 min-h-full min-w-full flex-1"
                >
                  <Switch>
                    <Match when={view() === "editor"}>
                      <AssetEditor id={asset()} />
                    </Match>
                    <Match when={view() == "history"}>
                      <RequestHistory
                        onRestore={restoreFromHistory}
                        currentTrace={currentTrace()}
                      />
                    </Match>
                    <Match when={view() == "recall"}>
                      <RecallSystem
                        onRestore={restoreFromHistory}
                        isCurrent={createSelector(currentTrace)}
                      />
                    </Match>
                    <Match when={view() === "scratch"}>
                      <KeyValueCopierWidget
                        class="flex size-0 min-h-full min-w-full overflow-auto bg-neutral-200 p-2 dark:bg-stone-800"
                        {...(scratchDropTarget as unknown as Partial<
                          ComponentProps<"div">
                        >)}
                        context={scratchValuesContext}
                        editor
                      />
                    </Match>
                  </Switch>
                </Resizable.Panel>
              </Resizable>
            </div>
          )}
        </MultiView>
      </Resizable.Panel>
    </Resizable>
  );
}
