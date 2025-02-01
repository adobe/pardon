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
import { dirname, join, resolve } from "node:path";
import { readFile, stat } from "node:fs/promises";
import os from "node:os";

import * as YAML from "yaml";

import type {
  AssetParseError,
  Configuration,
  LayeredEndpoint,
  LayeredMixin,
} from "../config/collection-types.js";
import { connectDb, PardonDatabase } from "../db/sqlite.js";
import { loadCollections, buildCollection } from "../config/collection.js";
import createCompiler, { PardonCompiler } from "../runtime/compiler.js";
import { homely } from "../util/resolvehome.js";

import fetchPolyfillReady from "../runtime/init/fetch-polyfill.js";
import { KV } from "./formats/kv-fmt.js";

export type CollectionData = {
  values: Record<string, unknown>;
};

export type AssetType =
  | "config"
  | "data"
  | "mixin"
  | "endpoint"
  | "script"
  | "unknown";
export type AssetSource = { path: string; content: string };
export type AssetInfo = {
  type: AssetType;
  name: string;
  sources: AssetSource[];
};

export type AppContext = {
  config: {
    root: string;
    collections: string[];
  };
  collection: PardonCollection;
  samples?: string[];
  example?: PardonRC["example"];
  compiler: PardonCompiler;
  database?: PardonDatabase;
};

type PardonConfigRC = {
  collections?: string | string[];
  samples?: string | string[];
  example?:
    | string
    | {
        request?: string;
        values?: string | Record<string, unknown>;
      };
  database?: string | false;
};

function* configurationFiles(cwd: string): Iterable<string> {
  let parentdir = cwd;

  do {
    cwd = parentdir;
    yield join(cwd, "pardonrc.yaml");
    yield join(cwd, "package.json");
    yield join(cwd, ".pardon", "pardonrc.yaml");
    parentdir = dirname(cwd);
  } while (parentdir.length < cwd.length);

  yield join(os.homedir(), ".pardon", "pardonrc.yaml");
  yield join(os.homedir(), ".config", "pardon", "pardonrc.yaml");
}

async function loadPardonRC(path: string): Promise<PardonConfigRC | undefined> {
  if (path.endsWith("pardonrc.yaml")) {
    if (
      await stat(path)
        .then((stat) => stat.isFile())
        .catch(() => false)
    ) {
      return YAML.parse(await readFile(path, "utf-8"));
    }
  }

  if (path.endsWith("package.json")) {
    if (
      await stat(path)
        .then((stat) => stat.isFile())
        .catch(() => false)
    ) {
      return JSON.parse(await readFile(path, "utf-8"))?.pardon;
    }
  }

  return;
}

async function discoverPardonRC(
  cwd: string,
): Promise<{ root: string; rc: PardonRC } | undefined> {
  for (const configfile of configurationFiles(cwd)) {
    const root = dirname(configfile);

    try {
      const rc = await loadPardonRC(configfile);
      if (rc) {
        return { root, rc: normalizeRC(rc, root) };
      }
    } catch (error) {
      console.warn(`warning: error loading ${configfile} as pardonrc:`, error);
      // ignore and continue
    }
  }
}

export type PardonAppContextOptions = {
  cwd?: string;
  environment?: Record<string, unknown>;
  sqlite3?: {
    nativeBinding?: string;
  };
};

type PardonRC = Omit<PardonConfigRC, "collections" | "samples" | "example"> & {
  collections: string[];
  samples: string[];
  example: {
    request?: string;
    values?: Record<string, unknown>;
  };
};

function normalizeRC(
  { collections, samples, example, ...rest }: PardonConfigRC,
  root: string,
): PardonRC {
  let request: string | undefined;
  let values: Record<string, unknown> | undefined;

  if (example) {
    if (typeof example == "string") {
      request = example;
    } else {
      request = example.request;
      try {
        values =
          typeof example.values === "string"
            ? KV.parse(example.values, "object")
            : example.values;
      } catch (error) {
        void error;
        values = {};
      }
    }
  }

  return {
    collections: normalizePaths(collections ?? [], root),
    samples: normalizePaths(samples ?? [], root),

    example: {
      request,
      values,
    },
    ...rest,
  };
}

function normalizePaths(paths: string | string[], configdir: string) {
  return [paths]
    .filter(Boolean)
    .flat(1)
    .map((dir) => resolve(configdir, homely(dir)));
}

export async function createPardonApplicationContext(
  options?: PardonAppContextOptions,
): Promise<AppContext> {
  // Node16 support
  await fetchPolyfillReady;

  const {
    rc: {
      collections,
      samples,
      example,
      database: databaseLocation = "./pardon.db",
    },
    root,
  } =
    (await discoverPardonRC(options?.cwd ?? process.cwd())) ??
    ({
      rc: {
        collections: ["//fallback/collection"],
        database: false,
        samples: [],
        example: {},
      },
      root: "//fallback",
    } satisfies { root: string; rc: PardonRC });

  const database =
    databaseLocation === false
      ? await connectDb(":memory:", options?.sqlite3)
      : await connectDb(resolve(root, databaseLocation), options?.sqlite3);
  const layers = await loadCollections(collections);

  return resolvePardonApplicationCollection({
    config: {
      root: root,
      collections,
    },
    layers,
    database,
    samples,
    example,
  });
}

export type PardonCollection = {
  configurations: Record<string, Configuration>;
  endpoints: Record<string, LayeredEndpoint>;
  data: Record<string, CollectionData>;
  mixins: Record<string, LayeredMixin>;
  assets: Record<string, AssetInfo>;
  errors: AssetParseError[];
  /** import "pardon:x" -> assets imported */
  resolutions: Record<string, { path: string; content: string }[]>;
  /** converse of resolutions, required name to import each asset */
  identities: Record<string, string>;
};

export function resolvePardonApplicationCollection({
  config,
  layers,
  database,
  samples,
  example,
}: {
  config: AppContext["config"];
  layers: Awaited<ReturnType<typeof loadCollections>>;
  samples: string[];
  example: PardonRC["example"];
  database?: PardonDatabase;
}) {
  const collection = buildCollection(layers);

  const compiler = createCompiler({
    collection,
  });

  const context: AppContext = {
    config,
    collection,
    compiler,
    database,
    samples,
    example,
  };

  return context;
}
