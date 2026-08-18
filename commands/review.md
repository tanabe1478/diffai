---
description: Open diffai and iterate on browser review feedback until the changes are approved
allowed-tools: Bash, Read, Edit, Write
---

Review the current working tree with diffai.

1. Run the following command in the foreground. Do not append `&`, redirect stdout, use `nohup`, or set a short timeout.

   ```bash
   npx github:tanabe1478/diffai --cwd "$PWD"
   ```

2. Read the `DIFFAI_REVIEW_RESULT=...` JSON from stdout.
3. If `decision` is `changes_requested`:
   - address every applicable item in `comments`, `fileFeedback`, `feedback`, and rejected `reviews`;
   - run appropriate checks;
   - update the result's `replyFile` (normally `.diffai/review-replies.json`) with one `fixed`, `replied`, or `wontfix` reply per addressed comment ID, preserving unrelated existing replies;
   - immediately run the same foreground diffai command again. Do not ask the user to request another review.
4. Repeat until `decision` is `approved`.
5. Once approved, report that the review passed and summarize the changes made during the loop.
