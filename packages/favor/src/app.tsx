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

import { ErrorBoundary, Show } from "solid-js";
import Main from "./app/main.tsx";
import LoadingSplash from "./components/LoadingSplash.tsx";
import { manifest } from "./signals/pardon-config.ts";
import "@fontsource/source-code-pro";

function PageLoader(props) {
  return (
    <Show
      when={manifest.state !== "pending"}
      fallback={
        <div class="flex size-full place-content-center align-middle">
          <LoadingSplash class="my-auto" />
        </div>
      }
    >
      <ErrorBoundary
        fallback={(error, reset) => (
          <div onClick={reset}>Caught error: {error?.stack ?? error}</div>
        )}
      >
        {props.children}
      </ErrorBoundary>
    </Show>
  );
}

export default function App() {
  return (
    <PageLoader>
      <Show when={manifest()}>
        <Main manifest={manifest()} />
      </Show>
    </PageLoader>
  );
}
