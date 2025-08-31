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
import type { ExecutionContinuation } from "@components/playgrounds/pardon/pardon-playground-shared";
import { createContext, createSignal, useContext } from "solid-js";
import type { ParentProps, Signal } from "solid-js";

type PardonResult = Awaited<ExecutionContinuation["result"]>;

type PardonResponseSignalInfo = {
  result: PardonResult;
  execution: ExecutionContinuation;
};

const ResponseContext =
  createContext<Signal<PardonResponseSignalInfo | undefined>>();

export default function ResponseSignalContext(props: ParentProps<{}>) {
  return (
    <ResponseContext.Provider
      value={createSignal<PardonResponseSignalInfo | undefined>(undefined)}
    >
      {props.children}
    </ResponseContext.Provider>
  );
}

export function useResponseSignal() {
  return useContext(ResponseContext)!;
}
