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
import assert from "node:assert";

import {
  mergeSchema,
  renderSchema,
} from "../../src/core/schema/core/schema-utils.js";
import { jsonEncoding } from "../../src/core/schema/definition/encodings/json-encoding.js";
import { ScriptEnvironment } from "../../src/core/schema/core/script-environment.js";
import { Schema } from "../../src/core/schema/core/types.js";
import { KV } from "../../src/core/formats/kv-fmt.js";
import { JSON } from "../../src/core/json.js";
import { unboxObject } from "../../src/core/schema/definition/scalar.js";
import { mixing } from "../../src/core/schema/core/contexts.js";

async function compose(
  testname: string,
  template: TemplateStringsArray,
  ...substitutons: any[]
) {
  const formatted = String.raw(template, substitutons);

  const templates = formatted.split("\n---\n");

  const { [KV.unparsed]: first, ...input } = KV.parse(templates[0], "stream");
  templates[0] = first ?? "";

  let expected: any;
  let last = "";
  const lastTemplate = templates.pop()!.trim();

  if (lastTemplate.startsWith("*")) {
    last = lastTemplate.slice(1);
  } else {
    ({ [KV.unparsed]: last = "", ...expected } = KV.parse(
      lastTemplate,
      "stream",
    ));
  }

  const merged = templates.reduce<Schema<string>>(
    (schema, template, index) => {
      const merge = mergeSchema(
        {
          mode: "mix",
          phase: index === templates.length - 1 ? "validate" : "build",
        },
        schema,
        template,
        new ScriptEnvironment({ name: `${testname}/${index}`, input }),
      );
      if (merge.schema) {
        return merge.schema;
      }
      throw merge.error || merge.context.diagnostics?.[0] || merge;
    },
    mixing(jsonEncoding(undefined)),
  );

  const {
    output,
    context: { evaluationScope: scope },
  } = await renderSchema(
    merged,
    new ScriptEnvironment({ name: `${testname}/render`, input }),
  );

  const resultValues = scope.resolvedValues();

  if (last.trim()) {
    assert.deepStrictEqual(
      JSON.parse(
        unboxObject(output),
        (_key, value, { source }) => source ?? value,
      ),
      JSON.parse(
        unboxObject(last),
        (_key, value, { source }) => source ?? value,
      ),
    );
  }

  if (expected) {
    assert.deepStrictEqual(unboxObject(resultValues), unboxObject(expected));
  }

  return { output, values: resultValues };
}

/**
 * call with
 * ```js
 * intent(testname)`
 * input
 * template
 * ---
 * template
 * ---
 * result
 * output
 * `()
 *
 * where input is kv data, templates are interpreted with json encoding (mix)
 * the result is the kv output, (use "*" to skip comparison), and the output is
 * plain JSON.  intent.skip, intent.only register the tests with it.skip/it.only and
 * intent.fails and intent.todo both assert a failure (with different semantics of course).
 * donot
 */
function intent(
  testname: string,
  mode?: "only" | "skip" | "fails" | "todo" | "tofail",
): (
  ...args: Parameters<typeof compose> extends [string, ...infer template]
    ? template
    : never
) => (
  expect?: (
    result: Awaited<ReturnType<typeof compose>>,
  ) => void | Promise<void>,
) => void {
  return (...args) =>
    (expect) => {
      const action =
        mode === "only" ? it["only"] : mode === "skip" ? it["skip"] : it;
      action(
        mode === "fails"
          ? `${testname} (failing)`
          : mode === "todo"
            ? `${testname} (todo)`
            : mode === "tofail"
              ? `${testname} (tofail)`
              : testname,
        async () => {
          if (mode === "fails" || mode === "todo") {
            await assert.rejects(
              async () => {
                const result = await compose(testname, ...args);
                await expect?.(result);
              },
              (err) => {
                if (mode === "todo") {
                  console.warn(`${testname} (todo): fix ${err}`);
                }
                return true;
              },
            );
          } else {
            const result = await compose(testname, ...args);
            await expect?.(result);
            if (mode === "tofail") {
              console.warn(`${testname} (tofail): should throw an error`);
            }
          }
        },
      );
    };
}

intent["only"] = (testname) => intent(testname, "only");
intent["skip"] = (testname) => intent(testname, "skip");
intent["fails"] = (testname) => intent(testname, "fails");
intent["todo"] = (testname) => intent(testname, "todo");
intent["tofail"] = (testname) => intent(testname, "tofail");

intent("render-empty-object")`
{}
---
{}
`();

intent("render-number")`
27
---
27
`();

intent("merge-number")`
"{{a}}"
---
27
---
a=27
27
`();

intent("render-primitives")`
{
  string: "s",
  number: 1,
  boolean: true,
  false: false,
  nil: null
}
---
{"string":"s","number":1,"boolean":true,"false":false,"nil":null}
`();

intent("match-primitives")`
{
  string: "s",
  number: 1,
  boolean: true,
  false: false,
  nil: null
}
---
{
  string: "{{s}}",
  number: "{{n}}",
  boolean: "{{t}}",
  false: "{{f}}",
  nil: "{{z}}"
}
---
s=s n=1 t=true f=false z=null
{"string":"s","number":1,"boolean":true,"false":false,"nil":null}
`();

intent("null")`
null
---
null
`();

intent("null-match")`
null
---
"{{z}}"
---
z=null
null
`();

intent("match-null")`
"{{z}}"
---
null
---
z=null
null
`();

intent("reference-array")`
abc
---
["a","b","c"]
---
abc=[a,b,c]
["a","b","c"]
`();

intent("array-reference-of")`
abc.of(["a","b","c"])
---
abc=[a,b,c]
["a","b","c"]
`();

intent("reference-squashing")`
abc.of("hello")
---
xyz
---
abc=hello
xyz=hello
"hello"
`();

intent("reference-squashing-of-a")`
abc.of(xyz)
---
xyz.of(abc.of("hello"))
---
abc=hello
xyz=hello
"hello"
`();

intent("reference-squashing-of-b")`
abc.of(xyz).of("hello")
---
xyz.of(abc)
---
abc=hello
xyz=hello
"hello"
`();

intent("array-reference")`
["a","b","c"]
---
abc
---
abc=[a,b,c]
["a","b","c"]
`();

intent("base64-json")`
base64(json({}))
---
"e30="
`();

intent("base64-json-enc-dec")`
{ enc: base64(json(a)), dec: a }
---
{ dec: "hello" }
---
a=hello
{ "enc": "ImhlbGxvIg==", "dec": "hello" }
`();

intent("base64-json-dec-enc")`
{ enc: base64(json(a)), dec: a }
---
{ "enc": "ImhlbGxvIg==" }
---
a=hello
{ "enc": "ImhlbGxvIg==", "dec": "hello" }
`();

intent("json-data-in-out")`
{ enc: json({ a: '{{a=b+c}}', b }), c: "{{c}}" }
---
{ enc: json({ a: '{{a=b+c}}', b }), c: "{{b = 10}}", a }
---
a=20
b=10
c=10
{ "enc": "{\"a\":20,\"b\":10}", "c": 10, "a": 20 }
`();

intent("json-object-order")`
{ x: json({ a: 1, b: 2 }), y: json({ b: 2, a: 1 }) }
---
{ x: json({ a: 1, b: 2 }), y: json({ a: 1, b: 2 }) }
---
{ "x": "{\"a\":1,\"b\":2}", "y": "{\"b\":2,\"a\":1}" }
`();

intent("export-ascope-array-value")`
{ x: [a.$value] }
---
{ x: [1,2,3,"hello"] }
---
a=[1,2,3,hello]
`();

intent("export-ascope-array-reference")`
{ x: [a.item] }
---
{ x: [1,2,3,"hello"] }
---
a=[{item=1},{item=2},{item=3},{item=hello}]
`();

intent("export-ascope-array-pattern")`
{ x: ["{{a.item}}"] }
---
{ x: [1,2,3,"hello"] }
---
a=[{item=1},{item=2},{item=3},{item=hello}]
`();

intent("import-ascope-array-pattern")`
a=[{item=1},{item=2},{item=3},{item=hello}]
{ x: ["{{a.item}}"] }
---
*
{ "x": [1,2,3,"hello"] }
`();

intent("import-ascope-array-pattern-computation")`
a=[{item=1},{item=2},{item=3}]
{ x: [["{{a.item}}","{{=item*2}}"]] }
---
*
{ "x": [[1,2],[2,4],[3,6]] }
`();

intent("import-ascope-array-pattern-computation-and-bind-each-element")`
a=[{item=1},{item=2},{item=3}]
{ x: [["{{a.item}}","{{=item*2}}"]] }
---
{ x: [each.value] }
---
a=[{item=1}, {item=2}, {item=3}]
each=[{value=[1,2]}, {value=[2,4]}, {value=[3,6]}]
{ "x": [[1,2],[2,4],[3,6]] }
`();

intent("bind-layers")`
outer.of(base64(inner.of(json({ a: 10, b }))))
---
outer2.of(base64(inner2.of(json({ b: 20, a: "{{a}}" }))))
---
a=10
b=20
inner='{"a":10,"b":20}'
inner2='{"a":10,"b":20}'
outer=eyJhIjoxMCwiYiI6MjB9
outer2=eyJhIjoxMCwiYiI6MjB9
"eyJhIjoxMCwiYiI6MjB9"
`();

intent("mix-mux-array")`
["{{x}}"]
---
mux(["x"])
---
["x"]
`();

// this is okay because `{{x}}` is in a specific item scope, and
// x=y is global scope.
intent("mix-mux-array-with-conflicting-value")`
x=y
["{{x}}"]
---
mux(["x"])
---
["x"]
`();

intent.fails("mux-mux-array-with-conflicting-value")`
x=y
mux(["{{x}}"])
---
["x"]
---
["xyz"]
`();

intent("mix-array-input-but-no-strut")`
x=x
{ a: ["{{x}}"] }
---
{}
`();

intent.fails("mux-array-no-value")`
mux(["{{x}}"])
---
[]
`();

intent("mux-array-with-value")`
mux(["{{x}}"])
---
["x"]
---
x=x
["x"]
`();

intent("mux-array-with-input")`
x=x
mux(["{{x}}"])
---
["x"]
---
x=x
["x"]
`();

intent("mux-pattern-with-mix-value")`
["x"]
---
mux(["{{item.x}}"])
---
item=[{x=x}]
["x"]
`();

/**
 * this test checks that "ab" defined in the top scope is not evaluated with
 * the values in the inner scope.
 */
intent("referential-consistency")`
{
  "a": "{{a = 1}}",
  "b": "{{b = 2}}",
  // hidden further prevents the render from triggering in the current scope
  "ab": hidden("{{ab = a + b}}"),
  "v": [{
    "a": "{{a = 10}}",
    "b": "{{b = 20}}",
    "ab_here": "{{= a + b}}",
    "ab_via_scope": "{{= ab}}"
  }]
}
---
{ v: mux([{}]) }
---
*
{
  "a": 1,
  "b": 2,
  "v": [{
    "a": 10,
    "b": 20,
    "ab_here": 30,
    "ab_via_scope": 3
  }] 
}
`();

// unwrapSingle is always mix / scoped
intent("lenient-array-behavior")`
a=foo
b=bar
c=baz
{
  "a": unwrapSingle("{{a}}"),
  "b": mux(unwrapSingle("{{b}}")),
  "c": unwrapSingle("{{c}}")
}
---
{
}
`();

// either {a: ["foo"]} or {a: "foo"} would be acceptable, but let's
// make sure it doesn't change by surprise.
intent("lenient-array-behavior-expanded-by-value")`
a=[foo]
{
  "a": unwrapSingle("{{a.@value}}")
}
---
a=[foo]
{
  "a": "foo"
}
`();

intent("lenient-array-behavior-valued-match-to-array")`
{
  "b": unwrapSingle("{{b.@value}}")
}
---
{
  "b": mux(["bar"])
}
---
b=[bar]
{
  "b": ["bar"]
}
`();

intent("lenient-array-behavior-valued-match-to-value")`
{
  "b": unwrapSingle("{{b.@value}}")
}
---
{
  "b": "bar"
}
---
b=[bar]
{
  "b": "bar"
}
`();

intent("lenient-array-behavior-non-unit-case")`
{
  "a": unwrapSingle("{{a.@value}}"),
  "b": unwrapSingle("{{b.@value}}")
}
---
{
  "a": [1, 2],
  "b": []
}
---
a=[1,2]
{
  "a": [1,2],
  "b": []
}
`();

intent("keyed-list-value-rendering")`
map={ x=1, y=2 }
keyed({ id: "{{key}}" }, [{
  "id": "{{map.@key}}", // should this be implied from the match archetype?
  "a": "{{map.@value}}"
}])
---
*
[{ "id": "x", "a": 1 }, { "id": "y", "a": 2 }]
`();

intent("keyed-list-merging-and-value-rendering")`
map={ x={ a=1, b=2 }, y={ a=3, b=4 }}
keyed({ id: "{{key}}" }, [{
  "id": "{{map.@key}}", // should this be implied from the match archetype?
  "a": "{{map.a}}"
}])
---
keyed({ id: "{{key}}" }, [{
  "b": "{{map.b}}"
}])
---
*
[{ "id": "x", "a": 1, "b": 2 }, { "id": "y", "a": 3, "b": 4 }]
`();

intent("keyed-list-merging-and-value-rendering-reuse-value")`
map={ x=xx, y=yy }
keyed({ id: "{{key}}" }, [{
  "id": "{{map.@key}}",
  "a": "{{map.@value}}"
}])
---
keyed({ id: "{{key}}" }, [{
  "b": "{{map.@value}}"
}])
---
*
[{ "id": "x", "a": "xx", "b": "xx" },
 { "id": "y", "a": "yy", "b": "yy" }]
`();

intent("mv-keyed-list-matching")`
keyed$mv({ id: "{{key}}" }, [{
  "id": "{{map.a.@key}}", // should this be implied from the match archetype?
  "a": "{{map.a.@value}}"
}])
---
[{ "id": "x", "a": "xx" },
 { "id": "x", "a": "xy" },
 { "id": "y", "a": "yy" },
 { "id": "y", "a": "yz" }]
---
map={x={a=[xx,xy]},y={a=[yy,yz]}}
[{ "id": "x", "a": "xx" },
 { "id": "x", "a": "xy" },
 { "id": "y", "a": "yy" },
 { "id": "y", "a": "yz" }]
`();

intent("mv-keyed-list-rendering-by-value")`
map={x={a=[xx,xy]},y={a=[yy,yz]}}
keyed$mv({ id: "{{key}}" }, [{
  "id": "{{map.@key}}",
  "a": "{{map.a.@value}}"
}])
---
*
[{ "id": "x", "a": "xx" },
 { "id": "x", "a": "xy" },
 { "id": "y", "a": "yy" },
 { "id": "y", "a": "yz" }]
`();

intent("keyed-tuple-list-mapping")`
keyed(["{{key}}", undefined],
[["{{headers.@key}}", "{{headers.value}}"]])
---
[["a", "AAA"],
 ["b", "BBB"]]
---
headers={a={value=AAA}, b={value=BBB}}
[["a", "AAA"],
 ["b", "BBB"]]
`();

intent("keyed-tuple-list-value-rendering")`
headers={a={value=AAA}, b={value=BBB}}
keyed(["{{key}}", undefined],
[["{{headers.@key}}", "{{headers.value}}"]])
---
*
[["a", "AAA"],
 ["b", "BBB"]]
`();

intent("mix-match")`
mix(["{{array.@value}}"])
---
["a","b"]
---
array=[a,b]
["a","b"]
`();

intent("keyed-new-syntax")`
headers={a={value=AAA}, b={value=BBB}}
[key, undefined] * [
  [headers.$key, headers.value]
]
---
*
[["a", "AAA"],
 ["b", "BBB"]]
`();

intent("keyed-merging-new-syntax")`
map={ x=xx, y=yy }
{ id: key } * [{
  "id": map.$key,
  "a": map.$value
}]
---
{ id: key } * [{
  "b": map.$value
}]
---
*
[{ "id": "x", "a": "xx", "b": "xx" },
 { "id": "y", "a": "yy", "b": "yy" }]
`();

intent("keyed-merging-new-syntax-expression")`
map={ x={value=xx}, y={value=yy} }
{ id: $key } * [{
  id: map.$key,
  a: map.value,
  a1: ( value + 1 )
}]
---
*
[{ "id": "x", "a": "xx", "a1": "xx1" },
 { "id": "y", "a": "yy", "a1": "yy1" }]
`();

intent("nested-kv-export")`
keyed({ id: "{{key}}" }, [{
  id: "{{map.@key}}",
  nested: keyed({ id: "{{key}}" }, [{
    id: "{{map.nested.@key}}",
    value: "{{map.nested.@value}}"
  }])
}])
---
[{ id: 'hello', nested: [{ id: 'x', value: 'y' }, { id: 'p', value: 'q' }] }]
---
map={ hello={ nested={ x=y, p=q } } }
[{ "id": "hello", "nested": [
  { "id": "x", "value": "y" },
  { "id": "p", "value": "q" }
]}]
`();

intent("nested-kv-import")`
map={ hello={ nested={ x=y, p=q } } }
keyed({ id: key }, [{
  id: map.$key,
  nested: keyed({ id: key }, [{
    id: map.nested.$key,
    value: map.nested.$value
  }])
}])
---
*
[{ "id": "hello", "nested": [
  { "id": "x", "value": "y" },
  { "id": "p", "value": "q" }
]}]
`();

intent("scalar-conversions")`
{
  a
}
---
{
  a: 100,
  ac: a,
  as: $string(a),
  an: $number(a),
  ab: $bool(a)
}
---
*
{
  "a": 100,
  "ac": 100,
  "as": "100",
  "an": 100,
  "ab": true
}
`();

intent.fails("scalar-matching")`
{
  a: $bool()
}
---
{
  a: 100
}
---
*
{
  "a": true
}
`();

intent("bigint")`
{
  a: $bigint()
}
---
{
  a: 18051727547282341502540305388584042500
}
---
*
{
  "a": 18051727547282341502540305388584042500
}
`();
