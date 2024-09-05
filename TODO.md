# Goals

- Developer Experience

  - [ ] npm workspaces, turbopack or nx integration.

- Release

  - [ ] version 0.1
  - [ ] public npm release

- Importing

  - [ ] swagger / OpenAPI (???)
  - [x] server/proxy
    - [ ] a proper server/proxy that enhances requests

- Functionality

  - [ ] cookie support (cookiejar)
  - [ ] `npm i` support for linking pardon collections?
  - [ ] rejecting matches without exceptions, usually,... and better rejection
        reporting. (mostly done)
  - request chaining `*.flow.https` files
    - [x] in unit tests.
    - [ ] outside of tests
    - [ ] in `favor`
  - [x] unit test runner
    - [ ] add unit-centric reports (which tests were involved with each unit)
    - [ ] load from reports/ directory. (in `favor`)
  - [ ] kv objects-in-arrays could omit the `{}`s and `,`s.
  - [ ] recall available in requests scripts (make a request based on data in a
        prior request or response)

- Fidelity

  - [ ] redact render pass - brainstorm alternative mechanisms that avoid
        matching the rendered output with the schema again (expression results
        might not match pattern regexes)

- Quality of life

  - [ ] command-line shell completion
  - [ ] generate `d.ts` files for `pardon:xyz` modules.
  - [x] assets should be `Record<string, string[]>` so ux can show all layers of
        a file.
  - [ ] detect conflict in value `x=abc` + match `"/{{x}}"` with `"/xyz"`.
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
- [ ] snapshoted resolve and render tests

### Request searching and value autocompletion

- [x] show requests or other values by value(s) in `favor`,
- [ ] support autocompletion with previously used values in some contexts?
- [x] mechanisms for sharing previously used values and their contexts (i.e.,
      request history)... (partial)
  - [x] by data, directly person-to-person

## Refactor-worthy ideas

The following ideas require more than a bullet-point to record, and will take
some significant effort...

### Schema debug view

The schema structure is currently opaque, would be nice to show a display
version of the structure, (and provide hooks to debug the dataflow through the
schema nodes).

### $body.of improvements

We could use javascript syntax to implement some patterns by tranforming
scripts:

```js
$body.of(json({ ... }))
// could be written as
$body == json({
  ...
})
```

and `keyed()`... maybe can be done with syntax too,

```js
keyed({ "k": "{{key}}" }, [...])
{ "k", "{{key}}" } * [...] // single value

keyed.mv({ "k": "{{key}}" }, [...])
{ "k", "{{key}}" } ** [...] // multivalue?
```

maybe we make mix/mux "easier" with

```js
mix([ ... ]) /* becoming */ -[...]
// and
mux([ ... ]) /* becoming */ +[...]
```

(certainly this makes things more subtle but removing the trailing `)` is nice!)
