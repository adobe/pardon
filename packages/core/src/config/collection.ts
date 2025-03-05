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
import { dirname, relative, resolve } from "node:path";

import * as YAML from "yaml";

import {
  AssetParseError,
  Configuration,
  EndpointConfiguration,
  LayeredEndpoint,
  LayeredMixin,
} from "./collection-types.js";
import {
  HTTPS,
  HttpsFlowScheme,
  HttpsTemplateConfiguration,
  HttpsTemplateScheme,
} from "../core/formats/https-fmt.js";
import { globfiles } from "./util/globfiles.js";
import { arrayIntoObject, mapObject } from "../util/mapping.js";
import { resolvePardonRelativeImport } from "../runtime/compiler.js";
import {
  AssetSource,
  AssetType,
  CollectionData,
  PardonCollection,
} from "../runtime/init/workspace.js";
import { PardonError } from "../core/error.js";
import { expandConfigMap } from "../core/schema/core/config-space.js";
import { compileHttpsFlow } from "../core/execution/flow/https-flow.js";

export async function loadCollectionLayer(root: string) {
  return {
    root,
    files: await globfiles(root, ["**/*"], async (content, path) => {
      return { path: resolve(root, path), content } as AssetSource;
    }),
  };
}

export function processCollectionLayer(sources: Record<string, AssetSource>): {
  type: AssetType;
  name: string;
  id: string;
  source: AssetSource;
  import?: string[];
}[] {
  return Object.entries(sources).map(([name, source]) => {
    switch (true) {
      case /[/](service|config)[.]yaml$/.test(name):
        return {
          type: "config" as const,
          name,
          id: name.replace(/[/](service|config)[.]yaml$/, ""),
          source,
        };
      case /[.](yaml|json)$/.test(name): {
        const id = `pardon:${name.replace(/[.](yaml|json)$/, "")}`;
        return {
          type: "data" as const,
          name,
          id,
          source,
        };
      }
      case /[.](mix|mux)[.](https)$/.test(name):
        return {
          type: "mixin" as const,
          name,
          id: `pardon:${name}`,
          source,
        };
      case /[.]flow[.]https$/.test(name):
        return {
          type: "flow" as const,
          name,
          id: name.replace(/[.]https$/, ""),
          source,
        };
      case /[.]https$/.test(name):
        return {
          type: "endpoint" as const,
          name,
          id: name.replace(/[.]https$/, ""),
          source,
        };
      case /[.]flow[.][tj]s$/.test(name):
        return {
          type: "script" as const,
          subtype: "flow",
          name,
          id: `pardon:${name.replace(/[.][tj]s$/, "")}`,
          source,
        };
      case /[.][tj]s$/.test(name):
        return {
          type: "script" as const,
          name,
          id: `pardon:${name.replace(/[.][tj]s$/, "")}`,
          source,
        };
      default:
        return {
          type: "unknown" as const,
          name,
          id: name,
          source,
        };
    }
  });
}

export async function loadCollections(collectionRoots: string[]) {
  return await Promise.all(
    collectionRoots.map((root) =>
      root === "//fallback/collection"
        ? ({
            root,
            files: {
              "default/service.yaml": {
                content: "# built-in fallback service",
                path: "//fallback/collection/default/service.yaml",
              },
              "default/default.https": {
                content: "# built-in fallback endpoint\n>>>\nANY //",
                path: "//fallback/collection/default/default.https",
              },
            },
          } satisfies Awaited<ReturnType<typeof loadCollectionLayer>>)
        : loadCollectionLayer(root),
    ),
  );
}

function add<T>(array: T[] | undefined, value: T) {
  if (array) {
    array.push(value);
  } else {
    array = [value];
  }
  return array;
}

function collate<T>(...records: Record<string, T>[]): Record<string, T[]> {
  return records.reduce<Record<string, T[]>>(
    (merged, values) =>
      Object.assign(
        merged,
        mapObject(values, (value, key) => add(merged[key], value)),
      ),
    {},
  );
}

function priorityOf(type: AssetType) {
  switch (type) {
    case "config":
      return 0;
    default:
      return 1;
  }
}

export function buildCollection(
  collections: Awaited<ReturnType<typeof loadCollectionLayer>>[],
): PardonCollection {
  const layers = collections.map(({ files }) => processCollectionLayer(files));
  const files = collections
    .flatMap(({ files }) => Object.values(files))
    .reduce(
      (files, { path, content }) =>
        Object.assign(files, {
          [path]: content,
        }),
      {},
    );

  const configurations: PardonCollection["configurations"] = {};
  const endpoints: PardonCollection["endpoints"] = {};
  const data: PardonCollection["data"] = {};
  const mixins: PardonCollection["mixins"] = {};
  const errors: PardonCollection["errors"] = [];
  const assets: PardonCollection["assets"] = {};
  const flows: PardonCollection["flows"] = {};
  const scripts: PardonCollection["scripts"] = {
    resolutions: {},
    identities: {},
  };

  for (const asset of Object.values(
    collate(
      ...layers.map((layer) =>
        arrayIntoObject(layer, ({ type, id, ...info }) => ({
          [`${type}:${id}`]: { type, id, ...info },
        })),
      ),
    ),
  ).sort(([{ type: a }], [{ type: b }]) => priorityOf(a) - priorityOf(b))) {
    const { type, name, id } = asset[0];
    const sources = asset.map(({ source }) => source);

    assets[id] = {
      type,
      sources,
      name,
    };

    function resolveExport(
      path: string,
      configuration: Configuration<"source">,
    ) {
      if (configuration?.export) {
        const sourcepath = resolve(
          dirname(path),
          relative(configuration.path, configuration.export),
        );
        const resolution = (scripts.resolutions[`pardon:${id}`] ??= []);
        const identity = `pardon:${id}?${resolution.length}`;
        if (sourcepath in files) {
          if ((scripts.identities[sourcepath] ??= identity) !== identity) {
            throw new PardonError(
              `cannot reidentify ${sourcepath} from ${scripts.identities[sourcepath]} to ${identity}`,
            );
          }

          resolution.push({ path: sourcepath, content: files[sourcepath] });
          return true;
        }
      }
    }

    switch (type) {
      case "config": {
        configurations[id] = collections.reduce(
          (mergedConfiguration, { files, root }) => {
            const { content, path } =
              files[`${id}/service.yaml`] ?? files[`${id}/config.yaml`] ?? {};

            const configuration = path
              ? loadConfig({ content, name, path }, errors)
              : undefined;

            const configurations = [mergedConfiguration, configuration].filter(
              Boolean,
            );

            if (configurations.length === 0) return null!;

            const merged = mergeConfigurations({
              name,
              configurations,
            });

            if (
              !resolveExport(path ?? resolve(root, merged.name), merged) &&
              configuration?.export
            ) {
              console.warn(
                `export: could not resolve direct reference to ${configuration.export} from ${path}`,
              );
            }

            return merged;
          },
          null! as Configuration,
        );

        break;
      }
      case "endpoint": {
        const {
          service,
          configuration: { export: _, ...serviceConfiguration },
        } = endpointServiceConfiguration(id, configurations);

        endpoints[id] = sources.reduce<LayeredEndpoint>(
          (endpoint, { content, path }) => {
            const { steps, configuration } = parseAsset(
              path,
              () => HTTPS.parse(content) as HttpsTemplateScheme<"source">,
              errors,
              () => ({
                configuration: {} as any,
                mode: "mix" as const,
                steps: [],
              }),
            );

            endpoint.configuration = mergeConfigurations({
              name: name.replace(/[.]https$/, ""),
              configurations: [endpoint.configuration, configuration].filter(
                Boolean,
              ),
            });

            if (
              !resolveExport(path, endpoint.configuration) &&
              configuration?.export
            ) {
              console.warn(
                `export: could not resolve direct reference to ${configuration.export} from ${path}`,
              );
            }

            endpoint.layers.push({ path, steps });

            return endpoint;
          },
          {
            service,
            action: id.split("/").slice(-1)[0],
            configuration: serviceConfiguration,
            layers: [],
          } as LayeredEndpoint,
        );
        break;
      }
      case "data": {
        data[id] = sources.reduce(
          (data, { content, path }) => {
            return {
              values: parseAsset(
                path,
                () =>
                  mergeData(
                    data.values,
                    path.endsWith(".json")
                      ? JSON.parse(content)
                      : YAML.parse(content),
                  ),
                errors,
                () => data.values,
              ),
            };
          },
          { values: {} },
        );
        break;
      }
      case "mixin": {
        const [, mode] = /[.](mix|mux)[.]https$/.exec(name)!;

        mixins[id] = sources.reduce<LayeredMixin>(
          (mixin, { content, path }) => {
            const { steps, configuration } = parseAsset(
              path,
              () => HTTPS.parse(content, mode as "mix" | "mux"),
              errors,
              () => ({
                configuration: {} as any,
                mode: mode as "mix" | "mux",
                steps: [],
              }),
            );

            mixin.configuration = mergeConfigurations({
              name,
              configurations: [mixin.configuration, configuration].filter(
                Boolean,
              ),
            });

            mixin.layers.push({ path, steps, mode: mode as "mix" | "mux" });

            return mixin;
          },
          { configuration: undefined!, layers: [], mode } as LayeredMixin,
        );
        break;
      }
      case "script":
        if (sources.some(({ path }) => scripts.identities[path])) {
          if (!sources.every(({ path }) => scripts.identities[path])) {
            console.warn(`inconsistent usage of script ${id}`);
          }
          break;
        }

        for (const { path, content } of sources) {
          const resolution = (scripts.resolutions[id] ??= []);
          scripts.identities[path] = `${id}?${resolution.length}`;
          resolution.push({ path, content });
        }
        break;
      case "flow": {
        const { content, path } = sources.slice(-1)[0];
        const scheme = HTTPS.parse(content, "flow") as HttpsFlowScheme;
        flows[id] = compileHttpsFlow(scheme, { path, name: id });
        break;
      }
      case "unknown":
        console.warn(`unknown asset: ${id}`);
        break;
      default:
        break;
    }
  }

  mergeDefaults(endpoints, data);

  return {
    assets,
    errors,

    endpoints,
    configurations,
    data,
    mixins,
    flows,
    scripts,
  };
}

function mergeDefaults(
  endpoints: Record<string, LayeredEndpoint>,
  data: Record<string, CollectionData>,
) {
  for (const [key, endpoint] of Object.entries(endpoints)) {
    const { defaults } = key
      .split("/")
      .reduce<{ path: string[]; defaults: Record<string, any> }>(
        ({ path, defaults }, part) => {
          path.push(part);

          return {
            path,
            defaults: mergeData(
              defaults,
              data[[...path, "defaults"].join("/")] || {},
            ),
          };
        },
        { path: [], defaults: {} },
      );

    endpoint.configuration.defaults = mergeData(
      endpoint.configuration.defaults,
      defaults,
    );
  }
}

type Combiner = {
  merge<A, B>(a: A, b: B, combiner: Combiner): A & B;
  mix<A, B>(a: A, b: B): A & B;
};

function mergeData<A, B>(
  a: A,
  b: B,
  combiner: Combiner = {
    merge: mergeData,
    mix: (a, b) => (b ?? a) as typeof a & typeof b,
  },
): A & B {
  if (
    typeof a === "object" &&
    typeof b === "object" &&
    a &&
    b &&
    !Array.isArray(a) &&
    !Array.isArray(b)
  ) {
    return {
      ...a,
      ...b,
      ...arrayIntoObject(
        Object.keys(a ?? {}).filter((k) => (b ?? {})[k] !== undefined),
        (k) =>
          ({
            [k]: combiner.merge(
              (a ?? {})[k] as any,
              (b ?? {})[k] as any,
              combiner,
            ),
          }) as any,
      ),
    };
  }

  if (typeof a === "undefined") {
    // don't merge null ?? undefined -> undefined.
    return b as A & B;
  }

  return combiner.mix(a, b) as A & B;
}

function endpointServiceConfiguration(
  endpoint: string,
  configurations: Record<string, Configuration>,
) {
  const paths: string[] = [];
  const layers: Configuration[] = [];
  let service: string | undefined;
  for (const segment of endpoint.split("/")) {
    paths.push(segment);

    const path = paths.join("/");
    const config = configurations[path];

    if (!config) continue;

    if (config.type === "service") {
      service = path;
    }

    layers.push(config);
  }

  return {
    service,
    configuration: mergeConfigurations({
      name: endpoint,
      configurations: layers,
      mixing: false,
    }),
  };
}

function loadConfig(
  { content, name: rawname, path }: Record<"content" | "name" | "path", string>,
  errors: AssetParseError[],
): Configuration<"source"> {
  const configuration = parseAsset(
    path,
    () => YAML.parse(content) as Configuration,
    errors,
    () => ({}),
  );

  const [, name, type] = /^(.*)[/](service|config)[.]yaml$/.exec(rawname)!;

  return {
    ...configuration,
    type: type as "service" | "config",
    name,
    path,
  };
}

/**
 * merges configuration objects, this is used for both merging the contextual
 * configuration mappings into each endpoint, as well as for
 * mixing in the inline configurations in mixins.
 */
export function mergeConfigurations({
  name,
  configurations,
  mixing,
}: {
  name: string;
  configurations: Partial<
    Configuration<"source" | "runtime"> &
      HttpsTemplateConfiguration<"source" | "runtime">
  >[];
  mixing?: boolean;
}): Configuration {
  const target = `pardon:${dirname(name)}`;
  const merged = configurations
    .filter(Boolean)
    .reduce<
      Pick<
        Configuration & EndpointConfiguration,
        | "config"
        | "defaults"
        | "import"
        | "export"
        | "mixin"
        | "type"
        | "encoding"
        | "search"
        | "flow"
      >
    >(
      (
        merged,
        {
          config,
          defaults,
          import: imports,
          export: exports,
          mixin,
          type,
          search,
          encoding,
          flow,
          //...other
        },
      ) => ({
        config: expandConfigMap(config, merged.config),
        // defaults do not override when applying mixins
        defaults: mixing
          ? mergeData(defaults ?? {}, merged.defaults)
          : mergeData(merged.defaults, defaults ?? {}),
        encoding: encoding ?? merged.encoding,
        search: search ?? merged.search,
        import: Object.assign(
          {},
          merged.import!,
          mapObject(imports || {}, {
            keys: (key) => resolvePardonRelativeImport(key, target),
            values: (value, key) => {
              let current = merged.import?.[key];
              if (!current) {
                return value;
              }

              if (typeof current === "string") {
                if (typeof value === "string") {
                  value = [`* as ${value}`];
                }
                current = [`* as ${current}`];
              } else if (Array.isArray(current)) {
                if (typeof value === "string") {
                  value = [`* as ${value}`];
                }
              }
              // the filter here might be a rough solution to the problem that
              // configurations are merged in two dimensions:
              //   - parent/child directories
              //   - layered collections
              return [
                ...current.filter((spec) => !value.includes(spec)),
                ...value,
              ];
            },
          }),
        ),
        export: exports
          ? resolvePardonRelativeImport(exports, target)
          : merged.export,
        mixin: [
          ...unmergedMixins(merged, mixin, target),
          ...(merged.mixin || []),
        ],
        flow: flow ?? merged.flow,
        type:
          merged.type === "service" || type === "service"
            ? ("service" as const)
            : ("config" as const),
      }),
      { config: [{}], defaults: {}, import: {}, mixin: [] },
    );

  return { ...merged, name, path: target };
}

function unmergedMixins(
  merged: { mixin?: string | string[] },
  mixin: string | string[] | undefined,
  target: string,
) {
  return (
    [mixin || []]
      .flat(1)
      .map((mixin) => resolvePardonRelativeImport(mixin, target))
      // this might be a rough solution to the problem that
      // configurations are merged in two dimensions:
      //   - parent/child directories
      //   - layered collections
      .filter(
        (mixin) => ![merged.mixin].filter(Boolean).flat(1).includes(mixin),
      )
  );
}

function parseAsset<T>(
  path: string,
  action: () => T,
  errors: AssetParseError[],
  fallback: () => T,
): T {
  try {
    return action();
  } catch (error) {
    console.warn(`${path}: error loading`, error);
    errors.push({
      path,
      error: new PardonError(`${path}: error loading`, error),
    });

    return (
      fallback() ??
      (() => {
        throw error;
      })()
    );
  }
}
