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
import { createContext, createMemo, useContext } from "solid-js";
import { resolvePardonRuntime, inMemorySecrets } from "pardon/playground";
import type { Accessor, ParentProps } from "solid-js";
import type { AssetSource } from "pardon/runtime";

Error.captureStackTrace ??= () => {};
Object.defineProperty(globalThis, "environment", {
  get() {
    return {};
  },
  set() {
    // ignore
  },
  configurable: false,
});

export type ApplicationContext = ReturnType<typeof resolvePardonRuntime>;

type ConfigProps = {
  example?: string;
  config: Record<string, string>;
  layers?: string[];
  server?: string;
};

const PardonApplicationContext =
  createContext<
    Accessor<
      | { application: ApplicationContext; server?: string }
      | { application?: undefined; error: unknown }
    >
  >();

export default PardonApplicationContext;

export function usePardonApplicationContext() {
  return useContext(PardonApplicationContext);
}

export function PardonApplication(props: ParentProps<ConfigProps>) {
  const applicationContext = createMemo(() => {
    try {
      return {
        application: createApplicationContext(props),
        server: props.server,
      };
    } catch (error) {
      return { error };
    }
  });

  return (
    <PardonApplicationContext.Provider value={applicationContext}>
      {props.children}
    </PardonApplicationContext.Provider>
  );
}

function createApplicationContext(props: ConfigProps) {
  const { config, example, layers } = props;

  const resolvedLayers = layers
    ? layers.map((layer) => extractLayer(config, layer, ""))
    : [extractLayer(config, "/collection/", "/collection/")];

  const localStorageSecrets = inMemorySecrets();
  try {
    localStorageSecrets.memory.push(
      ...JSON.parse(localStorage.getItem("pardon:secrets") ?? "[]"),
    );
  } catch (error) {
    void error;
    console.warn("could not restore secrets from local storage");
  }

  return resolvePardonRuntime({
    config: {
      root: "/",
      collections: layers ?? ["/collection/"],
    },
    layers: resolvedLayers,
    samples: [],
    example: { request: example },
    secrets: {
      learn(keys, values) {
        localStorageSecrets.learn(keys, values);
        localStorage.setItem(
          "pardon:secrets",
          JSON.stringify(localStorageSecrets.memory),
        );
      },
      recall(keys, ...secrets) {
        return localStorageSecrets.recall(keys, ...secrets);
      },
    },
  });
}
function extractLayer(
  config: Record<string, string>,
  layer: string,
  prefix: string,
): { root: string; files: Record<string, AssetSource> } {
  return {
    root: prefix,
    files: Object.entries(config)
      .map(([source, content]) => {
        const path = `${prefix}${source}`;
        if (path.startsWith(layer)) {
          return {
            name: path.slice(layer.length),
            path,
            content,
          };
        }
      })
      .filter<Record<"name" | "path" | "content", string>>(Boolean as any)
      .reduce(
        (map, { name, path, content }) =>
          Object.assign(map, {
            [name]: { path, content },
          }),
        {},
      ),
  };
}
