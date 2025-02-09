import { createContext, createMemo, useContext } from "solid-js";
import { resolvePardonApplicationCollection } from "pardon/playground";
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

export type ApplicationContext = ReturnType<
  typeof resolvePardonApplicationCollection
>;

type ConfigProps = {
  example?: string;
  config: Record<string, string>;
  layers?: string[];
};

const PardonApplicationContext =
  createContext<
    Accessor<
      | { application: ApplicationContext }
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
      return { application: createApplicationContext(props) };
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

  return resolvePardonApplicationCollection({
    config: {
      root: "/",
      collections: layers ?? ["/collection/"],
    },
    layers: resolvedLayers,
    samples: [],
    example: { request: example },
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
