# PRD: Sidekick AI

## Overview
Sidekick AI is a persistent student assistant that runs alongside third-party learning websites. It should understand page content, interact with the site when needed, and preserve the student’s context across devices.

## Current Product State
- Sidekick now runs as a native two-webview desktop workspace inside Tauri.
- The left webview hosts the assistant interface and the right webview hosts the active target page.
- The current layout uses exact native split presets of `70/30`, `50/50`, and `30/70` for left/right pane widths.
- The two panes do not visually overlap and resize together from shared native layout logic.
- The assistant can inspect the active right-side page, extract grounded context, and answer chat questions about that page.
- The assistant can now summarize the live page, extract structured interactive elements, and keep responses grounded in either whole-page or focused-asset context.
- The assistant can execute low-risk page actions against the right-side webview, currently including `click`, `type`, and `scroll`.
- The assistant supports a manual asset-picking flow so the user can hover and select an element on the right-side page for focused review and lower-token context.
- The assistant now supports inline human-in-the-loop review cards in chat for sensitive or blocked actions such as login, verification, and CAPTCHA-adjacent flows.
- The assistant shell now has a more consistent visual system built with Tailwind CSS and shadcn/ui primitives, improving UX/UI while preserving the desktop-first architecture.

## Product Goals
- Provide an AI companion that works next to educational sites instead of replacing them.
- Maintain synchronized student memory, chat history, and settings across devices.
- Preserve third-party site sessions so students can resume work from another device.
- Support remote intervention for blocked flows such as CAPTCHA challenges.

## Recommended Platform
### Primary: Tauri v2
- Multi-webview desktop app with one persistent AI interface and one or more target-site webviews.
- Native Rust backend manages authentication, storage, encryption, and sync.
- Best fit for security-sensitive session handling because credentials can stay outside the webview JavaScript context.

## Validation Tests
### 1. Identity Leak Test
- Inject a malicious script into a target-site webview.
- Success: the script cannot access the Supabase session or JWT because secrets remain in Rust and the system keychain.

### 2. Dual-View Layout Test
- Launch the desktop shell with the assistant interface on the left and the target site on the right.
- Switch between `70/30`, `50/50`, and `30/70`, then resize the window.
- Success: both panes remain visible in the same window, no overlap appears, and both webviews stay aligned to the shared native layout bounds.

### 3. Grounded Chat Test
- Open a target page and ask the assistant questions about the visible page content.
- Success: the assistant returns a useful response grounded in the current page snapshot from the right-side webview.

### 4. Page Interaction Test
- Open a target page and ask the assistant to perform a safe action such as clicking a visible control, typing into a non-sensitive field, or scrolling.
- Success: the assistant executes the action inside the active right-side session, refreshes page context, and reports the result back in chat.

### 5. Human Review Test
- Trigger a login, verification, password, or CAPTCHA-like flow and ask the assistant to continue.
- Success: the assistant pauses with an inline review card in chat, accepts human approve/edit/reject input, and resumes from that same flow.

### 6. Focused Asset Review Test
- Enable page picking, hover over an asset or interactive element, select it, and ask the assistant to review it.
- Success: the assistant uses the focused selection and nearby context instead of defaulting to a full-page summary, reducing unnecessary token usage.

### 7. Session Recovery Test
- Log into a target site, force an app crash, and reopen the app.
- Success: the site session is restored and the AI resumes without requiring the student to log in again.

### 8. CSP / DOM Access Test
- Load a site with strict security policies and attempt to capture useful page context.
- Success: Sidekick can still extract the required DOM content through the desktop app architecture.

### 9. Frontend System Baseline Test
- Build the assistant UI using Tailwind CSS and shadcn/ui primitives as the default frontend system.
- Success: the main interface can be composed from the shared design system, global styling stays minimal, and new screens do not require bespoke CSS as the default approach.

## Core Architecture
### Dual-Webview Workspace
- The app must support two webviews in the same window.
- One webview hosts the Sidekick AI interface.
- One webview hosts the active third-party learning site.
- Both must remain visible so the assistant can operate alongside the student’s live browsing session.
- Layout is controlled natively by Tauri, not by a fake placeholder pane in the frontend.
- The current supported pane presets are `70/30`, `50/50`, and `30/70` for left/right widths.

### Page Understanding and Action Layer
- The system must be able to read the current page state, including visible content, DOM structure, and relevant interactive elements.
- The system must be able to execute actions against the page, such as clicking, typing, navigating, and extracting updated context after each step.
- AI behavior should follow a loop of observe, reason, and act so the assistant can respond to the page as it changes.
- Current implemented slice: observe -> reason -> act for safe interactions. The assistant can capture whole-page state, summarize grounded context, perform `click` / `type` / `scroll` actions, refresh page state after actions, and surface inline review when a human decision is needed.
- Current implemented focus slice: manual hover-and-pick element selection for focused review, allowing the assistant to reason over a selected asset or UI target instead of sending full-page context by default.
- Next slice: expand sensitive-flow handling, broader action coverage, richer blocked-state recovery, and more durable cross-device intervention flows.

### Authentication
- Use Supabase Auth with OTP or OAuth.
- Store sessions in the system keychain, not in webview-accessible storage.
- On a new device, authenticate and restore synced student data from Supabase.

### Student Memory and App Data
- Persist chat history, user settings, and student profile data in Supabase.
- Use Realtime subscriptions where low-latency cross-device updates matter.

### Site Session Sync
- Package the target site’s local session data from the app container.
- Encrypt the session bundle with AES-256-GCM before upload.
- Restore and decrypt the bundle locally before the target-site webview starts on a new device.

### Remote Assistance
- Use Supabase Realtime to notify secondary devices when manual input is required.
- Primary example: CAPTCHA detection triggers an event, the student resolves it on another device, and the response is passed back into the active session.

## Feature Summary
| Feature | Implementation | Sync Method |
| :--- | :--- | :--- |
| Chat history | Supabase database | Realtime subscription |
| Student memory | Supabase database | Row updates + fetch on login |
| Site session | Encrypted storage bundle | Blob upload/download |
| Page context | Rust bridge from webview | Realtime or direct app state |
| Page actions | Rust/Tauri action bridge | Direct app state |
| Focused asset review | Manual page picker + grounded extraction | Direct app state |
| Human review state | Inline chat workflow + agent checkpointing | Direct app state |
| User settings | Supabase database | Row updates |

## Technical Requirements
- Desktop-first architecture with support for at least two embedded webviews in a single window.
- Shared window layout that keeps the AI interface and target site visible at the same time.
- Native split layout so the left assistant pane and right target-site pane remain synchronized with shared webview bounds.
- Support exact split presets of `70/30`, `50/50`, and `30/70` with no overlap between panes.
- A bridge for securely reading page content, DOM state, and interaction targets from the site webview.
- A bridge for executing page actions in the site webview, including click, type, scroll, and navigation events.
- Structured page element descriptors so the AI can refer to visible targets deterministically instead of relying only on raw text snapshots.
- A focused asset selection flow that lets the user hover and pick an element for low-token review and grounded follow-up.
- An AI runtime capable of turning page observations into next-step actions within the active session.
- Support for an observe -> reason -> act loop with updated page context after every interaction.
- Inline human-in-the-loop review for sensitive or blocked actions, including approve, edit, and reject decisions in chat.
- Rust backend with secure local credential storage.
- Supabase for auth, database, storage, and realtime messaging.
- Hardware-backed key storage where available.
- Tailwind CSS as the default frontend styling system.
- shadcn/ui as the default component baseline for controls, layout primitives, and reusable interface patterns.

## Open Risks
- Syncing third-party session state across devices may be brittle across sites.
- CAPTCHA handling may require site-specific logic.
- Some sites may resist automation or DOM inspection despite desktop-webview control.

## Success Criteria
- A student can sign in on one device and continue on another with the same memory and settings.
- Sensitive credentials never become accessible to page-level JavaScript.
- Target-site sessions can be restored reliably enough for real-world study flows.
- Sidekick can recover from blocked interactions by handing off to the student on another device.
- Sidekick can answer questions about the live target page using grounded page context captured from that same session.
- Sidekick can see the live state of the target page and execute actions in that same session without breaking the side-by-side experience.
- Sidekick can narrow its reasoning to a user-selected asset or element on the live page to keep reviews more precise and token-efficient.
- Sidekick can pause sensitive actions for inline human feedback and continue from the same chat flow with an actionable next step.
- Sidekick presents a stable dual-view shell where both panes remain usable, visually aligned, and non-overlapping as the window and pane presets change.
- The frontend can be extended using Tailwind and shadcn/ui as the default system instead of relying on custom page-specific CSS for each new screen.
