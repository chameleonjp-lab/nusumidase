# カイセン継承の画像比較

2026-10-11。固定カイセン `3d751051dc6212482a129e8da596ddd349b2f9f5` とヌスミダセ候補の実画像を比較した。機体4方向とNormal/Easyの固定カメラfixtureは、全画像のRGB差分0、PNGのSHA256も完全一致。8画面の意味対応画像とCTF追加状態も取得し、100%表示で確認した。8画面の実時計・配置・ゲーム結果は同一stateではないため、これらの全画像差分を同条件合格には使っていない。

全体のgateとbrowser試験は [VERIFICATION.md](VERIFICATION.md)。固定sourceのURL/commit/blob/理由は [PROVENANCE.md](../PROVENANCE.md)、SHA256は [source-manifest.json](source-manifest.json)。

## 撮影環境と候補の識別

Chromium `154.0.8037.57`、Debian GNU/Linux 13、ANGLE SwiftShader、Node `24.19.0`、npm `11.9.0`、Three `0.186.1`、Vite `8.3.1`、Playwright `1.61.1`。UIは393×852/DPR1、文字倍率100%、browser zoom100%、safe area0。モデル/カメラは852×393/DPR1。描画環境は実機iPhoneではない。

Japanese明朝はNoto Serif CJK JP Regular、本文/ボタンはNoto Sans CJK JP Regular/Bold、LatinブランドはNoto Sans BoldをCDPで確認した。[font検査](baseline/fonts.json) にCSS stack・PostScript名を保存した。

カイセンの8画面は02:41:39–02:41:49 UTCに取得し、その完了を候補UI構築前に通知した。機体/カメラbaselineは02:42:59–02:43:39 UTCに未変更の固定sourceから取得。機体/カメラの撮影は候補UI作業開始後になったため、全14画像がUI構築前だったとは記録しない。

最終画像のsource固定はcommit `af8d9b9ebcf79c55b4c2b650991f266bf5360cba`。音の停止/復活・非同期WebGL復帰・全geometryの事前upload・効果240上限・通知の同文再読上げ抑制・携行HUDと公開コアlabelの重なり修正後に、17状態とNormal/Easy cameraを再取得した。機体4方向はisolated factoryが使うaircraft.tsのhashが変わらないため元の撮影時刻を保持し、最終commitで同hashを再検査した。sceneを使うcamera画像とは区別する。

候補の最終UI画像は、HMRによる再読み込みを防ぐためsourceを `/workspace/nusumidase-visual-snapshot` へ複製し、同じnode_modulesでdev server4180を起動して撮影した。候補17状態の各JSONに撮影時の全src/index SHA256を保持。[候補manifest](candidate/manifest.json) と [source readback](candidate/source-snapshot-readback.json) で、本repoの実装byteとの一致を確認した。[証拠readback](evidence-integrity-readback.json) は固定出典31件、画像37件、候補src/index36件のhash/blob一致を検査した。gitのbase HEADだけを完成commitと呼ばず、最終commitへの対応は全体gateで同じsource hashを確認する。

## 同じfixtureでの比較

| fixture | baseline | candidate | 全画像差分 |
| --- | --- | --- | --- |
| 機体正面 | [画像](baseline/aircraft-front-baseline.png) | [画像](candidate/aircraft-front-candidate.png) | 0 pixel |
| 機体側面 | [画像](baseline/aircraft-side-baseline.png) | [画像](candidate/aircraft-side-candidate.png) | 0 pixel |
| 機体背面 | [画像](baseline/aircraft-rear-baseline.png) | [画像](candidate/aircraft-rear-candidate.png) | 0 pixel |
| 機体bank0.45 | [画像](baseline/aircraft-bank-baseline.png) | [画像](candidate/aircraft-bank-candidate.png) | 0 pixel |
| Normal camera | [画像](baseline/camera-normal-baseline.png) | [画像](candidate/camera-normal-candidate.png) | 0 pixel |
| Easy camera | [画像](baseline/camera-easy-baseline.png) | [画像](candidate/camera-easy-candidate.png) | 0 pixel |

モデル4画像は同じfactory・hero品質・照明fixture・pose・cameraを使ったisolated geometry/material検査。実sceneの追従camera検査とは区別する。原機体の全幅12mとbboxを状態JSONへ保存し、実機体sourceを簡略モデルへ置換していないことをbyte/画像両方で確認した。

カメラは両作品のproduction sceneを使い、playerの位置 `(0,300,0)`、quaternion identity、bank0、tick0、elapsed0、seed1262569811で固定。元作の艦/他機、本作の基地/コア/他機をfixtureから除き、playerと全空/海背景を残した。画像のpixelをmaskしていない。FOV64、near0.5、far22000、相対位置 `(0,11,29)`、mode別quaternion、500m target投影、Normal gun sight座標もJSONで一致。

[baseline model/camera manifest](baseline/model-camera-manifest.json)、[candidate model manifest](candidate/model-camera-manifest.json)、[candidate camera manifest](candidate/camera-manifest.json)、[機械差分](visual-diff-report.json)、[全差分PNG](diff/)。機体・flight-view・aircraft-batch・sky shader・ocean・gun-sightのsource byteは固定Kaisenと一致（[byte照合](inherited-source-check.json)）。

## 8画面の意味対応と説明できる差分

| 画面 | baseline | candidate | 確認した変更境界 |
| --- | --- | --- | --- |
| home | [画像](baseline/home-baseline.png) | [画像](candidate/home-candidate.png) | 作品名、旗取りの編隊/3回目標/12分説明、source艦の除外。長い作品名の同じ明朝内でのサイズ調整 |
| Normal flight | [画像](baseline/normal-flight-baseline.png) | [画像](candidate/normal-flight-candidate.png) | 艦/対艦兵装/得点を旗/基地/回収/残時間へ、旧加減速2円を縦レバーへ。source play51、本作countdown180+play51、spawn poseは異なる |
| Easy flight | [画像](baseline/easy-flight-baseline.png) | [画像](candidate/easy-flight-candidate.png) | 同じEasy巡航・照準円・宙返り。本作play55、source play55でも初期配置/航空機標的は異なる |
| pause | [画像](baseline/pause-baseline.png) | [画像](candidate/pause-candidate.png) | source同様のpanel/各入口。停止理由はCTFの時計/復活/装填へ |
| Normal touch settings | [画像](baseline/normal-touch-settings-baseline.png) | [画像](candidate/normal-touch-settings-candidate.png) | 同じタブ・range・draft・preview・保存/破棄。武器/速度項目をCTF3操作へ、labelを操作に変更 |
| Easy touch settings | [画像](baseline/easy-touch-settings-baseline.png) | [画像](candidate/easy-touch-settings-candidate.png) | Easyの宙返り1操作、CTF説明、同じpreview/dialog |
| keyboard settings | [画像](baseline/keyboard-settings-baseline.png) | [画像](candidate/keyboard-settings-candidate.png) | 対艦キーを除いた9操作。加減速key名は互換として残り、touch2ボタンの残存とは扱わない |
| result | [画像](baseline/result-baseline.png) | [画像](candidate/result-candidate.png) | 元作の海面接触敗北tick206と、本作の12分引分fixture。回収/奪還/撃墜/死亡と作品記録へ置換 |

CSS差分は旧throttle/payloadのstyle除去と旗/復活/レバー/title fitの追加。明朝/ゴシックfamily、`#eff4ed`、`#071e2b`、gold `#e4c88b`、muted `#b8cbce`、full-width、透明panel、主要home/pause/settingsの構造を保っている。設定のrect/color/font情報は候補画面JSONにも記録した。

最初の候補でNormal/Easyの操縦hint末尾「縦」だけが改行する欠点を目視で発見し、sourceの短い「ドラッグで操縦」へ修正後に最終17状態を再撮影した。最終Normal/Easy、携行/自旗不在の画像で機体・照準を隠さず、hintが1行に収まることを確認した。初回のHMR/並行GPU撮影の失敗を最終画像へ転用していない。

自旗不在でenemy coreを携行する状態では、携行HUDの理由とfriendly coreの公開labelが重なっていた。最終sceneは携行時の自基地labelを省き、公開friendly coreを左の第1行へ移す。最終の携行/自旗不在画像を393×852/DPR1・100%表示で確認し、公開label（約y260）と携行理由/距離（y293–330）の重なりが解消した。他viewportや200%文字の全画像matrixを検査したという意味ではない。

8画面のraw diffは [diff/](diff/) に保存した。これらは作品文字・ルール・world・結果などの差分をそのまま可視化する参考であり、全画像の0差分を期待する検査ではない。

## CTF固有の表示fixture

| fixture | 実画像 | 正本との対応 |
| --- | --- | --- |
| 縦レバー設定 | [画像](candidate/lever-settings-candidate.png) | Normalの1項目、長方形preview |
| ルール | [画像](candidate/rules-candidate.png) | 可視home入口からdialog |
| 携行 | [画像](candidate/carrying-candidate.png) | 生存player世代を参照するenemy flag carried |
| 自旗不在 | [画像](candidate/own-flag-absent-candidate.png) | 両旗carried、HUDに「自軍コアの奪還が必要」 |
| drop | [画像](candidate/drop-candidate.png) | 合法位置のdropped、due=playTick+1800 |
| 復活待ち | [画像](candidate/respawn-wait-candidate.png) | scheduleRespawn経路で8秒予約、最後のcamera維持 |
| roundReset | [画像](candidate/round-reset-candidate.png) | 合法carrierを自基地へfixture配置し、実stepで回収1→roundReset |
| time draw | [画像](candidate/time-draw-candidate.png) | 最終合法time tick→実stepで引分result |
| 保存失敗 | [画像](candidate/save-failure-candidate.png) | 本作allowlistのsetItemにQuotaExceededErrorを注入、元設定維持/「今回だけ使う」を表示 |

これらはdevelopment限定 `?review` の固定state/clock fixture。対戦を人が遊んで同じ戦況へ到達した証拠とは分ける。各JSONに生成recipe、mode、tick、playTicks、seed、stateを保存。最終撮影のpageerrorは0件。

## 判定と残る検査

| gate | 判定 | 範囲 |
| --- | --- | --- |
| P0固定source/blob/hash | passed | planの固定pinを変更せず記録。core別commitの期待hash一致 |
| P0 UI baseline先行 | passed | 必須8画面を候補UI構築前に確保 |
| P0 model/camera先行時刻 | failed | 固定source画像は確保したが、追加6画像は候補UI作業開始後に撮影 |
| 原機体/空海/固定camera fixture | passed | 同環境・同pose・同tickの6画像、全pixel差0、PNG hash一致 |
| 8画面の意味対応/追加CTF画像 | passed | 17状態を撮影/目視、source hashreadback一致、説明済み差分あり |
| 携行/自旗不在のlabel重なり | passed | 最終393×852/DPR1・100%画像で公開coreと携行HUDが重ならないことを確認 |
| AC-VISUAL全条件 | not-run | 全8画面を同一再生stateにした比較、全viewport/DPR2/200%文字・zoom/safe-areaの画像比較は未完了 |
| WebKit起動/能力 | passed | WPE WebKit26.5、Japanese renderとWebGL2=trueを確認。製品browser試験は全体gateへ |
| iPhone実機/支援技術/操作感/熱性能 | not-run | desktop browser模擬と区別 |

WebKitは不足lib10packageをDebian snapshotからdownloadし、workspaceへ `dpkg-deb -x`。system packageの変更なし。[環境とhash](webkit-environment.json)、[能力probe](webkit-capability-probe.json)、[起動wrapper](webkit-launch.sh)。Playwrightのdefault wrapperがLD_LIBRARY_PATHを上書きするため、このWPE wrapperをexecutablePathへ渡し、`LIBGL_ALWAYS_SOFTWARE=1` とlocal lib pathを使用した。起動成功やWebGL2の存在を製品検査の全件合格にしない。

再取得scriptは [source UI](capture-kaisen-baseline.mjs)、[source model/camera](capture-kaisen-models.mjs)、[candidate UI](capture-candidate-ui.mjs)、[candidate models](capture-candidate-models.mjs)、[candidate camera](capture-candidate-camera.mjs)、[diff計算](compare-visuals.py)、[明示commitへの照合](bind-candidate-evidence.py)。撮影→diff計算後、`python3 docs/evidence/bind-candidate-evidence.py <source-commit>` で現行byteとgit archiveの一致を要求し、画像とsourceのreadbackを更新する。初期ソースsnapshotは保持し、candidate sourceが変わればhash一致を再確認して影響する撮影をやり直す。
