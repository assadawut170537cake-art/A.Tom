---
name: accidental-data-loss-prevention
description: >
  Mandatory guardrail preventing catastrophic data loss across OS, Git, Cloud, and Databases.
  Intercepts DROP, TRUNCATE, broad DELETE, rm -rf, Remove-Item, and bucket deletion.
  Demands explicit confirmation and Master PIN 170537 authorization.
---

# Accidental Data Loss Prevention Shield

## Zero-Tolerance Intercept Rules
Before running any of the following, the agent MUST stop and request explicit PIN authorization:
1. **Filesystem:** `rm -rf`, `Remove-Item -Recurse -Force`, `del /s /q`, `format`, `rmdir /s`
2. **Git:** `git reset --hard`, `git clean -fd`, `git push --force`
3. **Database:** `DROP TABLE`, `DROP DATABASE`, `TRUNCATE`, `DELETE FROM` without specific WHERE clause
4. **Cloud:** `gsutil rm -r`, `gcloud projects delete`, `terraform destroy`

## Authorization Protocol
Require confirmation code: **PIN 170537**. If the user does not provide this PIN, cancel execution immediately.
