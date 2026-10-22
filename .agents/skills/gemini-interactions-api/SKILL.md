---
name: gemini-interactions-api
description: >
  Next-Gen Google Gemini API & Interactions SDK engineering guide. Covers multimodal
  understanding (vision, video, audio), Live WebSocket streaming, function calling,
  structured JSON schema output, and exponential backoff retry resilience.
  Current models: gemini-2.5-flash, gemini-2.5-pro, gemini-3.5-flash-lite, gemini-3.6-flash.
---

# Gemini Interactions API (Next-Gen Production Engine)

Use this skill when developing or debugging integrations with the Google Gemini API using Python (`google-genai`) or TypeScript (`@google/genai`).

## Upgraded Capabilities
1. **Live Bi-directional Streaming:** Full WebSocket pipeline for real-time low-latency audio/video interaction.
2. **Type-Safe Structured Output:** Enforcing JSON Schema and Pydantic validation on model responses.
3. **Resilience & Rate-Limit Fallback:** Auto-retry on HTTP 429 with exponential jitter and fallback to local models.
4. **Tool Use & Function Calling Dispatcher:** Declarative schema generator with safe local execution hooks.

## Current Model Roster (2026/2027)
- `gemini-2.5-flash`: Default workhorse — fast, multimodal, 1M context window.
- `gemini-2.5-pro`: Deep reasoning, complex coding, and multi-document synthesis.
- `gemini-3.5-flash-lite` / `gemini-3.6-flash`: High-throughput, sub-second latency agent interactions.

## Standard Python Implementation Template

```python
from google import genai
from google.genai import types
import os

client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])

# Structured JSON Response
response = client.models.generate_content(
    model="gemini-2.5-flash",
    contents=["Analyze user intent and return JSON", image_part],
    config=types.GenerateContentConfig(
        response_mime_type="application/json",
        temperature=0.2,
    )
)
print(response.text)
```

## Function Calling Template
Always declare tool functions with complete docstrings and typed arguments. Gemini inspects type hints directly.
