# 02: Resolve project-local Vue compilers

**What to build:** Add project-aware Vue compiler discovery and version selection so a template resource can use the compiler installed by its nearest owning package, including explicit override support and actionable failures.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

## Context

The package currently has no direct dependency on Vue. Native template parsing must use the compiler associated with the application being built, not a compiler version bundled by the collector. This is especially important for Vue 2, where `vue-template-compiler` must match the installed Vue version.

The repository may be used as a monorepo containing Vue 2 and Vue 3 packages at the same time. Compiler selection therefore cannot rely only on the repository root or on the installed vue-loader version.

Before implementation, read the repository agent instructions, collection architecture, loader configuration rules, resource description code, and dependency conventions.

## Decisions already made

- Resolve from the template resource's owning package by walking upward to the nearest installed `vue/package.json`.
- Select Vue 2 or Vue 3 from the discovered Vue major version.
- Vue 2 uses the owning project's `vue-template-compiler` and requires an exact compatible Vue version.
- Vue 3 uses the owning project's `@vue/compiler-sfc` and `@vue/compiler-dom`.
- Allow an explicit loader option to override automatic major-version selection for unusual layouts.
- Do not infer Vue major from vue-loader.
- Missing, unsupported, ambiguous, or incompatible installations must fail with the resource/project context needed to fix the problem.

## Acceptance criteria

- [ ] A resource in a Vue 2 package resolves that package's Vue 2 compiler.
- [ ] A resource in a Vue 3 package resolves that package's Vue 3 SFC and DOM compilers.
- [ ] A monorepo fixture with separate Vue 2 and Vue 3 packages resolves each resource independently.
- [ ] An explicit loader option can override automatic Vue-major selection without requiring callers to pass compiler objects.
- [ ] Vue 2 compiler and Vue version mismatch produces a deterministic, actionable error.
- [ ] Missing Vue, missing compiler packages, and unsupported Vue majors produce deterministic, actionable errors.
- [ ] Compiler resolution is independently testable and does not require running a full webpack build.
- [ ] Existing package tests remain green.

## Non-goals

- Do not add native template parsing in this ticket.
- Do not bundle fixed Vue compiler versions into the collector package.
- Do not install or modify application dependencies automatically.
- Do not add Vite or Rollup integration.

## Validation

- Run focused compiler-resolution tests.
- Run the complete package test suite.
- Verify error messages include enough package/resource context for a fresh user to resolve the dependency problem.

