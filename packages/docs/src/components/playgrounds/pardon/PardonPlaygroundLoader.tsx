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
import PardonApplicationEditor from "@components/playgrounds/pardon/PardonApplicationEditor";
import type { PlaygroundOptions } from "@components/playgrounds/pardon/pardon-playground-shared";
import {
  Show,
  Suspense,
  createEffect,
  createSignal,
  lazy,
  splitProps,
  untrack,
  type ParentProps,
} from "solid-js";

export default function PardonPlaygroundLoader(
  props: ParentProps<{
    options: PlaygroundOptions;
    example?: string;
    config: Record<string, string>;
    layers?: string[];
    id?: string;
  }>,
) {
  const [configProps, otherProps] = splitProps(props, ["config", "children"]);
  const [config, setConfig] = createSignal(untrack(() => configProps.config));

  const PlaygroundApp = lazy(async () => {
    const PardonApplicationImport = import(
      "@components/playgrounds/pardon/PardonApplication"
    );
    const PardonPlaygroundComponentImport = import(
      "@components/playgrounds/pardon/PardonPlayground"
    );

    const { PardonApplication } = await PardonApplicationImport;
    const PardonPlayground = (await PardonPlaygroundComponentImport).default;

    return {
      default: (passedProps: typeof otherProps) => {
        const [componentProps, applicationProps] = splitProps(passedProps, [
          "options",
          "id",
        ]);

        return (
          <PardonApplication
            config={config()}
            {...applicationProps}
            server={componentProps.options.server}
          >
            <PardonPlayground {...componentProps}>
              <Show when={componentProps.options.editor}>
                <PardonApplicationEditor
                  config={config}
                  setConfig={setConfig}
                  selected={
                    typeof componentProps.options.editor === "string"
                      ? componentProps.options.editor
                      : undefined
                  }
                />
              </Show>
            </PardonPlayground>
          </PardonApplication>
        );
      },
    };
  });

  const [isSSR, setSSR] = createSignal(true);

  if (!import.meta.env.SSR) {
    createEffect(() => {
      setSSR(false);
    });
  }

  const loading = (
    <div class="pp-app grid h-52 grow place-content-center">
      <span>Loading Pardon Playground...</span>
    </div>
  );

  return (
    <div class="pp-container copypaste-context grid gap-2">
      <div>{props.children}</div>
      <div class="pp-app-container not-content mt-0!">
        <Suspense fallback={loading}>
          <Show when={!isSSR()} fallback={loading}>
            <div class="t-0 l-0 absolute z-10 -translate-x-3/4 text-3xl opacity-50">
              <IconTablerDirectionArrows />
            </div>
            <PlaygroundApp {...otherProps} />
          </Show>
        </Suspense>
      </div>
    </div>
  );
}
