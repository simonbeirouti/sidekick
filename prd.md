# PRD: Sidekick AI

## Overview
Sidekick AI is a persistent student assistant that runs alongside third-party learning websites. It should understand page content, interact with the site when needed, and preserve the student’s context across devices.

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

### Fallbacks
- Electron: viable if webview orchestration or native integration becomes a blocker.
- Browser extension: last-resort option if desktop distribution becomes infeasible.

## Validation Tests
### 1. Identity Leak Test
- Inject a malicious script into a target-site webview.
- Success: the script cannot access the Supabase session or JWT because secrets remain in Rust and the system keychain.

### 2. Session Recovery Test
- Log into a target site, force an app crash, and reopen the app.
- Success: the site session is restored and the AI resumes without requiring the student to log in again.

### 3. CSP / DOM Access Test
- Load a site with strict security policies and attempt to capture useful page context.
- Success: Sidekick can still extract the required DOM content through the desktop app architecture.

## Core Architecture
### Dual-Webview Workspace
- The app must support two webviews in the same window.
- One webview hosts the Sidekick AI interface.
- One webview hosts the active third-party learning site.
- Both must remain visible so the assistant can operate alongside the student’s live browsing session.

### Page Understanding and Action Layer
- The system must be able to read the current page state, including visible content, DOM structure, and relevant interactive elements.
- The system must be able to execute actions against the page, such as clicking, typing, navigating, and extracting updated context after each step.
- AI behavior should follow a loop of observe, reason, and act so the assistant can respond to the page as it changes.

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
| User settings | Supabase database | Row updates |

## Technical Requirements
- Desktop-first architecture with support for at least two embedded webviews in a single window.
- Shared window layout that keeps the AI interface and target site visible at the same time.
- A bridge for securely reading page content, DOM state, and interaction targets from the site webview.
- A bridge for executing page actions in the site webview, including click, type, scroll, and navigation events.
- An AI runtime capable of turning page observations into next-step actions within the active session.
- Support for an observe -> reason -> act loop with updated page context after every interaction.
- Rust backend with secure local credential storage.
- Supabase for auth, database, storage, and realtime messaging.
- Hardware-backed key storage where available.

## Open Risks
- Syncing third-party session state across devices may be brittle across sites.
- CAPTCHA handling may require site-specific logic.
- Some sites may resist automation or DOM inspection despite desktop-webview control.

## Success Criteria
- A student can sign in on one device and continue on another with the same memory and settings.
- Sensitive credentials never become accessible to page-level JavaScript.
- Target-site sessions can be restored reliably enough for real-world study flows.
- Sidekick can recover from blocked interactions by handing off to the student on another device.
- Sidekick can see the live state of the target page and execute actions in that same session without breaking the side-by-side experience.
