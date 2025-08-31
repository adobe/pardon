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
