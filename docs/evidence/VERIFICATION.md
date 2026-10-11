# ヌスミダセ実装の検証記録

2026-10-11。5対5の旗取り、3回先取／12分判定、旗の取得・落下・奪還、8秒復活、4役AI、Normal/Easy、速度レバー、操作設定、端末内記録、停止・描画復旧を実装した。原カイセンの機体・飛行・追従視点を継承した。実機の操作感・熱性能と人が遊ぶ対戦バランスを含めた、全受入条件の合格は主張しない。

検査した最終ゲーム実装commitは `af8d9b9ebcf79c55b4c2b650991f266bf5360cba`。browser試験commitは `12bebe666e8b9290470b07780edaa37355ef5a21`（文字倍率の検査だけを追加改定）。描画喪失時の旧資源の解放順、初回の全geometry登録、準備中だけの有限GPU待機、粒子の追加時上限、通知音・live表示を修正した。以後の証拠文書commitでゲーム実装を変更せず、[実装manifest](implementation-manifest.json) のruntime・設定・試験ファイルhashで最終PRとの対応を検査する。既存の [要件](../REQUIREMENTS.md) と [計画](../IMPLEMENTATION_PLAN.md) の固定pin・本文は変更していない。

## 実行環境と再現

Debian GNU/Linux 13、Node 24.19.0、npm 11.9.0、Three 0.186.1、TypeScript 5.9.3、Vite 8.3.1、tsx 4.21.0、Playwright 1.61.1。Chromium 154.0.8037.57はANGLE SwiftShader、WebKit 26.5（Playwright build2311）はWPE／software rendering。いずれもiPhone実機ではない。

通常の環境ではREADMEの `npm ci`、`npx playwright install chromium webkit` の後に次を実行する。

```sh
npm test
npm run build
npm run test:browser
```

このworkspaceではsystem Chromiumと、workspaceへ抽出したWebKitの依存libraryを使った。WebKitのpackage・hash・probeは [環境記録](webkit-environment.json)、[能力検査](webkit-capability-probe.json)。OSへpackageをinstallしていない。[起動wrapper](webkit-launch.sh) は実際のPlaywright WPEのinstall先へ合わせて使用する。

```sh
NUSUMIDASE_CHROMIUM_EXECUTABLE=/usr/bin/chromium \
PLAYWRIGHT_BROWSERS_PATH=/workspace/playwright-browsers \
LD_LIBRARY_PATH=/workspace/webkit-libs/root/usr/lib/x86_64-linux-gnu \
NUSUMIDASE_WEBKIT_EXECUTABLE=/workspace/playwright-browsers/webkit-local/run.sh \
LIBGL_ALWAYS_SOFTWARE=1 npm run test:browser
```

ブラウザーは1 workerで順番に実行し、ソフトウェアGPUを他の撮影と競合させない。dev serverを最終ソースで再起動し、検査中のHMRによる別module identityを避けた。固定stateを使う検査はdevelopment限定 `?review` のowner module経由で実step・描画・音・UIを通す。production buildにはこの可変state入口を含めない。生成JSで `__nusumidase` が存在しないことを照合した。`node docs/evidence/verify-evidence.mjs` で実装62ファイル・撮影ソース36ファイル・共通core／fixture・画像37枚のhash一致を再確認できる。

## 検査結果

| gate | 判定 | 証拠と範囲 |
| --- | --- | --- |
| unit | passed | `npm test`、14試験ファイル、失敗0。[実行ログ](unit-results.txt)。35共通レバーfixtureを含む |
| type / production build | passed | strict TypeScriptとVite。[buildログ](build-results.txt)。Threeを含むJSは773.74kB／gzip207.74kB、500kBのchunk警告は残る |
| Chromium / WebKit製品経路 | passed | 最終42件（各21）、失敗・skip・retryなし。[ログ](browser-results.txt)・[条件別結果](browser-results.json)。全42件を最終ソースで再実行 |
| 原作飛行trace | passed | [固定元trace](../../tests/fixtures/flight-source-trace.json)、[検査](../../tests/flight-inheritance.test.ts)。両mode各780tick、姿勢・位置・速度・宙返り・camera・投影を1e-10以内で照合 |
| 機体4方向／camera2条件 | passed | [画像比較](VISUAL_COMPARISON.md)。同fixture6画像は全pixel差0、PNG hash一致。機体・空海・視点を簡略化していない |
| 8画面とCTF固有表示 | passed | baseline8画面とcandidate17状態を撮影／目視し、raw diffと変更理由を記録。異なる実時計・spawn・結果を同stateのpixel検査とは扱わない |
| P0画像の先行取得時刻 | failed | 8画面はUI構築前。機体／camera追加6画像は固定sourceから取得したがUI作業開始後。履歴条件は遡って合格にできない |
| AC-VISUAL全条件 | not-run | DPR2、全8画面の全viewport・200%文字／browser zoom・safe-areaの元作対比matrixは未完了 |
| iPhone実機／touch支援技術／操作感 | not-run | desktopのChromium／WebKitと合成pointer／button試験を実機検証へ代用しない |
| 実時間12分最大負荷／実機30fps・desktop60fps | not-run | 加速有効12分と20retryの資源試験を実時間のFPS・熱性能・heap／listener計測へ代用しない |
| 人が遊ぶバランス／復活地点からの実戦離脱 | not-run | 下記20seed無操作試合は有限終了とAI回収能力の証拠。対戦の面白さ・勝率・spawn camping耐性の合格ではない |
| GitHub Actions | not-run | 今回CI基盤を新設していない。提出時のhead check/statusはPR本文にreadback結果を記録する |

## 状態・入力・保存の受入範囲

| 条件 | 判定 | 実行した検査 |
| --- | --- | --- |
| AC-FLAG / MATCH、T01–18 | passed | 45m内外と高速sweep、候補順shuffle、2旗単一owner、同tick自軍奪還優先、newdrop／due帰還tickの再取得拒否、自旗不在、待機から翌tick回収、致死優先・相打ち、旧match／epoch／世代／revision、3点・時間切れ優先、deep freeze、0／5step・backlog停止 |
| AC-LIFE / COMBAT、T19–23 | passed | 10slot／予約1件、479／480復活、119／120保護、保護中境界死、双方弾切れ360tick装填、1024上限の2発組atomic予約、友軍除外、死んだ射手の既発射弾、旧世代へ不命中、距離減衰 |
| AC-AI / WORLD、T24–26 | passed | 役割と120tick保持・6tick再評価、1500m通常視認、carrier帰還と300m待機円、2段階stuck再経路。両team／両mode／65・110・141m/sで各drop端点往復、計216実飛行routeを合法空域・180秒以内で検査 |
| 共通レバー・PC／合成pointer、T27–34・47 | passed | 固定35fixture／core hash、非有限fail-safe、明示0優先、18m/s/秒・65..141clamp、release保持、Easy110、3入力を合算後1回clamp、3pointer独立owner、focusout／cancel、短押しの実tick1回ack、IME／shortcut／Tab／重複key除外 |
| 配置安全／移行、T36–40 | passed | レバーだけの退避、空き不足の無効・警告・保存拒否、旧v1 raw不変、未来version拒否、journal確保とreadback、各write／read／rollback故障、旧snapshot復元、stale tab preflight、Web Locksなし拒否、session／Cancelを検査 |
| 設定の実DOM、T35・39–40 | passed | 両browserで320×568／393×852／568×320／852×393のレバーhit・非衝突・preview/live一致、全dialog文字をcomputedサイズの2倍へ変更し保存／閉じるの表示とfocus到達を検査。Cancel0write、journalを含む全raw保全、session適用。全live controlの200%matrix／browser zoom／実safe-areaは別途未実施 |
| AC-STORE記録、T41 | passed | 終了済みimmutable resultのみ、completedMatchId重複拒否、reload後も異なるmatch identity、最新20件・mode／rules別best、途中試合を保存しない、future／保存失敗で旧raw保持 |
| 音・通知、T42 | passed | 10音unit：原作propeller harmonics／gain、10effect・2pass上限、重複cue抑制、capture／death／残60秒warningをengine停止後にも通知、AI死亡を自機爆発音にしない、off／reset／disposeで停止。旗・携行・drop・復活・resetを画像fixtureで照合 |
| meaningful event上限、T44 | passed | 128超は安全pause・記録対象外にしてcritical killを保存。GPU queueと描画効果は正本から分離している |
| 描画効果上限・期限、T43 | passed | 両browserで100kill通知から粒子240／wreck10、5.01秒で消滅、20retry資源不変、加速有効12分、2連続context喪失・手動再開・喪失中Home復帰を検査。GL error0。粒子は追加前から240以内。描画・音は各tick最大128件の直接dispatchで未処理queue0、512 queue溢れfixtureは構造上適用外で未実行 |
| T46実戦の復活保護離脱 | not-run | 保護期限／damage順はunitで検査済み。敵・射線固定下で人が合法離脱できるかは未確認 |

正本の`tick`はcountdown／roundResetを含み、タイマーの期待値は有効playing時間の`playTicks`で検査する。pause／countdown／roundResetは試合時間を進めず、自機の復活待ちはAIと世界を進める。画像JSONには両方を記録した。描画30／60／120Hz分割で正本が同じこと、旧epoch event1000回を拒否することも検査した。単体のfailure注入を、実機で自然に同じ障害が発生した証拠とは呼ばない。

## AIの有限終了と資源計測

[20seed無操作結果](ai-idle-summary.json)：seed1..20、奇数Normal／偶数Easy、既定戦力・入力中立・state改変なし。全試合が43200有効tick＝720秒で終了し、全stepで旗／slot／予約／弾／有限数値の不変条件を検査した。計938pickup、enemy AIの回収1回（seed3）、19引分・1敗北。carrierは904回被弾・27回衝突で死亡し、取得後死亡中央値は約5.03秒。無操作では強い防衛傾向があり、バランス調整済みとは記録しない。

加速renderer soakは両browserで720有効秒の時間切れへ終了し、deep frozenの記録対象resultを生成した。既定Easy・seed 0x4e555355・10slot、実simulation/event/audio/UIを600tick単位で進める。[Chromium JSON](browser-soak-chromium.json)・[WebKit JSON](browser-soak-webkit.json)に完全version・software GPU・source hashes・全sampleを記録。

| browser | wall時間 | 有効時間 | sample数 | 弾最大 | 粒子最大 | wreck最大 | 音source最大 | geometry／texture |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| chromium | 37.13秒 | 720秒 | 73 | 62 | 144 | 4 | 6 | 41／4で不変 |
| webkit | 23.36秒 | 720秒 | 73 | 62 | 144 | 4 | 7 | 41／4で不変 |

これらは600simulation tickごとのsnapshot最大値であり、全tick最大値や実時間連続12分／10機最大連射／実機FPS／heapやlistenerの単調増加を測定したという意味ではない。GPU queue failureは全sampleでnull。1024弾のatomic上限は別のcore fixtureで検査した。

[初回全40件の結果](browser-initial-results.json)は33 passed／7 failed。内訳はCSSの1/64px丸めとfuture journal警告の期待値4件、描画復旧1件、初回未登録geometryによるsoak2件。期待値は限定的に修正し、実装の復旧と全pool登録も修正した。最終42件の全再実行を合格の根拠とし、初回の失敗を隠していない。

## 独立レビューと提出

試合核の担当とは別の読み手が不正flag timer／homeTeam、stale capture、dead carrier再検証、event overflow、保護期限、旧世代弾をレビューし、[6回帰検査](../../tests/core-review.test.ts) を追加した。統合担当とは別の読み手がpause／reset／result／保存／非同期callbackをレビューした。指摘を受けて、reloadを越えたmatch identity、再開直後の長押し維持、自機撃墜音、描画初期化／復帰の古いPromise無効化を修正した。描画喪失中に旧sceneを解放し、復帰後の新sceneを準備する。GPUの全pool準備に限り最大30秒を待ち、飛行中の1秒stall判定と250ms backlog停止は維持した。

最終検査は修正後のソースに対して実施し、[manifest](implementation-manifest.json) とremote branchのbytesをreadbackする。mainは確認時点で `c604c7990e5ba9a599898ede6c1ccb4b42970b51`、open PRは0件。main宛てDraft PRとして提出する。merge・auto-merge・配備・公開設定変更は行っていない。最終head／競合／GitHub checkの状態はPR本文に記録する。
