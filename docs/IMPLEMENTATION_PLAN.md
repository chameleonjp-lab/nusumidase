# ヌスミダセ 実装計画書

主継承元は [カイセン](https://github.com/chameleonjp-lab/kaisen)、固定baselineは [3d751051dc6212482a129e8da596ddd349b2f9f5](https://github.com/chameleonjp-lab/kaisen/tree/3d751051dc6212482a129e8da596ddd349b2f9f5)。機体・飛行の照合元は [ファイトフライト c2b313d37875b93458032d98636fcf5b5d30a138](https://github.com/chameleonjp-lab/faitofuraito/tree/c2b313d37875b93458032d98636fcf5b5d30a138)。元作の見た目と操縦を保持したまま、二基地の空中旗取りを新しい試合stateとして接続する。

作成日: 2026-10-05。計画v1。[要件仕様計画書](REQUIREMENTS.md) を仕様の正本とする。対象は [chameleonjp-lab/nusumidase](https://github.com/chameleonjp-lab/nusumidase)。本PRは文書2本の追加のみ。ゲーム本体、依存package、CI、デプロイ設定、README、既存ファイルを書き換えない。以下のファイル分割・試験は後続実装で行う計画であり、本PRの実施結果ではない。

## 1 開始時の確認と停止条件

調査時mainは [2ca2e0a9ccddc41438175e750a93d0190d531ac7](https://github.com/chameleonjp-lab/nusumidase/commit/2ca2e0a9ccddc41438175e750a93d0190d531ac7)、既存内容は [README.md](https://github.com/chameleonjp-lab/nusumidase/blob/2ca2e0a9ccddc41438175e750a93d0190d531ac7/README.md) のみ（blob `fb589c4a910f392f1a282e5644a897d72d92cbc6`）。実装・試験runnerは未存在。準備済みのゲームや既存CIがあるとは扱わない。

文書提出直前にもmain/open PR/treeを再読する。別作業が進んでいれば読み取りで差分を確認し、その作業を移動・改変・mergeしない。文書pathが競合したら上書きせず止めて整理する。ブランチはmainから派生、main宛てDraft PRとし、main直push、merge、auto-merge、配備、公開設定変更は行わない。

後続実装は別途着手範囲を確認して開始する。独自UI・簡略機体・別カメラへの置換、ネット対戦/ランキング/DB導入、地上/対艦兵装追加は本計画の範囲外。数値の初期設計を変更する際は理由・rulesVersion・影響するfixtureと記録互換を同時更新する。

## 2 固定参照と依存の入口

### 2.1 ソースと追補契約

要件第2章の固定ファイル表を入口とし、HTML、style.css、control-settings.ts/css、keyboard-settings.ts、input.ts、main.ts、aircraft.ts、flight.ts、flight-assist.ts、flight-view.ts、scene.tsを実ファイルで読む。コード転用時は元URL/commit/path/blobと変更理由をprovenanceへ記録する。元作のAGENTSや文書は参照元の文脈を理解するために読み、本作へ無関係な公開・実行指示を持ち込まない。

共通縦速度レバーは [契約v1固定本文](https://github.com/chameleonjp-lab/machimamore/blob/c4224528b83d31cccc66e04b2c146ec931ec51e0/docs/THROTTLE_LEVER_CONTRACT.md) と [共通35fixture](https://github.com/chameleonjp-lab/machimamore/blob/c4224528b83d31cccc66e04b2c146ec931ec51e0/docs/fixtures/throttle-lever-v1.json) を参照する。[共通文書のDraft PR](https://github.com/chameleonjp-lab/machimamore/pull/3) は依存の来歴であり、実装完成の証明ではない。作品固有adapter文書は本作へ流用しない。

| 入力契約の識別 | 固定値 |
| --- | --- |
| 契約 | v1、SHA256 `cd0e7db83c54cf349fb6a178a8abcd22bf09f78376cb4b836784faa2ae721864` |
| 共通core `throttle-lever.ts` | SHA256 `e83fe3c570581d16cb76e08ef9a039bbe9d4a50da6575366ac7e126bf3f30cf0` |
| fixture | SHA256 `416c5ac01d4d14d1f45d94385e07233090740db04382e468db1f0c64689df8ca` |

coreの取得元固定commit/pathは接続する後続実装PRで確定し、このhashとの一致を確認する。未取得のcoreを実装済み扱いしない。後続共有版が出ても無条件にmain最新版へ追従せず、契約差分と互換性を確認してpinを更新する。空力/機体/カメラのbaselineは速度レバー追補を理由にずらさない。

### 2.2 基準画像の先行確保

本作UIを組む前に固定Kaisenを同一環境で起動し、8画面・機体・カメラの実画像と状態fixtureを確保する。browser名/完全version、OS、font、viewport、DPR、文字倍率、seed、mode、状態、tick、source commit、capture時刻をmanifestへ記録する。元作と本作で異なる時刻や機体姿勢の画像を「同条件diff」としない。

画面は home / normal flight / easy flight / pause / normal touch settings / easy touch settings / keyboard settings / result の8つ。ゲーム固有結果を機械的に同じ数値へできない場合は固定の意味対応fixtureを使い、その違いを明示する。追加でルール、設定保存失敗、携行、自旗不在、drop、復活待ち、roundReset、time drawを撮る。機体は正面/側面/背面/旋回、同姿勢のcamera/照準投影を比較する。これは実装時に必須で、文書PR時点では未撮影。

## 3 実装の責務分割

以下は予定path。必要な既存依存を調べて最小構成へ調整するが、simulationの正本をrenderer/DOM/localStorageへ分散しない。

| 予定責務 | 予定path | 所有する正本と禁止事項 |
| --- | --- | --- |
| ルールと版 | src/mission.ts、src/types.ts | 5対5・12分・半径・各timer/上限。UI側に複製定数を置かない |
| 飛行共通 | src/flight.ts、flight-assist.ts、flight-view.ts | 固定元の飛行/宙返り/照準/カメラ。CTF勝敗を持たない |
| 入力共通adapter | src/input.ts、throttle-lever.ts | pointer/key/AT→正規化入力、実tick消費ack、失効解除。DOMから旗/scoreを変更しない |
| 戦闘 | src/combat.ts | 弾発射/予約、swept hit収集、同時damage。旗得点を直接行わない |
| 旗reducer | src/flags.ts | 2旗・revision・contact候補・得点候補。唯一のflag書込元 |
| 機体lifecycle | src/respawn.ts | 10slot、世代、1slot1予約、保護。setTimeout spawnなし |
| 地図と経路 | src/arena.ts、navigation.ts | 基地/空域/合法drop/実飛行経路。空力を変えず到達性を保証 |
| AI | src/ai.ts | 役割割当・視認情報・飛行入力。teleport/未来状態参照なし |
| 固定step統合 | src/simulation.ts | 第5.3節順序、時間、epoch、end/result確定。描画乱数に依存しない |
| 表示 | src/scene.ts、flag-view.ts、hud.ts | source機体・空海・cameraと旗/基地/marker。stateはread-only |
| 設定 | src/control-settings.ts/css、keyboard-settings.ts | draft/保存/破棄、長方形preview、同時タブpreflight、focus。ゲームを勝手に再開しない |
| 保存 | src/storage.ts、records.ts | 作品固有allowlist、version、journal/rollback/readback。対戦途中永続snapshotなし |
| 起動と画面 | index.html、src/main.ts、style.css | 既存画面構造と切替、loop寿命、pause/context loss、資源破棄 |
| 証拠 | tests/、browser-tests/、docs/evidence/ | fixture、trace、画像、計測、未検証一覧。CI基盤新設とは別 |

最小データ契約:

- Match: matchId, roundEpoch, tick, playTicks, phase, phaseTicks, pausedFrom, mode, rulesVersion, seed, slots[10], flags[2], captures[2], respawns, immutable result
- Slot: team, slotId, generation, alive, aircraft, respawnReservation?, protectedUntilPlayTick。aliveとreservationの同時存在禁止
- Flag: flagId, homeTeam, epoch, revision, tagged state。carrierはmatch/epoch/team/slot/generationの完全な機体世代参照、dropは有限位置とreturnDue
- InputFrame: ownership revision, turn/climb/fire/loop/throttle, source revision, oneShot pending ID。sampleと消費を別にし、step完了時に消費ack
- Event: match/epoch/tick/sequence, kind, source/target generation, expected flag revision, payload。重複処理はstateを書き換えない
- Result: completedMatchId, rulesVersion, mode, outcome, captures, playTicks, bounded statistics。live stateへの参照を保持しない

simulationとinputの再現traceは数値/ID/seedのみとし、device識別や利用者の個人情報を集めない。DOM/renderer通知はsimulation eventから作り、通知喪失で得点を失わない。

## 4 実装工程と終了ゲート

### P0 継承点と検査条件の固定

- 固定sourceと転用権限/必要なライセンス表示を確認しprovenanceを作る。既存機体/flight-viewの比較は末尾改行の差と意味差を分ける
- 共通レバーcore/fixtureの固定取得とhashを記録。source baseline、追補契約、作品差分の3層を明示する
- 元作8画面・機体/視点の基準画像と状態fixtureを先に確保する
- runtime/依存の既存推奨構成を確認。この文書PRにはCIを追加しない。後続ゲーム実装の着手範囲にPR自動検査が含まれる場合は、P1でrunner確立後・P2接続前に最小workflowを用意する。contents: readのみ、secret/書込権限なし、checkoutの資格情報持越しなし、固定action版、timeoutを設定し、unit/type/buildと必要browser検査を実行する。リポジトリのActions許可や保護設定を無断変更せず、利用できない場合はローカル相当結果とCI未実施を記す。deploy工程は設けない
- 終了: sourceと画像の出典が再現でき、足りない画像は未検証として一覧化。画像を揃えずに視覚継承を完了としない

### P1 DOMなしの試合核

- 10slot、2flag tagged union、rule config、60Hz時計、match/epoch/generation IDを設計
- pickup/drop/return/captureを第5.3節の順序で純粋reducerとして接続。snapshot差分で単一owner保存則をassert
- 境界値、両旗奪取、自旗不在、同tickreturn、時間切れ、二重候補異常をfixture化
- 終了: FLAG/MATCHの単体property試験が通り、renderなしで3点/12分/引分まで再現可能

### P2 既存飛行と武器の接続

- 自機・AIの共通flightとaircraft geometry、view/projectionを保持。scene scaleとcameraを固定元に合わせる
- 銃はmg/cannonだけに絞り、対艦武器/UI/型依存を持ち込まない。fireの左右同時予約と弾数原子性を維持
- damage候補を先に収集して全機同時適用、同tick致死/衝突/dropを安定化。AI火力対称化はルール値へ分離
- 終了: 同じ入力traceの飛行/target/姿勢が元作と一致（追補レバーの入力形式差を除く）。速度携行ペナルティなし。相打ちと飛び越し命中を試験

### P3 基地と旗の到達性

- 海上空域、二つの非衝突リング基地、取得/回収球、swept接近、合法drop投影を実装
- 65/110/141m/s、両mode、両陣営、各drop境界から基地へ、基地から敵基地へ、待機円から回収へ実flight traceを作る
- 30秒帰還、due tick接触抑制、生成直後drop取得抑制、不正位置復旧を試験
- 終了: 中心点だけでなく最小旋回/高度変化を含む合法飛行が成立。敵機なしのroute試験で全対象地点を180秒以内に訪問できる（最適routeの保証ではない）

### P4 復活と4役AI

- 8秒復活、120tick保護、1slot1予約、世代更新、reset/endキャンセルを接続
- 攻撃/護送/迎撃/奪還を6tick評価、priorityと120tickhysteresis、有限経路探索を導入
- 自機死亡でもAIと時計が進む、camera固定、復活後target110、入力持越しなしを確認
- 終了: 敵味方AI同条件で循環、旗を運び得点できる。1機/全滅/両旗不在/10秒stuckからの再経路fixtureと20seed無操作試合が12分以内の判定へ到達。勝率50%を無根拠に保証しない

### P5 レバーと設定保存

- Normalの速度UIは縦レバー1つ。Easy巡航と射撃支援、PCキー9/6操作、touch3/1操作を統一
- 共通core/35fixtureを接続し、controller.advanceThrottle相当まで実入力経路を試験。fixtureだけの試験にしない
- pointer所有、操縦＋射撃＋レバー、cancel/blur/visibility/mode/resize、短入力の実tickack、ARIA slider、keyboard/ATを接続
- v1 raw保持→作品固有v2、future保護、journal/readback/rollback失敗、同時タブを実装。previewとliveで同じ長方形boundsを使う
- 終了: 全INPUT/STORE試験を通過。旧加速/減速のタッチ2ボタンがDOM・設定・ルールに残らない。キーとlegacyデータ名は意図的互換として検査で区別

### P6 HUDと結果

- Kaisenの既存画面/styleに旗状態、回収数、持帰り条件、残時間、復活、roundResetの表示だけを追加
- marker/aria-live/音は状態変化を通知。旗を撃つ自動照準や機体を隠すHUDを作らない
- 結果をimmutable化し記録を1回保存。20件上限とbest、未完試合reload時中断を実装
- 終了: ホーム→出撃→pause→設定→破棄/保存→再開→得点reset→結果→retry、保存失敗/背景復帰の全経路で整合

### P7 統合検証と調整

- 全unit/type/buildと関係browser検査を最終候補commitで実施。失敗を直した後は影響するゲートを再実施する
- 元作対本作の8画面、追加状態、機体/カメラを同条件実画像で比較し説明のない差分を解消
- 12分最大負荷soak、20retry、上限・メモリ・frame・context lossを検査
- 遊びの調整は旗回収時間/奪還率/往復到達/死亡頻度の計測に基づきrulesVersionとfixtureを更新。カメラや空力を勝手に変えない
- 終了: 各gateをpassed/failed/not-run/blockedに分け、独立レビュー、全文readback、差分一覧、最終head CI状態を添えたDraft PR。merge/配備は別操作

## 5 受入検査の実施計画

すべて将来の検査。今回の文書PRで実施済みという表ではない。unitは固定seed/入力traceとstate assert、browserはChromiumとWebKitを基本に実際の製品経路を通す。下表のtickはplaying tickで、pause中は増えない。

| 検査IDと要件 | 操作または境界 | 期待結果 |
| --- | --- | --- |
| T01 FLAG-01 | 生成、全state遷移、長いランダムevent列 | 旗2、各旗1state、機体最大1旗、carrier生存世代一致を全step assert |
| T02 FLAG-01 | 取得球44.999/45/45.001m、141m/sで跨ぐ | 内/境界は候補、外は不可、swept crossingも1回取得 |
| T03 FLAG-01 | 敵2機同tick同点距離、配列順を逆転 | fraction→距離→slot順で同一の1owner |
| T04 FLAG-01 | dropへ自/敵同tick接近、先に敵配列を走査 | 自軍帰還優先、同tick敵再取得なし |
| T05 FLAG-01 | carrier撃墜地点へ別機が同tick存在 | そのtickはdropのみ、次tickからpickup可能 |
| T06 FLAG-01 | drop1799tick/1800tick、dueと接触同時 | 前は残留/接触可、dueは帰還優先、そのtick再取得なし |
| T07 WORLD-02 | 海面・場外・上限・NaN drop | 合法浮遊点へclamp、非有限は理由付きhome、無得点 |
| T08 FLAG-02 | 敵旗持帰り、自旗carriedまたはdropped | 0点で携行維持、必要な奪還をHUD表示 |
| T09 FLAG-02 | 回収球内待機、自旗が今tick帰還 | 今tick0点、次tick生存/自旗homeなら1点、再侵入不要 |
| T10 FLAG-02 | 到着tickに自旗被奪取 | 得点不可、旗owner一意 |
| T11 FLAG-03 | 到着tick致死/敵carrier双方致死 | 致死carrierはdrop、両者相打ち、得点なし |
| T12 FLAG-03 | 双方が敵旗を保持し自基地へ到着 | 双方0点。異常な二得点候補注入なら安全pause・記録対象外 |
| T13 FLAG-04 | kill/drop/capture同ID再配送、旧revision、旧epoch | 二重加点/生成/予約なし、旧stateへ戻らない |
| T14 FLAG-04 | 得点直後に旧弾/respawn callback配送 | score/playTicks/累計統計を保持、新round180tick無戦闘、旧event無効 |
| T15 MATCH-01 | 2対2で3点目、captureを重複再入 | 一方3点でresult1つ、以降不変、保存1回 |
| T16 MATCH-01 | playTicks43199→43200と得点同tick | 得点を解決後、3点優先、未到達なら回収差/同点引分 |
| T17 MATCH-01 | pause60秒/非表示、drop/復活/再装填途中 | 全timer/phase不変、戻っても自動再開/入力再生なし |
| T18 MATCH-02 | fixed step0/5frame、0.25秒超backlog | 0stepではedge残存、最大5、超過はpause・無い時間をsimulateしない |
| T19 LIFE-01 | 同機へ同tick複数致死、479/480tick | 予約1件、479復活なし、480で世代更新1回 |
| T20 LIFE-01 | 保護119/120tick、射撃/旗接触/境界越え | 期限前は攻撃/取得/被弾不可、期限到達で有効、境界死は保護外 |
| T21 LIFE-01 | player死亡中AI回収/時間切れ/pause | 世界は続行、必要なら結果、pause時のみ全停止 |
| T22 COMBAT-01 | 弾capacity残1/2、mg2/cannon0、双方0 | 2発組のみ、失敗時弾数clock不変、片方のみ発射、双方空で360tickreload |
| T23 COMBAT-01 | 同tick弾複数/相打ち/友軍/保護機 | 同時damage、victim世代ごとkill1、友軍/保護機damage0 |
| T24 AI-01 | 自旗carried/drop、味方carrier、残AI1 | 規定優先と役割人数、carrier自己帰還、自機操縦を奪わない |
| T25 AI-02 | 10秒20m未満→さらに10秒stuck | 有限再経路/役割復帰、teleportなし、12分を延長しない |
| T26 WORLD-02 | 両mode/両チーム/3速度/各drop端点 | 実flight traceが合法空域内で180秒以内に到達、姿勢制限違反なし |
| T27 INPUT-01 | 共通fixture35全件＋NaN/Infinity/不正寸法 | axis/pointer/combine/advanceの期待値一致、中立fail-safe |
| T28 INPUT-01 | target110、axis+1/−1を60tick | 128/92。raw0.54で119。target119でrelease後119保持 |
| T29 INPUT-01 | target140/66、最大入力60tick、Easy±1 | 141/65へclamp、Easy110維持、実速度瞬間変化なし |
| T30 INPUT-01 | 明示throttle0＋legacy true、throttleなし | 前者0優先、後者legacy±1、旧AI/trace互換 |
| T31 INPUT-01 | 操縦指＋射撃指＋レバー、所有外up/cancel | 3操作両立、ownerだけ解除、跨ぎ/2本目で乗っ取りなし。レバーfocusoutだけで別pointer操縦/射撃は切れない |
| T32 INPUT-01 | keydown/upがsample前、sample後0step/複数step | 1実tickだけ消費、複数stepへ二重適用なし、cancelなら破棄 |
| T33 INPUT-01 | pause/blur/resize/hidden/mode/death/reset | レバー中央と全入力0、capture解除、復帰は再押下必須 |
| T34 INPUT-01 | slider focus矢印/Home/End/Escape、IME、rebind | focus操作と操縦二重処理なし、shortcuts尊重、重複key拒否 |
| T35 INPUT-01 | 320×568/393×852/568×320/852×393、200%文字 | 44px hit、safe area、CSS実rectのpreview/live長方形一致、pause/sound等HUD操作と非衝突、保存/閉じる到達 |
| T36 INPUT-01 | 配置重なり、利用可能領域なし | レバーだけ退避、不可なら無効/警告/保存阻止。他control不動 |
| T37 STORE-01 | v1 custom左右/未設定/破損/未来/v2未来 | raw bytes保持、合法移行、未知形式上書きなし、他作品キー不読書 |
| T38 STORE-02 | 保存1/2/3番目拒否、journal拒否、rollback拒否 | active不変、控え保持、未完了表示、次起動で整合復旧 |
| T39 STORE-02 | 別タブ更新→Save、Save→閉→開→reload反復 | stale書込中止、完了分readback一致、Cancelはwrite0 |
| T40 STORE-02 | 今回だけ使う、設定×/Esc/保存後pause | sessionのみ適用、破棄は元値/focus、pauseから勝手に再開なし |
| T41 STORE-03 | victory→result連打→retry、途中reload | 終了記録1回、未完記録なし、最新20/版別best、未来raw保持 |
| T42 UI-01 | 両旗不在/携行/回収不可/自動帰還/復活待ち | HUDの理由・時計・markerが正本と一致、音なしでも判別 |
| T43 LIMIT-01 | 10機連射12分、20retry、破棄後callback | 定員/弾/queue/wreck上限、listener/資源単調増殖なし |
| T44 LIMIT-01 | 意味event128超、描画queue512超 | critical不足はpause、描画破棄で正本変化なし |
| T45 AC-VISUAL | 元作対本作8画面＋機体/カメラ | 同環境実画像・diff・目視、差分は要件2.2で説明。未確認を合格にしない |
| T46 LIFE-01 | 復活地点に敵/弾を配置、保護119→120tickで接触/射線を固定 | 保護期限と同時damage順が一意。保護中に合法離脱routeを選べるか確認。不可ならバランス不合格、無敵延長/敵消去/ワープで隠さない |
| T47 INPUT-01 | pointer+1、focus+1、減速key−1を同時入力し1実tick消費 | 全入力合算後clampでaxis+1、target110→110.3。pointer/focusだけ先にclampして0にしない |

### 5.1 性質試験と再現情報

- 配列順をシャッフルしても同じseed/input/stateから同じcapture/kill/flag ownerになる
- roundEpochを越えたeventを1000回注入しても新roundのstate hashは変わらない
- pauseの長さを変えても再開後の同tick state hashは同じ。render30/60/120Hzの分割差で結果を変えない（負荷pause条件は別試験）
- 0..3の回収数、2旗、10slot、予約上限、全位置/速度有限を全step検査
- terminal resultはfreezeし、後続step/通知/保存失敗から不変。未完了試合をbestへ混ぜない
- 失敗報告にはルール版、seed、入力trace、match/epoch/tick、最小再現state、期待/実際、対象commitを添付する。秘密情報は記録しない

### 5.2 視覚検査の合格基準

構造/色/フォント/主要座標/機体寸法/カメラ定数を先に機械比較し、実画像を100%で目視する。差分maskは旗/基地/作品文字/回収HUD/レバー/対象外兵装など説明済み領域だけに限定。元作のレバー前画面とは旧領域置換を明示し、機体や全背景をmaskして通さない。スクリーンショットを撮れただけでは合格にしない。

393×852と852×393を基本、320×568/568×320、desktop1280×720を追加。DPRは同条件で1/2、文字倍率100/200%、safe-areaあり/なし、OS fontを固定。Normal/Easy、長い日本語、dialog内scroll/最終項目、focus/hover、保存失敗警告を含める。CSS200%文字とbrowser200%zoomは別ケースとして記録する。

画像名の例は `normal-flight-baseline.png` / `normal-flight-candidate.png` / `normal-flight-diff.png`。manifestで実際のcommitとfixtureへ結び、見た目が違うなら原因と必要差分を記載する。iPhone相当WebKitの模擬検査とiPhone実機、touch支援技術、操作感/実機性能は別欄にする。実機を使っていなければ未検証のまま残す。

## 6 記録保存と移行の具体工程

保存の順序は `read current → validate versions/bounds → compare revisions → obtain transaction exclusivity → persist rollback journal → verify journal → write all proposed raw → read back all → mark committed → apply active snapshot`。失敗はactiveを触らず旧rawへ戻す。途中journal/backupの消失を許さない。専用transaction lockが得られない環境は同時タブ保存を安全に拒否し、「今回だけ使う」を案内する。

作品固有キーallowlist、復元対象raw/null、現在値の比較条件を明示し、localStorage.clearやprefix一括削除を実装しない。未来version/別タブの新値をrollbackで上書きしない。journalが不正/未来形式なら書込停止と警告、安全snapshot/既定値でsessionを継続する。破損rawを自動で消さない。

旧Normal/Easy両キーのraw hashを保存前後/reload後に比較する。新v2の有効レバー配置が無くても、旧v1を勝手に書き直して直さない。先にUI draftで候補と競合を示し、Saveが成功した時だけ新形式を有効にする。保存失敗・rollback失敗・ページ再読み込みを独立のfault injectionとして検査する。

記録は対戦完了1回に限定し、実行中matchstateのresume機能は作らない。ゲーム時計をDate.now差分で補って再開する実装はしない。旧版記録は消さず、異なるrulesVersionとして残す。将来cleanupが必要なら対象・件数・復元可能性を別途扱う。

## 7 レビューと提出のチェックリスト

### 文書PRの完了条件

- 要件/実装計画の全文を読み返し、表と本文で初期値・phase・優先順位・定員・キー数・timerが一致
- 採用された旗取りルールと、理由付きの初期設計案、実装後に必要な検査を区別
- 独立した読み手が旗保存則、相打ち/同tickscore、復活旧世代、時間、AI経路、レバー入力/保存、視覚継承をレビューし、指摘を解消
- 新規文書だけ追加、既存README blob一致、ゲーム/CI/package/配備差分0を確認
- remote最終commitの2ファイル全文を再取得し、ローカル最終原稿とUTF-8 bytes/hash一致を確認
- Draft、base=main、対象repo/branch/head一致、最新mainとopen PR確認、diffは2文書のみを確認
- 存在するhead check/statusを読み、なしなら「チェックなし」、未実行ゲーム試験を「成功」としない

### 後続ゲーム実装PRの完了条件

- P0..P7の必須検査、独立レビュー、最終候補全文/差分確認、すべての未検証と制約を明記
- 元作継承の8画面・機体/カメラ実画像と出典、fixtureの製品経路接続、保存故障時の証拠
- score/flag/respawn/timer不変条件、上限と有限終了を最終commitで検証
- Draft PR提出はmergeや公開運用の許可ではない。最新head CI失敗や競合はそのまま明示し、未確認を合格にしない

## 8 現時点の検証状態

2026-10-05の文書作成時点で、対象repo/main/READMEと固定元の該当sourceを読み、旗ルールと共通レバー契約を計画へ取り込んだ。元作調査snapshot28ファイルのGit blob hash照合と、flight/flight-assist/aircraft-damage/missionの固定取得も行った。ただし元作全関数の包括的正しさを保証したものではない。

ヌスミダセ本体・テスト・build・browser実行・8画面比較・実機性能・バランス試験はすべて未実施。本体がない段階でgreen扱いしない。文書の独立レビューとremote全文readbackの実施結果はPR本文で最終commitと合わせて報告する。実装の着手/公開/mergeをこの計画書だけで自動実行しない。
