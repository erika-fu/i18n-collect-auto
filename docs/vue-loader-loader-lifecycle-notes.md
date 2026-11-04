# Vue Loader and Webpack Loader Lifecycles

## Scope

These notes explain how `vue-loader`, `i18n-collect/myloader`, and the normal JavaScript, template, and CSS loaders relate during a webpack build. They describe the Vue 2 / Vue CLI integration in `apps/demo`.

## The two request layers

A Vue single-file component is not compiled as one flat loader pipeline.

1. Webpack first builds the root SFC request, for example `src/App.vue`.
2. `vue-loader` parses that SFC and emits generated module code that depends on block requests, such as:

   ```text
   src/App.vue?vue&type=script
   src/App.vue?vue&type=template
   src/App.vue?vue&type=style&index=0&lang=css
   ```

3. Webpack builds each block request as its own module. Each has its own matched rules, loader list, loader context, pitch phase, and normal phase.

Consequently, a root `App.vue` request and a `App.vue?vue&type=template` request are separate lifecycles. A statement that `vue-loader` runs before a block collector means that the root request creates the block request first. It does **not** mean that a `vue-loader` normal function runs before `myloader.pitch()` in one loader chain.

## Loader execution within one request

For one matched loader list:

```text
Configured list: A -> B -> C
Pitch phase:     A.pitch -> B.pitch -> C.pitch
Normal phase:    C        -> B        -> A
```

Webpack completes the pitch traversal before it starts the normal traversal for that request, unless a pitch function short-circuits the request by returning a result.

`enforce` affects how webpack constructs the final rule order before those phase rules apply:

- `pre` rules are placed before normal rules;
- normal rules follow;
- `post` rules are placed after normal rules;
- inline loader prefixes can further alter whether normal, pre, or post rules participate.

`enforce` does not create a third execution phase. After webpack has built the final list, every loader in it still follows the same left-to-right pitch and right-to-left normal traversal.

## What the collector does

`myloader` collects in `pitch`:

```js
loader.pitch = function pitch() {
  runCollect(this, fs.readFileSync(this.resourcePath, 'utf8'))
  if (this.data) this.data.collected = true
}
```

Pitch does not receive a `source` argument from webpack. The collector explicitly reads `resourcePath`, so its normal collection path starts from bytes on disk rather than from the output of another loader.

The normal loader function is deliberately transparent:

```js
function loader(source, sourceMap, meta) {
  if (!this.data || !this.data.collected) runCollect(this, source)
  this.callback(null, source, sourceMap, meta)
}
```

If pitch collected successfully, `this.data.collected` prevents duplicate collection. The normal function passes transformed source, source maps, and metadata to the next loader unchanged.

## Why Vue uses the original SFC as the source of truth

A Vue block request identifies one semantic block through `resourceQuery`, while `resourcePath` still identifies the complete physical `.vue` file. For example:

```text
resourcePath:  /project/src/App.vue
resourceQuery: ?vue&type=template&id=abc
```

The collector uses the query to identify the block and the original SFC text to locate it and preserve original `.vue` source coordinates.

This also protects the normal-phase fallback. If pitch did not record collection for a particular request, `myloader` can reach its normal function with source that has already been changed by loaders to its right in the block request's loader list—for example, a template compiler, Babel, or a CSS transform. For Vue blocks, collection therefore rereads the complete original SFC and locates the requested block instead of treating fallback `source` as authoritative.

This is not a claim that `myloader.pitch()` receives transformed source. In the usual path, it reads original bytes itself. The extra Vue read is primarily a defensive invariant for fallback collection and original-coordinate recovery; in the successful pitch path it duplicates the earlier disk read.

## Current demo integration

The Vue CLI demo inserts the collector into:

- the JavaScript chain before `thread-loader`, so the collector stays in webpack's main process and Babel can run later in a worker;
- Vue template, script, and style block request rules selected with `resourceQuery`;
- ordinary CSS rules;
- the explicit HTMLWebpackPlugin template loader request.

The repository's loader-order integration test resolves the final Vue CLI configuration and inspects real webpack loader lists. This matters because chain-webpack declarations and rule names alone do not prove the runtime order.

## Debugging checklist

When a loader order looks impossible, first ask:

1. Is this one module request, or a root `.vue` request plus a `?vue&type=...` block request?
2. What is the final loader list for that exact request after VueLoaderPlugin and all rules have run?
3. Which phase is being discussed: pitch or normal?
4. Does a rule use `enforce: 'pre'` or `enforce: 'post'`, or does the request use an inline-loader prefix?
5. Is `myloader` collecting in pitch, or did it take its normal-phase fallback?

Keeping those questions separate prevents confusing request recursion with loader-phase order.
