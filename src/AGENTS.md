# React Interface Practices

## Scope
This directory owns the assistant UI, layout, and frontend state for the Sidekick experience.

## Responsibilities
- Render the assistant interface and shared application shell.
- Present page-derived context coming from Tauri.
- Trigger user-initiated actions and AI workflows through typed backend calls.
- Maintain responsive side-by-side layout for the AI panel and target-site view.

## React Guidance
- Prefer deriving values during render instead of storing derived state.
- Use effects only for real synchronization with external systems.
- Put user interaction logic in event handlers, not in effect chains.
- Keep component state local until multiple parts of the UI truly need shared ownership.
- Use `startTransition` or `useDeferredValue` when non-urgent updates could affect input responsiveness.

## Performance and Structure
- Keep components small and purposeful.
- Avoid barrel imports when direct imports are clearer.
- Split expensive or async-heavy UI paths so we do not create unnecessary render waterfalls.
- Prefer clear data boundaries between presentational components, stateful UI components, and backend integration hooks.

## Tauri Integration
- Treat Tauri calls as typed integration points, not ad hoc utilities.
- Centralize backend communication behind small frontend adapters as the project grows.
- Never assume backend actions succeeded without reflecting loading, success, and error states in the UI.

## UI Direction
- Preserve the dual-webview product model: the assistant should feel present alongside the student’s active site, not separate from it.
- Favor layouts that make the current page state, AI reasoning, and next action easy to understand.
- Keep the interface practical and inspectable before polishing for breadth.

## Avoid
- Effect-driven synchronization for values that can be calculated during render.
- Business logic hidden inside visual components.
- Repeated backend `invoke` calls spread across unrelated UI files without a shared contract.
- Premature global state when simpler component composition is enough.
