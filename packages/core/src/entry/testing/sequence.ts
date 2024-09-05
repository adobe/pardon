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
import * as acorn from "acorn";
import {
  arrayIntoObject,
  definedObject,
  mapObject,
} from "../../util/mapping.js";
import { shared } from "../../core/async.js";
import { valueId } from "../../util/value-id.js";
import { disarm } from "../../util/promise.js";
import { UnitOrFlowName } from "../../core/formats/https-fmt.js";

declare let environment: Record<string, any>;

export type UnitParamBase = { required: boolean };
export type UnitParamsItem = UnitParamBase & { name: string };
export type UnitParam = UnitParamsDict | UnitParamsList | UnitParamsItem;
export type UnitParamsList = UnitParamBase & {
  list: UnitParam[];
  rested?: string;
};

export type UnitParamsDict = UnitParamBase & {
  dict: Record<string, UnitParam>;
  rested?: string;
};

function isList(param: UnitParam): param is UnitParamsList {
  return "list" in param;
}

function isDict(param: UnitParam): param is UnitParamsDict {
  return "dict" in param;
}

function isItem(param: UnitParam): param is UnitParamsItem {
  return "name" in param;
}

export type UnitOptions = { target?: string };

type UnitFn = (
  values: Record<string, any>,
) => Promise<void | undefined | Record<string, any>>;

type FlowAction = {
  path: string;
  action: (
    values: Record<string, unknown>,
    key: string,
  ) => Promise<Record<string, any>>;
  params: UnitParamsDict;
};

const units: Record<string, FlowAction> = {};
const flows: Record<string, FlowAction> = {};
const executions: Record<string, Promise<Record<string, any>>> = {};

export function sequenceRegistry() {
  const registry = mapObject({ units, flows }, (sequences) =>
    mapObject(sequences, ({ path }) => path),
  );

  return registry as Pick<typeof registry, "units" | "flows">;
}

const pardonTestingSym = Symbol.for("pardon:testing");

if (globalThis[pardonTestingSym]) {
  throw new Error("pardon module cannot be initialized twice!", {
    cause: globalThis[pardonTestingSym],
  });
}

globalThis[pardonTestingSym] = new Error("previously initialized here");

let executeCallback: <T>(_: Promise<T>) => Promise<T> = (p) => p;

export function onExecute(callback: typeof executeCallback) {
  executeCallback = (promise) => disarm(callback(promise));
}

export function createUnit(name: `${string}.unit`, fn: UnitFn) {
  if (!name.endsWith(".unit")) {
    throw new Error("createUnit expects name to end with .unit: " + name);
  }

  return registerUnit(name.slice(0, -".unit".length), {
    path: "script",
    params: parseParams(fn),
    async action(values = {}) {
      await Promise.resolve();

      return (await fn(values)) || {};
    },
  });
}

export function registerFlow(name: string, info: FlowAction) {
  flows[name] = info;
}

export function registerUnit(name: string, info: FlowAction) {
  units[name] = info;
}

export function execute(
  name: UnitOrFlowName,
  context?: Record<string, unknown>,
): Promise<Record<string, any>> {
  if (name.endsWith(".unit")) {
    return executeUnit(name.slice(0, -".unit".length), context);
  } else if (name.endsWith(".flow")) {
    return executeFlow(name.slice(0, -".flow".length), context);
  }

  throw new Error("execute only supports .unit and .flow sequences");
}

function executeUnit(
  name: string,
  context?: Record<string, unknown>,
): Promise<Record<string, any>> {
  return executeCallback(
    runUnit(name, context).then((result) => {
      if (result) {
        environment = result;
      }
      return result;
    }),
  );
}

export function runUnit(
  name: string,
  context?: Record<string, unknown>,
): Promise<Record<string, any>> {
  if (!units[name]) {
    throw new Error(`executeUnit(${JSON.stringify(name)}): unit not defined`);
  }

  const { action, params } = units[name];

  const values = composeValuesDict(params, context, { ...environment });

  const key = `${name}::${valueId(values)}`;
  let execution = executions[key];

  if (!execution) {
    console.info(`-- unit start: ${key}`);

    execution = executions[key] = shared(async () => {
      return await action(values, key);
    });

    execution.then(
      () => {
        console.info(`-- unit done: ${key}`);
      },
      (err) => {
        console.info(`-- unit fail: ${key}`);
        console.error(`Error in unit: ${key}`, err);
      },
    );
  }

  return execution;
}

let flowKeySeed = Date.now();

function executeFlow(
  name: string,
  context?: Record<string, unknown>,
): Promise<Record<string, any>> {
  if (!flows[name]) {
    throw new Error(`executeFlow(${JSON.stringify(name)}): flow not defined`);
  }

  const { action, params } = flows[name];

  const values = composeValuesDict(params, context, { ...environment });

  return executeCallback(
    action(values, `F${flowKeySeed++}`).then((result) => {
      if (result) {
        environment = result;
      }

      return result;
    }),
  );
}

export function composeValuesDict(
  params: UnitParamsDict,
  options?: Record<string, any>,
  environment?: Record<string, any>,
  required = params.required,
) {
  const values = definedObject(
    mapObject(params.dict, (item, name) => {
      return composeParam(
        item,
        options?.[name],
        environment?.[name],
        required && item.required,
      );
    }),
  );

  if (typeof params.rested === "string") {
    return { ...options, ...values };
  }

  return values;
}

function composeValuesList(
  params: UnitParamsList,
  options?: any[],
  env?: any[],
  required = params.required,
) {
  if (options !== undefined && !Array.isArray(options)) {
    return undefined;
  }
  if (options === undefined && env !== undefined && !Array.isArray(env)) {
    return undefined;
  }

  const values = params.list.map((item, idx) => {
    return composeParam(
      item,
      options?.[idx],
      environment?.[idx],
      required && item.required,
    );
  });

  if (params.rested) {
    return [values, ...(options?.slice(values.length) || [])];
  }

  return values;
}

function composeParam(
  param: UnitParam,
  option: any,
  env: any,
  required: boolean,
) {
  if (isDict(param)) {
    return composeValuesDict(param, option, env, required);
  }
  if (isList(param)) {
    return composeValuesList(param, option, env, required);
  }
  if (isItem(param)) {
    const value = option ?? env;
    if (value === undefined && required && param.required) {
      throw new Error(`required param ${param.name} undefined`);
    }
    return value;
  }

  console.error("confusion about param", param);
  throw new Error("confused");
}

export function extractValuesDict(
  params: UnitParamsDict,
  values: Record<string, any>,
) {
  const result = arrayIntoObject(Object.entries(params.dict), ([k, m]) => {
    const v = values?.[k];
    if (v === undefined) {
      return;
    }

    if (isItem(m)) {
      return { [m.name]: v };
    }

    if (isDict(m)) {
      return extractValuesDict(m, v);
    }

    if (isList(m)) {
      if (v && !Array.isArray(v)) {
        throw new Error("expected array");
      }

      return extractValuesList(m, v);
    }

    throw new Error("unknown param type to extract");
  });

  if (params.rested) {
    result[params.rested] = mapObject(values ?? {}, {
      filter(key) {
        return !(key in params.dict);
      },
    });
  }

  return result;
}

export function injectValuesDict(
  params: UnitParamsDict,
  values: Record<string, any>,
) {
  const result = definedObject(
    mapObject(params.dict, (m) => {
      if (isItem(m)) {
        return values[m.name];
      }

      if (isDict(m)) {
        return injectValuesDict(m, values);
      }

      if (isList(m)) {
        throw new Error("unimplemented: inject array values");
      }

      throw new Error("unknown param type to inject");
    }),
  );

  if (params.rested) {
    return { ...values[params.rested], ...result };
  }

  return result;
}

export function ejectValuesDict(
  params: UnitParamsDict,
  values: Record<string, any> | undefined,
) {
  const result = definedObject(
    mapObject(params.dict, {
      keys(k, m) {
        if (isItem(m)) {
          return m.name;
        }
        return k;
      },
      values(m, k) {
        if (isItem(m)) {
          return values?.[k];
        }

        if (isDict(m)) {
          return ejectValuesDict(m, values);
        }

        if (isList(m)) {
          throw new Error("unimplemented: inject array values");
        }

        throw new Error("unknown param type to inject");
      },
    }),
  );

  if (params.rested) {
    return { ...values?.[params.rested], ...result };
  }

  return result;
}

function extractValuesList(params: UnitParamsList, values: any[]) {
  void params;
  void values;
  throw new Error("unimplemented");
}

function parseParams(fn: UnitFn) {
  if (fn.length === 0) {
    return { dict: {}, required: false };
  }

  if (fn.length > 2) {
    throw new Error(
      "unit functions can take at most one destructured argument, and one options arg",
    );
  }

  const ast = acorn.parse(String(fn), { ecmaVersion: 2022 });

  const pattern =
    ast.body[0].type === "ExpressionStatement"
      ? ((ast.body[0].expression as acorn.ArrowFunctionExpression)
          .params[0] as acorn.ObjectPattern)
      : ((ast.body[0] as acorn.FunctionDeclaration)
          .params[0] as acorn.ObjectPattern);

  if (pattern.type !== "ObjectPattern") {
    throw new Error(
      "expected an ObjectPattern for the first argument of the unit",
    );
  }

  return parseParamObjectPattern(pattern, true);

  function parseParamObjectPattern(
    pattern: acorn.ObjectPattern,
    required: boolean,
  ) {
    return pattern.properties.reduce<UnitParamsDict>(
      (result, property) => {
        if (property.type === "RestElement") {
          if (property.argument.type !== "Identifier") {
            throw new Error("confused by rest element");
          }
          result.rested = property.argument.name;
        } else
          switch (property.key.type) {
            case "Identifier":
              switch (property.value.type) {
                case "ObjectPattern":
                  result.dict[property.key.name] = parseParamObjectPattern(
                    property.value,
                    true,
                  );
                  break;
                case "ArrayPattern":
                  result.dict[property.key.name] = parseParamArrayPattern(
                    property.value,
                    true,
                  );
                  break;
                case "Identifier":
                  result.dict[property.key.name] = {
                    name: property.value.name,
                    required: true,
                  };
                  break;

                case "AssignmentPattern":
                  switch (property.value.left.type) {
                    case "Identifier":
                      result.dict[property.key.name] = {
                        name: property.value.left.name,
                        required: false,
                      };
                      break;
                    case "ObjectPattern":
                      result.dict[property.key.name] = parseParamObjectPattern(
                        property.value.left,
                        false,
                      );
                      break;
                    case "ArrayPattern":
                      result.dict[property.key.name] = parseParamArrayPattern(
                        property.value.left,
                        false,
                      );
                      break;
                    default:
                      throw new Error("confused");
                  }
                  break;
                default:
                  throw new Error("confused");
              }
              break;
            default:
              throw new Error("confused");
          }

        return result;
      },
      { dict: {}, required },
    );
  }

  function parseParamArrayPattern(
    pattern: acorn.ArrayPattern,
    required: boolean,
  ) {
    return pattern.elements.reduce<UnitParamsList>(
      (result, element, idx) => {
        if (!element) {
          return result;
        }
        if (element.type === "RestElement") {
          if (element.argument.type !== "Identifier") {
            throw new Error("confused by rest element");
          }
          result.rested = element.argument.name;
        } else
          switch (element.type) {
            case "ObjectPattern":
              result.list[idx] = parseParamObjectPattern(element, true);
              break;
            case "ArrayPattern":
              result.list[idx] = parseParamArrayPattern(element, true);
              break;
            case "Identifier":
              result.list[idx] = {
                name: element.name,
                required: true,
              };
              break;

            case "AssignmentPattern":
              switch (element.left.type) {
                case "Identifier":
                  result.list[idx] = {
                    name: element.left.name,
                    required: false,
                  };
                  break;
                case "ObjectPattern":
                  result.list[idx] = parseParamObjectPattern(
                    element.left,
                    false,
                  );
                  break;
                case "ArrayPattern":
                  result.list[idx] = parseParamArrayPattern(
                    element.left,
                    false,
                  );
                  break;
                default:
                  throw new Error("confused");
              }
              break;
            default:
              throw new Error("confused");
          }

        return result;
      },
      { list: [], required },
    );
  }
}
