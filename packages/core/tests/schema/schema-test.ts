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

import type { Schema } from "../../src/core/schema/core/types.js";
import {
  mergeSchema,
  renderSchema,
} from "../../src/core/schema/core/schema-utils.js";
import { jsonEncoding } from "../../src/core/schema/definition/encodings/json-encoding.js";
import { ScriptEnvironment } from "../../src/core/schema/core/script-environment.js";
import { KV } from "../../src/core/formats/kv-fmt.js";
import { unboxObject } from "../../src/core/schema/definition/scalar.js";
import { merging } from "../../src/core/schema/core/contexts.js";
import { bodyTemplate } from "../../src/core/request/https-template.js";

async function compose(
  testname: string,
  template: TemplateStringsArray,
  ...substitutons: any[]
) {
  const formatted = String.raw({ raw: template }, substitutons);

  const templates = formatted.split("\n---\n");

  const testmeta: Record<string, string> = {};
  const firstTemplateLines = templates[0].split("\n");
  for (;;) {
    if (!firstTemplateLines[0].trim()) {
      firstTemplateLines.shift();
      continue;
    }

    const [, k, v] =
      /\s*\[\s*([a-z]+)\s*\]\s*:\s*(.*)$/.exec(firstTemplateLines[0]) ?? [];
    if (!k) {
      break;
    }
    firstTemplateLines.shift();
    testmeta[k] = v;
  }

  templates[0] = firstTemplateLines.join("\n").trim();

  const { [KV.unparsed]: first, ...input } = templates[0].startsWith("{")
    ? { [KV.unparsed]: templates[0] }
    : KV.parse(templates[0], "stream");
  templates[0] = first ?? "";

  let expected: any;
  let last = "";
  const lastTemplate = templates.pop()!.trim();

  if (lastTemplate.startsWith("*")) {
    last = lastTemplate.slice(1);
  } else if (lastTemplate.trim().startsWith("{")) {
    last = lastTemplate;
  } else {
    ({ [KV.unparsed]: last = "", ...expected } = KV.parse(
      lastTemplate,
      "stream",
    ));
  }

  const merged = templates.reduce<Schema<string | undefined>>(
    (schema, template, index) => {
      const merge = mergeSchema(
        {
          mode: "merge",
          phase: index === templates.length - 1 ? "validate" : "build",
          body: "json",
        },
        schema,
        template,
        new ScriptEnvironment({ name: `${testname}/${index}`, input }),
      );
      if (merge.schema && merge.context!.diagnostics.length === 0) {
        return merge.schema;
      }
      throw merge.error || merge.context!.diagnostics?.[0] || merge;
    },
    merging(testmeta.schema === "body" ? bodyTemplate() : jsonEncoding())!,
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
    assert.deepStrictEqual(KV.parse(output, "value"), KV.parse(last, "value"));
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
function templating(
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
      // if (testname !== "match string number") return;
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

templating["only"] = (testname) => templating(testname, "only");
templating["skip"] = (testname) => templating(testname, "skip");
templating["fails"] = (testname) => templating(testname, "fails");
templating["todo"] = (testname) => templating(testname, "todo");
templating["tofail"] = (testname) => templating(testname, "tofail");

templating("render-empty-object")`
{}
---
{}
`();

templating("render-number")`
27
---
27
`();

templating("merge-number")`
"{{a}}"
---
27
---
a=27
27
`();

templating("render-primitives")`
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

templating("match-object-with-reference")`
a
---
{ x: "y" }
---
a={ x=y }
`();

templating("chained-evaluation")`
{
  "world": "planet earth",
  "planet": "PLANET {{planet}}"
}
---
{
  "world": "{{-globe}}",
  "hi": "{{-world = globe.toUpperCase()}}",
  "planet": "{{-world}}",
  "hello": "{{planet}}"
}
---
planet=EARTH
`();

templating("inverse-chained-evaluation")`
{
  "world": "{{#-globe}}",
  "hi": "{{#-world = globe.toUpperCase()}}",
  "planet": "{{#-world}}",
  "hello": "{{planet}}"
}
---
{
  "world": "planet earth",
  "planet": "PLANET {{planet}}"
}
---
planet=EARTH
{
  "hello": "EARTH"
}
`();

templating.todo("match-simple-pattern-as-reference")`
"{{a}}"
---
{ x: "y" }
---
a={ x=y }
`();

templating("optional")`
{
  x: x.$optional
}
---
-*-
{}
`();

templating("optional-interpolated")`
{
  x: "{{?x}}"
}
---
*
{}
`();

templating("optional-interpolated-as-type")`
{
  x: "{{?x}}" as boolean
}
---
*
{}
`();

templating("optional-interpolated-as-type-2")`
{
  x: x as optional | boolean
}
---
*
{}
`();

templating("match-string-number")`
"{{x}}4{{y}}" as number
---
1234567
---
x="123"
y="567"
`();

templating.fails("match string number")`
"{{x}} {{y}}"
---
"a {{z}}"
`();

templating.todo("x-y-merge")`
"{{x}} {{y}}"
---
"a {{y}}"
---
"{{x}} b"
---
"a b"
`();

templating("match-primitives")`
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

templating("null")`
null
---
null
`();

templating("null-match")`
null
---
"{{z}}"
---
z=null
null
`();

templating("match-null")`
"{{z}}"
---
null
---
z=null
null
`();

templating("reference-array")`
abc
---
["a","b","c"]
---
abc=[a,b,c]
["a","b","c"]
`();

templating("array-reference-eq")`
-*-
abc = ["a","b","c"]
---
abc=[a,b,c]
["a","b","c"]
`();

templating("reference-squashing")`
-*-
abc = "hello"
---
xyz
---
abc=hello
xyz=hello
"hello"
`();

templating("reference-squish-squashing")`
-*-
abc = xyz
---
xyz = abc = "hello"
---
abc=hello
xyz=hello
"hello"
`();

templating("reference-squash-squishing")`
-*-
abc = xyz = "hello"
---
xyz = abc
---
abc=hello
xyz=hello
"hello"
`();

templating("array-reference")`
["a","b","c"]
---
abc
---
abc=[a,b,c]
["a","b","c"]
`();

templating("base64-json")`
base64(json({}))
---
"e30="
`();

templating("base64-json-enc-dec")`
{ enc: base64(json(a)), dec: a }
---
{ dec: "hello" }
---
a=hello
{ "enc": "ImhlbGxvIg==", "dec": "hello" }
`();

templating("base64-json-dec-enc")`
{ enc: base64(json(a)), dec: a }
---
{ "enc": "ImhlbGxvIg==" }
---
a=hello
{ "enc": "ImhlbGxvIg==", "dec": "hello" }
`();

templating("json-data-in-out")`
{ enc: json({ a: '{{a=b+c}}', b }), c: "{{c}}" }
---
{ enc: json({ a: '{{a=b+c}}', b }), c: "{{b = 10}}", a }
---
a=20
b=10
c=10
{ "enc": "{\\"a\\":20,\\"b\\":10}", "c": 10, "a": 20 }
`();

templating("json-object-order")`
{ x: json({ a: 1, b: 2 }), y: json({ b: 2, a: 1 }) }
---
{ x: json({ a: 1, b: 2 }), y: json({ a: 1, b: 2 }) }
---
{ "x": '{"a":1,"b":2}', "y": '{"b":2,"a":1}' }
`();

templating("export-ascope-array-value")`
{ x: [...a] }
---
{ x: [1,2,3,"hello"] }
---
a=[1,2,3,hello]
`();

templating("export-ascope-array-reference")`
{ x: [...a.item!] }
---
{ x: [1,2,3,"hello"] }
---
a=[{item=1},{item=2},{item=3},{item=hello}]
`();

templating("export-ascope-array-pattern")`
{ x: [..."{{a.item}}"] }
---
{ x: [1,2,3,"hello"] }
---
a=[{item=1},{item=2},{item=3},{item=hello}]
`();

templating("import-ascope-array-pattern")`
a=[{item=1},{item=2},{item=3},{item=hello}]
{ x: [..."{{a.item}}"] }
---
*
{ "x": [1,2,3,"hello"] }
`();

templating("import-namespaced-ascope-array-reference")`
a=[{item=1},{item=2},{item=3},{item=hello}]
{ x: a | [...item!] }
---
*
{ "x": [1,2,3,"hello"] }
`();

templating("import-ascope-array-pattern-computation")`
a=[{item=1},{item=2},{item=3}]
{ x: [...["{{a.item}}","{{=item*2}}"]] }
---
*
{ "x": [[1,2],[2,4],[3,6]] }
`();

templating("import-ascope-array-pattern-computation-and-bind-value")`
a=[{item=1},{item=2},{item=3}]
{ x: [...["{{a.item}}","{{=item*2}}"]] }
---
{ x: [...each] } /* compare with next test */
---
a=[{item=1}, {item=2}, {item=3}]
each=[[1,2], [2,4], [3,6]]
{ "x": [[1,2],[2,4],[3,6]] }
`();

templating("import-ascope-array-pattern-computation-and-bind-each-element")`
a=[{item=1},{item=2},{item=3}]
{ x: [...["{{a.item}}","{{=item*2}}"]] }
---
{ x: [...each.value!] } /* compare with previous test */
---
a=[{item=1}, {item=2}, {item=3}]
each=[{value=[1,2]}, {value=[2,4]}, {value=[3,6]}]
{ "x": [[1,2],[2,4],[3,6]] }
`();

templating("bind-layers")`
-*-
outer = base64(inner = json({ a: 10, b }))
---
outer2 = base64(inner2 = json({ b: 20, a: "{{a}}" }))
---
a=10
b=20
inner='{"a":10,"b":20}'
inner2='{"a":10,"b":20}'
outer=eyJhIjoxMCwiYiI6MjB9
outer2=eyJhIjoxMCwiYiI6MjB9
"eyJhIjoxMCwiYiI6MjB9"
`();

templating("mix-mux-array")`
[..."{{x}}"]
---
["x"]
---
["x"]
`();

// this is okay because `{{x}}` is in a specific item scope, and
// x=y is global scope.
templating("mix-mux-array-with-conflicting-value")`
x=y
[..."{{x}}"]
---
["x"]
---
["x"]
`();

templating.fails("mux-mux-array-with-conflicting-value")`
x=y
["{{x}}"]
---
[..."x"]
---
["xyz"]
`();

templating("mix-array-input-but-no-strut")`
x=x
{ a: [..."{{x}}"] }
---
{}
`();

templating.fails("mux-array-no-value")`
["{{x}}"]
---
[]
`();

templating("mux-array-with-value")`
["{{x}}"]
---
[..."x"]
---
x=x
["x"]
`();

templating("mux-array-with-input")`
x=x
["{{x}}"]
---
[..."x"]
---
x=x
["x"]
`();

templating("mux-pattern-with-mix-value")`
[..."x"]
---
["{{item.x}}"]
---
item=[{x=x}]
["x"]
`();

/**
 * this test checks that "ab" defined in the top scope is not evaluated with
 * the values in the inner scope.
 */
templating("referential-consistency")`
{
  "a": "{{a = 1}}",
  "b": "{{b = 2}}",
  // hidden further prevents the render from triggering in the current scope
  "ab": hidden("{{ab = a + b}}"),
  "v": [...{
    "a": "{{a = 10}}",
    "b": "{{b = 20}}",
    "ab_here": "{{= a + b}}",
    "ab_via_scope": "{{= ab}}"
  }]
}
---
{ v: [{}] }
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
templating("lenient-array-behavior")`
a=foo
b=bar
c=baz
{
  "a": ![ ..."{{a}}" ],
  "b": ![ ..."{{b}}" ],
  "c": ![ ..."{{c}}" ]
}
---
{
}
`();

// either {a: ["foo"]} or {a: "foo"} would be acceptable, but let's
// make sure it doesn't change by surprise.
templating("lenient-array-behavior-expanded-by-value")`
a=[foo]
{
  "a": ![ ..."{{a.@value}}" ]
}
---
a=[foo]
{
  "a": "foo"
}
`();

templating("lenient-array-behavior-valued-match-to-array")`
{
  "b": ![ ..."{{b.@value}}" ]
}
---
{
  "b": ["bar"]
}
---
b=[bar]
{
  "b": ["bar"]
}
`();

templating("lenient-array-behavior-valued-match-to-value")`
{
  "b": ![ ..."{{b.@value}}" ]
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

templating("lenient-array-behavior-non-unit-case")`
{
  "a": ![..."{{a.@value}}"],
  "b": ![..."{{b.@value}}"]
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

templating("lenient-array-behavior-non-unit-case-explicit")`
{
  "a": elements("{{a.@value}}"),
  "b": elements("{{b.@value}}")
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

templating("keyed-list-value-rendering")`
map={ x=1, y=2 }
keyed({ id: "{{key}}" }, elements({
  "id": "{{map.@key}}", // should this be implied from the match archetype?
  "a": "{{map.@value}}"
}))
---
*
[{ "id": "x", "a": 1 }, { "id": "y", "a": 2 }]
`();

templating("keyed-list-merging-and-value-rendering")`
map={ x={ a=1, b=2 }, y={ a=3, b=4 }}
keyed({ id: "{{key}}" }, elements({
  "id": "{{map.@key}}", // should this be implied from the match archetype?
  "a": "{{map.a}}"
}))
---
keyed({ id: "{{key}}" }, elements({
  "b": "{{map.b}}"
}))
---
*
[{ "id": "x", "a": 1, "b": 2 }, { "id": "y", "a": 3, "b": 4 }]
`();

templating("keyed-list-merging-and-value-rendering-reuse-value")`
map={ x=xx, y=yy }
keyed({ id: "{{key}}" }, elements({
  "id": "{{map.@key}}",
  "a": "{{map.@value}}"
}))
---
keyed({ id: "{{key}}" }, elements({
  "b": "{{map.@value}}"
}))
---
*
[{ "id": "x", "a": "xx", "b": "xx" },
 { "id": "y", "a": "yy", "b": "yy" }]
`();

templating("mv-keyed-list-matching")`
keyed$mv({ id: "{{key}}" }, elements({
  "id": "{{map.a.@key}}", // should this be implied from the match archetype?
  "a": "{{map.a.@value}}"
}))
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

templating("mv-keyed-list-rendering-by-value")`
map={x={a=[xx,xy]},y={a=[yy,yz]}}
keyed$mv({ id: "{{key}}" }, elements({
  "id": "{{map.@key}}",
  "a": "{{map.a.@value}}"
}))
---
*
[{ "id": "x", "a": "xx" },
 { "id": "x", "a": "xy" },
 { "id": "y", "a": "yy" },
 { "id": "y", "a": "yz" }]
`();

templating("keyed-tuple-list-mapping")`
keyed(["{{key}}", undefined],
elements(["{{headers.@key}}", "{{headers.value}}"]))
---
[["a", "AAA"],
 ["b", "BBB"]]
---
headers={a={value=AAA}, b={value=BBB}}
[["a", "AAA"],
 ["b", "BBB"]]
`();

templating("keyed-tuple-list-value-rendering")`
headers={a={value=AAA}, b={value=BBB}}
keyed(["{{key}}", undefined],
elements(["{{headers.@key}}", "{{headers.value}}"]))
---
*
[["a", "AAA"],
 ["b", "BBB"]]
`();

templating("mix-match")`
[..."{{array.@value}}"]
---
["a","b"]
---
array=[a,b]
["a","b"]
`();

templating("keyed-new-syntax")`
headers={a={value=AAA}, b={value=BBB}}
[key, undefined] * [
  ...[headers.$key, headers.value]
]
---
*
[["a", "AAA"],
 ["b", "BBB"]]
`();

templating("keyed-merging-new-syntax")`
map={ x=xx, y=yy }
{ id: key } * [...{
  "id": map.$key,
  "a": map.$value
}]
---
{ id: key } * [...{
  "b": map.$value
}]
---
*
[{ "id": "x", "a": "xx", "b": "xx" },
 { "id": "y", "a": "yy", "b": "yy" }]
`();

templating("keyed-merging-new-syntax-expression")`
map={ x={value=xx}, y={value=yy} }
{ id: $key } * [...{
  id: map.$key,
  a: map.value,
  a1: ( value + 1 )
}]
---
*
[{ "id": "x", "a": "xx", "a1": "xx1" },
 { "id": "y", "a": "yy", "a1": "yy1" }]
`();

templating("nested-kv-export")`
keyed({ id: "{{key}}" }, elements({
  id: "{{map.@key}}",
  nested: keyed({ id: "{{key}}" }, elements({
    id: "{{map.nested.@key}}",
    value: "{{map.nested.@value}}"
  }))
}))
---
[{ id: 'hello', nested: [{ id: 'x', value: 'y' }, { id: 'p', value: 'q' }] }]
---
map={ hello={ nested={ x=y, p=q } } }
[{ "id": "hello", "nested": [
  { "id": "x", "value": "y" },
  { "id": "p", "value": "q" }
]}]
`();

templating("nested-kv-import")`
map={ hello={ nested={ x=y, p=q } } }
keyed({ id: key }, elements({
  id: map.$key,
  nested: keyed({ id: key },elements({
    id: map.nested.$key,
    value: map.nested.$value
  }))
}))
---
*
[{ "id": "hello", "nested": [
  { "id": "x", "value": "y" },
  { "id": "p", "value": "q" }
]}]
`();

templating("mapped-mv")`
{ id: key } ** [
  ...{ value: items.$value.$value }
]
---
[
  { id: 'a', value: 1 },
  { id: 'a', value: 2 },
  { id: 'b', value: 1 },
  { id: 'b', value: 2 },
  { id: 'b', value: 3 },
]
---
items={
 a=[1,2]
 b=[1,2,3]
}
`();

templating("unmapped-mv")`
items={
 a={ values=[1,2] }
 b={ values=[1,2,3] }
}
{ id: key } ** [
  ...{ id: items.$key, value: items.values.$value }
]
---
*
[
  { id: 'a', value: 1 },
  { id: 'a', value: 2 },
  { id: 'b', value: 1 },
  { id: 'b', value: 2 },
  { id: 'b', value: 3 },
]
`();

templating("unmapped-mv-value-value")`
items={
  a=[1,2]
  b=[1,2,3]
}
{ id: key } ** [
  ...{ id: items.$key, value: items.$value.$value }
]
---
*
[
  { id: 'a', value: 1 },
  { id: 'a', value: 2 },
  { id: 'b', value: 1 },
  { id: 'b', value: 2 },
  { id: 'b', value: 3 },
]
`();

templating("scalar-conversions")`
{
  a
}
---
{
  a: 100,
  ac: a,
  as: string(a),
  an: number(a),
  ab: bool(a)
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

templating.fails("scalar-matching")`
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

templating("bigint")`
{
  a: bigint()
}
---
{
  "a": 18051727547282341502540305388584042500
}
---
*
{
  "a": 18051727547282341502540305388584042500
}
`();

templating("tpl-quoted-value")`
a-b=a-b-c
{
  a: $\`a-b\`
}
---
*
{
  "a": "a-b-c"
}
`();

templating("tpl-structured-value")`
items=[
  { a-b = 10 },
  { a-b = 20 }
]
{
  a: [
    ...$\`items.a-b\`
  ]
}
---
*
{
  "a": [ 10, 20 ]
}
`();

templating("tpl-expression-value")`
a-b=c
{
  a: ($\`a-b\`)
}
---
*
{
  "a": "c"
}
`();

templating("aggregate-value-elements")`
{
  items: [...items]
}
---
{
  items: ["a", "b", "c"],
  z: items
}
---
{
  items: ["a","b","c"],
  z: ["a", "b", "c"]
}
`();

templating("aggregate-complex-elements")`
{
  items: [...[items.x, items.y]]
}
---
{
  items: [["a","A"], ["b","B"], ["c","C"]],
  z: items
}
---
{
  items: [["a","A"], ["b","B"], ["c","C"]],
  z: [{ x: "a", y: "A" }, {x: "b", y: "B"}, {x: "c", y: "C"}]
}
`();

templating("aggregate-value-fields")`
{
  items: { key } * [...{ key, value: items.$value }]
}
---
{
  items: [{ key: "a", value: "A"}, { key: "b", value: "B" }, {key: "c", value: "C" }],
  z: items
}
---
{
  items: [{ key: "a", value: "A"}, { key: "b", value: "B" }, {key: "c", value: "C" }],
  z: { a: "A", b: "B", c: "C" }
}
`();

templating("aggregate-complex-fields")`
{
  items: { key } * [...{ key, value: items.field }]
}
---
{
  items: [{ key: "a", value: "A"}, { key: "b", value: "B" }, {key: "c", value: "C" }],
  z: items
}
---
{
  items: [{ key: "a", value: "A"}, { key: "b", value: "B" }, {key: "c", value: "C" }],
  z: { a: { field: "A" }, b: { field: "B" }, c: { field: "C" } }
}
`();

templating("aggregate-array-of-map")`
{
  items: { key } * [...{ key, value: [...items.each], which: (each.join("")) }]
}
---
{
  items: [{ key: "a", value: ["A"]}, { key: "b", value: ["B","C"] }, {key: "c", value: ["D","E","F"] }],
  z: items
}
---
{
  items: [{
    key: "a", value: ["A"],
    which: "A"
  }, {
    key: "b",
    value: ["B","C"],
    which: "BC",
  }, {
    key: "c",
    value: ["D","E","F"],
    which: "DEF"
  }],
  z: {
    a: { each: ["A"] },
    b: { each: ["B","C"] },
    c: { each: ["D","E","F"] } }
}
`();

templating("mixed-styles")`
flag=true
{
  flag: "{{?flag}}" as bool
}
---
{
  flag: true
}
`();

templating("render-sum")`
{
  items: [...items]
}
---
{
  items: [1,2,3,4,5],
  total: (items.reduce((a, b) => a + b, 0))
}
---
{
  items: [1,2,3,4,5],
  total: 15
}
`();

templating("merge-operator")`
{
  x: a = b = "hello"
}
---
a=hello b=hello
{
  "x": "hello"
}
`();

templating("merge-operator-value-first")`
{
  x: "hello" = b = a
}
---
a=hello b=hello
{
  "x": "hello"
}
`();

templating("merge-operator-value-middle")`
{
  x: b = "hello" = a
}
---
a=hello b=hello
{
  "x": "hello"
}
`();

templating("merge-operator-array-archetype-and-array")`
{
  x: [...{ p: xs.p, q: xs.q = (1) }] = [{ p: "hello" }, { p: "world", q: 7 }] 
}
---
xs=[{ p=hello, q=1 }, { p=world, q=7 }]
{
  "x": [{ "p": "hello", "q": 1 }, { "p": "world", "q": 7 }]
}
`();

// not sure if we _should_ support adding array archetypes post-hoc
// marking as todo for now.
templating.todo("merge-operator-array-and-array-archetype")`
{
  x: [{ p: "hello" }] = [...{ p: xs.p, q: xs.q = (1) }]
}
---
xs=[{ p=hello, q=1 }]
{
  "x": [{ "p": "hello", q: 1 }]
}
`();

templating.fails("incompatible-regex-via-reference")`
{
  x: x = /a/,
  y: x,
}
---
{
  y: 'b'
}
---
{
  x: 'b',
  y: 'b'
}
`();

templating("expr-and-resolution-ref-conflict")`
{
  x: x = (10),
  y: x = 30,
}
---
{
  x: 30,
  y: 30
}
`();

templating("array-reference-and-expansion")`
x = [1]
{
  x
}
---
{
  items: [...x]
}
---
{
  x: [1],
  items: [1]
}
`();

// we can't yet (?) "resolve" x into the internal representation
// that expands back into { items: [...x] } (but you can use `items: x` or `items: (x.map(...))`)
templating.todo("resolved-references")`
{
  x: [...x]
}
---
{
  x: [1,2,3,4],
  items: [...x]
}
---
{
  x: [1,2,3,4],
  items: [1,2,3,4]
}
`();

templating.fails("undefined-scalar")`
{ x: "{{x}}" }
---
{ }
`();

templating.fails("undefined-reference")`
{ x }
---
{ }
`();

templating("merged-references")`
{
  x: hidden(a = (10)),
  y: b = c = a
}
---
{
}
---
b=10
c=10
a=10
{
  y: 10
}
`();

templating("cyclic-undefined/alternate")`
{ c, y: a = (1 + 2 + 3), x: a = b, z: c = b }
---
{ x: 6, y: 6, z: 6, c: 6 }
`();

templating("cyclic-undefined")`
{ c, y: a = (1 + 2 + 3), x: b = a, z: c = b }
---
{ x: 6, y: 6, z: 6, c: 6 }
`();

templating("cyclic-undefined-chained-evaluation")`
{ c, y: a = (1 + 2 + 3), x: (a + 1) = b, z: c = b }
---
{ x: 7, y: 6, z: 7, c: 7 }
`();

templating("evaluate-input-aggregate")`
x=[1,2,3,4]
{ x: [...x], z: (x) }
---
*
{ x: [1,2,3,4], z: [1,2,3,4] }
`();

templating("match-eval-aggregate")`
{ x: [...y] }
---
{ x: ([1,2,3,4]) }
---
*
{ x: [1,2,3,4] }
`();

templating("self-matching-spread-evaluation")`
a=[{x=1},{x=2},{x=3},{x=4}]
{ a: [...{ x: a.x }] }
---
{ a }
---
{ a: [{x:1},{x:2},{x:3},{x:4}] }
`();

templating("evaluated-items")`
a=[1,2]
{ a: [...a], b: [...[a.$value, ($\`a.@value\` * 2)]] }
---
{ a: [1,2],
  b: [[1,2],[2,4]] }
`();

templating("matching-references-with-expressive-defaults")`
{ x: x = ([1, 2, 3]), y: y = ([4, 5, 6]) }
---
{ x: ['a', 'b'] }
---
*
{ x: ['a', 'b'], y: [4, 5, 6]}
`();

templating("conflict-with-defaults-interpolate")`
done=true
{
  done: bool("{{done = false}}")
}
---
*
{
  done: true
}
`();

templating("conflict-with-defaults-ref")`
done=true
{
  done: done.$bool = (false)
}
---
*
{
  done: true
}
`();

templating("form-merging")`
form({ "a": "b" })
---
c=d&e=f
---
*
a=b&c=d&e=f
`();

templating("form-item-merging")`
form({ "a": "b" })
---
c=d
---
*
a=b&c=d
`();

templating("form-form-merging")`
form({ "a": "b" })
---
form({ "c": "d" })
---
*
a=b&c=d
`();

templating("example-one")`
{ b }
---
{
  a: "{{a = b + ''}}",
  b: 20
}
---
*
{ a: "20", b: 20 }
`();

templating("example-two")`
{
  b: b = 20
}
---
*
{ b: 20 }
`();

templating.fails("example-fail")`
{
  b: b = 20 = 30
}
---
*
{ b: 20 }
`();

templating("scoped-objects")`
{
  ...{ x: obj.x, y: obj.y }
}
---
{
  a: { x: 1, y: 2 },
  b: { x: 7, y: "abc" }
}
---
obj={ a={ x=1 y=2 } b={ x=7 y=abc } }
{
  a: { x: 1, y: 2 },
  b: { x: 7, y: "abc" }
}
`();

templating("scoped-objects-rendering")`
obj={ a={ x=1 y=2 } b={ x=7 y=abc } }
{
  ...{ x: obj.x, y: obj.y }
}
---
obj={ a={ x=1 y=2 } b={ x=7 y=abc } }
{
  a: { x: 1, y: 2 },
  b: { x: 7, y: "abc" }
}
`();

templating("scoped-objects-unpacking")`
{
  ...{ x: obj.x, y: obj.y }
}
---
{
  a: { x: 1, y: 2 },
  b: { x: 7, y: "abc" }
}
---
obj={ a={ x=1 y=2 } b={ x=7 y=abc } }
{
  a: { x: 1, y: 2 },
  b: { x: 7, y: "abc" }
}
`();

templating("scoped-merging")`
a={ q=b }
{ ...{ a: a.$value } }
---
{ q: { a: "b", c: 10 } }
---
*
{
  "q": { "a": "b", "c": 10 }
}
`();

templating("number-reference")`
{ x: number(x) }
---
{ x: 7, y: (x * 3) }
---
*
{
  x: 7,
  y: 21
}
`();

templating("render-reference")`
{ x: x }
---
{ x: (7), y: (x * 3) }
---
*
{
  x: 7,
  y: 21
}
`();

templating("number-render-reference")`
{ x: number(x) }
---
{ x: n = (7), y: y = (x * 3) }
---
*
{
  x: 7,
  y: 21
}
`();

// why is z=1, and not z="1" ?
// because the expression value is assigned to the variable prior to conversion,
//
// otherwise using both `string(z)` and `number(z)` in the same template
// would conflict on the type of `z`.
templating("cast-ref-with-expr")`
{ x: string((1)), y: z = string((1)) }
---
z=1
{ x: "1", y: "1" }
`();

templating("text-and-json")`
[schema]: body
text("{{json}}")
---
{}
---
json='{}'
{}
`();

templating("double-encodings")`
base64(json(content)) = "eyAieCI6IDcgfQ=="
---
content={ x=7 }
"eyJ4Ijo3fQ=="
`();

templating.only("reference-binding-in-encodings")`
base64(json(content) = j) = "eyAieCI6IDcgfQ=="
---
j='{"x":7}'
content={ x=7 }
"eyJ4Ijo3fQ=="
`();

templating("reference-binding-in-encodings-alt-order")`
base64(x = json(content)) = "eyAieCI6IDcgfQ=="
---
x='{"x":7}'
content={ x=7 }
"eyJ4Ijo3fQ=="
`();
