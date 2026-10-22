---
name: wayfinder_codebase_navigator
description: >
  Ultra-fast codebase graph indexer and navigator. Extracts class/function skeletons
  using AST without reading full file contents, reducing token consumption by up to 90%.
  Traces call chains, imports, and dependencies across Python, TypeScript, and Dart.
---

# Wayfinder Codebase Navigator

Enables instant comprehension and navigation of large codebases without dumping thousands of lines into the LLM context window.

## Upgraded Capabilities
1. **AST Skeleton Parsing:** Reads only class names, method signatures, and docstrings in milliseconds.
2. **Cross-File Dependency Mapping:** Identifies all files that import or call a target function before applying modifications.
3. **Targeted Surgery:** Directs edits to exact line ranges rather than reading/writing whole files.
