# Product

## Problem

A ticket states the outcome someone wants. It rarely says how the code behaves today, which
components are involved, which decisions are still open, or how the change will be tested. The
engineer who picks it up rediscovers all of that, then either guesses at the missing decisions
or interrupts someone to ask.

## What ReadySpec does

It reads the actual repository, then produces a brief an engineer can review and implement:

- requested outcome, scope and explicit non-goals
- **existing behavior**, each statement tied to file and line evidence
- decisions the human made, and questions still open
- proposed acceptance criteria, each connected to evidence, affected components and a test
- implementation sequence, test plan, risks and explicit assumptions

## Target user

An engineer or technical lead preparing a ticket for implementation. Not (yet) a manager tracking
delivery: the MVP measures nothing about company-wide time to market and makes no such claim.

## The four kinds of content

The interface, the schema, the verifier and the exports all keep these apart:

| Kind | Meaning | Rule |
|---|---|---|
| **Observed** | What the code does today | Must cite evidence; verified against the pinned snapshot |
| **Proposed** | A change, criterion, step or test | Never phrased as existing behavior |
| **Assumed** | An explicit, temporary assumption | Must say what would replace it |
| **Unresolved** | A decision that needs a human | Never chosen silently; stays visible until answered |

## Core flow

1. **Select** one repository (inside an allowed root) and enter a ticket.
2. **Investigate** locally: snapshot the repository, find relevant code. No model call.
3. **Consent**: review exactly which excerpts would be sent to the model, then approve.
4. **Clarify**: at most five prioritized questions per round (three rounds max). Suggested
   answers are options, never decisions. Any question can be deferred and stays open.
5. **Brief**: generated from the recorded decisions, then verified deterministically.
6. **Review**: edit inline, re-verify on save, approve (human, named reviewer), export
   Markdown or JSON.

## The standout interaction

Select an acceptance criterion and the evidence explorer shows, together: the source excerpts it
builds on (others dim), the affected components, its proposed tests, delivering steps, the
decisions it relies on and any open questions blocking it.

## Question policy

Ask only when an answer would materially change behavior, scope or testing. Do not ask what the
code or docs already settle. Do not repeat answered questions. If nothing material is open,
return no questions and say why.

## MVP scope

In: one repository per session, one model provider, saved sessions (SQLite), evidence
validation, Markdown/JSON export, a visible activity log, cancellation, resumable failures,
usage limits.

Out: editing repositories, running their code, installing dependencies, PR creation, Slack or
Jira, organization-wide indexing, reviewer routing, delivery dashboards, embeddings, multiple
cooperating agents. Each needs a demonstrated gap before it is added.

## Demonstration data

The bundled repository (`fixtures/demo-repository`) is fictional demo code written for ReadySpec.
It is **not** BetterMe's code or system, and everything derived from it is labelled as demo data.
