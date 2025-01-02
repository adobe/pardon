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
import test, { describe } from "node:test";
import assert, { deepEqual } from "node:assert";
import {
  all_disconnected,
  disconnected,
  semaphore,
  shared,
  tracking,
} from "../../src/core/tracking.js";

function testing(name, fn: (_: ReturnType<typeof tracking>) => void, result) {
  test(name, async () => {
    await Promise.resolve();
    const tracker = tracking<string>();
    await Promise.resolve();

    await shared(async () => fn(tracker));
    assert.equal(tracker.awaited().join(""), result);
  });
}

// use [] syntax so searching for dot-only
// doesn't find it (as we like to clean dot-only use up).
testing["only"] = (
  name,
  fn: (_: ReturnType<typeof tracking>) => void,
  result,
) => {
  test["only"](name, async () => {
    await Promise.resolve();
    const tracker = tracking<string>();
    await Promise.resolve();

    await fn(tracker);
    assert.equal(tracker.awaited().join(""), result);
  });
};

async function delay(n = 100 * Math.random()) {
  return new Promise((resolve) => setTimeout(resolve, n));
}

async function thread(fn) {
  await Promise.resolve();
  return fn();
}

describe("async", () => {
  testing(
    "tracking-sequence",
    async ({ track, awaited }) => {
      //const a = delay(1).then(() => track("a"));
      //const b = delay(1).then(() => track("a"));

      let x, y;
      (async () => {
        await delay(1);

        track("a");
        x = delay(10);
        track("b");
        y = Promise.resolve().then(() => Promise.resolve());
        track("c");
      })();

      await delay(10);

      assert.equal(awaited().join(""), "");

      await x;
      assert.equal(awaited().join(""), "a");

      await y;
      assert.equal(awaited().join(""), "ab");
    },
    "ab",
  );

  testing(
    "simple async tracking",
    async (tracker) => {
      tracker.track("a");
      tracker.track("b");
      tracker.track("c");
    },
    "abc",
  );

  testing(
    "abac",
    async ({ track }) => {
      const a = thread(() => {
        track("a");
      });
      const ab = a.then(() => track("b"));
      const ac = a.then(() => track("c"));

      await ab;
      await ac;
    },
    "abc",
  );

  testing(
    "0abac",
    async ({ track }) => {
      track("0");
      const a = thread(() => {
        track("a");
      });
      const ac = a.then(() => track("c"));
      const ab = a.then(() => track("b"));

      await ab;
      await ac;
    },
    "0abc",
  );

  testing(
    "resolute",
    async ({ track }) => {
      const zero = thread(() => {
        track("0");
      });

      const ab = thread(async () => {
        await zero;

        track("a");
        track("b");
      });

      const cd = thread(async () => {
        await zero;

        track("c");
        track("d");
      });

      const abcd = thread(() => {
        return ab.then(() => cd);
      });

      await abcd;
    },
    "0abcd",
  );

  testing(
    "merge flows",
    async ({ track }) => {
      track("0");
      await Promise.resolve();
      track("1");
      await Promise.resolve();
      track("a");
      const x = thread(() => {
        track("b");
        track("c");
      });
      const y = thread(() => {
        track("e");
        track("f");
      });

      await x;
      await y;
    },
    "01abcef",
  );

  testing(
    "untracked-flow",
    async ({ track }) => {
      const a = thread(async () => {
        track("a");
      });

      let pq;
      thread(async () => {
        track("p");
        await delay();
        pq = thread(async () => {
          track("q");
        });
      });

      void pq;
      await a;
      await delay(200);
    },
    "a",
  );

  testing(
    "tracked-complex-flow",
    async ({ track }) => {
      const a = thread(async () => {
        track("a");
      });

      let pqrs;
      thread(async () => {
        track("p");
        await delay(1);
        track("q");
        await delay(1);
        track("r");
        await delay(1);
        pqrs = thread(async () => {
          track("s");
        });
      });

      await delay(200);

      await pqrs;
      await a;
    },
    "pqrsa",
  );

  testing(
    "tracked-mixed-flow",
    async ({ track }) => {
      const a = thread(async () => {
        track("a");
      });

      let pqrs;
      thread(async () => {
        await a;
        track("p");
        await delay(1);
        track("q");
        await delay(1);
        track("r");
        await delay(1);
        pqrs = thread(async () => {
          track("s");
        });
      });

      await delay(200);

      await pqrs;
      await a;
    },
    "apqrs",
  );

  testing(
    "multitap",
    async ({ track, awaited }) => {
      const a = thread(() => {
        track("a");
      });
      const b = thread(() => {
        track("b");
      });
      const c = thread(() => {
        track("c");
      });
      const ab = thread(async () => {
        await a;
        await b;
        assert.equal(awaited().join(""), "ab");
      });

      const ba = thread(async () => {
        await b;
        await a;
        assert.equal(awaited().join(""), "ba");
      });

      const abba = thread(async () => {
        await ab;
        await ba;
        assert.equal(awaited().join(""), "ab");
      });

      const baab = thread(async () => {
        await ba;
        await ab;
        assert.equal(awaited().join(""), "ba");
      });

      const abbacbaab = thread(async () => {
        await abba;
        await c;
        await baab;
        assert.equal(awaited().join(""), "abc");
      });

      const baabcabba = thread(async () => {
        await c;
        await abba;
        assert.equal(awaited().join(""), "cab");
      });

      await abbacbaab;
      await baabcabba;
    },
    "abc",
  );

  testing(
    "multiawait",
    async ({ track, awaited }) => {
      track("a");

      const b = thread(() => {
        track("b");
      });

      const c = thread(() => {
        track("c");
      });

      await b;
      assert.equal(awaited().join(""), "ab");

      await c;
      assert.equal(awaited().join(""), "abc");

      await b; // changes nothing, already awaited
    },
    "abc",
  );

  testing(
    "complex",
    async ({ track, awaited }) => {
      const assertions: Promise<void>[] = [];
      const x = thread(() => track("x"));

      let z;
      const abxcd = thread(async () => {
        track("a");
        await delay();
        track("b");
        await delay();
        await x;
        await delay();
        track("c");
        z = thread(() => track("z"));
        track("d");
      });

      const pqxrs = thread(async () => {
        await thread(() => track("p"))
          .then(() => delay())
          .then(() => track("q"));
        await x;
        await thread(() => track("r"))
          .then(() => delay())
          .then(() => track("s"));
      });

      assertions.push(
        pqxrs.then(() => {
          assert.equal(awaited().join(""), "pqxrs");
        }),
      );

      assertions.push(
        abxcd.then(() => {
          assert.equal(awaited().join(""), "abxcd");
        }),
      );

      assertions.push(
        (async () => {
          await pqxrs;
          await abxcd;

          assert.equal(awaited().join(""), "pqxrsabcd");
        })(),
      );

      await delay(500);

      assertions.push(
        z.then(() => {
          assert.equal(awaited().join(""), "abxcz");
        }),
      );

      assert.equal(awaited().join(""), "");

      const awaiting = thread(async () => {
        for (const a of assertions) {
          await a;
        }
        assert.equal(awaited().join(""), "pqxrsabcdz");
      });

      const alling = thread(async () => {
        await Promise.all(assertions);
        assert.equal(awaited().join(""), "pqxrsabcdz");
      });

      await awaiting;
      await alling;
    },
    "pqxrsabcdz",
  );

  testing(
    "async-generator",
    async ({ track, awaited }) => {
      let cd;
      thread(async () => {
        track("c");
        await delay();
        cd = thread(() => track("d"));
      });

      async function* agen() {
        track("a");
        await delay();
        track("b");
        yield "ab";
        await delay(200);
        await cd;
        yield "abcd";
      }

      for await (const expected of agen()) {
        assert.equal(awaited().join(""), expected);
      }
    },
    "abcd",
  );

  testing(
    "semaphore-tests-1",
    async ({ track, awaited }) => {
      const tasker = semaphore(1);

      const seq: string[] = [];
      const a = tasker(async () => {
        await delay(100);
        track("a");
        seq.push("a");
        assert.equal(awaited().join(""), "a");
      });
      const b = tasker(async () => {
        await delay(50);
        track("b");
        seq.push("b");

        assert.equal(awaited().join(""), "b");
      });

      await Promise.all([a, b]);
      seq.push("c");
      assert.equal(seq.join(""), "abc");
    },
    "ab",
  );

  testing(
    "semaphore-tests-2",
    async ({ track, awaited }) => {
      const tasker = semaphore(2);
      await delay(100);
      track("x");

      const seq: string[] = [];
      const a = tasker(async () => {
        await delay(100);
        track("a");
        seq.push("a");
        assert.equal(awaited().join(""), "xa");
      });
      const b = tasker(async () => {
        await delay(50);
        track("b");
        seq.push("b");

        assert.equal(awaited().join(""), "xb");
      });

      await Promise.all([a, b]);
      seq.push("c");
      assert.equal(seq.join(""), "bac");
    },
    "xab",
  );

  testing(
    "disconnected",
    async ({ track, awaited }) => {
      const tasker = semaphore(3);
      await disconnected(async () => {
        track("x");

        const c = tasker(async () => {
          await delay(50);
          track("c");
        });
        const a = tasker(async () => {
          await delay(100);
          track("a");
        });
        const b = tasker(async () => {
          await delay(50);
          track("b");
        });

        await Promise.all([a, b, c]);
        assert.equal(awaited().join(""), "xabc");
      });
    },
    "",
  );

  testing(
    "test-disconnected-gc",
    async ({ track, awaited }) => {
      const gclog: string[] = [];
      const registry = new FinalizationRegistry((held: string) => {
        gclog.push(held);
      });

      const result = await disconnected(async () => {
        const tracked = {};
        registry.register(tracked, "held");

        assert.equal(awaited().length, 0);
        track(tracked);
        assert.equal(awaited().length, 1);

        return "hi";
      });

      assert.equal(awaited().length, 0);
      assert.equal(result, "hi");

      global.gc!();
      await delay(10);
      global.gc!();
      await delay(10);

      assert.equal(gclog.join("\n"), "held");
    },
    "",
  );

  testing(
    "test-disconnected-gc-all",
    async ({ track, awaited }) => {
      let count = 0;
      const registry = new FinalizationRegistry(() => {
        count++;
      });

      const result = await Promise.all([
        disconnected(async () => {
          const tracked = { xxx: 1 };
          registry.register(tracked, null);

          assert.equal(awaited().length, 0);
          track(tracked);
          assert.equal(awaited().length, 1);

          // garbage collected nothing;
          assert.equal(count, 0);

          return "hello";
        }),
        disconnected(async () => {
          const tracked = { yyy: 1 };
          registry.register(tracked, null);

          assert.equal(awaited().length, 0);
          track(tracked);
          assert.equal(awaited().length, 1);
          // garbage collected nothing;
          assert.equal(count, 0);

          await delay(100);
          global.gc!();
          await delay(100);
          global.gc!();
          await delay(100);

          // garbage collected the tracked value in the other branch.
          assert.equal(count, 1);
          await delay(100);

          return "world";
        }),
        disconnected(async () => {
          await Promise.resolve();
          await Promise.resolve();
          await Promise.resolve();
          await Promise.resolve();
          await Promise.resolve();
          await Promise.resolve();
          await Promise.resolve();
        }),
        disconnected(async () => {
          await Promise.resolve();
          await Promise.resolve();
          await Promise.resolve();
          await Promise.resolve();
          await Promise.resolve();
          await Promise.resolve();
          await Promise.resolve();
        }),
        disconnected(async () => {
          await Promise.resolve();
          await Promise.resolve();
          await Promise.resolve();
          await Promise.resolve();
          await Promise.resolve();
          await Promise.resolve();
          await Promise.resolve();
        }),
        disconnected(async () => {
          await Promise.resolve();
          await Promise.resolve();
          await Promise.resolve();
          await Promise.resolve();
          await Promise.resolve();
          await Promise.resolve();
          await Promise.resolve();
        }),
        disconnected(async () => {
          await Promise.resolve();
          await Promise.resolve();
          await Promise.resolve();
          await Promise.resolve();
          await Promise.resolve();
          await Promise.resolve();
          await Promise.resolve();
        }),
        disconnected(async () => {
          await Promise.resolve();
          await Promise.resolve();
          await Promise.resolve();
          await Promise.resolve();
          await Promise.resolve();
          await Promise.resolve();
          await Promise.resolve();
        }),
      ]).then((a) => a.filter(Boolean));

      //console.log("ZZZ", debug());
      assert.equal(awaited().length, 0);
      assert.deepEqual(result, ["hello", "world"]);

      global.gc!();
      await delay(10);
      global.gc!();
      await delay(10);

      assert.equal(count, 2);
    },
    "",
  );

  testing(
    "test-semaphore-gc",
    async ({ track, awaited }) => {
      let count = 0;
      const registry = new FinalizationRegistry(() => {
        count++;
      });

      const gate = semaphore(1);

      const first = gate(() =>
        disconnected(() => {
          const tracked = {};
          registry.register(tracked, null);

          assert.equal(awaited().length, 0);
          track(tracked);
          assert.equal(awaited().length, 1);

          // garbage collected nothing;
          assert.equal(count, 0);

          return "hello";
        }),
      );

      const second = gate(() =>
        disconnected(async () => {
          const tracked = {};
          registry.register(tracked, null);

          assert.equal(awaited().length, 0);
          track(tracked);
          assert.equal(awaited().length, 1);
          // garbage collected nothing;
          assert.equal(count, 0);

          await delay(100);
          global.gc!();
          await delay(100);
          global.gc!();
          await delay(100);
          // garbage collected the tracked value in the other branch.
          assert.equal(count, 1);
          await delay(100);

          return "world";
        }),
      );

      const result = await Promise.all([first, second]);

      assert.equal(awaited().length, 0);
      assert.deepEqual(result, ["hello", "world"]);

      global.gc!();
      await delay(10);
      global.gc!();
      await delay(10);

      assert.equal(count, 2);
    },
    "",
  );

  testing(
    "large-promise-all",
    async ({ track }) => {
      const batch = 10;
      const concurrency = semaphore(batch);
      await all_disconnected(
        [...new Array(100)].map(async () => {
          await concurrency(() => delay(10));

          track("x");
          track("");
          track("y");
          track("");
          track("z");
        }),
      );
    },
    "",
  );

  testing(
    "docs-example",
    async ({ awaited, track }) => {
      function randomDelay() {
        return delay(Math.random() * 100);
      }
      function confirm(value: string) {
        assert.equal(awaited().join(""), value);
      }
      async function f() {
        await randomDelay();
        track("f");
      }
      async function g() {
        await randomDelay();
        track("g");
      }

      const pf = f();
      const pg = g();

      confirm("");

      const ppg = randomDelay().then(async () => {
        await pg;
        confirm("g");
      });
      const ppgf = randomDelay().then(async () => {
        await pg;
        await pf;
        confirm("gf");
      });

      await pf;

      confirm("f");

      await pg;

      confirm("fg");

      await ppg;
      await ppgf;
    },
    "fg",
  );

  testing(
    "set-timeout-continuation",
    async ({ awaited, track }) => {
      track("x");
      let t;
      setTimeout(() => {
        // setTimeout creation does not propagate contexts
        t = awaited();
      }, 10);
      await delay(20);
      deepEqual(t, []); // clarifying that we don't inherit ["x"] here at the moment.
    },
    "x",
  );
});
