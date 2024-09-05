# Pardon Modules

These modules are largely 1-1 with the exports in `package.json` backed by the
modules produced via the `rollup.config`.

## The pardon modules

A brief description of the modules and their roles.

### import "pardon"

Provided by `./api.ts` here. Currently a grab-bag of functionality helpful for
writing helper scripts.

repackaging: build this to "./api.js" for runtime access.

### import "pardon/testing"

Methods for defining "units" and validating and/or extracting data from
responses.

### import "pardon/runtime"

Provides the method for initializing the pardon systems.

### import "pardon/loader"

(internal, do not use directly.)

Used internally for initializing the system, needs to be its own artifact.

repackaging: build this to "./loader.js" for runtime access.

### import "pardon/formats"

Provides the pardon formats without the rest of the runtime, (easier to consume
in front-end code than the entire pardon api.)

The exports are also provided in "api".

### import "pardon/utils"

(internal, do not use.)

Sharing some small mapping utilities directly with ux.
