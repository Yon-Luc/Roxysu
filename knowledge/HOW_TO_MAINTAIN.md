# Codebase Knowledge Maintainer

## Purpose

Maintain a parallel semantic knowledge base inside the repository at `knowledge/`.

The knowledge base is **not documentation** and is **not a copy of source code**.
It is a structured, navigable map of:

- what the application does and why
- business rules and important states
- how major features are organized and related
- how user-facing flows work end-to-end
- which files, classes, and functions implement each concept
- architectural decisions that must not be accidentally violated

**Source code is always the implementation authority. The knowledge base explains meaning.**

---

## Core Principle

> Source code says **how**. The knowledge base says **what, why, and where**.

---

## Directory Structure

```text
knowledge/
├── AGENTS.md              ← how agents should use this knowledge base
├── .state                 ← bootstrap status and last review date
├── index.md               ← root map
├── architecture/          ← system-wide structure, tech choices
├── features/              ← one subdirectory per feature
├── business/              ← cross-cutting business rules
├── flows/                 ← end-to-end user flows
└── decisions/             ← architectural decisions agents must not violate
```

Agents navigate from `knowledge/index.md` downward. Every directory with multiple concepts has an `index.md`.

---

## Bootstrap State

`knowledge/.state` tracks whether the knowledge base has been initialized and when it was last reviewed.

```yaml
bootstrap_complete: false
last_full_review: null
```

On entry, read `.state` first:
- If `bootstrap_complete: false` → run the bootstrapping phases before doing task work
- If `bootstrap_complete: true` → proceed with targeted navigation and incremental updates

After completing bootstrap, set `bootstrap_complete: true` and record the date.

---

## Three Levels

| Level | Examples | Answers |
|---|---|---|
| **Map** | `index.md`, `features/index.md` | What exists? Where do I look? |
| **Concept** | `features/chat/index.md`, `business/permissions.md` | What does this mean? What are the rules? |
| **Implementation** | `features/chat/realtime/implementation.md` | How exactly does this work? |

Start with `index.md` files. Create child documents only when complexity justifies them.

---

---

## Domain Vocabulary

Define the canonical terms for this codebase here. Agents must use these exact
terms in all knowledge documents, code comments, and reasoning. Never use synonyms
or informal alternatives — consistency is what makes cross-document search reliable.

### Format

```markdown
### TermName
One sentence defining what it is in business/domain terms.
**Not:** common misuse or synonym to avoid.
**See:** `knowledge/features/relevant-feature/` or `src/path/to/canonical-file.ts`
```

### Rules

- If a concept doesn't have an entry here, add it before using it in a knowledge document
- If two documents use different words for the same thing, reconcile here first
- Terms defined here take precedence over variable names, class names, or comments in source
- When source code uses a different name than the canonical term, note it explicitly:
  `**In code:** RealmRepository (canonical term: Local mirror)`

### Example entries

### Collection
A user's osu! beatmap collection, represented locally and optionally synchronized
with the hub.
**Not:** "playlist", "set", "library"
**See:** `knowledge/features/collections/`

### Realm
osu!lazer's `client.realm` database. Roxysu reads it but must treat it as
osu!'s data source — never write to it, never assume its schema is stable.
**Not:** "the database", "osu db", "lazer db"
**See:** `knowledge/architecture/realm-access.md`

### Local mirror
The SQLite representation of data extracted from `client.realm`. Roxysu's own
persistent store — writable, owned, schema-controlled.
**Not:** "cache", "local db", "copy"
**In code:** `MirrorRepository`
**See:** `knowledge/architecture/local-mirror.md`

---

### Forbidden terms

These words are too vague to use alone in any knowledge document. If you find
yourself reaching for one, stop and use or define a canonical term instead.

| Forbidden | Why | Use instead |
|---|---|---|
| "database" | Ambiguous between Realm, local mirror, or any future store | `Realm`, `local mirror`, or the specific store name |
| "service" | Means different things at the HTTP, domain, and infrastructure layers | The specific layer: `domain service`, `HTTP handler`, `repository` |
| "sync" | Ambiguous between Realm→mirror extraction, mirror→hub upload, and hub→client download | `extract`, `upload`, `pull`, or the specific direction |
| "data" | Carries no meaning on its own | The specific entity: `beatmap`, `collection`, `score` |
| "update" | Ambiguous between user action, DB write, and background refresh | `edit` (user), `persist` (DB), `refresh` (background) |
| "cache" | Implies temporary storage; misrepresents the local mirror's role | `local mirror` if persistent, or name the specific cache explicitly |
| "local" | Ambiguous between local mirror, client machine, and offline state | `local mirror`, `client`, or `offline` depending on meaning |

If a new forbidden term keeps appearing in documents or agent output, add it here
rather than correcting it repeatedly at the document level.


### When a term is unknown or ambiguous

If you encounter a term that is not in this vocabulary and you cannot confidently
infer its meaning from source code and context, **stop and ask** before using it
in any knowledge document or reasoning.

Do not:
- Invent a definition and proceed
- Use a synonym that "seems close enough"
- Document it as `unknown` and move on silently

Do:
- Ask: *"I encountered the term X — is it equivalent to [nearest canonical term],
  or is it a distinct concept that needs its own entry?"*
- Wait for confirmation before writing any knowledge that depends on it
- Once confirmed, add the term to this vocabulary section before continuing

The same applies when two canonical terms seem to overlap in a specific context.
If you are not sure whether something is a `Collection` or a `Local mirror`,
ask — do not guess. Ambiguous vocabulary in knowledge documents silently
corrupts every agent that reads them afterward.

---


## Document Metadata Header

Every concept and implementation document must begin with a YAML front-matter block:

```yaml
---
last_verified: 2025-01
confidence: verified        # verified | inferred | unknown | deprecated
touches:
  - src/chat/chat.service.ts
  - src/chat/message.repository.ts
---
```

- `last_verified` — the date this document was last confirmed against source
- `confidence` — overall confidence level of the document's content
- `touches` — primary source files this document describes

Agents should treat documents older than 3 months with `inferred` or `unknown` confidence as potentially stale and re-verify before trusting.

---

## Document Structure

For concept and implementation documents, use this order when sections are relevant:

```markdown
## Purpose
## Business meaning
## Business rules
## Security rules
## Important states
## Main flows
## Implementation
## Important symbols
## Dependencies
## Depended on by
## Side effects
## Failure behavior
## Related knowledge
```

**Business meaning always precedes implementation details.**

Not every section is required. Omit what doesn't apply.

---

## Cross-feature Dependency Tracking

Two sections work together to map the dependency graph:

`## Dependencies` — what this feature needs to function:
```markdown
## Dependencies
- `features/authentication/` — user identity required before access checks
- `business/permissions.md` — conversation membership rules
- `src/events/event-bus.ts` — event publication
```

`## Depended on by` — what would break or need updating if this feature changed:
```markdown
## Depended on by
- `features/notifications/` — subscribes to `MessageCreated` event
- `features/search/` — indexes message content on creation
- `features/chat/realtime/` — listens for conversation membership changes
```

**An agent making changes to a feature must read its `## Depended on by` section before touching anything.** This is the primary mechanism for cross-feature impact awareness.

When creating or updating a feature document, check which other features reference it and add yourself to their `## Depended on by` section if missing.

---

## Security Rules Are Mandatory

Any feature that involves access control **must** include a `## Security rules` section.

Security rules must never carry `inferred` or `unknown` status — verify them directly from source before documenting.

```markdown
## Security rules

1. Only conversation members can send messages.
   **Enforced by:** `ConversationAccessService.canSend()` — status: verified
   **Unauthorized result:** throws `ForbiddenException`, request aborted before persistence

2. Blocked users cannot send messages.
   **Enforced by:** `ConversationAccessService.isBlocked()` — status: verified
   **Unauthorized result:** same as above
```

Required fields for each security rule:
- the rule itself (plain language)
- which symbol enforces it
- status (`verified` only — never infer security rules)
- what happens on unauthorized access

If a feature has access control and its security rules cannot be fully verified, mark the entire section `unknown` and flag it for review. Never omit the section.

---

## Writing Rules

**Do:**
- Describe what a feature means and why it exists
- List business rules explicitly and numbered
- Use pseudo-code for complex flows, not source reproduction
- Reference symbols precisely: `src/chat/chat.service.ts:ChatService.sendMessage()`
- Mark uncertainty explicitly (see Confidence States)

**Do not:**
- Copy source code into knowledge documents
- Write exhaustive lists of every function
- Create speculative explanations
- Turn index files into encyclopedias — they are navigation maps

### Never infer from these alone

These patterns are common sources of hallucinated business rules:

| Source | Risk |
|---|---|
| Variable or function names | `canSend` does not mean users can always send |
| Code comments | May be outdated; not authoritative |
| Test file names without reading assertions | Name alone is insufficient evidence |
| Absence of a guard | Missing check ≠ intentional open access |
| Partial reads of a function | A function may have conditions not visible in the first few lines |

Always read the full relevant implementation before documenting a rule.

### Pseudo-code example (good)

```text
sendMessage(userId, conversationId, content)
    ↓
verifyConversationMembership()
    ↓
validateContent()
    ↓
createMessage()
    ↓
publish(MessageCreated)
    ├──→ RealtimeGateway
    └──→ NotificationService
```

### Source reference example (good)

```markdown
## Important symbols
- `src/chat/chat.service.ts:ChatService.sendMessage()`
- `src/chat/conversation-access.service.ts:ConversationAccessService.canSend()`
- `src/chat/message.repository.ts:MessageRepository.create()`
```

---

## Confidence States

Never invent business logic. When intent is not obvious from source, mark it:

| State | Meaning |
|---|---|
| `verified` | Confirmed by source, tests, or constraints |
| `inferred` | Reasonable conclusion from evidence |
| `unknown` | Implementation exists but business reason is unclear |
| `deprecated` | No longer accurate; kept for history |

`unknown` is always better than a hallucinated explanation.

Security rules must always be `verified`. Never document a security rule as `inferred` or `unknown`.

Example:
```markdown
**Business rule:** Muted conversations suppress notifications.
**Status:** verified
**Source:** `NotificationService.shouldNotify()`, test: "muted conversation does not create notification"
```

---

## Evidence Sources

Business rules can be inferred from:
- validation logic and conditionals
- permission checks
- test names **and** their assertions
- database constraints (`UNIQUE`, `NOT NULL`, foreign keys)
- event handlers and domain services

Reference the evidence. Example:
```markdown
UNIQUE(user_id, conversation_id) → a user can only have one membership per conversation.
```

---

## Flows

Use `knowledge/flows/` for important end-to-end user actions. Flows are distinct from features: features describe what exists, flows describe what happens.

Required sections in a flow document:
- **User intent** — what the user is trying to do
- **Flow** — pseudo-code or arrow diagram through services/functions
- **Business guarantee** — what the system promises
- **Implementation references** — precise file/symbol links

---

## Architectural Decisions

Use `knowledge/decisions/` for constraints that agents could accidentally violate.

Required sections:
- **Decision** — what was decided
- **Reason** — why
- **Consequences** — what this implies for future changes
- **Relevant implementation** — where this is enforced

Agents must consult decisions before making architectural changes.

---

## Auto-triggers for Knowledge Review

After every code change, check which category of file was touched and review the corresponding knowledge area:

| File pattern touched | Review |
|---|---|
| `*.service.ts`, `*.controller.ts`, `*.resolver.ts` | `features/` — relevant feature concept and flows |
| `*.repository.ts`, migration files | `business/` and `decisions/` — persistence rules |
| Event names or event handlers | `flows/` — any flow that passes through that event |
| Guards, policies, permission checks | `business/permissions.md` and feature security rules |
| Config or environment variables | `architecture/` |
| Shared utilities used across features | `## Depended on by` of the changed module |

This check is mandatory. Do not skip it because the change "seems small."

---

## Pre-change Impact Checklist

Before modifying any symbol, answer:

1. Which knowledge documents reference this symbol? (search `knowledge/` for the symbol name)
2. Which flows pass through it?
3. Which decisions constrain it?
4. What does the feature's `## Depended on by` section list?
5. Could this change silently break a security rule in a dependent feature?

If any answer is non-trivial, read those documents before writing a single line of code.

---

## Maintenance Workflow

### When implementing a task

```text
1. Read knowledge/.state → determine mode (bootstrap or incremental)
2. Read knowledge/index.md
3. Navigate to relevant feature/concept
4. Read security rules and business rules
5. Read relevant flows and decisions
6. Run pre-change impact checklist
7. Inspect source implementation
8. Make the code change
9. Run auto-triggers check
10. Update affected knowledge only
11. Validate all source references still exist
12. Update last_verified date in touched documents
13. Review the knowledge diff
```

Use the knowledge base **before** modifying code, not only after.

### After refactoring (implementation changes, behavior unchanged)

Update implementation references and `touches` metadata. Do not rewrite business documentation.

### Detecting stale knowledge

When maintaining knowledge, look for:
- deleted or renamed files, functions, classes
- changed event names, routes, or database models
- contradictory business rules
- broken internal links
- documents with `last_verified` older than 3 months and confidence `inferred` or `unknown`

If a referenced symbol no longer exists, investigate and update. Never silently leave stale references.

---

## Update Report Format

When knowledge changes, the agent's final report must include:

```text
Knowledge updated:
- knowledge/features/chat/realtime/index.md
- knowledge/flows/send-message.md

Reason: Realtime delivery behavior changed.

Business behavior: Unchanged.

Implementation: Changed from direct gateway invocation to EventBus publication.

Security rules affected: None.

Depended-on features reviewed: notifications/, search/
```

---

## Creating Knowledge for a New Feature

1. Identify business purpose, concepts, user flows, and business rules
2. Identify source entry points, key functions/classes, dependencies, side effects
3. Identify access control and security rules (verify directly from source)
4. Identify architectural decisions
5. Create `features/<feature>/index.md` with metadata header
6. Add `## Security rules` if the feature has any access control
7. Add child documents only when complexity justifies them
8. Update parent index files
9. Identify which existing features this one depends on — add itself to their `## Depended on by` sections
10. Mark uncertain information as `unknown`

Do not pre-create empty documents.

---

## Bootstrapping an Existing Codebase

Work in phases. Do not attempt to document everything in one pass.

| Phase | Goal | Creates |
|---|---|---|
| 1 | Understand repo structure | `index.md`, `architecture/` |
| 2 | Identify major features | `features/*/index.md` |
| 3 | Extract business rules | `business/` |
| 4 | Document major flows | `flows/` |
| 5 | Record critical decisions | `decisions/` |
| 6 | Map security rules | `## Security rules` in each relevant feature |
| 7 | Build dependency graph | `## Dependencies` and `## Depended on by` in each feature |

After completing all phases, set `knowledge/.state` → `bootstrap_complete: true`.

Grow the knowledge base incrementally. Do not aim for perfection in one pass.

---

## AGENTS.md

Every knowledge base should include `knowledge/AGENTS.md` with instructions for agents entering the repository:

```markdown
# For agents working in this repository

1. Read knowledge/.state to determine if bootstrap is complete.
2. Start at knowledge/index.md.
3. For any feature task, read the relevant feature index before touching code.
4. For any architectural change, read knowledge/decisions/ first.
5. For end-to-end behavior, consult knowledge/flows/.
6. For any feature with access control, read ## Security rules before making changes.
7. Always run the pre-change impact checklist.
8. Business rules are authoritative only when status is `verified` or `inferred`.
9. Security rules are authoritative only when status is `verified`.
10. Update last_verified in any document you read and confirm is accurate.
```

Customize this file with repo-specific conventions, entry points, and team preferences.

---

## Minimum Knowledge Checklist

A knowledge document is useful when it answers:

- What is this feature and why does it exist?
- What are its business rules?
- Who can use it and what enforces that? (security rules)
- What happens when a user performs the main action?
- Which components and functions are involved?
- What other features depend on it?
- What constraints apply?

---

## Golden Rule

**Before changing code:**
> "What would I need to know about this system if I had never seen this repository?"

**After changing code:**
> "Did I change what this system means, its security model, or what depends on it? If so, did I update the knowledge?"

The knowledge base is a **living semantic model of the repository** — maintained alongside code, not generated from it.