import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  untrack,
  type Accessor,
  type ParentProps,
  type Setter,
} from "solid-js";
import PardonPlaygroundMood, {
  type Mood,
} from "@components/playgrounds/pardon/PardonPlaygroundMood";
import { iconSize } from "@components/pardon-shared.ts";
import {
  deferred,
  type ExecutionHandle,
} from "@components/playgrounds/pardon/pardon-playground-shared";

export default function PardonPlaygroundRenderMood(
  props: ParentProps<{
    executionHandle: ExecutionHandle;
    moodRef?: Setter<Mood>;
  }>,
) {
  const [moodSignal, setMoodSignal] = createSignal<Accessor<Mood>>(
    () => "confused",
  );
  const mood = createMemo(() => moodSignal()());

  createEffect(() => {
    props.moodRef?.(mood());
  });

  createResource(
    () => ({ executionHandle: props.executionHandle() }),
    async ({ executionHandle }) => {
      const [mood, setMood] = createSignal<Mood>(untrack(untrack(moodSignal)));
      setMoodSignal(() => mood);

      if ("error" in executionHandle) {
        setMood(() => "confuzzled");
        return {};
      }

      const { execution } = executionHandle;

      await new Promise((resolve) => requestAnimationFrame(resolve));

      const previewing = execution.preview;

      try {
        await previewing;
      } catch (error) {
        setMood(() => "confused");
        return {};
      }

      const deferredMood = deferred<Mood>();

      deferredMood.promise.then((value) => setMood(value));

      setTimeout(() => deferredMood.resolution.resolve("thinking"), 200);

      try {
        await execution.outbound;
        deferredMood.promise.then(() => setMood("happy"));
        deferredMood.resolution.resolve("happy");
      } catch (error) {
        deferredMood.promise.then(() => setMood("error"));
        deferredMood.resolution.resolve("error");
      }

      return {};
    },
  );

  return <PardonPlaygroundMood mood={mood()} iconSize={iconSize} />;
}
