# Sidekick Project Practices

## Purpose
This project builds Sidekick as a desktop-first assistant using Tauri, React, and Vite. The app must keep an AI interface and a live target-site webview visible in the same window, while safely reading page state and executing actions against the active session.

## Development Approach
- Prefer a desktop-first architecture. Treat Tauri as the product shell and security boundary.
- Keep responsibilities clear: React owns interface and interaction state, Tauri owns native capabilities, secure storage, window/webview control, and privileged execution.
- Build in thin vertical slices. Each slice should connect UI, command layer, and native behavior end to end before expanding scope.
- Optimize for observable flows over abstractions. We should be able to verify what the AI can see, what it decides, and what it does.

## Core Principles
- Security first. Secrets, tokens, and sensitive session material must stay out of page-level JavaScript whenever possible.
- Side-by-side operation is a product requirement, not a nice-to-have. Changes should preserve the dual-webview workflow.
- AI actions must be grounded in current page state. Avoid blind execution paths that are detached from what the app can actually inspect.
- Keep data flow explicit. Use typed interfaces between React and Tauri.
- Prefer simple, maintainable patterns over early framework-heavy abstractions.

## Architecture Boundaries
### React
- Owns layout, assistant UI, local interaction state, and presentation of page-derived context.
- Should not contain native business logic or security-sensitive behavior.

### Tauri
- Owns commands, capabilities, secure storage, window/webview lifecycle, and page automation bridges.
- Acts as the trusted execution layer for reading and acting on embedded site content.

## Workflow Expectations
- Before adding abstractions, prove the behavior in the smallest working path.
- When adding a new capability, define:
  - what the AI needs to observe
  - what action it needs to take
  - where the source of truth lives
  - how success and failure are reported back to the UI
- Prefer incremental milestones:
  1. dual-webview layout
  2. page inspection bridge
  3. action execution bridge
  4. AI observe -> reason -> act loop
  5. sync, memory, and recovery flows

## Code Quality
- Use TypeScript on the frontend and typed Rust command interfaces on the backend.
- Keep functions focused and data contracts explicit.
- Add tests around critical behavior when the codebase starts introducing logic beyond scaffolding.
- Avoid hidden side effects and implicit cross-layer coupling.

## Skills To Apply
- Use the React effect guidance in [.agents/skills/react-useeffect/SKILL.md](/Users/besi/Developer/ai/sidekick/.agents/skills/react-useeffect/SKILL.md) when deciding whether state belongs in render logic, event handlers, or effects.
- Use the React performance guidance in [.agents/skills/vercel-react-best-practices/SKILL.md](/Users/besi/Developer/ai/sidekick/.agents/skills/vercel-react-best-practices/SKILL.md) when shaping components, async flows, and rendering boundaries.
- Use the Tauri guidance in [.agents/skills/tauri-v2/SKILL.md](/Users/besi/Developer/ai/sidekick/.agents/skills/tauri-v2/SKILL.md) for commands, capabilities, window management, and Rust-side architecture.
- Use the Vite guidance in [.agents/skills/vite/SKILL.md](/Users/besi/Developer/ai/sidekick/.agents/skills/vite/SKILL.md) for build configuration and frontend tooling decisions.

## Decision Defaults
- Prefer Tauri-native capabilities over browser-only workarounds when security or session control matters.
- Prefer event handlers and derived state over effect-driven state synchronization in React.
- Prefer explicit IPC contracts over ad hoc invoke usage spread across many components.
- Prefer one clear way of doing something over multiple competing patterns in the same layer.
- Never push to git automatically. Only push branches or remote updates when the user explicitly asks for it.
