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
        ]);

        return (
          <PardonApplication config={config()} {...applicationProps}>
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
    <div class="pp-app grid h-52 flex-grow place-content-center">
      <span>Loading Pardon Playground...</span>
    </div>
  );

  return (
    <div class="pp-container grid w-full gap-2">
      <div>{props.children}</div>
      <div class="pp-app-container not-content !mt-0">
        <Suspense fallback={loading}>
          <Show when={!isSSR()} fallback={loading}>
            <PlaygroundApp {...otherProps} />
          </Show>
        </Suspense>
      </div>
    </div>
  );
}
