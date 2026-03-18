---
description: Run all tests (Rust + TypeScript)
---

Run the full test suite:

1. Run `cargo test` in `apps/desktop/` for Rust tests
2. Run `cargo clippy -- -D warnings` for Rust linting
3. Run `pnpm typecheck` for TypeScript type checking
4. Report results and fix any failures found
