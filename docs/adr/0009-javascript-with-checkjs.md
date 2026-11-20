# 0009 — JavaScript sources typechecked with `tsc --checkJs`

Status: Accepted

## Context

The brief requires a passing typecheck. TypeScript sources would need compilation, which
conflicts with ADR 0002 (no build step).

## Decision

Write JavaScript with JSDoc types and run `tsc -p tsconfig.json` with `allowJs` + `checkJs` and
`noEmit`. three.js types come from `@types/three`. Strict mode is off (JSDoc-annotating every
local would cost more than it catches) but `noUnusedLocals` and `noFallthroughCasesInSwitch`
are on.

## Consequences

- The typecheck catches wrong API usage (three.js, Node), typos in property names and unused
  code, without a compile step.
- It is weaker than strict TypeScript; tightening it (`strictNullChecks`) is a possible follow-up.
