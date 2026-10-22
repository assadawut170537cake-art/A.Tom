---
name: skill-discovery-and-forge
description: >
  Autonomous Skill Discovery, Acquisition, and Forge Engine.
  Searches for required skills and tools across internal repositories (local configs, workspace .agents/skills)
  and online sources (GitHub, MCP registries, open agent repos).
  If a skill is found online but not installed, safely validates and installs it.
  If no matching skill exists anywhere, automatically forges and writes a new production-grade SKILL.md
  and supporting tools from scratch to fulfill the user's requirements.
---

# Skill Discovery & Forge Engine

Autonomous capability acquisition system for the A.T.O.M. / J.A.R.V.I.S. ecosystem. Ensures that no task is ever blocked by a missing skill.

---

## Operational Workflow

```
                        [ Task requires capability 'X' ]
                                       │
                                       ▼
                     ┌───────────────────────────────────┐
                     │ Phase 1: Local Internal Discovery │
                     └─────────────────┬─────────────────┘
                                       │ Found?
                        ┌──────────────┴──────────────┐
                        ▼ YES                         ▼ NO
                [ Activate Skill ]       ┌───────────────────────────────┐
                                         │ Phase 2: Online Hunter Search │
                                         └───────────────┬───────────────┘
                                                         │ Found?
                                          ┌──────────────┴──────────────┐
                                          ▼ YES                         ▼ NO
                                ┌──────────────────┐          ┌──────────────────────┐
                                │ Phase 3: Inspect │          │ Phase 4: Skill Forge │
                                │   & Safe Install │          │   (Synthesize New)   │
                                └──────────────────┘          └──────────────────────┘
```

---

## Phase 1: Internal Search
1. Check Global Skills Directory:
   - Path: `C:\Users\CJN_assadawut17\.gemini\config\skills/`
2. Check Workspace Skills Directories:
   - Paths: `J:\Cloude\A.Tom\.agents\skills/`, `J:\Mark-LV\.agents\skills/`
3. Check Export Packages:
   - Path: `J:\Android\JARVISbot\READY_SKILLS_EXPORT/`
4. Inspect matches using `find_by_name` and `grep_search`. If an existing skill matches the required intent, activate and use it directly.

---

## Phase 2: Online Hunter Search
If the skill does not exist locally:
1. Search GitHub and open repositories using `search_web`:
   - Query format: `site:github.com "SKILL.md" "<desired-capability>"` or `gemini antigravity skill "<desired-capability>"`
   - Search MCP tool registries: `mcp server "<desired-tool>"`
2. Evaluate candidates against the objective.

---

## Phase 3: Safe Installation
When an external skill or MCP tool is found:
1. **Safety Audit:**
   - Scan for dangerous commands (e.g., unintended `rm -rf`, credential harvesters, hardcoded malicious URLs).
   - Ensure it conforms to Boss's security rules (PIN 170537 protection for destructive actions).
2. **Install to Destination:**
   - Global skills: `C:\Users\CJN_assadawut17\.gemini\config\skills/<skill-name>/SKILL.md`
   - Workspace skills: `<workspace>/.agents/skills/<skill-name>/SKILL.md`
3. **Register:**
   - Validate YAML frontmatter (`name`, `description`).
   - If it contains an MCP server, add to `C:\Users\CJN_assadawut17\.gemini\config\mcp_config.json`.

---

## Phase 4: The Skill Forge (Synthesizing New Skills From Scratch)
If no matching skill exists anywhere on earth:
1. **Deconstruct Requirements:**
   - What is the exact goal? What are the input triggers? What are the output artifacts?
2. **Author the `SKILL.md`:**
   - Must contain clean YAML frontmatter:
     ```yaml
     ---
     name: <unique-kebab-case-name>
     description: >-
       Clear, actionable description of what this skill does and when to activate it.
     ---
     ```
   - Must contain clear section headers:
     - `# Skill Title`
     - `## Overview & Objectives`
     - `## Step-by-Step Procedure / Runbook`
     - `## Error Handling & Fallbacks`
     - `## Verification Checklist`
3. **Write Supporting Scripts (if code/terminal execution is required):**
   - Save helper scripts in `scripts/` inside the skill directory.
   - Use Node.js (`.mjs`) or Python with proper error handling and logging.
4. **Deploy & Record:**
   - Write to `C:\Users\CJN_assadawut17\.gemini\config\skills/<name>/SKILL.md`.
   - Record the newly minted skill into SuperMemory container `atom_knowledge` for cross-agent discovery.
