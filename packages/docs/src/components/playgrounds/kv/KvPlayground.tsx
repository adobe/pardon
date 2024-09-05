import CodeMirror from "@components/codemirror/CodeMirror.jsx";
import { KV } from "pardon/formats";
import { createMemo, createSignal } from "solid-js";

export default function KvPlayground(props: { value: string }) {
  const [kv, setKV] = createSignal(props.value ?? "a=b");
  const [valid, setValid] = createSignal(true);
  const parsed = createMemo<string>((previous) => {
    try {
      const result = JSON.stringify(KV.parse(kv()), null, 2);
      setValid(true);
      return result;
    } catch (error) {
      setValid(false);
      return previous ?? String(error);
    }
  });

  return (
    <div class="not-content flex h-[30rem] flex-row gap-2 p-2">
      <CodeMirror
        readwrite
        class="grow basis-32 overflow-auto rounded-lg bg-neutral-300 dark:bg-neutral-700"
        onValueChange={setKV}
        value={kv()}
      />
      <CodeMirror
        class="flex-auto overflow-auto rounded-lg bg-neutral-200 dark:bg-neutral-800"
        text="10px"
        readonly
        value={parsed()}
        classList={{
          "text-red-500 dark:text-red-400": !valid(),
        }}
      />
    </div>
  );
}
