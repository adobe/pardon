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
    <div class="pp-container copypaste-context grid gap-2 pl-2">
      <div class="not-content pt-5">
        <Suspense fallback={loading}>
          <Show when={!isSSR()} fallback={loading}>
            <PlaygroundApp {...props} />
          </Show>
        </Suspense>
      </div>
    </div>
  );
}
