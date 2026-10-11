# ヌスミダセの継承出典と検査環境

主継承元はカイセン固定commit `3d751051dc6212482a129e8da596ddd349b2f9f5`。カメラ・機体の照合元はファイトフライト固定commit `c2b313d37875b93458032d98636fcf5b5d30a138`。速度レバー契約の追補は空力・機体・カメラのbaselineを変更する理由にしない。要件/計画の既存pinとhashは変更していない。

## 転用する固定ソース

各ファイルのSHA256は [source-manifest.json](evidence/source-manifest.json) に保存。以下の変更理由は責務の境界であり、視覚比較が合格したという意味ではない。

| 固定ソース | Git blob | 本作の転用理由・変更境界 |
| --- | --- | --- |
| [index.html](https://github.com/chameleonjp-lab/kaisen/blob/3d751051dc6212482a129e8da596ddd349b2f9f5/index.html) | `de945a10417a2f883b3cfd3d79fadbfe3c7a4afc` | 全幅home / HUD / pause / result / 設定入口の構造。作品名・旗取りの意味と対艦兵装除外のみ変更。 |
| [src/style.css](https://github.com/chameleonjp-lab/kaisen/blob/3d751051dc6212482a129e8da596ddd349b2f9f5/src/style.css) | `66f33fdd090157f27d8c4661d0f6d42a486c6ed7` | 青緑・金、明朝見出し、余白、全画面レイアウト。旗HUDと縦レバーを最小追加。 |
| [src/control-settings.ts](https://github.com/chameleonjp-lab/kaisen/blob/3d751051dc6212482a129e8da596ddd349b2f9f5/src/control-settings.ts) | `5208c4da8ebe014552cae855d84c2574ab152292` | タッチ/キー両タブとdraft操作。作品固有キー、長方形レバー、保存transactionへ接続。 |
| [src/control-settings.css](https://github.com/chameleonjp-lab/kaisen/blob/3d751051dc6212482a129e8da596ddd349b2f9f5/src/control-settings.css) | `1235392f369ac27ef3056852512319fe6994300b` | 設定dialogの色・余白・preview。長方形レバー表示を追加。 |
| [src/keyboard-settings.ts](https://github.com/chameleonjp-lab/kaisen/blob/3d751051dc6212482a129e8da596ddd349b2f9f5/src/keyboard-settings.ts) | `eb143ac27b3f65b66912d10b89ec17d0efc581b2` | code再割当・IME/shortcut除外。対艦キーを除いた9/6操作。 |
| [src/input.ts](https://github.com/chameleonjp-lab/kaisen/blob/3d751051dc6212482a129e8da596ddd349b2f9f5/src/input.ts) | `0edbd1c5f9f07a2d1088539e188bab0329ab53f0` | 相対ドラッグ、36px・8%deadzone、pointer所有。縦レバーと実step消費ackを追加。 |
| [src/main.ts](https://github.com/chameleonjp-lab/kaisen/blob/3d751051dc6212482a129e8da596ddd349b2f9f5/src/main.ts) | `af73f3ae5b0bdcecb1b8e10d86b9342e2663d983` | 起動・画面遷移・CSS読み込み順・中断解除を参照。CTF stateへのadapterとして接続。 |
| [src/aircraft.ts](https://github.com/chameleonjp-lab/kaisen/blob/3d751051dc6212482a129e8da596ddd349b2f9f5/src/aircraft.ts) | `e4e3009464bb8c4ae473b7cfc46d010198c27149` | hero/enemy geometry・material・手続きtexture・可動翼を原形保持。 |
| [src/flight.ts](https://github.com/chameleonjp-lab/kaisen/blob/3d751051dc6212482a129e8da596ddd349b2f9f5/src/flight.ts) | `3019be9650863c11cc1c57f7bb7e09ab815c9c07` | 空力・旋回・上昇・宙返りを保持。共通レバーの速度入力adapterのみ追加。 |
| [src/flight-assist.ts](https://github.com/chameleonjp-lab/kaisen/blob/3d751051dc6212482a129e8da596ddd349b2f9f5/src/flight-assist.ts) | `799efdfb97c3b9ba435e8eaf4080f65b74326773` | Easyの航空機支援を保持。非航空機を対象にしない。 |
| [src/flight-view.ts](https://github.com/chameleonjp-lab/kaisen/blob/3d751051dc6212482a129e8da596ddd349b2f9f5/src/flight-view.ts) | `87f83928a00092338391442ec2d7e87e3b4e33da` | FOV64・offset(0,11,29)・bank0.45・mode別視線と投影を保持。 |
| [src/scene.ts](https://github.com/chameleonjp-lab/kaisen/blob/3d751051dc6212482a129e8da596ddd349b2f9f5/src/scene.ts) | `2611a6e6a7b57fe6f94c1d75593aa8da51d33726` | 空/海/照明・renderer・camera・機体描画を参照。艦/対艦visualを除き旗/基地を接続。 |
| [src/aircraft-damage.ts](https://github.com/chameleonjp-lab/kaisen/blob/3d751051dc6212482a129e8da596ddd349b2f9f5/src/aircraft-damage.ts) | `fe0c48ff296a31db70c7f93a0cdab64244ba939b` | 機銃/機関砲の4段階距離減衰を保持。チーム対戦の火力値はmission側。 |
| [src/aircraft-batch.ts](https://github.com/chameleonjp-lab/kaisen/blob/3d751051dc6212482a129e8da596ddd349b2f9f5/src/aircraft-batch.ts) | `6aed47adeb8d22f976b99f0630bb2e841bb054b9` | 遠距離機体の共有geometry描画。 |
| [src/atmosphere.ts](https://github.com/chameleonjp-lab/kaisen/blob/3d751051dc6212482a129e8da596ddd349b2f9f5/src/atmosphere.ts) | `7c6bb5925aeffc850596061fcbb1563048bcc96a` | 固定元の空/海shader。 |
| [src/gun-sight.ts](https://github.com/chameleonjp-lab/kaisen/blob/3d751051dc6212482a129e8da596ddd349b2f9f5/src/gun-sight.ts) | `1cdbd4bb3cf49d963c78f87a1cb00a42fb3b222b` | Normalの500m固定照準投影を保持。 |
| [src/ocean.ts](https://github.com/chameleonjp-lab/kaisen/blob/3d751051dc6212482a129e8da596ddd349b2f9f5/src/ocean.ts) | `22c6bfd0278455fbc60cc365e82846161819deab` | 手続き海面とworld scaleを保持。 |
| [src/render-queue.ts](https://github.com/chameleonjp-lab/kaisen/blob/3d751051dc6212482a129e8da596ddd349b2f9f5/src/render-queue.ts) | `2540d37e7cb098515979c39eb461b2ab64ee112e` | GPU描画完了の有界監視。 |
| [src/aim-indicator.ts](https://github.com/chameleonjp-lab/kaisen/blob/3d751051dc6212482a129e8da596ddd349b2f9f5/src/aim-indicator.ts) | `110902ee729435cab2092b290e8b9eb164b3ab98` | 航空機標的の色・照準円表示。 |
| [src/aircraft-tracers.ts](https://github.com/chameleonjp-lab/kaisen/blob/3d751051dc6212482a129e8da596ddd349b2f9f5/src/aircraft-tracers.ts) | `ba741ce4953f286342079effe2d9ce0fa0c4e4be` | 銃弾の有界描画。 |
| [src/audio.ts](https://github.com/chameleonjp-lab/kaisen/blob/3d751051dc6212482a129e8da596ddd349b2f9f5/src/audio.ts) | `efb077f729aa3c95c3e2e8db518a47095e45fa0c` | 元作のWeb Audio合成音を参照。対艦呼出を除外し、旗通知と自機撃墜の経路を追加。engine停止時も旗・撃墜cueをdirect gain .6で通知。 |
| [src/dialog-focus.ts](https://github.com/chameleonjp-lab/kaisen/blob/3d751051dc6212482a129e8da596ddd349b2f9f5/src/dialog-focus.ts) | `5d10d15cb0b9d3de31871af98a7801d638a5055b` | dialogのfocus境界と復帰。 |
| [src/rules-guide.ts](https://github.com/chameleonjp-lab/kaisen/blob/3d751051dc6212482a129e8da596ddd349b2f9f5/src/rules-guide.ts) | `8aa776fb9c0cebf3145d8d507a96fea3233edc87` | 既存の説明dialog枠。文章はCTFルールへ置換。 |
| [src/types.ts](https://github.com/chameleonjp-lab/kaisen/blob/3d751051dc6212482a129e8da596ddd349b2f9f5/src/types.ts) | `54b740b9895be8d02e37054aa7a8aeab48610b53` | 飛行用Aircraft/FlightInputの形を参照。Match/Flag/Resultの正本は本作に新設。 |

## 機体とカメラの元作照合

Kaisen `aircraft.ts` SHA256は `1a9c18f93e5a48869882b2aa2946cdeb352dc4a8acd76b4fd9beade8ded621d5`、FightFlightは `bd36d4b5bab5c5a4fbf53d860e759b70d954ef0740fbacdcbe803e641586c729`（blob `7ea053b94f6af23eb3b46296d740dccd39209d5b`）。Kaisen `flight-view.ts` は `1f9b7e040c2270de5838f24bad93c7ac1c75c7827ba3c1b58591ef6271a20363`、FightFlightは `e656e86bebdef77cbd3515b45f933880fca524ef07e1bbe623c95199afc61486`（blob `c221e1035f83bcef29435df7c8d0042e59013174`）。どちらもKaisen側の末尾空行1つだけがbyte差。末尾LFの正規化後の本文は一致し、意味差はない。元のbyte/hashを改変せず両方記録した。

## 速度レバーの追補契約

契約・fixtureは [machimamore c4224528b83d31cccc66e04b2c146ec931ec51e0](https://github.com/chameleonjp-lab/machimamore/tree/c4224528b83d31cccc66e04b2c146ec931ec51e0) から取得。coreはこのcommitには存在しないため、後続実装の固定commitを別に明示した。

| 対象 | 固定commit / path | Git blob | SHA256 |
| --- | --- | --- | --- |
| 契約v1 | `c4224528b83d31cccc66e04b2c146ec931ec51e0` / `docs/THROTTLE_LEVER_CONTRACT.md` | `e635791464f3f7051c6a27b7449f6ec311ff7bd6` | `cd0e7db83c54cf349fb6a178a8abcd22bf09f78376cb4b836784faa2ae721864` |
| 共通35fixture | 同commit / `docs/fixtures/throttle-lever-v1.json` | `2589bf90f2171a1c9213e57e36fb9e5edabf2a5d` | `416c5ac01d4d14d1f45d94385e07233090740db04382e468db1f0c64689df8ca` |
| 共通core | [`cb7d698a50abb8bbb53b00c2e0071fc7cfc28b70` / `src/throttle-lever.ts`](https://github.com/chameleonjp-lab/machimamore/blob/cb7d698a50abb8bbb53b00c2e0071fc7cfc28b70/src/throttle-lever.ts) | `0a694b632dd38d310ea9f20a5ef6ee14d24767db` | `e83fe3c570581d16cb76e08ef9a039bbe9d4a50da6575366ac7e126bf3f30cf0` |

長方形のsafe layout adapterは同じ [machimamore cb7d698a50abb8bbb53b00c2e0071fc7cfc28b70](https://github.com/chameleonjp-lab/machimamore/tree/cb7d698a50abb8bbb53b00c2e0071fc7cfc28b70) の以下2ファイルも参照した。カイセンの見た目/空力/機体/カメラのpinを置換せず、レバー追補だけを別層で記録する。

| 補助ソース | Git blob | SHA256 | 本作での接続 |
| --- | --- | --- | --- |
| [src/control-settings.ts](https://github.com/chameleonjp-lab/machimamore/blob/cb7d698a50abb8bbb53b00c2e0071fc7cfc28b70/src/control-settings.ts) | `bbfeac9c3e038e6d37e4a97d2bfaf67cbdabb982` | `c3be9e6c2f947a0915d2b47e8891dc3716fe14ae15becb4d9cdfa20df4779f1f` | controlDimensions / rectangularBounds / safeThrottlePlacement等の長方形bounds・レバー退避の参照。Kaisen dialogに本作の配置競合検査・transactionを接続 |
| [src/control-obstacles.ts](https://github.com/chameleonjp-lab/machimamore/blob/cb7d698a50abb8bbb53b00c2e0071fc7cfc28b70/src/control-obstacles.ts) | `f8582462653b75c9426322050e3f8ad5425bcb99` | `cacd1cff5a216dc45a1c9d5eba95b261d2d3343d517290d3b4c0fd85421dac67` | detached HUD cloneのutility rect、offset寸法、zoom/transform補正を本作control-settings.ts内へ接続。独立obstacles.tsファイルを取得したという扱いにはしない |

coreは計画書の期待hashに完全一致。c422契約本文とfixtureのpinは移動していない。共通coreの履歴導入commit `4c2d5e5c84a3d7774f75f80608e501e88ef68bdb` も同blobだが、本作の取得pinは上表に統一。作品固有adapter・保存キー・Normal/Easy説明は本作で接続する。

## UI構築前の基準画像

2026-10-11 02:41:39–02:41:49 UTC、固定Kaisenを先に起動し、home / normal flight / easy flight / pause / normal touch settings / easy touch settings / keyboard settings / resultの8画面を確保した。候補UIの構築開始前に取得完了を通知した。画像・状態は [baseline manifest](evidence/baseline/manifest.json) と同directoryのPNG/JSONに結び付く。Normal flight/pauseはtick51、Easy flightはtick55。結果は実際のキー操縦で海面へ接触したtick206の終了画面。CTF結果との比較には意味対応を使い、撃墜終了と旗回収終了の数値一致を主張しない。

飛行画像は標準UIから出撃して停止ボタンを押し、停止overlayのvisibilityだけを撮影時に隠した。元作の艦・対艦兵装・旧加減速ボタンはbaselineのまま保存した。tickや姿勢が異なるcandidateを同条件diffと呼ばない。固定model/cameraは [model-camera manifest](evidence/baseline/model-camera-manifest.json) と状態JSONへ記録。isolated geometry renderとproduction camera fixtureを区別する。

環境はDebian GNU/Linux13、Node24.19.0/npm11.9.0、Chromium154.0.8037.57（`/usr/bin/chromium`）、ANGLE SwiftShader。Kaisenの指定依存 Three0.186.1 / Vite8.3.1 / Playwright1.61.1 / TypeScript5.9.3 / tsx4.21.0 をそのまま使用した。sourceのpackageを将来版に置換せず、候補でインストールした同一node_modulesをsourceにリンクして起動。画面は393×852/DPR1、文字倍率100%、zoom100%、safe area0、seed1262569811。CSSのsystem-ui系と明朝系を保持し、CDPの実使用font検査で、見出しNoto Serif CJK JP Regular、本文/ボタンNoto Sans CJK JP Regular/Bold、LatinブランドNoto Sans Boldを確認した（[fonts.json](evidence/baseline/fonts.json) にPostScript名を保存）。fontconfigの既定候補とブラウザが実使用したfontは区別した。完全font stack・viewport・DPR・UA・computed font sizeは画面JSON内。

再取得は固定Kaisenで `npm run dev -- --port 4176` を起動し、本作の `node docs/evidence/capture-kaisen-baseline.mjs` / `node docs/evidence/capture-kaisen-models.mjs` / `node docs/evidence/capture-source-fonts.mjs` を実行。実時計の8画面はtickが変動し得るため再取得時manifestを確認する。モデル/カメラfixtureは固定tick0・同じ姿勢を使う。

## 素材と権限の範囲

固定source treeにLICENSE/COPYINGは見つからなかった。同じ chameleonjp-lab 管理repo間で、利用者が指定した操作/見た目の継承として必要なsourceを転用し、出典を記録した。新たな再配布ライセンスが付与されたという主張はしない。機体texture・空/海・音はsourceの手続き生成/合成で、外部画像・font download・実録音・ランキング・分析SDKを追加していない。公開・merge・配備の実施証拠はこの文書に含めない。

## 視覚検査の現在状態

[画像比較報告](evidence/VISUAL_COMPARISON.md) へcandidate17状態と実diffを記録した。原機体4方向とproduction Normal/Easy cameraの6画像は同環境/同fixtureで全pixel差0・PNG hash一致。8画面の意味対応画像は、sourceとCTFのspawn/時刻/結果差を説明した参考比較であり、AC-VISUAL全条件の合格ではない。source8画面はUI構築前に確保し、追加model/camera6画像の撮影はUI作業開始後だったことも報告へ明示。WebKit26.5のlocal起動/WebGL2能力を確認したが、製品試験は全体gateと区別する。複数viewport・DPR2・200%文字/zoomの全画像比較、iPhone実機、支援技術・操作感・熱性能は未実施。未実施をpassedへ昇格しない。
