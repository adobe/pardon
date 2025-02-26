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
