---
name: mcp-skill-optimizer-editor
description: >
  Autonomous Skill and MCP Auditor, Modifier, and Optimizer.
  Allows agents to inspect, refactor, debug, patch, and tailor existing skills (SKILL.md)
  and Model Context Protocol (MCP) server definitions (mcp_config.json, tool schemas, transport bridges).
  Enables fine-tuning parameters, adjusting auth headers, improving prompt instructions,
  and customizing tools to match exact operational specifications.
---

# MCP & Skill Optimizer-Editor Engine

The dedicated surgical and optimization engine for the agent's toolbelt. Ensures that all tools, skills, and MCP servers run at peak efficiency and perfectly fit Boss's requirements.

---

## Capabilities & Scopes

```
                    ┌──────────────────────────────────────────────┐
                    │       MCP & Skill Optimizer-Editor           │
                    └──────────────────────┬───────────────────────┘
                                           │
                    ┌──────────────────────┴──────────────────────┐
                    ▼                                             ▼
       [ Track A: Skills Optimization ]              [ Track B: MCP Server Engineering ]
       - Inspect SKILL.md structure                  - Inspect mcp_config.json & servers
       - Refine triggers & descriptions              - Add/Fix Authentication Headers
       - Fix syntax & YAML frontmatter               - Wrap CLI tools into JSON-RPC MCP
       - Add runbooks & safety rules                 - Tune timeouts, transports & env vars
       - Prune redundant/bloated instructions        - Test tool schemas & response payloads
```

---

## Track A: Skill Inspection & Surgery

### 1. Skill Discovery & Audit
- Locate target skill in `C:\Users\CJN_assadawut17\.gemini\config\skills/` or `<workspace>/.agents/skills/`.
- Verify YAML frontmatter:
  ```yaml
  ---
  name: <skill-name>
  description: >-
    Must be specific, describing trigger criteria and exact capabilities.
  ---
  ```
- Check for common defects:
  - Vague descriptions preventing auto-activation.
  - Outdated tool references.
  - Missing error handling or dangerous destructive commands without safeguards.

### 2. Surgical Modification
- Use `replace_file_content` to make surgical updates without breaking existing structure.
- Add context-specific operational rules (e.g., Boss's PIN protection, quota preservation rules).
- Optimize token efficiency by removing conversational fluff from skill instructions.

---

## Track B: MCP Server Engineering & Customization

### 1. Configuration Tuning (`mcp_config.json`)
- Target: `C:\Users\CJN_assadawut17\.gemini\config\mcp_config.json`
- Capabilities:
  - Add missing headers (e.g., Bearer tokens, custom headers like `x-goog-user-project`).
  - Switch transport protocols (stdio command vs. SSE HTTP URL).
  - Add environment variables (`env: { ... }`) to server configurations.

### 2. Tool Schema & Parameter Adaptation
- When an MCP tool returns unexpected errors (e.g., schema validation failed, wrong field name):
  - Inspect the MCP server logs or source code.
  - Patch the caller bridge or write a lightweight proxy wrapper.
  - Example: Resolving parameter names (`q` vs `query`, auth tokens in headers vs query params).

### 3. Verification & Live Health Check
- After modifying a skill or MCP configuration:
  1. Validate JSON / YAML syntax with a parser.
  2. Perform a test call against the modified tool or inspect discovery registration.
  3. Commit the architectural change record to SuperMemory container `atom_knowledge`.
