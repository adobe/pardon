import { createContext, createSignal, untrack, useContext } from "solid-js";
import type { Accessor, ParentProps, Setter } from "solid-js";

const SecretsContext = createContext<{
  secrets: Accessor<boolean>;
  setSecrets: Setter<boolean>;
  enabled: true;
}>();

export default function SecretsSignalContext(
  props: ParentProps<{ secrets?: boolean }>,
) {
  const defaultValue = untrack(() => props.secrets);

  if (defaultValue !== undefined) {
    const [secrets, setSecrets] = createSignal(defaultValue);

    return (
      <SecretsContext.Provider
        value={{
          secrets,
          setSecrets,
          enabled: true,
        }}
      >
        {props.children}
      </SecretsContext.Provider>
    );
  }

  return <>{props.children}</>;
}

export function useSecretsSignal() {
  return (
    useContext(SecretsContext) ??
    ({ enabled: false, secrets: () => false } as {
      enabled: false;
      secrets: Accessor<false>;
      setSecrets: undefined;
    })
  );
}
