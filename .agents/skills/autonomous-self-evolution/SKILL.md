---
name: autonomous-self-evolution
description: >
  Continuous Autonomous Capability Growth and Self-Evolution Engine.
  Empowers agents to learn and upgrade their capabilities in all domains
  through conversations with the operator (ลูกพี่), technical documents,
  session retrospectives, and internet search discoveries.
  Distills insights into operational wisdom, automatically updates central memory (SuperMemory),
  and synthesizes enhanced behavioral rules and specialized tools.
---

# Autonomous Self-Evolution Engine

Empowers A.T.O.M., J.A.R.V.I.S., F.R.I.D.A.Y., and U.L.T.R.O.N. to evolve continuously. Every turn, every error, every user correction, and every research discovery feeds back into the system's persistent intelligence.

---

## The 4 Evolutionary Streams

```
                       ┌─────────────────────────────────────┐
                       │    4 Streams of Continuous Input    │
                       └──────────────────┬──────────────────┘
                                          │
       ┌──────────────────┬───────────────┴───────────────┬──────────────────┐
       ▼                  ▼                               ▼                  ▼
 [ 1. Conversational  [ 2. Document & Blueprint       [ 3. Web & Research  [ 4. Error & Edge Case
   Corrections &        Deep Reading                    Discoveries          Telemetry ]
   Operator Habits ]    (AST, Specs, Codebases) ]       (New APIs/Docs) ]
       │                  │                               │                  │
       └──────────────────┴───────────────┬───────────────┴──────────────────┘
                                          │
                                          ▼
                       ┌─────────────────────────────────────┐
                       │     Evolutionary Distillation       │
                       │   - Heuristic Extraction            │
                       │   - Pattern Recognition             │
                       │   - Anti-Pattern Blacklisting       │
                       └──────────────────┬──────────────────┘
                                          │
                                          ▼
                       ┌─────────────────────────────────────┐
                       │     Permanent Knowledge Storage     │
                       │  - SuperMemory 4-Container Sync     │
                       │  - Prompt & Rule Refinement         │
                       │  - Micro-Skill Synthesis            │
                       └─────────────────────────────────────┘
```

---

## 1. Stream 1: Conversational Learning (Operator Alignment)
Whenever Boss ("ลูกพี่") speaks, commands, corrects, or expresses preference:
1. **Detect Operator Nuance:**
   - Tone preferences (e.g., "ตอบสั้นกระชับ 1-2 ประโยคสำหรับเสียง").
   - Domain preferences (e.g., "ไม่เอา Google Cloud TTS ดั้งเดิม ให้ใช้ Gemini Voice").
   - Operational habits (e.g., "บิลด์ทีเดียวตอนสรุป อย่าเพิ่งเชื่อม").
2. **Commit to Central Memory:**
   - Save directly to SuperMemory container `atom_user` with metadata `{ author: "operator_instruction", topic: "preference" }`.
3. **Instantly Align Behavior:**
   - Enforce the new rule immediately in the current and subsequent sessions.

---

## 2. Stream 2: Document & Blueprint Ingestion
When reading files, documentation, or codebase schemas:
1. Extract architectural invariants (e.g., navigation patterns, state management, SDK version constraints).
2. Distill key conventions and save to SuperMemory container `atom_knowledge`.
3. If an outdated pattern is identified, blacklist it and replace it with the modern best practice.

---

## 3. Stream 3: Web Search & API Upgrades
When searching the web or documentation (via `search_web`, `read_url_content`, `gemini_search_docs`):
1. Detect API deprecations, new endpoints, and migration guides (e.g., `gemini-3.8-flash-tts`, `Chirp 3 HD`).
2. Update local config files (`api_keys.json`, `.env`, MCP configurations).
3. Record verified working code snippets into `atom_knowledge`.

---

## 4. Stream 4: Autonomous Skill & Rule Mutation
If a gap in capability is encountered repeatedly:
1. **Trigger Skill Forge:** Utilize `skill-discovery-and-forge` to synthesize a new standalone skill.
2. **Refine Rule Set:** Update project rules (`AGENTS.md` or `.agents/rules/`) with high-density bullet points.
3. **Verify Evolution:** Test the newly acquired capability with a dry run to guarantee regression-free execution.
