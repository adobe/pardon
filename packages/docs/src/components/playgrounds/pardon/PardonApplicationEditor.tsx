import CodeMirror from "@components/codemirror/CodeMirror.tsx";
import {
  For,
  createMemo,
  createSelector,
  createSignal,
  untrack,
  type Accessor,
  type Setter,
  type VoidProps,
} from "solid-js";

export default function PardonApplicationEditor(
  props: VoidProps<{
    config: Accessor<Record<string, string>>;
    setConfig: Setter<Record<string, string>>;
    selected?: string;
  }>,
) {
  let selectElement!: HTMLSelectElement;
  const configKeys = createMemo(() => Object.keys(props.config()));
  const [selectedKey, setSelectedKey] = createSignal(
    untrack(() => props.selected) ?? configKeys()[0],
  );
  const keySelected = createSelector(selectedKey);
  let configOverrides = {
    ...Object.entries(untrack(props.config))
      .sort(([k1], [k2]) => k1.localeCompare(k2))
      .reduce<Record<string, string>>(
        (config, [k, v]) => Object.assign(config, { [k]: v.trim() }),
        {},
      ),
  };

  const document = createMemo(() => {
    const key = selectedKey();
    return configOverrides[key];
  });

  function updateConfig(value: string) {
    configOverrides = { ...configOverrides, [selectedKey()]: value };
    props.setConfig(configOverrides);
  }

  return (
    <div class="not-content mt-1 flex flex-col gap-2 rounded-md border-0 border-x-2 border-solid px-2 py-2 dark:border-x-sky-600">
      <select
        class="w-full"
        ref={selectElement}
        onChange={(event) => setSelectedKey(event.target.value)}
      >
        <For each={configKeys()}>
          {(key) => (
            <option value={key} selected={keySelected(key)}>
              {key}
            </option>
          )}
        </For>
      </select>
      <CodeMirror
        icon={
          <div
            class="icon-grid"
            classList={{
              "icon-grid-col": (document()?.split("\n").length ?? 0) < 4,
            }}
          >
            <IconTablerCode color="gray" class="text-2xl" />
          </div>
        }
        class="max-h-56 min-h-24 overflow-auto rounded-sm bg-yellow-100 shadow dark:bg-neutral-800"
        readwrite
        value={document()}
        onValueChange={updateConfig}
      />
    </div>
  );
}
