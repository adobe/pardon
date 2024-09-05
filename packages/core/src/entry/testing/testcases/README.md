# TestCase overview

This system generates a list of dictionaries of values: think of an excel
spreadsheet of testcases but where the relationships between the cases are
described. Normally we would define

- for three countries US, JP, and GB, and
- for COM, EDU and GOV customers,
- with offers COM1, COM2, EDU1, EDU2, EDU3, and GOV1, respectively by type,

as a table like this

```cs
US, COM, "COM1,COM2"
US, EDU, "EDU1,EDU2,EDU3"
US, GOV, "GOV1"
JP, COM, "COM1,COM2"
JP, EDU, "EDU1,EDU2,EDU3"
JP, GOV, "GOV1"
GB, COM, "COM1,COM2"
GB, EDU, "EDU1,EDU2,EDU3"
GB, GOV, "GOV1"
```

This is fine, but hard to understand the structure at a glance and unintentional
inconsistencies introduced by maintainance will be indistinguishable from tweaks
required for business reasons.

With testcases, we can define these choices with intent, where adding a country
or modifying a set of offers per segment are in distinct places.

```js
cases(({ set, each }) => {
  set("country", each("US", "JP", "GB"));

  each(
    set({ segment: "COM", offers: ["COM1", "COM2"] }),
    set({ segment: "EDU", offers: ["EDU1", "EDU2", "EDU3"] }),
    set({ segment: "GOV", offers: ["GOV1", "GOV2"] }),
  );
});
```

## Semantics

Test cases are built with "generation" statements, with each generation
transforming the collection of testcases in some way. Additionally "alternation"
values can achieve the same effect.

Testcases start as `[{ ...environment }]`, a single testcase based on the
current `environment` value object, and are extended/filtered by statements.

The most basic statement, `set` applies one or more values to each of the
testcases.

Set can apply to a single key.

```js
set("x", "y");
```

Set can apply to a multiple keys at once.

```js
set({ a: 1, b: "two" });
```

Set can transform the current testcase with arbitrary behavior.

```js
set(({ count, ...env }) => ({ ...env, count: count + 1 }));
```

The `each` statement, applies each of its statements (arguments) to copies of
the testcases, multiplying their number.

For instance, the following splits every testcase into three, setting `x` to
each value of `"a"`, `"b"`, and `"c"`.

```js
each(set("x", "a"), set("x", "b"), set("x", "c"));
```

Alternatively, `each` can be used as an alternation value, with

```js
set("x", each("a", "b", "c"));
```

being equivalent and more compact.

A related and instructive (and somewhat obscure) statement `cycle` operates
similarly, except it

- does not multiply the cases
- advances through its statements on each evaluation.

Consider the example:

```js
set("x", each("a", "b", "c", "d", "e"));
set("z", cycle(1, 2, 3));
```

yields the `(x,z)` pairs: (a,1), (b,2), (c,3), (d,1), and (e,2). cycling the
values of `z` for each successive testcase.

Note that application is not commutitive, as this example

```js
set("z", cycle(1, 2, 3));
set("x", each("a", "b", "c", "d", "e")); // and then for each
```

yields the `(x,z)` pairs: (a,1), (b,1), (c,1), (d,1), and (e,1), because the
first operation transforms `[{}] -> [{z: 1}]`, and then `x` is assigned to each
value on top of that singular test case.

Multiple generation statements-as-arguments can be grouped by putting them in a
function.

The core generation primatives are `set`, `def`, `unset`, `each`, `repeat`,
`robin`, `fi`, `stop`, `counter`, `format`, `fun`, `exe`, `unique`, `local`,
`shuffle`, `smoke`, and `debug`.

### `set`, `def`

Assigns a single value, multiple values, or values computed via a
transformation.

```js
set("key", "value");
set({ key: "value", another: "value" });
set(({ exp }) => ({ exp: exp * 2 }));
```

`def` is the same but does not overwrite existing values.

### `unset`

Unsets keys in the current test environment.

```js
unset("key", ...);
```

### `each`

Expands the test cases with each option, also can be used as an
alternation-value.

```js
each(
  set("x", "y"),
  () => {
    set("x", "z");
    set("p", "q");
  },
  set("s", each("t", "u", "v")),
);

//  { x: "y" },
//  { x: "z", p: "q" }
//  { s: "t" }
//  { s: "u" }
//  { s: "v" }
```

### `repeat`

Repeats testcases `n` ways.

```js
set("x", each("a", "b"));
repeat(3);

// { x: "a" }
// { x: "a" }
// { x: "a" }
// { x: "b" }
// { x: "b" }
// { x: "b" }
```

compare with

```js
repeat(3);
set("x", each("a", "b"));

// { x: "a" }
// { x: "b" }
// { x: "a" }
// { x: "b" }
// { x: "a" }
// { x: "b" }
```

### `robin`

Acts as a round robin for generation statements. Also can be used as a
round-robin value.

```js
repeat(2);

each(
  set("x", "y"),
  () => {
    set("x", "z");
    set("p", "q");
  },
  set("s", each("t", "u", "v")),
);

set("rr", robin("m", "w"));

//  { x: "y", rr: "m" },
//  { x: "z", p: "q", rr: "w" }
//  { s: "t", rr: "m" }
//  { s: "u", rr: "w"  }
//  { s: "v", rr: "m"  }

//  { x: "y", rr: "w" },
//  { x: "z", p: "q", rr: "m" }
//  { s: "t", rr: "w" }
//  { s: "u", rr: "m"  }
//  { s: "v", rr: "w"  }
```

### `fi`

Conditions for test cases. Can be used as a filter or as an if-then-else
expression.

If used alone, it acts to remove test cases that don't satisfy a condition.

```js
set("x", each(1, 2, 3));
set("y", each(1, 2, 3));

fi(({ x, y }) => x + y > 3);

// { x: 1, y: 3 }
// { x: 2, y: 2 }
// { x: 2, y: 3 }
// { x: 3, y: 1 }
// { x: 3, y: 2 }
// { x: 3, y: 3 }
```

Alternatively a map can select specific values (only filtering on the values
present).

```js
fi({ x: 3, y: 2 });
```

If a `.then(...)` and/or `.else(...)` is applied, then the `fi()` ceases to be a
filter, and instead those generation statements are applied when the condition
is true (or false), e.g., this sets `z` to `5` only when x and y are 3 and 4,
respectively.

```js
fi({ x: 3, y: 4 }).then(set("z", 5));
```

Additionally, the `if` construction can also be used as an alternation value, as
well as supporting alternations in the test, such as:

```js
fi({ x: each("a", "b", "c") });
```

### `defi` a combination of `def` and `fi`

`defi` defines values to some set, and also filters the values to not be outside
of that set.

i.e.,

```js
defi({ env: each("stage", "prod") });
// { env: "stage" }
// { env: "prod" }
```

```js
set({ env: "stage" });
defi({ env: each("stage", "prod") });
// { env: "stage" }
```

```js
set({ env: each("stage", "prod", "local") });
defi({ env: each("stage", "prod") });
// { env: "stage" }
// { env: "prod" }
```

You can even specify an additional parameter for additional allowed values. In
the next example, `"stage"` and `"prod"` are the default values but `"local"` is
not filtered out.

```js
set({ env: each("stage", "local") });
defi({ env: each("stage", "prod") }, { env: "local" });
// { env: "stage" }
// { env: "local" }
```

### `stop`

A shorthand for a negative `fi` (for filtering only).

In this example, we discard cases where `x` is greater than `y`.

```js
set("x", each(1, 2));
set("y", each(1, 2));
stop(({ x, y }) => x > y);

// { x: 1, y: 1 }
// { x: 1, y: 2 }
// { x: 2, y: 2 }
```

`stop()` by itself prunes all of the current cases.

### `format`

Formats text templated with the environment. Templates are specified like
"`%xyz`".

For example

```js
set("xyz", each("x", "y", "z"));
set("f", format("xyz is %xyz"));

// { xyz: "x", f: "xyz is x" }
// { xyz: "y", f: "xyz is y" }
// { xyz: "z", f: "xyz is z" }
```

As a shorthand of the above, format also provides a 2 argument generator version

```js
set("xyz", each("x", "y", "z"));
format("f", "xyz is %xyz");

// { xyz: "x", f: "xyz is x" }
// { xyz: "y", f: "xyz is y" }
// { xyz: "z", f: "xyz is z" }
```

### `fun` / `exe`

`fun` defines generation statements or alternation values for later use with
`exe`.

This can be helpful to decouple definitions from usage and control evaluation
order without sacrificing code locality.

```js
fun("define-abc", () => {
  // exe("define-abc") runs this
  set("abc", exe("xyz")); // exe("xyz") could be each("x", "y", "z") or each("p", "q")
});
set("env", each("stage", "prod"));
fun("xyz", each("x", "y", "z"));
fi({ env: "stage" }).then(fun("xyz", each("p", "q")));

exe("define-abc");

// { env: 'stage', abc: 'p' }
// { env: 'stage', abc: 'q' }
// { env: 'prod', abc: 'x' }
// { env: 'prod', abc: 'y' }
// { env: 'prod', abc: 'z' }
```

### `unique`

Filters out duplicate cases, keyed on either a stable JSON-like serialization or
custom hash function.

### `shuffle` / `smoke`

Turns complete integration test cases into smaller smoke tests.

- `shuffle` permutes the test case set, semi-randomly (according to a seed)
- `smoke` runs tests once (or more) with each value of each key.

Suppose we have a set of 18 testcases defined with

```js
set("country", each("US", "MX", "CA"));
set("vendor", each("visa", "mastercard"));
set("operation", each("authorize", "capture", "refund"));
```

and we want to run at least one for each `country`, `vendor`, and `operation`,
but not every combination.

If we just add

```js
smoke();
```

then the smoke filter will pick a lot more tests with the earlier choices.

```js
// { country: 'US', vendor: 'visa', operation: 'authorize' }
// { country: 'US', vendor: 'visa', operation: 'capture' }
// { country: 'US', vendor: 'visa', operation: 'refund' }
// { country: 'US', vendor: 'mastercard', operation: 'authorize' }
// { country: 'MX', vendor: 'visa', operation: 'authorize' }
// { country: 'CA', vendor: 'visa', operation: 'authorize' }
```

if we add both `shuffle()` and `smoke()` to the picture.

```js
shuffle(); // randomizes the order of the cases
smoke(); // covers all values with a subset of the tests
```

we get this order, which covers each feature once, which is better than 18 tests
but not optional

```js
// { country: 'CA', vendor: 'mastercard', operation: 'capture' }
// { country: 'US', vendor: 'visa', operation: 'capture' }
// { country: 'CA', vendor: 'visa', operation: 'refund' }
// { country: 'MX', vendor: 'visa', operation: 'refund' }
// { country: 'CA', vendor: 'visa', operation: 'authorize' }
```

But it's one less test and a little bit more well-balanced on the operations.

With a different seed for shuffle

```js
shuffle(34);
smoke();
```

we happen to find that just three test cases can cover every kind of value!

```js
// { country: 'CA', vendor: 'mastercard', operation: 'authorize' },
// { country: 'US', vendor: 'visa', operation: 'capture' },
// { country: 'MX', vendor: 'visa', operation: 'refund' }
```

When running the pardon-test system, you can specify a smoke filter with
`--smoke=key1,key2,key3` which applies per test,
`--smoke=key1,key2%perkey1,perkey2` which applies per `perkey1,perkey2` ...
values. A shuffle seed can be added with `~<number>`, `~0` will disable
shuffling, (`~1` is the assumed default.). So to run a single deteriminstically
random test, you can try `--smoke=%~1`.

In the test config `closing() {}` method, the smoke operation will be
independent per-trial. You can also add additional `.per` keys with, say
`smoke(...).per("env")` to compute the smoke set independently per `env` value.

### `debug`

You can use `debug` to display the testcases generated by a particular point in
the testcase flow.

For instance, the following debug statement

```ts
set("x", each("a", "b", "c"));
set("y", counter(1));
debug("something");
...
```

Yields the following via `console.info()`

```js
----- cases at something -----
 - something (1): { x: 'a', y: 1 }
 - something (2): { x: 'b', y: 2 }
 - something (3): { x: 'c', y: 3 }
```
