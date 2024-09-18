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
import { AsyncLocalStorage } from "node:async_hooks";
import { join } from "node:path";

import describeCases from "./testcases/index.js";
import { disarm } from "../../util/promise.js";
import { PardonTestConfiguration } from "./cli/runner.js";

declare global {
  let environment: Record<string, any>;
}

const pendingRegistrationTasks: Promise<unknown>[] = [];

type RegisteredTrial = {
  name: string[];
  descriptions: TestcaseDescription[];
  definition: (environment: Record<string, any>) => void | Promise<void>;
};

type TestcaseDescription = Parameters<typeof describeCases>[0];

const trialRegistry: RegisteredTrial[] = [];

export function runRegistrationTask<T>(action: () => Promise<T>): Promise<T>;
export function runRegistrationTask<T>(action: () => T): T;
export function runRegistrationTask<T>(
  action: () => T | Promise<T>,
): T | Promise<T> {
  try {
    const task = action();

    if (typeof (task as Promise<T>)?.then === "function") {
      pendingRegistrationTasks.push(disarm(task as Promise<T>));
    }

    return task;
  } catch (error) {
    pendingRegistrationTasks.push(disarm(Promise.reject(error)));
    throw error;
  }
}

export async function flushTrialRegistry(
  configuration: PardonTestConfiguration,
) {
  while (pendingRegistrationTasks.length) {
    await Promise.all(
      pendingRegistrationTasks.splice(0, pendingRegistrationTasks.length),
    );
  }

  return trialRegistry
    .splice(0, trialRegistry.length)
    .map(({ name, descriptions, definition }) => ({
      descriptions: [
        configuration.opening,
        ...descriptions,
        ({ set, format, fun }) => {
          const testcaseFormat = join(
            ...[configuration.gamut, ...name].filter(Boolean),
          );

          set("testcase", format(testcaseFormat));
          fun("trial", `${++smokeCategoryId}/${testcaseFormat}`);
          set(
            "::testexecution",
            async (environment: Record<string, unknown>) => {
              await Promise.resolve();
              return await definition(environment);
            },
          );
        },
      ].filter(Boolean),
    }));
}

const gamutHolder = new AsyncLocalStorage<{
  name: string[];
  descriptions: TestcaseDescription[];
}>();

export function withGamutConfiguration<T>(callback: () => T) {
  return gamutHolder.run(
    {
      name: [],
      descriptions: [],
    },
    callback,
  );
}

export function cases(description: Parameters<typeof describeCases>[0]) {
  const { descriptions } = gamutHolder.getStore()!;

  descriptions.push(description);

  return {
    trial(...args: Parameters<typeof trial>) {
      const popped = descriptions.pop();
      // sanity check that called cases().trial()
      if (popped !== description) {
        throw new Error("cases.trial invoked late");
      }

      gamut(() => {
        cases(description);
        trial(...args);
      });
    },
  };
}

function withCases(name: string | undefined, callback: () => void): void;
function withCases(
  name: string | undefined,
  callback: () => Promise<void>,
): Promise<void>;
function withCases(
  name: undefined | string,
  callback: () => void | Promise<void>,
) {
  const gamutContext = gamutHolder.getStore()!;

  return runRegistrationTask(() =>
    gamutHolder.run(
      {
        ...gamutContext,
        name: [...(gamutContext.name || []), ...(name ? [name] : [])],
        descriptions: [...(gamutContext.descriptions || [])],
      },
      callback,
    ),
  );
}

export function gamut(gamutDefinition: () => void | Promise<void>): void;
export function gamut(
  nameFormat: string,
  gamutDefinition: () => void | Promise<void>,
): void;
export function gamut(
  nameOrGamutDefinition?: string | { (): void | Promise<void> },
  gamutDefinition?: () => void | Promise<void>,
) {
  if (gamutDefinition) {
    return withCases(nameOrGamutDefinition as string, gamutDefinition);
  } else {
    return withCases(
      undefined,
      nameOrGamutDefinition as () => void | Promise<void>,
    );
  }
}

let smokeCategoryId = 0;

function registerTest(
  testDefinition: (environment: Record<string, any>) => void | Promise<void>,
) {
  const { name, descriptions } = gamutHolder.getStore()!;

  trialRegistry.push({
    name,
    // -- we could collect stack trace and other info for debugging support?
    descriptions: [...descriptions],
    definition: testDefinition,
  });
}

export type TrialFunction = (
  environment: Record<string, any>,
) => void | Promise<void>;

export function trial(trialFunction: TrialFunction): void;
export function trial(nameFormat: string, trialFunction: TrialFunction): void;
export function trial(
  nameOrTrial: string | TrialFunction,
  trialFunction?: TrialFunction,
) {
  if (trialFunction) {
    return withCases(nameOrTrial as string, () =>
      registerTest((env) => {
        environment = env;
        return trialFunction(env);
      }),
    );
  } else {
    return withCases(undefined, () =>
      registerTest((env) => {
        environment = env;
        return (nameOrTrial as TrialFunction)(env);
      }),
    );
  }
}
