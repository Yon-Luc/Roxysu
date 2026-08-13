# AGENTS.md

## Before starting any task

The `knowledge/` directory is the source of trust for this repository.
It describes what the project does, how it is structured, and why decisions
were made. It is always more reliable than inference from source code alone.

**Read the following before writing any code or making any plan:**

1. `knowledge/.state` — bootstrap or incremental mode?
2. `knowledge/index.md` — what exists and where to find it
3. `knowledge/DOMAIN_VOCABULARY.md` — canonical terms; use no others
4. `knowledge/decisions/` — constraints you must not violate
5. `knowledge/HOW_TO_MAINTAIN.md` — how to read, update, and extend the knowledge base

Then navigate to the relevant feature or flow for your specific task.

---

## Trust hierarchy

When sources conflict, resolve in this order:

| Priority | Source | Authority |
|---|---|---|
| 1 | `knowledge/decisions/` | Architectural constraints — never violate |
| 2 | `knowledge/` business and security rules | What the system must do |
| 3 | Source code | How it currently does it |
| 4 | Your own inference | Lowest trust — never use alone for business or security rules |

---

## Vocabulary

All terms used in knowledge documents, plans, and reasoning must come from
`knowledge/DOMAIN_VOCABULARY.md`. If a term you need is not there:

- Do not invent a definition
- Do not use a synonym that seems close enough
- Ask: *"I encountered the term X — is it equivalent to [nearest canonical term],
  or does it need its own entry?"*

Wait for confirmation before proceeding.

---

## Before making any code change

Run this checklist:

1. Which knowledge documents reference the symbol you are changing?
2. Which flows pass through it?
3. Which decisions constrain it?
4. What does the feature's `## Depended on by` section list?
5. Could this change silently break a security rule in a dependent feature?

If any answer is non-trivial, read those documents before writing code.

---

## After making any code change

Check which files you touched and review the corresponding knowledge area:

| File touched | Review |
|---|---|
| `*.service.ts`, `*.controller.ts`, `*.resolver.ts` | Relevant feature in `features/` |
| `*.repository.ts`, migration files | `business/` and `decisions/` |
| Event names or handlers | `flows/` passing through that event |
| Guards, policies, permission checks | `business/permissions.md` + feature security rules |
| Config or env variables | `architecture/` |
| Shared utilities | `## Depended on by` of the changed module |

Then update any affected knowledge documents and report: