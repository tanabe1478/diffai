---
name: diffai-review
description: diffaiで変更レビューを起動し、ブラウザでのレビュー完了後にDIFFAI_REVIEW_RESULTを受け取って修正・返信・再レビューを繰り返す。ユーザーがdiffaiを起動して、変更を見たい、レビューしたい、レビュー結果を返したい、PiやClaude Codeからdiffaiを使いたいと言った時に使う。
---

# diffai review

## Piでの推奨起動

Pi packageとしてインストール済みなら、ユーザーは次を一度実行する:

```text
/diffai-review
```

このコマンドは非同期レビュー・修正ループを開始する。ブラウザの指摘は同じPiセッションへ自動送信され、Piの修正完了後に同じタブが自動更新される。承認されるまでユーザーがレビューを再起動する必要はない。

## Claude Codeおよび汎用CLIでの起動

Claude Code pluginでは `/diffai:review` コマンドを使う。コマンドがない環境では以下のフォアグラウンドCLIを使う。レビューで修正依頼を受けた場合は、修正・返信ファイル更新後に同じコマンドを**自発的に再実行し、承認されるまでループする**。ユーザーへ再実行を依頼しない。

## 絶対ルール

- diffaiをレビュー結果返却用途で起動するときは、必ずフォアグラウンドで実行する。
- `&`、`nohup`、`disown`、`> logfile 2>&1`、`tee` などでバックグラウンド化・ログファイル化しない。
- bashツールの実行がブラウザでの「レビューを完了」までブロックされる状態が正しい。
- 自分で `open http://...` する前に、diffai自身のブラウザ自動起動に任せる。
- `DIFFAI_REVIEW_RESULT=...` を bash 実行結果として受け取ったら、必ず内容を読んでユーザーへ反応する。

## 起動手順

プロジェクトの未コミット変更をレビューしてもらう場合:

```bash
npx github:tanabe1478/diffai --cwd "$PWD"
```

ローカルのdiffaiリポジトリ自身で、ビルド済み成果物を使う場合:

```bash
node dist/server/index.js --cwd "$PWD"
```

未ビルドなら先にビルドする:

```bash
npm run build
node dist/server/index.js --cwd "$PWD"
```

## bashツール実行時の注意

- timeoutはレビュー時間を見込んで長めにする。短時間でタイムアウトさせない。
- 正しい例:

```bash
npx github:tanabe1478/diffai --cwd "$PWD"
```

- 悪い例:

```bash
npx github:tanabe1478/diffai --cwd "$PWD" > /tmp/diffai.log 2>&1 &
```

この悪い例では、レビュー結果がログにだけ出て、エージェント自身は反応できない。

## 結果の扱い

終了後のstdoutに次の形式が出る:

```text
DIFFAI_REVIEW_RESULT={...}
```

- `decision: "approved"` の場合: 承認されたことをユーザーへ報告する。
- `decision: "changes_requested"` の場合: `reviews`、`comments`、`fileFeedback`、`feedback` を読み、指摘に沿って修正する。
- 修正・返答後は、結果JSONの `replyFile`（通常 `.diffai/review-replies.json`）へ `replyFormat` に従って返信を書く。次回diffai起動時にUIへ表示される。
- Claude Codeまたは汎用CLIでは、修正と返信を書いた直後にdiffaiを再実行する。`approved` になるまで修正→再レビューを継続する。
- Piの `/diffai-review` ループ中は拡張が再レビューを自動起動するため、bashから重ねて起動しない。
- JSONが出ていない場合: 起動失敗、ブラウザ未完了、タイムアウト、誤ってバックグラウンド化した可能性を確認する。

## 返信ファイル

レビューコメントやファイル全体フィードバックにはIDが付く。呼び出し元エージェントが対応したら、次の形式で返信を書く。

```json
{
  "replies": [
    {
      "commentId": "<comments[].id または fileFeedback[].id>",
      "status": "fixed",
      "body": "修正しました"
    }
  ]
}
```

`status` は `fixed` / `replied` / `wontfix` のいずれか。
既存の返信がある場合は消さずに更新・追記する。

## 誤ってバックグラウンド起動した場合の復旧

- まず対象ログを読み、`DIFFAI_REVIEW_RESULT=` が出ていれば手動でJSONを解釈して反応する。
- その後、同じ失敗を繰り返さないよう、次回は必ずフォアグラウンドで起動する。
