import { Show, createMemo, createResource, type ParentProps } from "solid-js";
import CodeMirror from "@components/codemirror/CodeMirror.tsx";

import type { ExecutionHandle } from "@components/playgrounds/pardon/pardon-playground-shared";
import { useSecretsSignal } from "@components/playgrounds/pardon/PardonPlaygroundSecretsSignalContext";
import { useResponseSignal } from "@components/playgrounds/pardon/PardonPlaygroundResponseSignalContext";
import { TbArrowBarDown, TbArrowBarRight, TbEye } from "solid-icons/tb";
import { iconSize } from "@components/pardon-shared.ts";
import { usePardonApplicationContext } from "@components/playgrounds/pardon/PardonApplication";
import { KV } from "pardon/playground";

export default function PardonPlaygroundDataView(
  props: ParentProps<{
    executionHandle: ExecutionHandle;
  }>,
) {
  const { secrets, enabled: secretsEnabled } = useSecretsSignal();
  const [response] = useResponseSignal();
  const context = usePardonApplicationContext();

  const [reprocessedResponse] = createResource(
    () => ({ response: response(), context: context!() }),
    async ({ response, context }) => {
      if (!context?.application) {
        return response;
      }

      try {
        return {
          result: await response?.execution.reprocess({
            app: () => context.application,
          }),
        };
      } catch (error) {
        return { result: undefined, error };
      }
    },
  );

  const [execution] = createResource(
    () => ({
      executionHandle: props.executionHandle(),
      response:
        reprocessedResponse.state !== "pending"
          ? reprocessedResponse.latest
          : undefined,
    }),
    async ({ executionHandle, response }) => {
      if ("error" in executionHandle) {
        return {
          error: new Error("invalid application context", {
            cause: executionHandle.error,
          }),
        };
      }

      if (response?.result) {
        const {
          inbound: { values, secrets },
        } = response.result;
        return {
          data: { values, secrets },
        };
      }

      const { execution } = executionHandle;

      try {
        const {
          request: { values: secrets },
          redacted: { values },
        } = await execution.outbound;

        return {
          data: { values, secrets },
        };
      } catch (error) {
        return {
          data: undefined,
          error,
        };
      }
    },
  );

  const pardon = createMemo<{
    error?: any;
    data?: {
      values: Record<string, unknown>;
      secrets: Record<string, unknown>;
    };
  }>((previous) => {
    const error = execution.latest?.error;
    const data = execution.latest?.data ?? previous?.data ?? ({} as any);

    return {
      error,
      data,
    };
  });

  const scope = createMemo(() => {
    const { search, body, ...values } =
      (secretsEnabled && secrets()
        ? pardon()?.data?.secrets
        : pardon()?.data?.values) || {};

    return { ...values, ...(search ? { search: String(search) } : null) };
  });

  const display = createMemo(() => KV.stringify(scope(), { indent: 2 }));

  return (
    <CodeMirror
      class="max-h-56 overflow-y-auto rounded-md p-2 text-blue-800 dark:bg-stone-700 dark:text-blue-200"
      classList={{
        "text-yellow-900 dark:text-purple-300": Boolean(!response()),
        "text-green-800 dark:text-green-500": Boolean(response()),
      }}
      icon={
        <div
          class="icon-grid"
          classList={{
            "icon-grid-col": (display()?.split("\n").length ?? 0) < 3,
          }}
        >
          <Show
            when={response()}
            fallback={<TbArrowBarRight color="gray" size={iconSize} />}
          >
            <TbArrowBarDown color="gray" size={iconSize} />
          </Show>
          <TbEye
            color="gray"
            size={iconSize}
            class="transition-transform hover:rotate-12"
          />
        </div>
      }
      readonly
      value={display()}
    />
  );
}
