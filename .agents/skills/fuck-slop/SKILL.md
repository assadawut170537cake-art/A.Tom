---
name: fuck-slop
description: >
  De-slop pass for any text (Thai & English): detects and erases the statistical
  fingerprints of AI writing (negative parallelism / "not X but Y", "ไม่ได้เป็นเพียงแค่ X แต่ยังเป็น Y",
  em-dash abuse, rule-of-three, false ranges, puffery vocabulary, uniform cadence,
  hedged both-sidesing, and robotic filler). Rewrites text into natural, crisp human prose.
  Use when asked to "fuck slop", "deslop", "ลบภาษา AI", "เกลาภาษาให้เป็นธรรมชาติ", or before publishing prose.
---

# F*ck Slop (Enhanced Edition: Thai & English Dual-Engine)

Strip every mark of robotic AI writing from a text and make it read like a sharp, authentic person with a clear point wrote it for a specific audience.

## Key Upgraded Capabilities
1. **Thai Language De-Slop Ruleset:** Specifically detects unnatural Thai AI phrases like "ไม่ได้เป็นเพียงแค่...", "ในโลกยุคปัจจุบันที่เปลี่ยนแปลงอย่างรวดเร็ว", "สิ่งสำคัญคือต้องจำไว้ว่า...", "นอกจากนี้ยัง...", "ท้ายที่สุดแล้วสรุปได้ว่า"
2. **Three-Tier Tone Matching:**
   - **Commander/ลูกพี่ Mode:** สรุปสั้น กระชับ ตรงประเด็น ชัดเจน ระดับมัธยมปลาย ไม่เยิ่นเย้อ ผลลัพธ์มาก่อน
   - **Technical/Architect Mode:** แม่นยำ ข้อมูลเชิงเทคนิคชัดเจน ไม่มีคำอวย ไม่มีคำโฆษณาชวนเชื่อ
   - **General/Social Mode:** ภาษาคนคุยกัน ไหลลื่น มีจังหวะสั้นยาวเป็นธรรมชาติ ไม่ใช้แพทเทิร์น 3 ข้อย่อย
3. **Automated Mechanical Scan:** Runnable regex scan patterns for zero-guesswork slop elimination.

## Phase 0: Fix Target & Register
Before rewriting, determine:
- **Genre & Audience:** Who is reading? What is the author's exact claim?
- **Tone Profile:** Casual, Executive, Engineering, or Conversational.

## Phase 1: Mechanical Detection Catalog

### 1. Negative Parallelism (The "Not X but Y" Trap)
- English: `not (just|only|merely) X, but (also)? Y`, `less about X than Y`, `the question isn't X, it's Y`
- Thai: `ไม่ได้เป็น(เพียง)?แค่ X แต่ยัง?เป็น Y`, `ไม่ใช่แค่ X แต่คือ Y`, `ไม่เพียงแต่ X เท่านั้น แต่ยัง Y`
-> **Treatment:** Cut the negative half entirely. State the positive truth directly with evidence.

### 2. Cliché AI Fillers & Throat-Clearing Openers
- English: "In today's fast-paced world...", "Delve into...", "It's worth noting...", "Crucial/Pivotal/Testament/Tapestry"
- Thai: "ในยุคปัจจุบันที่...", "เป็นที่น่าสังเกตว่า...", "มีความสำคัญเป็นอย่างยิ่ง...", "สิ่งสำคัญคือ...", "กล่าวโดยสรุปคือ..."
-> **Treatment:** Delete immediately. Start right at the action/fact.

### 3. Rule-of-Three & Metronomic Lists
- Any bullet list that artificially forces 3 points of equal length with bold prefixes (`**Point:** Description`).
-> **Treatment:** Keep only the points that contain real, distinct information. Vary syntax and sentence length.

## Phase 2: Meaning-First Rewrite
1. What does the author actually mean to claim?
2. Write that claim in plain words as if speaking to a colleague.
3. No fake humanizing (no forced typos, no cheesy slang).

## Phase 3: Verification
Re-scan rewritten text. Repeat until 0 pattern hits remain.
