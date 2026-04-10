# Tauri Practices

## Scope
This directory owns the trusted native layer for Sidekick: app lifecycle, commands, capabilities, secure storage, and webview control.

## Responsibilities
- Manage the main window and embedded webviews.
- Expose typed commands to the frontend.
- Handle secure storage, session material, and privileged operations.
- Provide the bridge for page inspection and page action execution.

## Rust and Tauri Rules
- Keep `main.rs` thin and place application logic in `src/lib.rs`.
- Register every command explicitly in `tauri::generate_handler!`.
- Prefer `Result<T, E>` return types for commands so failures are explicit across the IPC boundary.
- Use owned types in async commands.
- Do not block the main thread with I/O or long-running work.

## Capabilities and Security
- Add the minimum required capabilities for every new native feature.
- Treat Tauri as the security boundary between the app and embedded site content.
- Keep secrets, auth state, and encrypted session artifacts outside webview-accessible storage.
- Use Tauri path APIs and app-managed storage locations instead of hardcoded filesystem paths.

## Webview Strategy
- Support and preserve a two-webview-in-one-window model.
- Keep webview management explicit: creation, labeling, navigation, teardown, and ownership should be easy to follow.
- Build page inspection and page action APIs as deliberate primitives that can later support AI orchestration.
- Prefer deterministic bridges for reading DOM state and executing actions over opaque one-off scripts.

## Command Design
- Define small, composable commands with clear payloads and return values.
- Separate UI-facing command contracts from lower-level implementation details.
- When adding automation features, model the flow as:
  1. observe page state
  2. return structured context
  3. decide next action
  4. execute action
  5. report updated state

## Avoid
- Commands that mix unrelated concerns.
- Missing capability updates when introducing new APIs or plugins.
- Silent failures across the Rust/React boundary.
- Security-sensitive logic implemented in the frontend when it belongs in Tauri.
