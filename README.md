# diffai

AI coding agentの変更をブラウザで確認し、承認・却下・フィードバックできるローカルUIです。デフォルトで未コミット変更を読み込み、レビュー完了まで呼び出し元のエージェントを待機させます。

## 起動

```bash
npx github:tanabe1478/diffai --cwd /path/to/project
```

全ファイルの判断後に「レビューを完了」を押すと、標準出力へ versioned bare JSON（`schemaVersion: 1` のReviewResult）が一行だけ出力され、結果を待っていたCLIプロセスが終了します。URL・workspace・待機進捗などの診断はすべて標準エラー出力へ出ます。ブラウザサーバーは継続するため、タブはそのまま開いておけます。既存の `--wait` は不要です。

呼び出し元のエージェントが修正後に同じコマンドを再実行すると、既存のブラウザサーバーへ接続し、同じタブへ新しい差分と返信を読み込みます。次の「レビューを完了」まで新しいCLIプロセスがフォアグラウンドで待機します。

呼び出し元のエージェントがレビュー結果を受け取るには、diffaiをフォアグラウンドで実行してください。バックグラウンド起動やログファイルへのリダイレクトを行うと、レビュー完了後もエージェントは結果に反応できません。

ローカル開発:

```bash
npm install
npm run dev -- --cwd /path/to/project
```

diffai本体はPi SDKやPiの認証・モデル設定に依存しません。Git差分を読み、`schemaVersion: 1` のReviewResultをbare JSON一行として標準出力へ返すだけです。標準出力に診断やprefixは混在しません。

## Piとのインタラクティブなレビュー

Pi packageとしてインストールすると、ブラウザと現在のPiセッションをつなぐレビュー・修正ループを利用できます。diffai本体の実行にPiは不要です。

```bash
pi install git:github.com/tanabe1478/diffai
```

ローカル開発中の checkout を使う場合:

```bash
pi install /path/to/diffai
```

インストール後、Piで次を一度実行します。

```text
/diffai-review
```

ブラウザから修正を依頼すると、結果が同じPiセッションへ自動送信されます。Piの修正ターンが完了すると同じブラウザタブへ更新後のdiffが自動で読み込まれ、承認されるまで繰り返します。

インストールすると次が有効になります。

- `/diffai-review`: 非同期のレビュー・修正・再レビューのループ
- `/diffai-status`: 現在のreviewing / waiting_for_agent / ended / idleとreviewIdを表示
- `/diffai-cancel`: 実行中のレビューを明示的にキャンセル（子プロセスも有限時間で停止）
- `diffai` skill: PiおよびClaude Codeでレビュー結果に対応する手順
- `diffai` extension: diffaiを `&` やstdoutリダイレクト付きで起動しようとしたbash実行をブロックし、レビュー状態をPiセッションへ保存してfooterへ表示

## Claude Codeで使う

Claude Code pluginとしてインストールできます。

```bash
claude plugin marketplace add tanabe1478/diffai
claude plugin install diffai@diffai
```

その後、Claude Codeでプラグインコマンドを実行します。

```text
/diffai:review
```

Claude CodeではCLIのレビュー結果を受け取り、指摘の修正、`.diffai/review-replies.json`への返信、同じタブでの再レビューを承認まで自動で繰り返します。Claude Codeの外部メッセージ注入APIには依存せず、プラグインコマンド内のフォアグラウンドCLIループとして動作します。

## レビュー対象

画面左上のセレクターから次を切り替えられます。

- 最新コミット (`HEAD`)
- 最近の特定コミット
- 未コミットの変更すべて（未追跡ファイルを含む）
- ステージ済みの変更
- 未ステージの変更（未追跡ファイルを含む）
- 任意のブランチ・コミット間の比較

変更ファイルはディレクトリ階層のツリーで表示されます。diffは`@pierre/diffs`とShikiで描画し、拡張子から言語を判定してハイライトします（Shikiの対応言語 + カスタム登録したTLA+）。未知の拡張子はプレーンテキストで表示します。未変更行は初期状態で折り畳まれ、全行表示への切り替えや左右・一列表示の切り替えができます。

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

diffaiはGit差分をレビュー用データとして読み込み、ブラウザUIでの判断・コメントを `schemaVersion: 1` のReviewResult bare JSON一行として標準出力へ返します。`reviewId`も結果へ含まれ、Pi拡張はv1 JSONを厳格に解析して同じIDで同じブラウザタブへ再レビューします。URLや進捗などの診断は標準エラー出力へ分離されます。呼び出し元エージェントはそのJSONを読んで、修正やコメント返信を行います。

同じcwdでレビューを交代すると、各CLI waiterは`expectedReviewId`をサーバーへ渡します。古いwaiterはサーバーから409の`review_conflict`を受け、診断を表示して非zero終了します。これにより別レビューの結果を誤って受け取りません。
