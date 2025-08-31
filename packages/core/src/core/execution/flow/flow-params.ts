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
import * as acorn from "acorn";
import type { HttpsFlowContext } from "../../formats/https-fmt.js";
import type { FlowFunction } from "./flow-core.js";
import {
  arrayIntoObject,
  definedObject,
  mapObject,
} from "../../../util/mapping.js";

export type FlowParamBase = { required: boolean };
export type FlowParamsItem = FlowParamBase & { name: string };
export type FlowParam = FlowParamsDict | FlowParamsList | FlowParamsItem;
export type FlowParamsList = FlowParamBase & {
  list: FlowParam[];
  rested?: string;
};

export type FlowParamsDict = FlowParamBase & {
  dict: Record<string, FlowParam>;
  rested?: string;
};

function isList(param: FlowParam): param is FlowParamsList {
  return "list" in param;
}

function isDict(param: FlowParam): param is FlowParamsDict {
  return "dict" in param;
}

function isItem(param: FlowParam): param is FlowParamsItem {
  return "name" in param;
}

export function contextAsFlowParams(
  context: HttpsFlowContext,
  definitions: Record<string, true | string> = {},
): FlowParamsDict {
  if (typeof context === "string") {
    context = context.split(/\s*,\s*/);
  }

  const params: FlowParamsDict = { dict: {}, required: false };

  for (let item of context) {
    // allow "x: y" as a synonym of "x as y"
    if (
      item &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      Object.keys(item).length === 1 &&
      typeof item[Object.keys(item)[0]] === "string"
    ) {
      const [[k, v]] = Object.entries(item);

      item = `${k} as ${v}`;
    }

    if (typeof item === "string") {
      if (item.startsWith("...")) {
        definitions[(params.rested = item.slice(3).trim())] = true;
      } else {
        const [, name, question, value, expression] =
          /([\w-]+)([?]?)(?:\s+as\s+([\w-]+))?(?:(?:\s+default\s+|\s*=\s*)((?=\S).*))?$/.exec(
            item.trim(),
          )!;

        params.dict[name] = {
          name: value ?? name,
          required: !question,
        };
        definitions[value ?? name] = expression ?? true;
      }
    } else if (Array.isArray(item)) {
      throw new Error("unexpected array in context");
    } else if (typeof item === "object") {
      const [[k, v], ...other] = Object.entries(item);
      if (other.length) {
        throw new Error("unexpected");
      }
      params.dict[k] = contextAsFlowParams(v, definitions);
    } else throw new Error("unexpected non-object in context: " + typeof item);
  }

  return params;
}

function composeParam(
  param: FlowParam,
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
  params: FlowParamsDict,
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
  params: FlowParamsDict,
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
  params: FlowParamsDict,
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

function extractValuesList(params: FlowParamsList, values: any[]) {
  void params;
  void values;
  throw new Error("unimplemented");
}

export function flowFunctionSignature(fn: FlowFunction) {
  if (fn.length === 0) {
    return { dict: {}, required: false };
  }

  if (fn.length > 2) {
    throw new Error(
      "unit functions can take at most one destructured argument, and one options arg",
    );
  }

  const ast = acorn.parse(`(${fn})`, { ecmaVersion: 2022 });

  const pattern =
    ast.body[0].type === "ExpressionStatement"
      ? ((ast.body[0].expression as acorn.ArrowFunctionExpression)
          .params[0] as acorn.ObjectPattern)
      : ((ast.body[0] as acorn.FunctionDeclaration)
          .params[0] as acorn.ObjectPattern);

  if (pattern.type !== "ObjectPattern") {
    throw new Error(
      "expected an ObjectPattern for the first argument of the flow function",
    );
  }

  return parseParamObjectPattern(pattern, true);

  function parseParamObjectPattern(
    pattern: acorn.ObjectPattern,
    required: boolean,
  ) {
    return pattern.properties.reduce<FlowParamsDict>(
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
    return pattern.elements.reduce<FlowParamsList>(
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

export function composeValuesDict(
  params: FlowParamsDict,
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
  params: FlowParamsList,
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
      env?.[idx],
      required && item.required,
    );
  });

  if (params.rested) {
    return [values, ...(options?.slice(values.length) || [])];
  }

  return values;
}
