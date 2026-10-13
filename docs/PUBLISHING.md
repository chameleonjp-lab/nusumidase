# 公開手順

公開URL: https://chameleonjp-lab.github.io/nusumidase/

GitHub Pages の公開元は `Deploy from a branch`、ブランチは `gh-pages`、フォルダは `/ (root)` です。ゲームのソースは `main` に保持し、`gh-pages` には作成済みの静的ファイルだけを置きます。`main` の変更は自動では公開されません。

## 2026-10-13 の初回公開

- ソース: `main` の `eb213bead0f45c6578a7ee290dab96fba1fa8483`。
- 公開ブランチのコミット: `dfce73dcd4c03f324ca8ee9bf0329a2425c01a05`。
- Node.js 24.19.0 で `npm ci`、`npm test`、`npm run build` を実施。既存の104検査が成功し、型検査と公開用の作成が成功しました。
- 公開ファイルは `index.html`、`assets/` 内の JavaScript と CSS、`.nojekyll`、`version.json` の5ファイルです。開発用ソース、検査用の操作経路、依存パッケージのフォルダは公開用ファイルに含めません。

公開処理 [pages build and deployment / 38335985020](https://github.com/chameleonjp-lab/nusumidase/actions/runs/38335985020) は、上記 `gh-pages` のコミットで成功しました。公開先の HTML、JavaScript、CSS、`version.json` はすべて HTTP 200 で取得でき、作成したファイルと全バイトが一致しました。公開された `sourceCommit` も対象の `main` と一致しています。

確認用クラウドブラウザーは WebGL が無効だったため、3Dの動作は公開先から取得した一致済みファイルをローカル配信し、WebGL対応の Chromium 153 で確認しました。393×852、タッチ対応の画面設定で、3Dの準備、ノーマルでの出撃、一時停止中の時計停止、再開後の時計進行、ホーム復帰が成功し、ページ内の実行エラーと読み込みエラーはありませんでした。iPhone実機やSafariでの操作感・性能を確認した結果ではありません。

以前は GitHub Pages の公開元が `GitHub Actions` でしたが、公開処理が存在せず、公開実行履歴もありませんでした。初回公開では `main` の変更やPRのマージを行わず、確認済みの `main` から作成したファイルを `gh-pages` に置き、GitHub Pages の公開元を切り替えました。

## 再公開

原則は `main` を公開対象にします。ただし利用者が修正後の公開を指示し、PRのマージをしないよう指定している場合は、検査済みのPRコミットを固定して公開できます。PRは未マージのまま保持し、`version.json` に実際に公開した `sourceCommit` と `sourceBranch` を記録します。再公開時は現在の `version.json` を読み、未マージの公開済み修正を古い `main` で取り消さないよう対象を確認します。

1. 公開対象の `main` のコミットを固定し、Node.js 24 で `npm ci`、`npm test`、`npm run build` を実行します。
2. `dist/` に空の `.nojekyll` と `version.json` を加えます。`version.json` の `sourceCommit` に固定したソースのコミット、`publishedDate` に公開日、`buildCommand` に `npm ci && npm run build` を記録します。
3. `gh-pages` の履歴を保持し、公開用のファイル一式を新しいコミットで置き換えます。`main` を公開用ファイルで上書きしません。不要になった古い `assets/` は新しい公開コミットに含めません。
4. GitHub の Actions にある `pages build and deployment` が、更新した `gh-pages` のコミットで成功したことを確認します。公開URLでタイトル画面、出撃、一時停止、再開が動くことと、JavaScript と CSS が正しく読み込まれることを確認します。

`vite.config.ts` の `base: "./"` は、`/nusumidase/` 以下でゲームを読み込むために保持します。

公開済みのソースは https://chameleonjp-lab.github.io/nusumidase/version.json の `sourceCommit` で確認できます。iPhone実機での操作感や性能は、公開先のブラウザー確認とは別に確認してください。

## 戻す場合

直前の正常な公開コミットのファイル一式を、新しい `gh-pages` コミットとして復元します。履歴の強制上書きや `main` の巻き戻しは不要です。初回公開の設定を戻す場合は GitHub Pages の公開元を `GitHub Actions` に戻しますが、公開処理が存在しない状態では次の公開は実行されません。
