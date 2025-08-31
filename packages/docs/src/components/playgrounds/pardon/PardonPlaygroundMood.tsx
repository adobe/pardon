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
import { createResource, type ParentProps } from "solid-js";
import PardonPlaygroundMoodComponent from "@components/playgrounds/pardon/PardonPlaygroundMoodComponent";
import type { ExecutionHandle } from "@components/playgrounds/pardon/pardon-playground-shared";

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
        void error;
        return "confused";
      }

      await new Promise((resolve) => requestAnimationFrame(resolve));

      try {
        await execution.egress;
      } catch (error) {
        void error;
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
