# Goals

- Developer Experience

  - [ ] npm workspaces, turborepo or nx integration.

- Release

  - [ ] public npm release

- Importing

  - [ ] swagger / OpenAPI (???)

- Functionality

  - [ ] cookie support (cookiejar)
  - [ ] `npm i` support for linking pardon collections? (needs design)
  - [ ] rejecting matches without exceptions, usually,... and better rejection
        reporting. (mostly done)
  - request chaining `*.flow.https` files
    - [x] in unit tests.
    - [x] outside of tests
    - [x] in `favor`
  - [x] unit test runner
    - [ ] add unit-centric reports (which tests were involved with each unit)
    - [ ] load from reports/ directory. (in `favor`)
  - [x] kv objects-in-arrays could omit the `{}`s and `,`s.
  - [ ] recall available in requests scripts (make a request based on data in a
        prior request or response)

- Quality of life

  - [ ] command-line shell completion
  - [ ] generate `d.ts` files for `pardon:xyz` modules.
  - [x] assets should be `Record<string, string[]>` so ux can show all layers of
        a file.
  - [x] detect conflict in value `x=abc` + match `"/{{x}}"` with `"/xyz"`.
        (currently overrides `x=xyz`)

### git-flow request graphs / UX Test Runner

executions (from flow.https executions especially, i.e., unit tests) could
benefit from a gitflow-style graph accompanying a waterfall chart of request
duration.

| gitflow | request          | &lt;- timing waterfall (scrollable column) -&gt; |
| ------- | ---------------- | ------------------------------------------------ |
| `\| `   | https://xyz.com  | `------`                                         |
| `\|\`   | https://pqr.com  | `......------`                                   |
| `.\`    | https://stuv.com | `......-----------`                              |
| `.\|`   | https://mnop.com | `.................----`                          |

### UX Collection and Test editors

Editing pardon collections in app would be a big development/adoption driver.

- [ ] Syntax highlighting / validation
- [ ] Request matching and rendering playground
- [x] Test planner and runner

### Collection unit testing

- [ ] mocking script dependencies

### Request searching and value autocompletion

- [x] show requests or other values by value(s) in `favor`,
- [ ] support autocompletion with previously used values in some contexts?
- [x] mechanisms for sharing previously used values and their contexts (i.e.,
      request history)... (partial)
  - [x] by data, directly person-to-person

### Numeric Source Values

Numbers and bigints are now deserialized with source text attached to boxed
primitives. This works but has some drawbacks w.r.t structuredClone and
electron's context bridge, which fails to copy properties on boxed primitives.
(perhaps our own boxes, with correct valueOf and Symbol.toPrimitive overrides
might work better?)

In scripts, we have choice for numbers to be either be pure
`typeof x === 'number'` javascript values or they can be boxed objects (
`Object.assign(Object(123), { source: '123' })` ) decorated with the source
token text.

Also it would be nice to produce a numeric value that serializes to, e.g.,
`1.90` instead of `1.9`, (the difference may be important in non-standard JSON
contexts for specifying, e.g., the _scale_ of a deserialized
`java.math.BigDecimal`)

The source token would allow scripts to implement semantics on `0.00` or
maintain the exact value of a bigint e.g., `123456789012345678901234567890`, (at
the cost of `===` comparisons).

Perhaps primitive values should always be presented to scripts with another
syntax for source tokens (source tokens might be important to represent as
richer objects, too, tracking more than just their text value for debugging /
reporting purposes, to?).

## Refactor-worthy ideas

The following ideas require more than a bullet-point to record, and will take
some significant effort...

### Schema debug view

The schema structure is intentionally opaque, but it would be nice to show a
display version of the structure, ideally debugging/breakpointing evaluation.
