# Pardon

A batteries-included and very polite REST client that does what you want.

Collections are file-based, self-documenting, and securely sharable by default.

The AI (Adam's Incorrigibility) powered scriptable template matching and
rendering system converts request template pseudocode into actual http requests,
and the same framework power running your gamuts of functional testcases.

## Quick start

This is primarily a source distribution in pure node module code, developed in
Node20 with support for older node versions in some modes (for... reasons).

For running from source (this rep), the fastest path to get the application
running is,

- `git clone https://github.com/adobe/pardon.git` and `cd pardon`
- `npm install`
- `npm install --prefix=packages/core`
- `npm install --prefix=packages/favor`
- `npm run package --prefix=packages/favor`
- find the application in `packages/favor/out/...`.

To use pardon globally as a script, in the packages/core directory either run

- `npm link .` (yes the dot too), or
- `npm install . --global`

To remove the installation of pardon, use `npm uninstall -g pardon` (this works
for both the `link` and `install --global` flavors).

## Quickstart

Pardon comes with a `default/default` endpoint that allows any request through.

Collections can specify specific endpoints that pardon will call.

Collections are organized in folders (services), the special `default` service
being checked if a request doesn't match any other endpoint. Similarly, the
special `default` endpoint of a service is the fallback for unmatched requests
that otherwise match the service rules (usually based on the server origin).

### Workspaces

To enable pardon to save a history of requests and responses, and to specify
collection folders, have a `pardonrc.yaml` file or add a `"pardon": { ... }`
section to a `package.json`. This will mark the workspace root. Pardon will
create a `pardon.db` file there.

When specifying a workspace folder, pardon will search up until it finds a
workspace root, falling back to a home-directory `~/.pardon/pardonrc.yaml` or
`~/.config/pardon/pardonrc.yaml`.

The schema for the `pardonrc.yaml`/`package.json` field is the same.

Collections can be specified by relative paths, e.g.,

```yaml
collections:
  - ./collection/
```

Now create the following files:

`./collection/example/ping.https` with the contents

```
>>>
GET https://example.com/ping
```

`./collection/example/service.yaml` with the contents

```
config:
  origin:
    env:
      stage: https://stage.example.com
      prod: https://example.com
```

To get a sense of how configuration applies, try running

- `pardon https://example.com/ping --http`,
- `pardon https://example.com/ping --http env=stage`
- `pardon https://stage.example.com --http`
- `pardon https://stage.example.com --http env=prod`

Now change things to something useful to you and try running without the
`--http` to actually run a request.

You can also build `favor`, set the context appropriately (menu), and enter the
same as, e.g.,

```
env=stage
https://example.com/ping
```

in the main input.

## Goals

Pardon is reaching for various goals.

1. Toil and noise reduction.
2. Secure-by-default flows for developers.
3. Transparent parameterization.
4. Useful and searchable logging.
5. Scripting throughout.
6. Integration testing and operational support.

## Thanks!

Thank you to all our internal early adopters, the entire javascript ecosystem,
and (in no particular order)

- [NodeJS](https://nodejs.org) and [Electron](https://www.electronjs.org/) for
  the overall platform.
- [Typescript](https://www.typescriptlang.org/),
  [ts-morph](https://ts-morph.com/), and
  [acorn](https://github.com/acornjs/acorn) for the scripting engine.
- [Rollup](https://rollupjs.org/), [tsx](https://github.com/privatenumber/tsx),
  [eslint](https://eslint.org/), and [prettier](https://prettier.io/) for an
  excellent dev and build environment.
- [SolidJS](https://www.solidjs.com/) and [Corvu](https://corvu.dev/)
- [Astro](https://astro.build/) for making documentation almost enjoyable to
  write.
- [patch-package](https://github.com/ds300/patch-package) for the things I
  cannot change (upstream).
- and [Adobe](https://www.adobe.com/) for letting me cook on this project.
