---
name: dynamic_multi_model_router
description: >
  Intelligent Model Router optimized for 48-Thread CPU + NVIDIA Quadro P4000 (8GB VRAM).
  Dynamically routes tasks between Cloud (Gemini Live / Pro) and Local Ollama (Qwen2.5 / UI-TARS / Hermes)
  based on token budget, latency requirements, and network health.
---

# Dynamic Multi-Model Router

Orchestrates which AI model executes each task to achieve maximum speed, minimum cost, and complete offline survivability.

## Hardware Optimization Matrix
- **CPU:** 48 Logical Threads (`OMP_NUM_THREADS=48`, `MKL_NUM_THREADS=48`)
- **GPU:** NVIDIA Quadro P4000 (8GB VRAM, CUDA compute)
- **Local Endpoint:** `http://127.0.0.1:11434` (Ollama)

## Routing Policy
| Task Complexity | Primary Target | Fallback Target |
| :--- | :--- | :--- |
| **Live Voice / Conversational HUD** | Gemini Live API (0.3s) | Local Ollama `hermes-qwen3.5-9b` |
| **Heavy Coding & Refactoring** | Gemini 2.5 Pro / Claude 3.7 | Local `qwen2.5-coder:14b` / `32b` |
| **Security Auditing & Red-Teaming** | DeepSeek-R1 / U.L.T.R.O.N. | Local Uncensored `qwen3.8:27b` |
| **Offline / Network Outage** | Local Ollama (Automated) | Local Faster-Whisper + Piper TTS |
