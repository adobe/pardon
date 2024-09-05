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
import { type ExecutionHandle } from "@components/playgrounds/pardon/pardon-playground-shared";

export default function PardonPlaygroundPreviewMood(
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
        setMood("confused");
        return {};
      }

      setMood("happy");
      return {};
    },
  );

  return <PardonPlaygroundMood mood={mood()} iconSize={iconSize} />;
}
