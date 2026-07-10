# diffai

Pi coding agentの変更提案をブラウザで確認し、承認・却下・フィードバックできるローカルUIです。Piはレビュー前にファイルを書き換えません。

## 起動

```bash
npx github:tanabe1478/diffai --cwd /path/to/project
```

ローカル開発:

```bash
npm install
npm run dev -- --cwd /path/to/project
```

既存の `~/.pi/agent/` の認証・モデル設定を利用します。

## 仕組み

Pi SDKに標準の書き込みツールを渡さず、`propose_edit` / `propose_write` で変更案を収集します。ブラウザで承認された変更だけを、内容がレビュー時点から変わっていないことを確認して適用します。
