import { createResource, type ParentProps } from "solid-js";
import PardonPlaygroundMoodComponent from "@components/playgrounds/pardon/PardonPlaygroundMoodComponent";
import { type ExecutionHandle } from "@components/playgrounds/pardon/pardon-playground-shared";

export default function PardonPlaygroundMood(
  props: ParentProps<{
    executionHandle: ExecutionHandle;
  }>,
) {
  const [mood] = createResource(
    () => ({ executionHandle: props.executionHandle() }),
    async ({ executionHandle }) => {
      if ("error" in executionHandle) {
        return "confuzzled";
      }

      const { execution } = executionHandle;

      await new Promise((resolve) => requestAnimationFrame(resolve));

      const previewing = execution.preview;

      try {
        await previewing;
      } catch (error) {
        return "confused";
      }

      await new Promise((resolve) => requestAnimationFrame(resolve));

      try {
        await execution.egress;
      } catch (error) {
        return "error";
      }

      return "happy";
    },
  );

  return (
    <PardonPlaygroundMoodComponent
      mood={mood.loading ? "thinking" : (mood() ?? "thinking")}
    />
  );
}
