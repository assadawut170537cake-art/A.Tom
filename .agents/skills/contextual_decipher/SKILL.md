---
name: contextual_decipher
description: >
  Deciphers ambiguous, misspelled, noisy, or wrong-keyboard-language user prompts
  (e.g., Thai typed on English keyboard or vice versa: "g9njv" -> "เพื่อน", "w,j" -> "ไม่").
  Extracts authentic user intent using contextual project history and fuzzy command mapping.
---

# Contextual Decipher (Intent & Keyboard Recovery Engine)

Transforms noisy, scrambled, or incorrectly switched keyboard inputs into exact actionable intentions for the AI ecosystem.

## Upgraded Capabilities
1. **Bidirectional Keyboard Layout Switcher:** Instant translation between Thai Kedmanee (เกษมณี) and US QWERTY.
   - Example EN -> TH: `g9njv` $\rightarrow$ `เพื่อน`, `w,j` $\rightarrow$ `ไม่`, `c]t` $\rightarrow$ `และ`
   - Example TH -> EN: `ัำห` $\rightarrow$ `yes`, `พกร` $\rightarrow$ `git`, `พกด้ำพ` $\rightarrow$ `python`
2. **Context-Aware Disambiguation:** Resolves ambiguous one-word inputs by checking:
   - What the user worked on in the previous 5 minutes.
   - Active processes, open editors, and recent errors.
3. **Fuzzy System Command Mapper:** Automatically matches typos to system actions:
   - "รันอะตอม", "เปดิบอท", "ชเคเน็ต" $\rightarrow$ executes corresponding system service without asking annoying clarifying questions.
