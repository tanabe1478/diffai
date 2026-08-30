---
name: diffai
description: diffaiで変更レビューを起動し、ブラウザでのレビュー完了後にschemaVersion 1のbare JSON結果を受け取って修正・返信・再レビューを繰り返す。ユーザーがdiffaiを起動して、変更を見たい、レビューしたい、レビュー結果を返したい、PiやClaude Codeからdiffaiを使いたいと言った時に使う。
---

# diffai

## Piでの推奨起動

Pi packageとしてインストール済みなら、ユーザーは次を一度実行する:

```text
/diffai-review
```

このコマンドは非同期レビュー・修正・再レビューのループを開始する。ブラウザの指摘は同じPiセッションへ自動送信され、Piの修正完了後に同じタブが自動更新される。承認されるまでユーザーがレビューを再起動する必要はない。

- `/diffai-status`: 現在のphase（`reviewing` / `waiting_for_agent` / `ended` / `idle`）とreviewIdを確認する。
- `/diffai-cancel`: 実行中のレビューを明示的にキャンセルする。callbackを無効化してから終了状態を保存し、子processはTERMからKILLへ有限時間で停止する。

reviewingとwaiting_for_agentはPi footerにも表示され、ended・idle・shutdownでは表示が消える。UIがない実行モードでもレビュー状態の復元とキャンセルは動作する。

## CLIでの起動

Piに依存しないフォアグラウンドCLIは次の形式で起動する:

```bash
npx github:tanabe1478/diffai --cwd "$PWD"
```

レビュー完了時、stdoutには `schemaVersion: 1` のReviewResult bare JSONが一行だけ出力される。URL・workspace・進捗・診断はstderrに出る。`decision` が `changes_requested` なら指摘を修正し、`.diffai/review-replies.json`を更新して同じコマンドを再実行する。CLIをバックグラウンド化したりstdoutをリダイレクトしたりしない。

## 絶対ルール

- `&`、`nohup`、`disown`、`> logfile 2>&1`、`tee` などでバックグラウンド化・ログファイル化しない。
- stdoutのbare ReviewResult v1を受け取ったらJSONを読み、指摘へ対応する。schemaVersionがない、未知version、余分なrecordは結果として受理しない。
- Piの`/diffai-review`ループ中は拡張が同じreviewId・同じブラウザタブで再レビューを起動するため、bashから重ねて起動しない。
- 同じcwdで別reviewIdが開始された場合、古いCLI waiterは競合診断を出して非zero終了する。別レビューの結果を受け取ったことにして処理を続けない。

## 結果の扱い

- `decision: "approved"`: 承認されたことを報告する。
- `decision: "changes_requested"`: `reviews`、`comments`、`fileFeedback`、`feedback`を読み、指摘に沿って修正する。
- 結果の`replyFile`と`replyFormat`に従って返信を書く。既存の返信は消さず更新・追記する。

返信の形式:

```json
{
  "replies": [
    { "commentId": "<comment id or fileFeedback id>", "status": "fixed", "body": "修正しました" }
  ]
}
```
