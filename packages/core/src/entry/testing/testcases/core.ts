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
import { isBoxedPrimitive } from "node:util/types";

function isAtomic(value: unknown) {
  return typeof value !== "object" || isBoxedPrimitive(value);
}

function atomicEqual(a: unknown, b: unknown) {
  if (
    isBoxedPrimitive(a) &&
    isBoxedPrimitive(b) &&
    a["source"] !== undefined &&
    b["source"] !== undefined
  ) {
    return a["source"] === b["source"];
  }

  return a?.valueOf() === b?.valueOf();
}

const alt = Symbol("alt");
const gen = Symbol("gen");

export type CaseValues = Record<string, any>;

/** The full case context that is passed through the test case generation. */
export type CaseContext = {
  environment: CaseValues;
  defs: Record<string | symbol, Generation | Alternation>;
  parent?: CaseContext;
};

export function normalize(context: CaseContext): Omit<CaseContext, "parent"> {
  if (context.parent) {
    const parent = normalize(context.parent);

    return {
      environment: { ...parent.environment, ...context.environment },
      defs: {
        ...parent.defs,
        ...context.defs,
      },
    };
  }

  return context;
}

/** A Generation object */
export type Generation = {
  [gen](contexts: CaseContext[]): CaseContext[];
};

type Generative = (context: CaseContext) => CaseContext[];

/**
 * The live set of case generators, initialized with one that produces
 * the seed CaseContext.
 *
 * These are manipulated so that only the free/unused ones are left
 * to bundle into a composed generation object for the current context.
 */
let nextGenerations: Generation[] = [];

/** alternations are multi-values that fork (or nullify) the current case context */
export type Alternation = {
  [alt](context: CaseContext): any[];
};

type Alternative = (context: CaseContext) => any[];

function runGenerations<T>(generations: Generation[], fn: () => T): T {
  const currentGenerations = nextGenerations;
  try {
    nextGenerations = generations;
    return fn();
  } finally {
    nextGenerations = currentGenerations;
  }
}

/**
 * runs a function that defines a generation, it can also
 * expand an Alternation or other value if no generations
 * are defined.
 */
export function defineGeneration<T>(
  definition: Generation | { (): T | Generation },
): Generation | T {
  if (isGeneration(definition)) {
    return definition;
  }

  const generations = [];
  const result = runGenerations(generations, definition);

  if (generations.length && generations[0] !== result) {
    return compile(...generations);
  }

  if (isAlternation(result)) {
    return result;
  }

  return compile(...generations);
}

export function desequenced(value: unknown) {
  if (isGeneration(value)) {
    desequence(value);
  } else if (Array.isArray(value)) {
    for (const item of value) {
      desequenced(item);
    }
  } else if (value && !isAtomic(value)) {
    desequenced(Object.values(value));
  }

  return value;
}

/** combines generation steps as a "single step" */
export function compile(...generations: Generation[]): Generation {
  desequenced(generations);

  return {
    [gen](contexts) {
      return generations.reduce((contexts, { [gen]: generator }) => {
        return generator(contexts);
      }, contexts);
    },
  };
}
export function generation(generative: Generative): Generation;
export function generation(
  generative: Generative,
  alternative: Alternative,
): Generation & Alternation;
export function generation(generative: Generative, alternative?: Alternative) {
  return sequence({
    [gen]: (contexts) => contexts.flatMap(generative),
    ...(alternative &&
      ({ [alt]: (context) => alternative(context) } as Alternation)),
  });
}

export function isGeneration(thing: any): thing is Generation {
  return thing
    ? typeof thing === "object" && typeof thing[gen] === "function"
    : false;
}

export function isAlternation(thing: any): thing is Alternation {
  return thing
    ? typeof thing === "object" && typeof thing[alt] === "function"
    : false;
}

// associates the generation with the current generating sequence.
export function sequence<G extends Generation>(thing: G): G;
export function sequence(thing: any) {
  const genera = generate(thing);
  if (isGeneration(genera)) {
    nextGenerations?.push(genera);
  }
  return genera;
}

export function generate(thing: unknown): Generation | Alternation {
  if (typeof thing === "function") {
    return desequence(defineGeneration(thing as any));
  }

  if (isGeneration(thing)) {
    return desequence(thing);
  }

  throw new Error(`cannot regenerate ${typeof thing} (${thing})`);
}

function desequence(thing: Generation) {
  const indexOf = nextGenerations.indexOf(thing);
  if (indexOf !== -1) {
    nextGenerations.splice(indexOf, 1);
  }
  return thing;
}

function alternates(value: unknown, context: CaseContext): any[] {
  context = normalize(context);

  if (!value || isAtomic(value)) {
    return [value];
  }

  if (typeof value[alt] === "function") {
    return value[alt](context).flatMap((value) => alternates(value, context));
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return [[]];

    const [head, ...rest] = value;
    return alternates(head, context).flatMap((z) =>
      alternates(rest, context).map((next) => [z, ...next]),
    );
  }

  if (Object.keys(value).length === 0) {
    return [{}];
  }

  const [[k, v], ...restkv] = Object.entries(value);
  const rest = restkv.reduce(
    (map, [k, v]) => Object.assign(map, { [k]: v }),
    {},
  );

  return alternates(v, context).flatMap((z) =>
    alternates(rest, context).map((restobj) => ({
      [k]: z,
      ...restobj,
    })),
  );
}

// exe - alternates
export function exalternates(
  context: CaseContext,
  alternate: Alternation | unknown,
) {
  return alternates(alternate, context);
}

export function matches(pattern: unknown) {
  return (context: CaseContext) => {
    function matching(pattern: any) {
      if (!pattern || isAtomic(pattern)) {
        return (value: any) => atomicEqual(value, pattern);
      }

      return (value: any) =>
        Object.entries(pattern).every(([k, v]) => matching(v)(value?.[k]));
    }

    return matching(pattern)(normalize(context).environment);
  };
}

/*
 * generalterations produce a dual-use generation / alternation value
 */
export function generalteration<
  Args extends Generation[] | [Alternation] | unknown[],
>(
  selector: (
    ...args: Args
  ) => (context?: CaseContext) => Generation[] | unknown[],
): (...alternates: Args) => Alternation & Generation {
  return (...alternatives: Args): Alternation & Generation => {
    if (alternatives.length === 0) {
      return {
        [alt]: () => [],
        [gen]: () => [],
      } as Alternation & Generation;
    }

    if (
      alternatives.every(
        (value) => typeof value !== "function" && !isGeneration(value),
      )
    ) {
      return {
        [alt]: selector(...alternatives),
      } as Alternation & Generation;
    }

    const options = alternatives.map(generate);
    const selection = selector(...(options as Args)) as () => Generation[];

    return generation((context) =>
      selection().flatMap((generation) => generation[gen]([context])),
    ) as Generation & Alternation;
  };
}

export type Filtration = Generation &
  Alternation & {
    then(
      ..._: any
    ): Generation & Alternation & { else(..._: any): Generation | Alternation };
    else(..._: any): Generation & Alternation;
  };

/**
 * produces an alternation which computes a single value from the context.
 */
function computed(generator: (context: CaseContext) => unknown): Alternation {
  return {
    [alt]: (context) => [generator(context)],
  };
}

/**
 * maps an alternation to another alternation, value-by-value
 */
function reputed(
  generator: (context: CaseContext, value: any) => unknown[],
  values: unknown | Alternation,
): Alternation {
  return {
    [alt]: (context) =>
      alternates(values, context).flatMap((value) => generator(context, value)),
  };
}

function interpret(
  ...genalt:
    | (
        | Generation
        | { (...setup: (Generation | { (): void | Generation })[]): void }
      )[]
    | [Alternation | Generation | { (): void | Generation | Alternation }]
    | unknown[]
) {
  const mapped = genalt.map<Generation>((fn: any) => {
    if (typeof fn === "function") {
      return generate(fn);
    }

    return desequence(fn) as any;
  });

  if (mapped.length === 1) {
    if (isAlternation(mapped[0])) {
      return mapped[0];
    }

    if (!isGeneration(mapped[0])) {
      return computed(() => mapped[0]);
    }
  }

  if (mapped.length > 1 && !mapped.every((item) => isGeneration(item))) {
    throw new Error(
      "testcases cannot intepret a non-singular non-generation value",
    );
  }

  return desequence(compile(...mapped));
}

/**
 * the core implementation of "set":
 * this is where we expand any alternation values into multiple cases
 */
function apply(context: CaseContext, updates: CaseValues | Alternation) {
  const { environment } = context;

  desequenced(updates);

  return alternates(updates, context).flatMap((alternatives) =>
    alternates(
      [
        ...Object.entries(environment).filter(
          ([k]) => !(k in (alternatives as any)),
        ),
        ...Object.entries(alternatives),
      ].reduce((map, [k, v]) => Object.assign(map, { [k]: v }), {}),
      context,
    ).map((environment: CaseValues) => ({ ...context, environment })),
  );
}

export function generateCases(
  descriptionCallback: () => void,
  contexts: CaseContext[] = [
    {
      environment: {},
      defs: {},
    },
  ],
) {
  return runGenerations([{ [gen]: () => contexts }], () =>
    (generate(() => descriptionCallback()) as Generation)[gen](contexts),
  );
}

// ----- internally defined gadgets -----

export function fi(
  test: (
    environment: CaseValues,
    /* private: defs: Record<string | symbol, Generation | Alternation>, */
  ) => boolean | CaseValues | void,
): Filtration;
export function fi(values: CaseValues): Filtration;
export function fi(key: string, value: unknown): Filtration;
export function fi(condition: boolean): Filtration;

export function fi(
  test:
    | boolean
    | string
    | CaseValues
    | {
        (
          environment: CaseValues,
          defs: Record<string | symbol, Generation | Alternation>,
        ): boolean | CaseValues | void;
      },
  value?: unknown,
) {
  if (typeof test === "boolean") {
    // prettier-ignore
    test = ((test) => () => test)(test);
  }

  if (typeof test === "string") {
    test = { [test]: value };
  }

  const filter = (test: CaseValues | boolean) =>
    typeof test === "boolean" ? () => test : matches(test);

  let truth: Generation | Alternation = {
    [gen]: (contexts) => contexts,
    [alt]: () => [],
  };

  // default else action - stops execution.
  let untruth: Generation | Alternation = {
    [gen]: () => [],
    [alt]: () => [],
  };

  let sequenced: Generation & Alternation;

  function filtration(
    test: unknown,
    context: CaseContext,
  ): (CaseValues | boolean)[] {
    return alternates(test, context).flatMap(
      (
        expansion:
          | CaseValues
          | {
              (
                environment: CaseValues,
                defs: Record<string | symbol, Generation | Alternation>,
              ): boolean | CaseValues | void;
            },
      ) => {
        if (typeof expansion === "function") {
          const normalized = normalize(context);
          return filtration(
            expansion(normalized.environment, normalized.defs),
            context,
          );
        }

        return [expansion];
      },
    );
  }

  const ifElse = (sequenced = sequence({
    [gen](contexts) {
      if (!isGeneration(truth) || !isGeneration(untruth)) {
        return contexts;
      }

      return contexts.flatMap((context) => {
        const filtrates = filtration(test, context).filter((filtrate) =>
          filter(filtrate)(context),
        );

        return (filtrates.length ? truth : untruth)[gen]([context]);
      });
    },
    [alt](context) {
      if (!isAlternation(truth) || !isAlternation(untruth)) {
        return [];
      }

      const filtrates = filtration(test, context).filter((filtrate) =>
        filter(filtrate)(context),
      );

      return [(filtrates.length ? truth : untruth)[alt](context)];
    },
    then(...when: Parameters<typeof interpret>) {
      truth = interpret(...when);
      // override the default filter .else action
      untruth = interpret();
      const { then: _if, ...chain } = ifElse;
      desequence(sequenced);
      return sequence((sequenced = chain));
    },
    else(...when: Parameters<typeof interpret>) {
      untruth = interpret(...when);
      const { then: _if, else: _else, ...chain } = ifElse;
      desequence(sequenced);
      return sequence((sequenced = chain));
    },
  }));

  return ifElse;
}

function local(
  ...setup: (
    | Generation
    | { (...setup: (Generation | { (): void | Generation })[]): void }
    | unknown
  )[]
): {
  export(
    ...production: (
      | Generation
      | { (...setup: (Generation | { (): void | Generation })[]): void }
      | unknown
    )[]
  ): Generation;
} {
  const localGeneration = interpret(...setup) as Generation;

  return {
    export: (...production) => {
      const exportGeneration = interpret(...production) as Generation;

      return sequence({
        [gen](contexts) {
          const locals = localGeneration[gen](
            contexts.map((parent) => ({ environment: {}, defs: {}, parent })),
          );

          return exportGeneration[gen](
            locals.map((parent) => ({ environment: {}, defs: {}, parent })),
          ).map(({ environment, defs, parent }) =>
            normalize({ environment, defs, parent: parent!.parent }),
          );
        },
      });
    },
  };
}

function fun(
  name: string | symbol,
  ...behavior:
    | (
        | Generation
        | { (...setup: (Generation | { (): void | Generation })[]): void }
      )[]
    | [Alternation | Generation | unknown]
): Generation {
  const action = interpret(...behavior);

  return generation(({ defs, ...context }) => [
    { defs: { ...defs, [name]: action }, ...context },
  ]);
}

function exe(name: string | symbol) {
  return generation(
    (context) => {
      const action = normalize(context).defs[name];
      if (action === undefined) {
        throw new Error(`exe: ${String(name)} - not fun`);
      }

      if (!isGeneration(action)) {
        return [context];
      }

      return action[gen]([context]);
    },
    (context) => {
      const action = normalize(context).defs[name];

      if (!isAlternation(action)) {
        throw new Error(`exe: ${String(name)} - not a value alternation: `);
      }

      return action[alt](context);
    },
  );
}

function lcg(seed = 1, a = 524287n, c = 1337n, m = 2n ** 29n) {
  let next = BigInt(seed);

  return (n?: number) => Number((next = (next * a + c * BigInt(n ?? 1)) % m));
}

function shuffle(seed = 1) {
  if (seed === 0) {
    // noop
    return () => {};
  }

  const next = lcg(seed);

  return sequence({
    [gen](contexts) {
      const shuffled = [...contexts];

      for (let i = shuffled.length - 1; i >= 0; i--) {
        const j = next() % (i + 1);
        [shuffled[j], shuffled[i]] = [shuffled[i], shuffled[j]];
      }

      return shuffled;
    },
  });
}

export function sort(key: string) {
  return sequence({
    [gen](contexts) {
      return [...contexts].sort((ac, bc) => {
        const a = normalize(ac).environment[key];
        const b = normalize(bc).environment[key];

        if (typeof a === "number" && typeof b === "number") {
          return a - b;
        }

        return String(a).localeCompare(b);
      });
    },
  });
}

function debug(
  identifier: string,
  formatContext?: (context: CaseContext) => unknown,
);
function debug(formatContext?: (context: CaseContext) => unknown);
function debug(
  identifierOrFormat?: string | ((context: CaseContext) => unknown),
  formatContext: (context: CaseContext) => unknown = (context: CaseContext) =>
    normalize(context).environment,
) {
  if (typeof identifierOrFormat === "function") {
    formatContext = identifierOrFormat;
    identifierOrFormat = undefined;
  }

  identifierOrFormat ??= "debug";

  return sequence({
    [gen](contexts) {
      console.info(`----- cases at ${identifierOrFormat} -----`);
      let count = 1;
      for (const context of contexts) {
        console.info(
          ` - ${identifierOrFormat} (${count++}):`,
          formatContext(context),
        );
      }
      return contexts;
    },
  });
}

export function get(key: string | Alternation, def?: unknown) {
  return {
    [alt](context) {
      const normalized = normalize(context);
      return exalternates(normalized, key).flatMap(
        (key) => normalized.environment[key] ?? def,
      );
    },
  } as Alternation;
}

export { computed, reputed, apply, fun, exe, interpret, local, shuffle, debug };
