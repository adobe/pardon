# Pardon testing

These files provide supporting helpers for integration testing in pardon.

Unit tests are, by default, files named `xyz.pardon.ts` which run with the same
runtime as helpers, with the addition of a global `environment` object which
expresses data that has been assigned to it through "await" / promise chains.

Comments inline:

```ts
async function slow() {
  await delay(1000); // wait 1 second
  environment.x = "slow";
}

function run() {
  const slowPromise = slow();
  await delay(5000); // wait 5 seconds (slow() has certainly finished by now)

  // the environment.x = "slow"; assignment has been executed,
  // but as we haven't awaited it yet,
  console.log(environment.x); // we get undefined still

  await slowPromise;
  console.log(environment.x); // now we should see "slow"
}
```

Because `await` syntax is lexical and not determined by runtime characteristics,
this environment object can transfer data between different async operations in
a stable manner, irrelevant of the performance characteristics of the test.

(The downside is that the mechanisms involved leak memory and need to be
repeatedly reset/clear or used in short-lived processes like test runners).

Overall the environment provides a mechanism to automatically ferry data between
units, similar to the environment object of popular test runners, but with the
ability to start multiple tests in parallel which share resources and setups
(units) yet propagate data independently of each other.

## Https flows (and units)

An https flow is similar to the https files which configure the collections.
It's composed of a configuration (yaml) which declares how data flows into and
out of the request, followed by a sequence of request and response patterns.

Unlike the collection https files which are matched to an input: and ultimately
execute a single request and match against a single result, https flow files are
a script of requests and responses, capable of simple matching and loops.

Each flow is executed serially, with a simple goto paradigm in the case of
labeled matchers.

For example consider the following script.

```
... configuration yaml ...
>>>
POST https://example.com/account

{ ...account data... }

<<< pending +3s
201 Created

{ "id": "{{account}}", "status": "pending" }

<<< ready
201 Created

{ "id": "{{account}}", "status": "ready" }

>>> pending / 5
GET https://example.com/account/{{account}}

<<< pending +3s
201 Created

{ "id": "{{account}}", "status": "pending" }

<<< ready
201 Created

{ "id": "{{account}}", "status": "ready" }
```

This script starts with a `POST` to `https://example.com/account`, binds the
`account` value to the response, and has two provided matchers for the response
(pardon considers each of these in-order and picks the first match, if there are
request matchers and none of them match, it's an error).

If the json has a status of "pending", as that response matcher is declared with
`>>> pending +3s`, pardon waits three seconds and then executes the
`>>> pending / 10` GET request, where the `/ 10` means we'll run this step at
most 10 times before giving up.

The GET request has a similar pair of matchers.

Eventually the account status should transition to "ready" in which case the
response matcher declared with `<<< ready` is matched. As there is no
corresponding request for "ready", this would exit the flow (successfuly) and
"ready" is deduced as the "outcome". (flows also exit if the last request
completes)

### units

Units are functions which are keyed on their input, and the results
cached/shared across multiple tests. They can be implemented as `...flow.https`
files as well, using a shared strucutre with other https flows.

The input argument should be written as a single destructured object (supporting
rest arguments), and the data will be provided via a hybrid of what is present
in the environment and what is passed directly in the call.

A stable serialization of this object identifies the unit and multiple calls
with the same input will reuse existing in-flight promises.

Because of this, the environment object accessible within the unit itself will
be effectively cleared to be at most a copy of the input. But any assignments to
the environment are available to the callers (or more specifically, the
awaiters, of the result.)
