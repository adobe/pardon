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
import { it } from "node:test";
import { KV } from "../../src/modules/api.js";
import assert from "node:assert";

it("should parse regex in expressions", () => {
  const { [KV.unparsed]: rest, ...data } = KV.parse(
    `ref := randomUUID().replace(/- a = b(?:.*[]\\/-)/g, '')`,
    "stream",
    { allowExpressions: true },
  );

  assert.deepEqual(new Set([...Object.keys(data)]), new Set(["ref"]));
  assert.ok(!rest);
});

it("should parse expressions with spaces around the sigil", () => {
  const { [KV.unparsed]: rest, ...data } = KV.parse(
    `a:=x+y
    b :=x-y
    c:= x*y
    d := x=y`,
    "stream",
    { allowExpressions: true },
  );

  assert.deepEqual(
    new Set([...Object.keys(data)]),
    new Set(["a", "b", "c", "d"]),
  );
  assert.ok(!rest);
});

it("should parse expressions with hyphenated keys", () => {
  const { [KV.unparsed]: rest, ...data } = KV.parse(
    `a-s:=x()+y()
    b-s :=x()-y()
    c-s:= x()*y()
    d-s := x=y()`,
    "stream",
    { allowExpressions: true },
  );

  assert.deepEqual(
    new Set([...Object.keys(data)]),
    new Set(["a-s", "b-s", "c-s", "d-s"]),
  );
  assert.ok(!rest);
});

it("should stringify patterns", () => {
  assert.equal(KV.stringify("{{abc}}", { quote: "single" }), "'{{abc}}'");
  assert.equal(
    KV.stringify('{{"xyz"[0]}}', { quote: "single" }),
    "'{{\"xyz\"[0]}}'",
  );
  assert.equal(KV.stringify("{{'xyz'[0]}}"), "\"{{'xyz'[0]}}\"");
});

it("should parse multiline strings", () => {
  const { [KV.unparsed]: rest, ...data } = KV.parse(
    `x='
a
'`,
    "stream",
    { allowExpressions: true },
  );

  assert.equal(data.x, "\na\n");
});

it("should keep all data", () => {
  const { [KV.unparsed]: rest, ...data } = KV.parse(
    `a=b
x='`,
    "stream",
    {
      allowExpressions: true,
    },
  );

  assert.equal(data.a, "b");
  assert.equal(data.x, undefined);
  assert.equal(rest, "x='");
});

it("should end at -*- patterns", () => {
  const { [KV.unparsed]: rest, ...data } = KV.parse(
    `x := y()
    -*-
    extra`,
    "stream",
    { allowExpressions: true },
  );

  assert.equal(data.x(), "y()");
  assert.equal(rest?.trim(), "extra");
});

it("should stringify numbers and strings differently", () => {
  assert.equal(
    KV.stringify({ x: 123, y: "123" }, { quote: "single" }),
    "x=123 y='123'",
  );
});
