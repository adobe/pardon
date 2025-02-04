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

import Collections, {
  CollectionItemInfo,
} from "../components/collection/Collections.tsx";
import {
  batch,
  createEffect,
  createMemo,
  createSelector,
  createSignal,
  Match,
  on,
  Show,
  Suspense,
  Switch,
  VoidProps,
} from "solid-js";
import { EditorView } from "../components/codemirror/CodeMirror.tsx";
import Resizable from "@corvu/resizable";
import DataInput from "../components/DataInput.tsx";
import { executionResource } from "../signals/pardon-execution.ts";

import {
  HTTP,
  HTTPS,
  HttpsRequestStep,
  HttpsResponseStep,
  KV,
  valueId,
} from "pardon/formats";
import Toggle from "../components/Toggle.tsx";

import {
  TbCopy,
  TbExclamationCircle,
  TbEye,
  TbFolderCode,
  TbLock,
  TbLockOpen,
  TbMist,
  TbMoodAnnoyed,
  TbMoodConfuzed,
  TbMoodNerd,
  TbMoodNeutral,
  TbMoodSadDizzy,
  TbMoodSmile,
  TbPencil,
  TbPlus,
  TbQuestionMark,
  TbSend,
  TbSettings2,
  TbTrash,
} from "solid-icons/tb";
import { manifest, samples } from "../signals/pardon-config.ts";
import AssetEditor from "../components/collection/AssetEditor.tsx";
import ResponsePanel from "../components/collection/inbound/ResponsePanel.tsx";
import { ConfigurationDrawer } from "../components/ConfigurationDrawer.tsx";
import RequestHistory, {
  startTracingRequestHistory,
} from "../components/RequestHistory.tsx";
import MultiView from "../components/MultiView.tsx";
import PreviewPanel from "../components/collection/outbound/PreviewPanel.tsx";
import TbInterrobang from "../components/TbInterrobang.tsx";
import RecallSystem from "../components/RecallSystem.tsx";
import CornerControls from "../components/collection/CornerControls.tsx";
import { displayHttp } from "../components/display-util.ts";
import Samples from "../components/collection/Samples.tsx";
import { mapObject } from "pardon/utils";
import KeyValueCopier from "../components/KeyValueCopier.tsx";
import { makePersisted } from "@solid-primitives/storage";
import { secureData } from "../components/secure-data.ts";
import { Text } from "@codemirror/state";
import { persistJson } from "../util/persistence.ts";

type SubPanelView = "history" | "editor" | "recall" | "samples";

export default function Main(
  props: VoidProps<{
    manifest: ReturnType<typeof manifest>;
  }>,
) {
  const [subPanelView, setSubPanelView] = makePersisted(
    createSignal<SubPanelView>("history"),
    { name: "view", ...persistJson },
  );
  const [redacted, setRedacted] = createSignal(true);
  const [relock, setRelock] = createSignal(true);
  const [globalsCollapsed, setGlobalsCollapsed] = createSignal(false);
  const [previewCollapsed, setPreviewCollapsed] = createSignal(false);
  const [includeHeaders, setIncludeHeaders] = createSignal(true);

  const [lastResult, setLastResult] = makePersisted(
    createSignal<ExecutionHistory>(),
    { name: "result", ...persistJson },
  );

  const [scratchValues, setScratchValues] = makePersisted(
    createSignal<Record<string, unknown>>({}),
    { name: "scratch", ...persistJson },
  );

  const [values, setValues] = makePersisted(createSignal({}), {
    name: "values",
    ...persistJson,
  });

  const [http, setHttp] = makePersisted(
    createSignal<string>(props.manifest.example.request ?? ""),
    { name: "http", ...persistJson },
  );

  const [globals, setGlobals] = makePersisted(
    createSignal<Record<string, unknown>>({}),
    { name: "globals", ...persistJson },
  );

  const [globalExtra, setGlobalExtra] = makePersisted(createSignal(""), {
    name: "globals-extra",
    ...persistJson,
  });

  const [source, updateSource] = createSignal<PardonExecutionSource>({
    http: http(),
    values: { ...globals(), ...values() },
    comp: { ...globals(), ...values() },
  });

  createEffect(() => relock() && setRedacted(true));

  const httpInitialValue = createMemo(
    () => props.manifest.example.request ?? "",
  );

  const globalsInitialValue = createMemo(() =>
    KV.stringify(props.manifest.example.values ?? {}, "\n", 2),
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

    restoreFromHistory({
      context: {
        trace: -1,
        ask: request,
      },
      outbound: {
        request: {
          ...HTTP.requestObject.json(HTTP.parse(request)),
          values: requestStep.values,
        },
      },
      inbound: {
        response,
        values: {},
      },
    });
  }

  function restoreFromHttp(content: string) {
    const parsed = HTTP.parse(content);
    if (!parsed.origin && !parsed.values.endpoint) {
      return false;
    }
    const reformatted = HTTP.stringify({
      ...parsed,
      values: localValues(parsed.values ?? {}),
    });
    setHttpInput(reformatted);
    return true;
  }

  createEffect(
    on(
      () => ({
        http: http(),
        values: values(),
        globals: globals(),
        hint: current(),
      }),
      ({ http, values, globals, hint }) => {
        const combined = { ...globals, ...values };

        const noEffectiveValueChange =
          valueId(combined) === valueId(source().comp);

        if (
          (http ?? "").trim() === (source().http ?? "").trim() &&
          noEffectiveValueChange
        ) {
          return;
        }

        updateSource(() => ({
          http,
          values: combined,
          comp: combined,
          hint,
        }));
      },
      { defer: true },
    ),
  );

  createEffect(
    on(
      manifest,
      () => {
        updateSource(({ history, values: { ...values }, ...source }) => ({
          values,
          ...source,
        }));
      },
      { defer: true },
    ),
  );

  const [showPreview, setShowPreview] = createSignal(false);
  const { preview, outbound } = executionResource(source);

  const moodIcon = createMemo(() => {
    const psettled = preview();

    switch (psettled?.status) {
      default:
      case "rejected":
        if (showPreview()) return <TbMoodSadDizzy />;
        return <TbMoodConfuzed />;
      case "fulfilled":
        if (showPreview()) return <TbMoodNerd />;

        switch (
          outbound?.state != "ready" ? outbound.state : outbound().status
        ) {
          case "rejected":
            return <TbMoodAnnoyed />;
          case "fulfilled":
            return <TbMoodSmile />;
          default:
          // fall through
        }
    }

    return <TbMoodNeutral />;
  });

  const requestJSON = createMemo(() => {
    if (showPreview()) {
      const p = preview();
      if (p?.status !== "fulfilled") {
        return undefined;
      }
      return HTTP.requestObject.json(HTTP.parse(p.value.http));
    }

    const r = outbound();
    if (r?.status !== "fulfilled") {
      return undefined;
    }

    return redacted()
      ? r.value.outbound?.request
      : (secureData()[r.value.context.trace]?.outbound.request ??
          r.value.outbound?.request);
  });

  let httpInputEditorView: EditorView;
  let setHttpInput: (text: string) => void;

  const request = createMemo(() => {
    const settled = outbound();

    if (settled?.status === "fulfilled") {
      const display = displayHttp(settled.value.outbound.request);

      if (!display) {
        return "";
      }

      const { method, origin, pathname } = display;
      return `${method} ${origin}${pathname}`;
    }
  });

  const previewText = createMemo(() => {
    switch (preview.state) {
      case "pending":
        return "";
      default:
        if (preview.latest.status === "fulfilled") {
          return preview.latest.value.http;
        }
    }
  });

  const renderText = createMemo(() => {
    if (preview.state === "pending" || preview.latest.status === "rejected") {
      return "";
    }

    switch (outbound.state) {
      case "refreshing":
      case "pending":
        return "";
      default:
        switch (outbound.latest.status) {
          case "fulfilled":
            return HTTP.stringify({
              ...HTTP.requestObject.fromJSON(
                redacted()
                  ? outbound.latest.value.outbound.request
                  : (secureData()[outbound.latest.value.context.trace]?.outbound
                      .request ?? outbound.latest.value.outbound.request),
              ),
              values: undefined,
            });
          case "rejected":
            return `
--- ERROR rendering ---
${previewText()}
`.trim();
        }
    }
  });

  const asset = createMemo(() => collectionItem()?.id);
  const selection = createMemo(() => collectionItem()?.key);
  const current = createMemo(() => {
    const resolved = preview.latest;
    if (resolved?.status === "fulfilled") {
      return `endpoint:${resolved.value.endpoint}`;
    }
    const key = collectionItem()?.key;
    if (key?.startsWith("endpoint:")) return key;
  });

  function localValues(values: Record<string, unknown>) {
    const globalValues = globals();

    return mapObject(values, {
      filter: (key, value) =>
        valueId(globalValues[key] ?? null) !== valueId(value ?? null),
    });
  }

  const active = createMemo(() => {
    const resource = preview.latest;
    if (resource?.status == "fulfilled") {
      return new Set(
        ([resource.value.configuration.mixin].flat(1) || []).map(
          (mixin) => `mixin:${mixin}`,
        ),
      );
    }
    return new Set<string>();
  });

  function restoreFromHistory(history: ExecutionHistory) {
    const {
      context: { ask },
    } = history;

    const {
      [KV.unparsed]: http,
      [KV.upto]: _upto,
      ...values
    } = KV.parse(ask, "stream");

    const historySource: PardonExecutionSource = {
      http,
      values,
      comp: values,
      history,
    };

    batch(() => {
      const askHttp = HTTP.parse(ask);

      updateSource({
        ...historySource,
        values: askHttp.values,
        comp: { ...globals(), ...askHttp.values },
      });

      setHttpInput(
        HTTP.stringify({
          ...askHttp,
          values: localValues(askHttp.values),
        }),
      );
    });
  }

  const currentTrace = createMemo(() => {
    const render = outbound();
    if (render?.status !== "fulfilled") {
      return;
    }

    const request = render?.value;

    return request.context.trace;
  });

  startTracingRequestHistory(outbound);

  return (
    <Resizable orientation="vertical">
      <Resizable.Panel
        class="flex size-full min-h-0 flex-1 flex-col"
        initialSize={0.7}
        minSize={"50px"}
      >
        <Resizable>
          <Resizable.Panel
            class="flex bg-stone-200 dark:bg-stone-700"
            initialSize={0.2}
            minSize={0.1}
            collapsible
            collapsedSize={0.0}
            maxSize={0.4}
          >
            {(panelProps) => {
              createEffect(() => setGlobalsCollapsed(panelProps.collapsed));
              createEffect(() => {
                if (!globalsCollapsed()) {
                  panelProps.expand("following");
                }
              });

              const desynchronized = createMemo(() =>
                Object.keys(globals() || {}).filter(
                  (key) => !(key in (source()?.values || {})),
                ),
              );

              return (
                <Resizable orientation="vertical">
                  <Resizable.Panel class="flex" initialSize={0.4}>
                    <DataInput
                      class="w-0 min-w-0 flex-1 bg-yellow-100 dark:bg-stone-700"
                      nowrap
                      onDataChange={({ values, doc }) => {
                        setGlobals(values);
                        setGlobalExtra(doc ?? "");
                      }}
                      defaultValue={globalsInitialValue()}
                      data={{ values: globals, doc: globalExtra }}
                      dragDrop={{
                        onDragOver() {},
                        onDrop(event) {
                          const value =
                            event.dataTransfer.getData("text/value");

                          if (value) {
                            const info = KV.parse(value, "object");
                            if (info.method && info.method === "GET") {
                              const { method, ...unget } = info;

                              setGlobals(({ method, ...globals }) => ({
                                ...globals,
                                ...unget,
                              }));
                            } else {
                              setGlobals((globals) => ({
                                ...globals,
                                ...info,
                              }));
                            }

                            event.preventDefault();
                          }
                        },
                      }}
                      icon={
                        <>
                          <Show when={desynchronized()?.length}>
                            <CornerControls
                              placement="tr"
                              class="p-0.5"
                              unbuttoned={["alert"]}
                              icons={{
                                alert: (
                                  <span class="smoothed-backdrop z-10 [&::after]:bg-[#DD660070] [&::after]:backdrop-blur-[1px]">
                                    <TbExclamationCircle />
                                  </span>
                                ),
                              }}
                            />
                          </Show>
                          {/* without this span the Show takes out the entire DataInput! (solidJS bug) */}
                          <span />
                        </>
                      }
                    />
                  </Resizable.Panel>
                  <Resizable.Handle />
                  <Resizable.Panel initialSize={0.6} class="flex w-0 min-w-0">
                    <div class="flex w-0 min-w-0 flex-1 overflow-hidden">
                      <KeyValueCopier
                        class="bg-neutral-200 p-1 dark:bg-stone-800"
                        data={scratchValues()}
                        onDragOver={(event) => {
                          if (event.dataTransfer.types.includes("text/value")) {
                            event.preventDefault();
                          }
                        }}
                        onDrop={(event) => {
                          const kvData =
                            event.dataTransfer.getData("text/value");
                          if (kvData) {
                            event.preventDefault();
                            const data = KV.parse(kvData, "object");
                            setScratchValues((current) => ({
                              ...current,
                              ...data,
                            }));
                          }
                        }}
                        icon={
                          <div
                            class="absolute inset-x-0 bottom-1 flex place-content-center opacity-100 transition-opacity duration-700"
                            classList={{
                              "!opacity-0 pointer-events-none":
                                Object.keys(scratchValues() ?? {}).length == 0,
                            }}
                          >
                            <button
                              class="flex-0 p-1 transition-colors duration-300 hover:bg-fuchsia-300 dark:hover:bg-pink-500 [&.drop]:!bg-fuchsia-300 [&.drop]:dark:!bg-pink-500"
                              onClick={() => setScratchValues({})}
                              onDragOver={(event) => {
                                if (
                                  event.dataTransfer.types.includes(
                                    "text/value",
                                  )
                                ) {
                                  event.preventDefault();
                                  event.target.classList.add("drop");
                                }
                              }}
                              onDragEnter={function (event) {
                                event.target.classList.add("drop");
                              }}
                              onDragLeave={function (event) {
                                event.target.classList.remove("drop");
                              }}
                              onDrop={(event) => {
                                const kvValue =
                                  event.dataTransfer.getData("text/value");

                                const datum = KV.parse(kvValue, "object");

                                const values = scratchValues();

                                for (const [k, v] of Object.entries(datum)) {
                                  if (
                                    values[k] !== undefined &&
                                    valueId(values[k]) === valueId(v)
                                  ) {
                                    setScratchValues(
                                      ({ [k]: _, ...rest }) => rest,
                                    );
                                  }
                                }

                                // eat the event to prevent reapplying the value.
                                event.preventDefault();
                                event.stopPropagation();
                              }}
                            >
                              <TbTrash class="pointer-events-none" />
                            </button>
                          </div>
                        }
                      />
                    </div>
                  </Resizable.Panel>
                </Resizable>
              );
            }}
          </Resizable.Panel>
          <Resizable.Handle />
          <Resizable.Panel initialSize={0.8}>
            <Resizable orientation="vertical">
              <Resizable.Panel
                class="flex flex-col bg-neutral-200 dark:bg-neutral-600"
                minSize={0.3}
                initialSize={0.5}
                collapsedSize={0.25}
                collapsible
              >
                <Resizable>
                  <Resizable.Panel
                    minSize={0.25}
                    initialSize={0.6}
                    class="flex"
                  >
                    <DataInput
                      class="w-0 flex-1 overflow-auto bg-yellow-100 dark:bg-stone-700 [&_.cm-line]:pr-8"
                      editorViewRef={(view) => (httpInputEditorView = view)}
                      defaultValue={httpInitialValue()}
                      setTextRef={(setText) => (setHttpInput = setText)}
                      data={{
                        values,
                        doc: http,
                      }}
                      nowrap
                      onDataChange={({ values, doc }) => {
                        setHttp(doc);
                        setValues(values);
                      }}
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
                      icon={
                        <>
                          <Show when={previewCollapsed()}>
                            <CornerControls
                              placement="rr"
                              class="corvu-handle-colors z-10 gap-1 bg-current [&:has(button:active)_svg]:text-neutral-500 dark:[&:has(button:active)_svg]:text-white [&_button]:active:!bg-inherit"
                              actions={{
                                preview() {
                                  setPreviewCollapsed(false);
                                },
                              }}
                              icons={{
                                preview: (
                                  <TbSend class="root-color rotate-45 bg-transparent" />
                                ),
                              }}
                            />
                          </Show>
                          <CornerControls
                            placement="tr"
                            flex="col"
                            class="z-10 gap-1 bg-stone-200 p-0.5 dark:bg-slate-600"
                            unbuttoned={["info"]}
                            actions={{
                              mood: () => setShowPreview((show) => !show),
                              copy: () => {
                                navigator.clipboard.writeText(
                                  `${KV.stringify({ ...source().values }, "\n", 2, "\n\n")}${http()}`,
                                );
                              },
                            }}
                            icons={{
                              mood: (
                                <Suspense fallback={<TbQuestionMark />}>
                                  {moodIcon()}
                                </Suspense>
                              ),
                              info: (
                                <ConfigurationDrawer
                                  class="!text-md flex bg-inherit p-0"
                                  preview={createMemo(() => {
                                    const p = preview();
                                    return p?.status === "fulfilled"
                                      ? p.value
                                      : undefined;
                                  })()}
                                >
                                  <TbSettings2 />
                                </ConfigurationDrawer>
                              ),
                              copy: <TbCopy />,
                            }}
                          />
                          <Show when={globalsCollapsed()}>
                            <CornerControls
                              placement="ll"
                              flex="col"
                              class="corvu-handle-colors z-10 gap-1 bg-current [&:has(button:active)_svg]:text-neutral-500 dark:[&:has(button:active)_svg]:text-white [&_button]:active:!bg-inherit"
                              actions={{
                                collection: () => setGlobalsCollapsed(false),
                              }}
                              icons={{
                                collection: (
                                  <TbPlus class="root-color bg-transparent" />
                                ),
                              }}
                            />
                          </Show>
                        </>
                      }
                      dragDrop={{
                        onDragOver(event) {
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
                            restoreFromHttp(http);
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
                    />
                  </Resizable.Panel>
                  <Resizable.Handle />
                  <Resizable.Panel
                    class="flex flex-1"
                    minSize={0.1}
                    collapsedSize={0}
                    initialSize={0.4}
                    collapsible
                  >
                    {(panelProps) => {
                      createEffect(() =>
                        setPreviewCollapsed(panelProps.collapsed),
                      );
                      createEffect(() => {
                        if (!previewCollapsed()) {
                          panelProps.expand("preceding");
                        }
                      });
                      return (
                        <PreviewPanel
                          relock={relock()}
                          redacted={redacted()}
                          setRedacted={setRedacted}
                          headers={includeHeaders()}
                          setHeaders={setIncludeHeaders}
                          preview={preview}
                          outbound={outbound}
                          showPreview={showPreview()}
                          request={requestJSON()}
                          httpInputEditorView={httpInputEditorView}
                          previewText={previewText()}
                          renderText={renderText()}
                          text="10pt"
                          resetRequest={() => {
                            batch(() => {
                              updateSource(({ history, ...source }) => ({
                                ...source,
                                values: { ...globals(), ...source.values },
                                comp: { ...globals(), ...source.values },
                              }));
                              setHttp(() => source().http);
                              setValues(() =>
                                localValues({ ...source().values }),
                              );
                            });
                          }}
                        />
                      );
                    }}
                  </Resizable.Panel>
                </Resizable>
              </Resizable.Panel>
              <Resizable.Handle />
              <Resizable.Panel class="flex flex-col">
                <ResponsePanel
                  outbound={outbound()}
                  redacted={redacted()}
                  request={request()}
                  include={includeHeaders()}
                  lastResult={lastResult()}
                  setLastResult={setLastResult}
                />
              </Resizable.Panel>
            </Resizable>
          </Resizable.Panel>
        </Resizable>
      </Resizable.Panel>
      <Resizable.Handle />
      <Resizable.Panel initialSize={0.3} minSize={"175px"}>
        <MultiView<SubPanelView>
          value={subPanelView() as SubPanelView}
          onChange={setSubPanelView}
          class="[&>.multiview-controls]:border-r-1 [&>.multiview-controls]:border-neutral-300 [&>.multiview-controls]:p-1 [&>.multiview-controls]:dark:border-neutral-500"
          controls={(value) => {
            return (
              <div class="flex flex-1 flex-col gap-1">
                <MultiView.Controls
                  view={value}
                  class="p-1 text-xl [&.multiview-selected]:bg-lime-400 [&.multiview-selected]:dark:bg-cyan-500"
                  disabled={{
                    samples: Boolean(
                      samples?.state !== "ready" || !samples().length,
                    ),
                  }}
                  controls={{
                    history: <TbMist />,
                    samples: <TbFolderCode />,
                    editor: <TbPencil />,
                    recall: <TbInterrobang />,
                  }}
                />
                <Toggle
                  class="relative mt-auto bg-inherit p-1 text-xl mix-blend-normal dark:active:!bg-neutral-500"
                  onChange={setRelock}
                  value={relock()}
                >
                  {(props) => (
                    <>
                      {props.value ? (
                        <TbLock class="scale-150 dark:text-neutral-400" />
                      ) : (
                        <TbLockOpen class="scale-150 dark:text-neutral-400" />
                      )}
                      <TbEye class="absolute bottom-[-1px] scale-75" />
                    </>
                  )}
                </Toggle>
              </div>
            );
          }}
        >
          {(props) => (
            <Resizable>
              <Resizable.Panel initialSize={0.2}>
                <Collections
                  selection={selection()}
                  filters={{
                    endpoint: true,
                    other: props.value === "editor",
                  }}
                  expanded={new Set()}
                  endpoint={current()}
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

                    setCollectionItem({ ...info, key });

                    if (type === "endpoint") {
                      restoreFromHttp(preview);
                    }
                  }}
                />
              </Resizable.Panel>
              <Resizable.Handle />
              <Resizable.Panel initialSize={0.8} class="flex">
                <Switch>
                  <Match when={props.value === "editor"}>
                    <AssetEditor id={asset()} />
                  </Match>
                  <Match when={props.value == "history"}>
                    <RequestHistory
                      onRestore={restoreFromHistory}
                      isCurrent={createSelector(currentTrace)}
                    />
                  </Match>
                  <Match when={props.value == "recall"}>
                    <RecallSystem
                      onRestore={restoreFromHistory}
                      isCurrent={createSelector(currentTrace)}
                    />
                  </Match>
                  <Match when={props.value == "samples"}>
                    <Samples
                      expanded={new Set()}
                      onDblClick={(_key, { content, path }) => {
                        if (path.endsWith(".log.https")) {
                          restoreFromLog(content);
                        } else {
                          restoreFromHttp(content);
                        }
                      }}
                    />
                  </Match>
                </Switch>
              </Resizable.Panel>
            </Resizable>
          )}
        </MultiView>
      </Resizable.Panel>
    </Resizable>
  );
}
