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
import { mapObject } from "../../util/mapping.js";
import { disarm } from "../../util/promise.js";

/**
 * The pardon executor is an object that executes the steps of a pardon request lazily,
 * and data can be awaited / tapped at any point in the process.
 *
 * The steps (verbs) are init(), match(), [preview()], render(), fetch(), and process().
 * Where preview() is an optional side-quest and processing is always performed after fetch().
 *
 * The continuations/partial results (nouns) are, respectively
 *  - init() -> context,
 *  - match() -> match,
 *  - preview() -> preview,
 *  - render() -> egress,
 *  - fetch() -> ingress, and
 *  - process() -> result.
 */

export type PardonExecutor<Init, Context, Match, Egress, Ingress, Result> = {
  /**
   * Initialize the context based on input (command-line, UX info)
   */
  init(init: Init): Context | Promise<Context>;
  /**
   * Try to match the context against known request patterns,
   * generates the template and determine variables to evaluate.
   *
   * This also contains the values which are inferred via the config block.
   */
  match(info: { context: Context }): Promise<Match>;
  /**
   * A preview render that doesn't evaluate any scripts.
   */
  preview(info: { context: Context; match: Match }): Promise<NoInfer<Egress>>;
  /**
   * Renders the template into a request.
   */
  render(info: { context: Context; match: Match }): Promise<Egress>;
  /**
   * Executes the request, producing a response.
   * (this is where "fetch" happens)
   */
  fetch(info: {
    context: Context;
    match: Match;
    egress: Egress;
  }): Promise<Ingress>;
  /**
   * Process the response, and produce the final result.
   */
  process(info: {
    context: Context;
    match: Match;
    egress: Egress;
    ingress: Ingress;
  }): Promise<Result>;

  error(error: PardonExecutionError, info: any): unknown;
};

export interface PardonContinuations<Context, Match, Egress, Ingress, Result> {
  // init()
  get context(): Promise<Context> &
    PardonContinuations<Context, Match, Egress, Ingress, Result>;
  // match()
  get match(): Promise<Match> &
    PardonContinuations<Context, Match, Egress, Ingress, Result>;
  // preview()
  get preview(): Promise<Egress> &
    PardonContinuations<Context, Match, Egress, Ingress, Result>;
  get egress(): Promise<Egress> &
    PardonContinuations<Context, Match, Egress, Ingress, Result>;
  get ingress(): Promise<Ingress> &
    PardonContinuations<Context, Match, Egress, Ingress, Result>;
  get result(): Promise<Result> &
    PardonContinuations<Context, Match, Egress, Ingress, Result>;

  reprocess(context: Partial<Context>): Promise<Result>;
}

export type PardonExecution<Init, Context, Match, Egress, Ingress, Result> = {
  executor: PardonExecutor<Init, Context, Match, Egress, Ingress, Result>;
  init(
    init: Init,
  ): Promise<Context> &
    PardonContinuations<Context, Match, Egress, Ingress, Result>;
  match(
    init: Init,
  ): Promise<Match> &
    PardonContinuations<Context, Match, Egress, Ingress, Result>;
  preview(
    init: Init,
  ): Promise<Egress> &
    PardonContinuations<Context, Match, Egress, Ingress, Result>;
  render(
    init: Init,
  ): Promise<Egress> &
    PardonContinuations<Context, Match, Egress, Ingress, Result>;
  fetch(
    init: Init,
  ): Promise<Ingress> &
    PardonContinuations<Context, Match, Egress, Ingress, Result>;
  process(
    init: Init,
  ): Promise<Result> &
    PardonContinuations<Context, Match, Egress, Ingress, Result>;
};

export function pardonExecution<
  Init,
  Context,
  Match,
  Request,
  Response,
  Result,
>(
  executor: PardonExecutor<Init, Context, Match, Request, Response, Result>,
): PardonExecution<Init, Context, Match, Request, Response, Result> {
  type Executor = PardonExecutor<
    Init,
    Context,
    Match,
    Request,
    Response,
    Result
  >;
  type Continuations = PardonContinuations<
    Context,
    Match,
    Request,
    Response,
    Result
  >;

  function executeStep<Step extends Exclude<keyof Executor, "error" | "init">>(
    step: Step,
    info: Parameters<Executor[Step]>[0],
  ): ReturnType<Executor[Step]> {
    return executor[step](info as any).catch((error) => {
      const ee = new PardonExecutionError({ cause: error, step, info });
      executor.error(ee, info);
      throw ee;
    }) as ReturnType<Executor[Step]>;
  }

  function start(init: Init) {
    let initializing: Continuations["context"];
    let matching: Continuations["match"];
    let previewing: Continuations["preview"];
    let egress: Continuations["egress"];
    let requesting_: Promise<Response>;
    let ingress: Continuations["ingress"];
    let processing: Continuations["result"];

    function mixin<X extends Promise<unknown>, Y>(
      promise: X,
      descriptors: Y,
    ): X & Y {
      return Object.defineProperties(
        disarm(promise),
        mapObject(
          Object.getOwnPropertyDescriptors(descriptors),
          (descriptor) => ({
            ...descriptor,
            enumerable: false,
            configurable: false,
          }),
        ),
      ) as X & Y;
    }

    return (initializing ??= mixin(Promise.resolve(executor.init(init)), {
      get context() {
        return initializing;
      },
      get match() {
        return match();
      },
      get preview() {
        return match().preview;
      },
      get egress() {
        return match().egress;
      },
      get ingress() {
        return match().egress.ingress;
      },
      get result() {
        return match().egress.ingress.result;
      },
      reprocess,
    }));

    function match() {
      return (matching ??= mixin(
        initializing.then((context) => executeStep("match", { context })),
        {
          context: initializing,
          get match() {
            return matching;
          },
          get preview() {
            return preview();
          },
          get egress() {
            return render();
          },
          get ingress() {
            return render().ingress;
          },
          get result() {
            return render().ingress.result;
          },
          reprocess,
        },
      ));

      function preview() {
        return (previewing ??= mixin(
          Promise.all([initializing, matching]).then(([context, match]) =>
            executeStep("preview", { context, match: match }),
          ),
          {
            context: initializing,
            match: matching,
            preview: previewing,
            get egress() {
              return render();
            },
            get ingress() {
              return render().ingress;
            },
            get result() {
              return render().ingress.result;
            },
            reprocess,
          },
        ));
      }

      function render() {
        return (egress ??= mixin(
          Promise.all([initializing, matching]).then(([context, match]) =>
            executeStep("render", { context, match }),
          ),
          {
            context: initializing,
            match: matching,
            get preview() {
              return preview();
            },
            get egress() {
              return egress;
            },
            get ingress() {
              return fetch();
            },
            get result() {
              return fetch().result;
            },
            reprocess,
          },
        ));

        function fetch() {
          requesting_ ??= Promise.all([initializing, matching, egress]).then(
            ([context, match, egress]) =>
              executeStep("fetch", { context, match, egress }),
          );

          return (ingress ??= mixin(
            requesting_.then(async (result) => {
              await process();
              return result;
            }),
            {
              context: initializing,
              match: matching,
              get preview() {
                return preview();
              },
              egress,
              get ingress() {
                return ingress;
              },
              get result() {
                return process();
              },
              reprocess,
            },
          ));

          function process() {
            return (processing ??= mixin(
              Promise.all([initializing, matching, egress, requesting_]).then(
                ([context, match, egress, ingress]) =>
                  executeStep("process", {
                    context,
                    match,
                    egress,
                    ingress,
                  }),
              ),
              {
                context: initializing,
                match: matching,
                get preview() {
                  return preview();
                },
                egress,
                ingress,
                get result() {
                  return processing;
                },
                reprocess,
              },
            ));
          }
        }
      }
    }

    async function reprocess(reinitial: Partial<Context>) {
      const context = { ...(await initializing), ...reinitial };
      const match = await executeStep("match", {
        context,
      });
      const egress = await initializing.egress;
      const ingress = await initializing.ingress;

      return executeStep("process", {
        context,
        match,
        egress,
        ingress,
      });
    }
  }

  return {
    executor,
    init(init: Init) {
      return start(init);
    },
    match(init: Init) {
      return start(init).match;
    },
    preview(init: Init) {
      return start(init).preview;
    },
    render(init: Init) {
      return start(init).egress;
    },
    fetch(init: Init) {
      return start(init).ingress;
    },
    process(init: Init) {
      return start(init).result;
    },
  };
}

type ErrorSteps = Exclude<
  keyof PardonExecution<any, any, any, any, any, any>,
  "init" | "error" | "executor"
>;

export class PardonExecutionError extends Error {
  step: ErrorSteps;

  constructor({
    cause,
    step,
    info,
  }: {
    cause?: any;
    step: ErrorSteps;
    info?: any;
  }) {
    super(
      info?.match?.endpoint?.configuration?.path
        ? `${info?.match?.endpoint?.configuration?.path} (${step})`
        : `failed at (${step})`,
      { cause },
    );

    this.step = step;
  }

  get formatted() {
    let error = this as any;

    const reasons: string[] = [];

    while (error?.["cause"] !== undefined) {
      error = error["cause"];
      reasons.unshift(String(error?.["message"] ?? error));
    }

    reasons.unshift(String(this?.["message"] ?? this));

    return reasons.join("\n -- ");
  }
}
