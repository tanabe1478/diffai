# diffai

AI coding agentの変更をブラウザで確認し、承認・却下・フィードバックできるローカルUIです。デフォルトで未コミット変更を読み込み、レビュー完了まで呼び出し元のエージェントを待機させます。

## 起動

```bash
npx github:tanabe1478/diffai --cwd /path/to/project
```

全ファイルの判断後に「レビューを完了」を押すと、標準出力へ `DIFFAI_REVIEW_RESULT=...` が出力され、結果を待っていたCLIプロセスが終了します。ブラウザサーバーは継続するため、タブはそのまま開いておけます。既存の `--wait` は不要です。

呼び出し元のエージェントが修正後に同じコマンドを再実行すると、既存のブラウザサーバーへ接続し、同じタブへ新しい差分と返信を読み込みます。次の「レビューを完了」まで新しいCLIプロセスがフォアグラウンドで待機します。

呼び出し元のエージェントがレビュー結果を受け取るには、diffaiをフォアグラウンドで実行してください。バックグラウンド起動やログファイルへのリダイレクトを行うと、レビュー完了後もエージェントは結果に反応できません。

ローカル開発:

```bash
npm install
npm run dev -- --cwd /path/to/project
```

diffai本体はPi SDKやPiの認証・モデル設定に依存しません。Git差分を読み、レビュー結果を標準出力へ返すだけです。

## 任意: Pi packageとしてインストール

Piからdiffaiを使う場合に、使い方を覚えさせ、誤ったバックグラウンド起動を防ぐには、このリポジトリをpi packageとしてインストールできます。diffai本体の実行にPiは不要です。

```bash
pi install git:github.com/tanabe1478/diffai
```

ローカル開発中の checkout を使う場合:

```bash
pi install /path/to/diffai
```

インストールすると次が有効になります。

- `diffai-review` skill: diffaiをフォアグラウンドで起動し、`DIFFAI_REVIEW_RESULT` を読んで反応する手順
- `diffai-foreground-guard` extension: diffaiを `&` や stdout リダイレクト付きで起動しようとしたbash実行をブロック

## レビュー対象

画面左上のセレクターから次を切り替えられます。

- 最新コミット (`HEAD`)
- 最近の特定コミット
- 未コミットの変更すべて（未追跡ファイルを含む）
- ステージ済みの変更
- 未ステージの変更（未追跡ファイルを含む）
- 任意のブランチ・コミット間の比較

変更ファイルはディレクトリ階層のツリーで表示されます。diffは拡張子から言語を判定し、GitHub互換のTextMate grammarでハイライトします（GitHub common languages + TLA+ + TSX）。未知の拡張子はプレーンテキストで表示します。

行コメント、ファイル全体へのフィードバックは同じレビューセッション内のブラウザ再読み込みでは保持されますが、次のレビューへ古い承認・却下状態を持ち越しません。全体に問題がなければ「レビューを完了」で未確認ファイルを一括承認できます。レビュー結果にはコメントIDとファイルフィードバックIDが含まれ、呼び出し元エージェントが `.diffai/review-replies.json` に返信を書いてdiffaiを再実行すると、同じタブでコメントへの返答として表示されます。

コミット済みの変更は「承認済み」または「修正を依頼」として扱い、diffaiがファイルを直接巻き戻すことはありません。

## コメントへ返信する

レビュー結果には `replyFile` と `replyFormat` が含まれます。呼び出し元エージェントは修正後、次の形式で `.diffai/review-replies.json` を書き込んでdiffaiを再実行すると、開いたままのタブで返答と修正差分を確認できます。

```json
{
  "replies": [
    {
      "commentId": "<comment id or fileFeedback id>",
      "status": "fixed",
      "body": "修正しました"
    }
  ]
}
```

`status` は `fixed` / `replied` / `wontfix` のいずれかです。

## 仕組み

diffaiはGit差分をレビュー用データとして読み込み、ブラウザUIでの判断・コメントを `DIFFAI_REVIEW_RESULT=...` として標準出力へ返します。呼び出し元エージェントはそのJSONを読んで、修正やコメント返信を行います。
