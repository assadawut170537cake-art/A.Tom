---
name: last-20-percent
description: >
  Finds and finishes the crucial last 20% of engineering solutions that AI models typically skip:
  proper error handling, responsive UI scaling, logging prefixes, fallback defaults, and self-testing.
---

# The Last 20% Finish Line

AI models are notorious for writing the "first 80%" (the happy path) and leaving behind fragile code.
This skill enforces the discipline required to make solutions production-grade.

## The Last 20% Checklist
1. **Error Boundaries:** Every network, file, and OS call wrapped in explicit `try-except` with logging.
2. **Empty & Loading States:** What does the UI display when data is missing or loading?
3. **DPI & Multi-Resolution Check:** Does the UI or coordinate math work on both standard and 2560x1080 Ultra-wide screens?
4. **Self-Testing Harness:** A built-in `if __name__ == '__main__':` block that verifies core functionality on launch.
