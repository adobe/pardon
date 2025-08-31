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

export type { __export_keeper__ } from "../../../types/global-environment.d.ts";

import { AsyncLocalStorage } from "node:async_hooks";
import { join } from "node:path";

import describeCases from "../../core/testcases/index.js";
import { disarm } from "../../util/promise.js";
import type { PardonTestConfiguration } from "./runner.js";

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
        configuration.setup,
        ...descriptions,
        ({ set, format, fun }) => {
          const testcaseFormat = join(
            ...[configuration.prefix, ...name].filter(Boolean),
          );

          set("testcase", format(testcaseFormat));
          fun("trial", `${++smokeCategoryId}/${testcaseFormat}`);
          set(
            "::testexecution",
            async (environment: Record<string, unknown>) => {
              await (null! as Promise<void>);
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

export function withSurveyConfiguration<T>(callback: () => T) {
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

      survey(() => {
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

export function survey(surveyDefinition: () => void | Promise<void>): void;
export function survey(
  nameFormat: string,
  surveyDefinition: () => void | Promise<void>,
): void;
export function survey(
  nameOrSurveyDefinition?: string | { (): void | Promise<void> },
  surveyDefinition?: () => void | Promise<void>,
) {
  if (surveyDefinition) {
    return withCases(nameOrSurveyDefinition as string, surveyDefinition);
  } else {
    return withCases(
      undefined,
      nameOrSurveyDefinition as () => void | Promise<void>,
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
