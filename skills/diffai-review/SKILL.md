---
name: diffai-review
description: diffaiで変更レビューを起動し、ブラウザでのレビュー完了後にDIFFAI_REVIEW_RESULTを受け取って反応する。ユーザーがdiffaiを起動して、変更を見たい、レビューしたい、レビュー結果を返したい、Piからdiffaiを使いたいと言った時に使う。
---

# diffai review

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
- `decision: "changes_requested"` の場合: `reviews`、`comments`、`feedback` を読み、指摘に沿って修正する。
- JSONが出ていない場合: 起動失敗、ブラウザ未完了、タイムアウト、誤ってバックグラウンド化した可能性を確認する。

## 誤ってバックグラウンド起動した場合の復旧

- まず対象ログを読み、`DIFFAI_REVIEW_RESULT=` が出ていれば手動でJSONを解釈して反応する。
- その後、同じ失敗を繰り返さないよう、次回は必ずフォアグラウンドで起動する。
