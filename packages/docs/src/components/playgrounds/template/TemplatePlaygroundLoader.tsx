import {
  Show,
  Suspense,
  createEffect,
  createSignal,
  lazy,
  type ParentProps,
} from "solid-js";

export default function TemplatePlaygroundLoader(props: ParentProps<{}>) {
  const PlaygroundApp = lazy(async () => {
    const { default: TemplatePlayground } = await import(
      "@components/playgrounds/template/TemplatePlayground"
    );

    return {
      default: (props: ParentProps<{}>) => {
        return <TemplatePlayground {...props} />;
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
    <div class="grid h-52 grow place-content-center">
      <span>Loading Template Playground...</span>
    </div>
  );

  return (
    <div class="pp-container copypaste-context m-0! grid gap-2">
      <div class="pp-app-container not-content border-t-0! pt-0">
        <Suspense fallback={loading}>
          <Show when={!isSSR()} fallback={loading}>
            <IconTablerDirectionArrows class="t-0 l-0 absolute z-10 -translate-x-3/4 text-3xl opacity-50" />
            <PlaygroundApp {...props} />
          </Show>
        </Suspense>
      </div>
    </div>
  );
}
