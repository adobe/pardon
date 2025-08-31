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
  type ParentProps,
  Show,
  Suspense,
  createEffect,
  createSignal,
  lazy,
  splitProps,
} from "solid-js";

export default function TestcasePlaygroundLoader(
  props: ParentProps<TestcaseOptions>,
) {
  const [componentProps, otherProps] = splitProps(props, ["children"]);

  const TestcaseApp = lazy(
    async () =>
      await import("@components/playgrounds/testcase/TestcasePlayground.tsx"),
  );

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
    <div class="pp-container grid w-full gap-2">
      <div>{componentProps.children}</div>
      <div class="pp-app-container not-content mt-0!">
        <Suspense fallback={loading}>
          <Show when={!isSSR()} fallback={loading}>
            <TestcaseApp {...otherProps} />
          </Show>
        </Suspense>
      </div>
    </div>
  );
}
