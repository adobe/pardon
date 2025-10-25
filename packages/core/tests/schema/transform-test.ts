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

import assert from "node:assert";
import { applyTsMorph } from "../../src/core/evaluation/expression.js";
import { jsonSchemaTransform } from "../../src/core/request/eval-template.js";
import { it } from "node:test";

const transforms = Object.assign(
  (testname: string, mode?: "only" | "skip" | "fails" | "todo") => ({
    from: (source: string) => ({
      to: (expected: string) => {
        let expectedSymbols: Set<string>;
        let expectedLiterals: Set<string>;

        function execute() {
          const { morphed, unbound } = applyTsMorph(
            source.trim(),
            jsonSchemaTransform,
          );

          assert.equal(morphed, expected.trim());
          if (expectedSymbols) {
            assert.deepEqual(unbound.symbols, expectedSymbols);
          }
          if (expectedLiterals) {
            assert.deepEqual(unbound.literals, expectedLiterals);
          }
        }

        (mode == "only" || mode === "skip" ? it[mode] : it)(testname, () => {
          try {
            execute();
          } catch (ex) {
            if (mode === "fails" || mode === "todo") {
              return;
            }

            throw ex;
          }
        });

        return {
          symbols(...symbols: string[]) {
            expectedSymbols = new Set(symbols);
            return {
              literals(...literals: string[]) {
                expectedLiterals = new Set(literals);
              },
            };
          },
          literals(...literals: string[]) {
            expectedLiterals = new Set(literals);
          },
        };
      },
    }),
  }),
  {
    skip: (name: string) => transforms(name, "skip"),
    only: (name: string) => transforms(name, "only"),
    todo: (name: string) => transforms(name, "todo"),
    fails: (name: string) => transforms(name, "fails"),
  },
);

transforms("parens-to-expressions").from("(a)").to(`$.$expr("a")`).symbols();

transforms("optional-chain").from("a?.b").to(`a?.b`).symbols("a");

transforms("parens-as-assignments")
  .from("b = ('hello')")
  .to(`b.$expr("'hello'")`);

transforms("parens-with-noexport-modifier")
  .from("b = ('hello') as internal")
  .to(`b.$noexport.$expr("('hello')")`);

transforms("no-parens") //
  .from("b = 'hello'")
  .to(`$merged(b, 'hello')`)
  .symbols("$merged", "b");

transforms("as-secret") //
  .from("{ data: data as secret }")
  .to(`{ data: data.$secret }`)
  .symbols("data");

transforms("no-parens-with-modifier")
  .from("b = 'hello' as secret")
  .to(`$merged('hello', b.$secret)`)
  .symbols("$merged", "b");

transforms("parens-with-redact-modifier")
  .from("b.$secret = ('hello')")
  .to(`b.$secret.$expr("'hello'")`);

transforms("plus-as-flow").from("+x").to(`$export(x)`).symbols("x", "$export");

// todo: create a template that can merge two templates,
// maybe
//        and("{{ a }}", "{{ b = c }}")
transforms("reference-reference")
  .from("a = b = (c)")
  .to(`$merged(a, b.$expr("c"))`)
  .symbols("a", "b", "$merged");

transforms("regexp").from("/abc/").to(`"{{ % /abc/ }}"`).symbols();

transforms("regexp-binding")
  .from("a = /abc/")
  .to(`"{{ a % /abc/ }}"`)
  .symbols();

transforms("regexp-binding-with-hyphenated-variable")
  .from("$`a-b` = /abc/")
  .to(`"{{ a-b % /abc/ }}"`)
  .symbols();

transforms("regexp-binding-with-hyphenated-variable-and-path")
  .from("$`a-b`.c = /abc/")
  .to(`"{{ a-b.c % /abc/ }}"`)
  .symbols();

transforms("regexp-binding-and-value")
  .from("a = (x) % /abc/")
  .to(`"{{ a = $$expr(\\"x\\") % /abc/ }}"`);

transforms("regexp-binding-and-value-hyphenated")
  .from("$`a-b` = (x) % /abc/")
  .to(`"{{ a-b = $$expr(\\"x\\") % /abc/ }}"`);

transforms("template-binding")
  .from("`<<${ abc }::${ xyz.pqr = 100+5 }>>`")
  .to(`"<<{{ abc }}::{{ xyz.pqr = $$expr(\\"100+5\\") }}>>"`);

transforms("kv-expression")
  .from(`[key, undefined] * [ ...[headers.$key, headers.$value] ]`)
  .to("$keyed([key, undefined], $elements([headers.$key, headers.$value]))")
  .symbols("$keyed", "$elements", "key", "undefined", "headers");

transforms("required-regex").from(`x! % /abc/`).to(`"{{ !x % /abc/ }}"`);
transforms("required-regex")
  .from(`x.y.z! % /abc/`)
  .to(`"{{ !x.y.z % /abc/ }}"`);

transforms("multi-kv-expression")
  .from(`{ id: key } ** { id: map.$key, value: map.each.$value }`)
  .to("$keyed$mv({ id: key }, { id: map.$key, value: map.each.$value })")
  .symbols("$keyed$mv", "key", "map");

transforms("array-with-value")
  .from(`{ x: [a.$value] }`)
  .to(`{ x: [a.$value] }`)
  .symbols("a");

transforms("kv-with-computed-properties")
  .from(
    `
{ id: key } * [...{
  id: map.$key,
  a: "{{map.value}}",
  a1: ( value + 1 )
}]`,
  )
  .to(
    `
$keyed({ id: key }, $elements({
    id: map.$key,
    a: "{{map.value}}",
    a1: $.$expr("value + 1")
}))
`,
  )
  .symbols("$keyed", "$elements", "key", "map");

transforms("function-calls")
  .from("form({ x: a = 10 })")
  .to('$form({ x: $merged(a, $$number("10")) })')
  .symbols("$form", "a", "$$number", "$merged");

transforms("distinct-operator")
  .from("~x")
  .to("$distinct(x)")
  .symbols("$distinct", "x");

transforms("merge-operator-array-archetype-and-array")
  .from(
    `
      {
        x: [...{ p: xs.p, q: xs.q = (1) }] = [{ p: "hello" }, { p: "world", q: 7 }] 
      }`,
  )
  .to(
    `
{
    x: $merged($elements({ p: xs.p, q: xs.q.$expr("1") }), [{ p: "hello" }, { p: "world", q: $$number("7") }])
}`,
  );

transforms("match-mode")
  .from(`match / { x: "{{x}}" }`)
  .to(`$match({ x: "{{x}}" })`)
  .symbols("$match");

transforms("hidden-template")
  .from(`hidden / { x: "{{x}}" }`)
  .to(`$hidden({ x: "{{x}}" })`)
  .symbols("$hidden");

transforms("scoped-objects")
  .from(`{ ...{ x: obj.x, y: obj.y } }`)
  .to(`$scoped({ x: obj.x, y: obj.y })`)
  .symbols("$scoped", "obj");

transforms("secret-spread-elements")
  .from(`[...x.$value as secret]`)
  .to(`$elements(x.$value.$secret)`)
  .symbols("$elements", "x");

transforms("export-template-literals")
  .from("{ id: +$`thing-id` }")
  .to("{ id: $export($ `thing-id`) }")
  .symbols("$export")
  .literals("thing-id");

transforms("secret-spread-unwrapped")
  .from(`![...x.$value as secret]`)
  .to(`$itemOrArray(x.$value.$secret)`)
  .symbols("$itemOrArray", "x");

transforms("reference-binding-in-encodings")
  .from('base64(json(content) = j) = "eyAieCI6IDcgfQ=="')
  .to('$merged($base64($merged($json(content), j)), "eyAieCI6IDcgfQ==")')
  .symbols("$base64", "$json", "content", "$merged", "j");
