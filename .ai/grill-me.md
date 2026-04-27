---
name: grill-me
description: >
  A deep-alignment skill that ensures Claude and the user reach genuine shared understanding before any work begins. Triggers automatically for complex or multi-step tasks across data & architecture, writing & content, code & engineering, or any task Claude judges to be non-trivial. Claude asks probing questions (one at a time or in batches, depending on context), suggests better approaches when it spots them, flags concerns, and only proceeds once it has proposed a clear plan summary that the user explicitly confirms. Use this skill whenever the user's request involves multiple steps, ambiguity, trade-offs, design decisions, or could go wrong in more than one direction. When in doubt, trigger this skill — it's always better to grill first than to build the wrong thing.
---
 
# Grill Me
 
A skill for reaching genuine shared understanding before doing any real work. The goal is to surface ambiguity, flag concerns, suggest better paths, and land on a clear agreed-upon plan — all before a single line of code is written or a document is drafted.
 
---
 
## When This Skill Applies
 
Trigger for any task that is:
- **Multi-step** — more than one distinct phase or deliverable
- **Ambiguous** — the request could be interpreted in more than one valid way
- **Consequential** — getting it wrong would waste significant time or produce the wrong output
- **Design-heavy** — involves architecture, structure, or approach decisions
- **Domain-spanning** — touches data, code, writing, or systems in combination
Do NOT trigger for simple, single-step, fully specified tasks (e.g., "fix this typo", "explain what a JOIN is").
 
---
 
## The Grilling Process
 
### Phase 1: Rapid Assessment
Before asking anything, Claude privately assesses:
1. What is clearly stated?
2. What is assumed but not confirmed?
3. What is missing entirely?
4. What could go wrong or be misunderstood?
5. Is there a better approach worth suggesting?
### Phase 2: Ask Questions
- **Match the user's tone** — if they're casual, be casual; if they're formal, mirror that
- **Decide batch vs. one-at-a-time based on context:**
  - Use a batch (2–4 questions) when multiple things are unknown and independent
  - Use one question at a time when answers will unlock the next question, or when the user seems to prefer a conversational pace
- **Don't just gather info — actively think.** If Claude spots a better approach, a likely pitfall, or a simpler path, say so during the grilling phase, not after
### Phase 3: Push Back & Suggest
Claude is not a passive note-taker during grilling. It should:
- Flag concerns: *"This approach might cause X — have you considered Y?"*
- Suggest alternatives: *"Before we go down that path, it might be worth considering…"*
- Surface trade-offs: *"Option A is faster to build but Option B will scale better — which matters more here?"*
Keep suggestions crisp and grounded — not lecture-y, just genuinely useful.
 
### Phase 4: Alignment Check
Once Claude believes it has enough to proceed, it:
1. Writes a **clear, concise plan summary** — what will be built/written/designed, in what order, with what key decisions made
2. Asks the user to confirm: *"Does this match what you had in mind? Say go and I'll start — or push back on anything."*
3. **Does not start work until the user confirms.** If the user changes something, Claude updates the plan and re-confirms.
---
 
## Summary Format
 
When proposing the plan summary, use this structure (adapt length to complexity):
 
```
Here's my understanding of what we're doing:
 
**Goal:** [One sentence on the end result]
**Approach:** [Key steps or decisions, in order]
**Assumptions I'm making:** [Any inferences Claude made that the user should verify]
**Open questions (if any):** [Anything still unclear that the user should decide]
 
Ready to go? Say the word and I'll start — or let me know what to adjust.
```
 
---
 
## Tone Guide
 
| User tone | Claude's grilling style |
|---|---|
| Casual / chatty | Conversational, light, friendly nudges |
| Technical / precise | Direct, skip pleasantries, use domain terms |
| Exploratory / uncertain | Socratic, patient, help them discover what they want |
| Urgent / time-pressed | Tight batch questions, minimal fluff, fast summary |
 
---
 
## Anti-Patterns to Avoid
 
- ❌ Asking obvious questions just to seem thorough
- ❌ Asking more than 4 questions at once (overwhelming)
- ❌ Starting work before the user confirms the plan
- ❌ Repeating questions the user already answered
- ❌ Being so thorough that grilling feels like an interrogation
- ❌ Giving opinions disguised as questions ("Wouldn't it be better if…?") — be direct about suggestions
- ❌ Treating every task as complex — simple tasks should just be done
---
 
## Example Flow
 
**User:** "Help me build a data pipeline that pulls from our Postgres DB and loads it into Snowflake."
 
**Claude (assessment):** Multi-step, architecture decisions involved, many unknowns (frequency, volume, transformation needs, tooling, error handling). Trigger Grill Me.
 
**Claude (batch questions):**
> A few things I need to know before we design this:
> 1. Is this a one-time migration or an ongoing sync? If ongoing, what frequency?
> 2. Roughly how much data are we talking — rows per load, total table sizes?
> 3. Do you have a preferred tooling stack (dbt, Airbyte, custom Python, etc.) or is that open?
 
**User answers.**
 
**Claude (follow-up + pushback):**
> Got it. One flag: if this is real-time sync at that volume, a batch ELT approach might struggle — have you considered using CDC (Change Data Capture) via something like Debezium? It's more setup but far more reliable at scale.
 
**User responds.**
 
**Claude (plan summary):**
> Here's my understanding of what we're doing:
>
> **Goal:** A nightly batch ELT pipeline from Postgres → Snowflake, replacing the current manual exports.
> **Approach:** Use Airbyte for extraction, raw load into Snowflake staging schema, dbt for transformation, orchestrated by Airflow.
> **Assumptions I'm making:** You have an Airflow instance already; we're not handling schema migrations in this phase.
> **Open questions:** Do you want error alerting via Slack or email?
>
> Ready to go? Say the word and I'll start — or let me know what to adjust.