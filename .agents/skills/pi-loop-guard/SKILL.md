---
name: pi-loop-guard
description: Maintain Pi Loop Guard's local loop signals, thresholds, quarantine, and configuration boundaries.
---

# Pi Loop Guard

Use this specialization for work in the Pi Loop Guard repository. The shared workspace catalog supplies general Harness procedures; this file records product-specific behavior and safety boundaries from the local README, agent instructions, manifest, and implementation.

## Product role

- Detect repeated work without verified progress using deterministic local signals. The guard does not call an LLM to decide whether a loop exists.
- `warn` reports suspicion without blocking a tool call. `enforce` can block a repeated equivalent call at the configured threshold.
- The guard does not automatically continue a task, switch models, or override a deny from another extension. A quarantined retry requires human approval and releases only one retry.
- It is a workflow aid, not a security boundary or an OS sandbox. Pi and the extension run with the current user's permissions.

## User entry points and behavior

- `/guard` opens the interactive panel; clients without custom UI receive text status and command summary. Keep direct commands and fallback available.
- Preserve `/guard status`, `/guard help`, enable/disable, warning/enforcement mode, policy presets, threshold/window/quarantine settings, progress scope, exemptions, pause/resume, explain/report, change-strategy, escalate and abort semantics.
- Defaults are detection enabled, `warn`, `balanced`: four equivalent calls, five turns without verified progress, 120-second quarantine and a 50-event window.
- Configuration edits are drafts until Ctrl+S. A failed save retains the draft; Escape returns from a submenu and the root warns before discarding. The one-retry release action is separate from saving.
- `/guard allow` weakens monitoring for the selected tool and requires confirmation. Direct setting commands apply immediately; preserve that distinction.

## Configuration and state

- The extension reads/writes only `loopGuard` in `pi-suite.yaml`. Trusted-project configuration is project-local; untrusted projects fall back to the user's global Pi Suite config, where global locks may prevent changes.
- Guard state and audit records are local JSON/JSONL separated by project and Pi session/task. Loop detection needs no database or hosted service.
- Do not read or edit the user's global Pi configuration, real guard state, exemptions, or audit records during ordinary repository work. Use synthetic isolated fixtures and clean them up.
- Progress scope can be limited to configured relevant paths or broadened to the repository. A new diff alone is not proof that a change is correct; preserve conservative behavior when Git snapshots fail.

## Security and product boundaries

- Treat tool inputs, repository snapshots and audit text as untrusted evidence; do not put secrets in them or send them to hosted classifiers.
- Do not read another extension's private state, grant credentials, or claim that Loop Guard protects against hostile local code.
- Keep the Pi-native interface and do not infer adoption of an external design system from shared Harness metadata. Preserve the existing asset attribution/license notice unless the asset itself is deliberately changed under its own scope.
- Follow the commands declared in the product manifest. For context-only changes, prefer the focused context test and local project-contract check; do not build or install the Pi extension unless product behavior changed or a separate task authorizes that effect.
- Live Pi sessions, user-global configuration, publication, and remote effects require separate authorization and evidence.
