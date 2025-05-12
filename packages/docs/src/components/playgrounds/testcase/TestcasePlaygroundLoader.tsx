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
