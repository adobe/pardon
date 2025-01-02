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
 *  - render() -> outbound,
 *  - fetch() -> inbound, and
 *  - process() -> result.
 */

export type PardonExecutor<Init, Context, Match, Outbound, Inbound, Result> = {
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
  preview(info: { context: Context; match: Match }): Promise<NoInfer<Outbound>>;
  /**
   * Renders the template into a request.
   */
  render(info: { context: Context; match: Match }): Promise<Outbound>;
  /**
   * Executes the request, producing a response.
   * (this is where "fetch" happens)
   */
  fetch(info: {
    context: Context;
    match: Match;
    outbound: Outbound;
  }): Promise<Inbound>;
  /**
   * Process the response, and produce the final result.
   */
  process(info: {
    context: Context;
    match: Match;
    outbound: Outbound;
    inbound: Inbound;
  }): Promise<Result>;

  onerror(
    error: any,
    stage: keyof PardonExecutor<
      Init,
      Context,
      Match,
      Outbound,
      Inbound,
      Result
    >,
    info: Partial<
      Parameters<
        PardonExecutor<
          Init,
          Context,
          Match,
          Outbound,
          Inbound,
          Result
        >["process"]
      >[0]
    >,
  ): unknown;
};

export interface PardonContinuations<
  Context,
  Match,
  Outbound,
  Inbound,
  Result,
> {
  // init()
  get context(): Promise<Context> &
    PardonContinuations<Context, Match, Outbound, Inbound, Result>;
  // match()
  get match(): Promise<Match> &
    PardonContinuations<Context, Match, Outbound, Inbound, Result>;
  // preview()
  get preview(): Promise<Outbound> &
    PardonContinuations<Context, Match, Outbound, Inbound, Result>;
  get outbound(): Promise<Outbound> &
    PardonContinuations<Context, Match, Outbound, Inbound, Result>;
  get inbound(): Promise<Inbound> &
    PardonContinuations<Context, Match, Outbound, Inbound, Result>;
  get result(): Promise<Result> &
    PardonContinuations<Context, Match, Outbound, Inbound, Result>;

  reprocess(context: Partial<Context>): Promise<Result>;
}

export type PardonExecution<Init, Context, Match, Outbound, Inbound, Result> = {
  executor: PardonExecutor<Init, Context, Match, Outbound, Inbound, Result>;
  init(
    init: Init,
  ): Promise<Context> &
    PardonContinuations<Context, Match, Outbound, Inbound, Result>;
  match(
    init: Init,
  ): Promise<Match> &
    PardonContinuations<Context, Match, Outbound, Inbound, Result>;
  preview(
    init: Init,
  ): Promise<Outbound> &
    PardonContinuations<Context, Match, Outbound, Inbound, Result>;
  render(
    init: Init,
  ): Promise<Outbound> &
    PardonContinuations<Context, Match, Outbound, Inbound, Result>;
  fetch(
    init: Init,
  ): Promise<Inbound> &
    PardonContinuations<Context, Match, Outbound, Inbound, Result>;
  process(
    init: Init,
  ): Promise<Result> &
    PardonContinuations<Context, Match, Outbound, Inbound, Result>;
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

  function executeStep<
    Step extends Exclude<keyof Executor, "onerror" | "init">,
  >(
    step: Step,
    info: Parameters<Executor[Step]>[0],
  ): ReturnType<Executor[Step]> {
    const result = executor[step](info as any);

    return result.catch((error) => {
      const chained = executor.onerror(error, step, info) ?? error;

      throw chained;
    }) as ReturnType<Executor[Step]>;
  }

  function start(init: Init) {
    let initializing: Continuations["context"];
    let matching: Continuations["match"];
    let previewing: Continuations["preview"];
    let outbound: Continuations["outbound"];
    let requesting_: Promise<Response>;
    let inbound: Continuations["inbound"];
    let processing: Continuations["result"];

    function mixin<X extends Promise<unknown>, Y>(
      object: X,
      descriptors: Y,
    ): X & Y {
      return disarm(
        Object.defineProperties(
          object,
          mapObject(
            Object.getOwnPropertyDescriptors(descriptors),
            (descriptor) => ({
              ...descriptor,
              enumerable: false,
              configurable: false,
            }),
          ),
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
      get outbound() {
        return match().outbound;
      },
      get inbound() {
        return match().outbound.inbound;
      },
      get result() {
        return match().outbound.inbound.result;
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
          get outbound() {
            return render();
          },
          get inbound() {
            return render().inbound;
          },
          get result() {
            return render().inbound.result;
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
            get outbound() {
              return render();
            },
            get inbound() {
              return render().inbound;
            },
            get result() {
              return render().inbound.result;
            },
            reprocess,
          },
        ));
      }

      function render() {
        return (outbound ??= mixin(
          Promise.all([initializing, matching]).then(([context, match]) =>
            executeStep("render", { context, match: match }),
          ),
          {
            context: initializing,
            match: matching,
            get preview() {
              return preview();
            },
            get outbound() {
              return outbound;
            },
            get inbound() {
              return fetch();
            },
            get result() {
              return fetch().result;
            },
            reprocess,
          },
        ));

        function fetch() {
          requesting_ ??= Promise.all([initializing, matching, outbound]).then(
            ([context, match, outbound]) =>
              executeStep("fetch", { context, match, outbound }),
          );

          return (inbound ??= mixin(
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
              outbound,
              get inbound() {
                return inbound;
              },
              get result() {
                return process();
              },
              reprocess,
            },
          ));

          function process() {
            return (processing ??= mixin(
              Promise.all([initializing, matching, outbound, requesting_]).then(
                ([context, match, outbound, inbound]) =>
                  executeStep("process", {
                    context,
                    match,
                    outbound,
                    inbound,
                  }),
              ),
              {
                context: initializing,
                match: matching,
                get preview() {
                  return preview();
                },
                outbound,
                inbound,
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
      const outbound = await initializing.outbound;
      const inbound = await initializing.inbound;

      return executeStep("process", {
        context,
        match,
        outbound,
        inbound,
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
      return start(init).outbound;
    },
    fetch(init: Init) {
      return start(init).inbound;
    },
    process(init: Init) {
      return start(init).result;
    },
  };
}
