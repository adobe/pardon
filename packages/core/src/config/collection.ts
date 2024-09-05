/*
Copyright 2024 Adobe. All rights reserved.
This file is licensed to you under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License. You may obtain a copy
of the License at http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed under
the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
OF ANY KIND, either express or implied. See the License for the specific language
governing permissions and limitations under the License.
*/
import { dirname, resolve } from "node:path";

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
  HttpsTemplateConfiguration,
} from "../core/formats/https-fmt.js";
import { globfiles } from "./util/globfiles.js";
import { arrayIntoObject, mapObject } from "../util/mapping.js";
import { resolvePardonRelativeImport } from "../runtime/compiler.js";
import {
  AssetInfo,
  AssetSource,
  AssetType,
  CollectionData,
  PardonCollection,
} from "../core/app-context.js";
import { PardonError } from "../core/error.js";

export async function loadCollectionLayer(root: string) {
  return await globfiles(root, ["**/*"], async (content, path) => {
    return { path: resolve(root, path), content } as AssetSource;
  });
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
          import: [`pardon:${name}`, id],
          name,
          id,
          source,
        };
      }
      case /[.](mix|mux)[.](https)$/.test(name): {
        const id = `pardon:${name}`;
        return {
          type: "mixin" as const,
          name,
          id,
          source,
        };
      }
      case /[.](https)$/.test(name):
        return {
          type: "endpoint" as const,
          name,
          id: name.replace(/[.]https$/, ""),
          source,
        };
      case /[.][tj]s$/.test(name): {
        const id = `pardon:${name.replace(/[.][tj]s$/, "")}`;
        return {
          type: "script" as const,
          name,
          import: [`pardon:${name}`, id],
          id,
          source,
        };
      }
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
            "default/service.yaml": {
              content: "# built-in fallback service",
              path: "//fallback/collection/default/service.yaml",
            },
            "default/default.https": {
              content: "# built-in fallback endpoint\n>>>\nANY //",
              path: "//fallback/collection/default/default.https",
            },
          } satisfies Record<string, AssetSource>)
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
  const layers = collections.map((layer) => processCollectionLayer(layer));

  const configurations: PardonCollection["configurations"] = {};
  const endpoints: PardonCollection["endpoints"] = {};
  const data: PardonCollection["data"] = {};
  const mixins: PardonCollection["mixins"] = {};
  const scripts: PardonCollection["scripts"] = {};
  const resolutions: PardonCollection["resolutions"] = {};
  const errors: AssetParseError[] = [];

  const assets: Record<string, AssetInfo> = {};

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

    for (const specifier of asset.flatMap(
      ({ import: imports = [] }) => imports,
    )) {
      if (type === "data" && id.endsWith("/defaults")) {
        continue;
      }

      resolutions[specifier] = id;
    }

    assets[id] = {
      type,
      sources,
      name,
    };

    switch (type) {
      case "config":
        configurations[id] = mergeConfigurations({
          name,
          configurations: sources.map(({ content, path }) =>
            loadConfig({ content, name, path }, errors),
          ),
        });
        break;
      case "endpoint": {
        const { service, configuration } = endpointServiceConfiguration(
          id,
          configurations,
        );

        endpoints[id] = sources.reduce<LayeredEndpoint>(
          (endpoint, { content, path }) => {
            const { steps, configuration } = parseAsset(
              path,
              () => HTTPS.parse(content),
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
            endpoint.layers.push({ path, steps });
            return endpoint;
          },
          {
            service,
            action: id.split("/").slice(-1)[0],
            configuration,
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
        scripts[id] = sources;
        break;
      case "unknown":
      default:
        break;
    }
  }

  mergeDefaults(endpoints, data);

  return {
    assets,
    endpoints,
    configurations,
    data,
    mixins,
    resolutions,
    scripts,
    errors,
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

function mergeData<A, B>(
  a: A,
  b: B,
  combine: (
    a: A extends Record<string, unknown> ? A[string] : never,
    b: B extends Record<string, unknown> ? B[string] : never,
  ) => unknown = mergeData,
): A & B {
  if (typeof a === "object" && typeof b === "object" && a && b) {
    return {
      ...a,
      ...b,
      ...arrayIntoObject(
        Object.keys(a ?? {}).filter((k) => (b ?? {})[k] !== undefined),
        (k) =>
          ({ [k]: combine((a ?? {})[k] as any, (b ?? {})[k] as any) }) as any,
      ),
    };
  }

  if (typeof a === "undefined") {
    // don't merge null ?? undefined -> undefined.
    return b as A & B;
  }

  return (b ?? a) as A & B;
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
): Configuration {
  try {
    const config = parseAsset(
      path,
      () => YAML.parse(content) as Configuration,
      errors,
      () => ({}),
    );

    const [, name, type] = /^(.*)[/](service|config)[.]yaml$/.exec(rawname)!;

    return {
      ...config,
      type: type as "service" | "config",
      name,
      path,
    };
  } catch (error) {
    console.warn(`${path}: error loading file`, error);
    throw new PardonError(`${path}: error loading file`, error);
  }
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
  configurations: Partial<Configuration & HttpsTemplateConfiguration>[];
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
          //...other
        },
      ) => ({
        // mixin configuration overrides without mergeData().
        // we do it like this so that mixins can specify, for instance:
        //
        // guard:
        //   method:
        //     POST: allowed
        //     PUT: allowed
        //
        // which prevents the mixin from being applied to any other request method.
        config: mixing
          ? {
              ...merged.config,
              ...(config ?? {}),
            }
          : mergeData(merged.config, config ?? {}),
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
        type:
          merged.type === "service" || type === "service"
            ? ("service" as const)
            : ("config" as const),
      }),
      { config: {}, defaults: {}, import: {}, mixin: [] },
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
