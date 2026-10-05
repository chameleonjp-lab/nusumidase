# ヌスミダセ 要件仕様計画書

外観・操作の主継承元は [カイセン](https://github.com/chameleonjp-lab/kaisen) とする。固定基準は [3d751051dc6212482a129e8da596ddd349b2f9f5](https://github.com/chameleonjp-lab/kaisen/tree/3d751051dc6212482a129e8da596ddd349b2f9f5)、機体・飛行の照合元は [ファイトフライト c2b313d37875b93458032d98636fcf5b5d30a138](https://github.com/chameleonjp-lab/faitofuraito/tree/c2b313d37875b93458032d98636fcf5b5d30a138)。縦速度レバーは固定基準に対する共通追補契約として第8章で明示する。

対象: [chameleonjp-lab/nusumidase](https://github.com/chameleonjp-lab/nusumidase)。作成日: 2026-10-05。版: 計画 v1。対応する [実装計画書](IMPLEMENTATION_PLAN.md) と合わせて読む。本書は新しい空中旗取りゲームを実装可能な条件へ落とした計画であり、ゲーム実装済み・試験合格を意味しない。

## 1 採用範囲と初期設計の区別

### 1.1 採用された中心ルール

- 二つの空中基地を置き、敵基地の機密コアを接近で奪い、自基地へ持ち帰る。以下「旗」はこのコアを指す。
- 携行機が撃墜されると旗を落とす。自軍旗が奪われている間は、敵旗を持ち帰っても得点できない。
- 先に3回回収した陣営の勝利。攻める、護送する、追い返す、自旗を奪還する役割が成立する。
- 自機・戦闘機操縦・UI・操作設定はゼロシリーズを継承する。敵味方AIを含む一人用。オンライン対戦は追加しない。

### 1.2 本計画で置く初期案

以下の具体値と追加ルールは、未指定事項を埋める理由付き初期案であり、利用者から個別に数値指定された事実ではない。調整時は `nusumidase-ctf-v1` のルール版を更新し、試験とローカル記録を分離する。

| 項目 | 初期設計 | 理由 |
| --- | --- | --- |
| 戦力 | 味方5機＝自機1＋AI4、敵AI5。各陣営5固定slot | 既存編隊規模を活かし4役を分担 |
| 残機 | 残機制なし。撃墜ごと8秒後に同slot復活、同時生存は各5以下 | 旗奪還を続行でき、自機一度の失敗で終了させない |
| 勝敗 | 3回先取。プレイ時間12分、未到達時は回収数の多い方、同数は引分 | 無限膠着を有限にし、撃墜稼ぎを勝敗から除外 |
| 得点後 | 両陣営・両旗・弾を初期配置へ戻し、3秒カウント後に次ラウンド | 連続即得点、死体からの旧弾、片側だけ消耗を防ぐ |
| 地形 | 海面の上の開放空域、左右対称の静止空中基地2つ。初版に山・建物迷路なし | 空中の接近と帰還を主眼にし、到達不能を減らす |
| 落下旗 | 最後の合法位置へ浮遊固定。水中に沈めない。30秒で自動帰還 | 海上で失われず、空中機体で拾える |
| 携行制約 | 追加の速度上限・加速率低下・射撃禁止を設けない | 共通飛行の手触りを変えず、位置公開と護送で駆け引き |
| 武器 | 機銃と機関砲。爆弾・魚雷・艦砲・ロケットなし | 空中旗取りの旗・基地は破壊対象でなく、対地対艦兵装の対象がない |
| 友軍被害 | 初版は友軍弾と友軍機同士の接触で損傷なし。敵機との衝突は双方撃墜 | 密集護送と復活直後の自滅連鎖を避ける |
| 記録 | 回収数が主記録。撃墜・奪還は統計のみ、加点・回復・残機増加なし | 無限復活を使ったスコア・回復稼ぎを防ぐ |

爆弾・魚雷除外は本作の初期案であり、他作品での承認を本作に対する明示承認とは扱わない。オンライン順位、名前入力、外部送信、共有ボタン、広告、分析SDK、課金、アカウント、DB、CI基盤追加、デプロイは今回の文書PRの対象外。ゲーム本体の実装も本PRには含めない。

## 2 シリーズ継承の固定契約

### 2.1 実在ファイルと保持対象

下表のKは冒頭のカイセン固定commit。リンクは移動するmainでなく固定ソースである。ファイル全体を無批判に複製する指定ではなく、保持する責務と作品差分を分ける指定とする。

| 出典 | 保持する内容 | 本作差分 |
| --- | --- | --- |
| [K index.html](https://github.com/chameleonjp-lab/kaisen/blob/3d751051dc6212482a129e8da596ddd349b2f9f5/index.html) | ホーム、モード選択、飛行HUD、停止、結果、操作/ルール入口のDOM構造と意味 | 作品名、編隊/旗/回収表示、兵装対象 |
| [K style.css](https://github.com/chameleonjp-lab/kaisen/blob/3d751051dc6212482a129e8da596ddd349b2f9f5/src/style.css) | 全画面、明朝見出し、本文ゴシック、青緑と金、半透明panel、余白、線、操作ボタン | 旗HUD・レバー用の最小拡張 |
| [K control-settings.ts](https://github.com/chameleonjp-lab/kaisen/blob/3d751051dc6212482a129e8da596ddd349b2f9f5/src/control-settings.ts) / [CSS](https://github.com/chameleonjp-lab/kaisen/blob/3d751051dc6212482a129e8da596ddd349b2f9f5/src/control-settings.css) | タッチ/キーの2タブ、normal/easy別配置、draft→保存/破棄、x/y/大きさ/不透明度、プレビュー、focus復帰 | 速度レバー1項目、作品固有保存キー、武器項目の除外 |
| [K keyboard-settings.ts](https://github.com/chameleonjp-lab/kaisen/blob/3d751051dc6212482a129e8da596ddd349b2f9f5/src/keyboard-settings.ts) | KeyboardEvent.code、再割当、重複拒否、予約キー/IME/shortcut除外 | 兵装キーを除いた9操作 |
| [K input.ts](https://github.com/chameleonjp-lab/kaisen/blob/3d751051dc6212482a129e8da596ddd349b2f9f5/src/input.ts) | 空き領域から相対ドラッグ、半径36px・8% deadzone、所有pointer、単発宙返り、解除 | 共通アナログ速度入力の追補 |
| [K main.ts](https://github.com/chameleonjp-lab/kaisen/blob/3d751051dc6212482a129e8da596ddd349b2f9f5/src/main.ts) | 画面遷移、モード別説明、style→settings CSSの順序、停止/文脈喪失時の遮断 | 旗試合のstateと表示adapter |
| [K aircraft.ts](https://github.com/chameleonjp-lab/kaisen/blob/3d751051dc6212482a129e8da596ddd349b2f9f5/src/aircraft.ts) / [F aircraft.ts](https://github.com/chameleonjp-lab/faitofuraito/blob/c2b313d37875b93458032d98636fcf5b5d30a138/src/aircraft.ts) | 実機体geometry、material、texture、hero/enemy品質、可動翼、プロペラ、銃口 | 携行旗は別子visual、機体は縮尺変更しない |
| [K flight.ts](https://github.com/chameleonjp-lab/kaisen/blob/3d751051dc6212482a129e8da596ddd349b2f9f5/src/flight.ts) / [flight-assist.ts](https://github.com/chameleonjp-lab/kaisen/blob/3d751051dc6212482a129e8da596ddd349b2f9f5/src/flight-assist.ts) | 空力、旋回/上昇応答、宙返り・途中解除、巡航、Easyの航空機照準支援 | 非航空機targetを渡さない。速度入力adapterのみ追加 |
| [K flight-view.ts](https://github.com/chameleonjp-lab/kaisen/blob/3d751051dc6212482a129e8da596ddd349b2f9f5/src/flight-view.ts) / [F flight-view.ts](https://github.com/chameleonjp-lab/faitofuraito/blob/c2b313d37875b93458032d98636fcf5b5d30a138/src/flight-view.ts) | カメラ姿勢と照準投影の同一関数 | 旗/基地markerもこの投影と整合 |
| [K scene.ts](https://github.com/chameleonjp-lab/kaisen/blob/3d751051dc6212482a129e8da596ddd349b2f9f5/src/scene.ts) | renderer・空/海・照明・既存機体・追従cameraの接続 | 艦/対艦visualを除き基地/旗visualを追加 |
| [K aircraft-damage.ts](https://github.com/chameleonjp-lab/kaisen/blob/3d751051dc6212482a129e8da596ddd349b2f9f5/src/aircraft-damage.ts) / [simulation.ts](https://github.com/chameleonjp-lab/kaisen/blob/3d751051dc6212482a129e8da596ddd349b2f9f5/src/simulation.ts) | 既存の機銃/機関砲・発射点・弾道・距離減衰 | チーム対戦用のAI火力対称化、旗stateと復活は新設 |

Kaisenの全幅レイアウトを主基準とし、FightFlightのmax-width620pxを混ぜない。Kの文字色 `#eff4ed`、背景 `#071e2b`、gold `#e4c88b`、muted `#b8cbce`、明朝h1（Hiragino Mincho ProN / Yu Mincho / serif）、本文system-ui系、primary最小52px、操作最小44pxを保持。新しい色/書体/カード型UIへ再設計しない。

機体は主翼幅12m、胴体基準長9.06m、灰緑の表面、暗いカウリング、赤い識別円、キャノピー、3枚プロペラ、機銃2挺と機関砲2門を保持。簡略三角機・別機体への差替えは不可。翼端等を含む全外接寸法と胴体長を混同しない。

カメラは追従三人称、FOV64度、機体相対offset `(0,11,29)`、bank反映0.45、Normal視線角−0.19rad、Easyは−atan2(11,479)。実sceneはnear0.5 / far22000。`FLIGHT_FAR=6500` は投影判定側、視認距離1500m、Easy円は短辺0.135であり、実camera farと取り違えない。旗を見せる理由で俯瞰/一人称/自動ズームへ変えない。

### 2.2 差分を許す範囲

旗と基地、そのmarker、携行/自旗状態、回収数と試合時計、復活/ラウンド告知、作品固有記録・保存キー、縦速度レバー、対象外兵装の撤去を許す。既存HUDの値と文言は本作の意味へ置換する。作品名の長さによる改行は確認して調整するが、書体・色・機体縮尺・視点変更でごまかさない。

旗は金属コア＋陣営の文字記号・輪郭を備える。基地と旗は銃撃で破壊されず、Easyの敵機ロック対象でもない。旗の携行表示が機体・照準を隠さない。敵味方識別は既存帯色を用い、色だけに依存しない「自軍」「敵軍」表示を併用する。

## 3 試合状態と時間

要件ID `MATCH-01`。試合phaseは `ready / countdown / playing / roundReset / ended`。pauseは `pausedFrom` を持つ外側状態で、終了結果と混同しない。ホーム→モード選択→3秒countdown→playing、得点→roundResetの3秒→playing、勝敗確定→ended。ホーム/結果から設定を開ける。プレイ中の設定・ルールは先にpauseし、閉じても自動再開しない。

`matchId` は開始/リトライで新規、`roundEpoch` は得点resetで増加、`tick` は試合内単調増加整数。simulationは60Hz、`playTicks` はplayingだけ進め最大43200、countdown/roundResetは各180 phaseTicks。自機復活待ちでもplayingと時計・AIは進む。pause・非表示・blur・context lossでは全state時間（復活、落下帰還、弾寿命、再装填、AI、phase時計）を止める。wall-clockで補うtimerは使わない。

時間切れtickも戦闘/旗/得点を一度解決してから終了する。3点到達を最優先、未到達なら回収差で勝敗、同点は引分。延長戦・突然の追加勝利条件はなし。途中ホーム/リトライは中断であり、勝敗・記録へ加えない。ended後の入力/遅延callback/古いhitで結果を変えない。

`MATCH-02`。長いframeで全経過を一挙simulateしない。1描画frameあたり最大5固定step、未処理accumulatorが0.25秒超なら性能警告付きpauseし、残りを捨てて勝敗を進めない。再開は明示操作。処理不足の試合を「実時間12分」とは説明せず、12分は有効プレイ時間と明記する。

## 4 空域と接近判定

`WORLD-01`。初期mapは海面基準y=0、矩形 `x=[−2400,2400], z=[−1800,1800]`、合法飛行高度 `y=(20,900)`。基地の旗/回収中心は味方 `A=(−1400,300,0)`、敵 `B=(1400,300,0)`。基地の旗取得と持帰り判定は中心から半径45mの球。drop旗の取得/奪還もdrop位置中心の半径45mとする。基地visualは非衝突の浮遊リングとし、中心を通過できる。基地visualと別の固体障害物を初版に追加しない。

接近は前tick位置→今tick位置のsegmentと球のswept交差で判定し、141m/sや低描画FPSでもすり抜けない。球境界45mは含む。同じtickの候補は交差fraction、終点距離、固定slot順の順に並べる。正規の生存機・非復活保護・正しいepochのみ対象。距離はworld metre、HUDのpixel距離ではない。

外縁から200m/上下限から50mで警告する。境界を越えた機体はそのtickに場外撃墜、旗は合法位置へ落とす。壁への瞬間反射・teleport・強制速度変更なし。海面の波visualは旗/空域判定のy=0を変えない。必要な低空接触visualは基準面と一貫させる。既存低高度警告を残すが、FightFlight固有の1200m未満10秒終了は持ち込まない。

`WORLD-02`。落下点は撃墜位置を `x=[−2000,2000], z=[−1400,1400], y=[150,750]` にclampした位置とし、浮遊を維持する。運搬中だけ機体に追従。海中/空域外/基地の飾り内部へ沈めず、無効数値や合法経路を構成できない場合は `invalid-drop` 理由で即homeに戻す。これは回収得点・手動奪還統計にしない。

両モード・両陣営・速度65/110/141・各drop端点に対し、旋回半径と上昇制限を満たす往復routeが存在することを飛行simulationで検査する。基地間直線と基地周辺radius300mの旋回円、drop候補の上下接続routeを用意する。単なるnav点連結や直線の非衝突だけで「到達可能」と判定しない。失敗時は空力を変えずmap/route側を修正する。

## 5 旗の保存則と遷移

### 5.1 正本データ

`FLAG-01`。旗は陣営ごとに1つ、合計2つ。各flagは `flagId, homeTeam, roundEpoch, revision, state` を持つ。stateは排他的な `atHome / carried / dropped`。

- atHome: 位置は自基地の定数、carrierなし、returnDueTickなし
- carried: 敵陣営の生存機を指す `carrier=(matchId, roundEpoch, team, slotId, generation)` がちょうど1つ、returnDueTickなし。描画位置はcarrierから算出し二重の正本位置を持たない
- dropped: carrierなし、合法な固定world位置、`droppedAtPlayTick` と `returnDuePlayTick=drop+1800`

外部へ公開する各commit済みsnapshotで1flagは1state、1機体は最大1flag。固定step中のdamage→dropは一つのtransactionとし、途中stateをHUD/AI/保存へ公開しない。自旗を運べない。carrier参照の機体が存在/生存/世代一致しなければ正常stateとして継続しない。flagstateと機体の携行HUDは同一reducerから導出する。描画entity/音/markerの有無で旗を増減しない。revisionは各遷移で増加、全イベントは元revisionを照合する。

### 5.2 遷移表

| 現state | 条件 | 次stateと結果 |
| --- | --- | --- |
| atHome | 有効な敵機が取得球へ接近 | 候補を1機だけ選びcarried。得点なし |
| atHome | 自軍機接近/被弾 | 変化なし |
| carried | 生存carrierが飛行 | 同carrierを維持、手渡し/任意投棄なし |
| carried | carrierが被弾撃墜/敵機衝突/場外/海面接触 | 合法位置へdropped、30秒timer開始 |
| carried | 第5.3節の持帰り条件成立 | 回収数+1、1回だけroundResetまたはended |
| dropped | homeTeamの有効機が接近 | atHomeへ即奪還。自機を含むhomeTeamは運搬しない |
| dropped | 敵陣営の有効機が接近 | carriedへ再取得。新しいcarrierのみ |
| dropped | due tick到達 | atHomeへ自動帰還。得点/手動奪還加算なし |
| 任意 | roundReset | 両旗atHome、全旧revision/eventを無効化 |

同tickでdropped旗に自軍と敵軍が触れたら自軍奪還を優先し、そのtickは再取得不可。due tickでは自動帰還が接触より優先し、同tickに新home位置で取得できない。撃墜でそのtickに新規dropされた旗は次tickから接触・取得可能。同tick内の連鎖を禁止する。敵同士の同時取得は候補順に1機のみ。敵が再取得後に再び落とした場合は30秒を再起算するが、試合全体の12分は延びない。

### 5.3 得点と競合順序

`FLAG-02`。得点には次の全条件が必要。

1. playingである
2. そのtick開始と旗遷移解決後（下記手順4終了時）の両方で、自軍旗がatHomeである
3. 同一carrierがtick開始と解決後の両方で敵旗を保持しており、終点で生存、復活保護なし
4. そのcarrierが自基地の回収球へswept接近、または球内に留まっている
5. 今roundEpochの得点が未確定で、captureIdが未処理

自旗が奪われている/落ちている間は0点のまま敵旗を携行し、「自軍コアの奪還が必要」と表示する。自旗がそのtickに帰還した場合は次tickから得点可能。同tickに自旗を奪われた場合は得点不可。到着tickの戦闘で撃墜されたcarrierは得点せずdrop。球内待機中なら自旗の帰還後に再侵入を求めず次tickに得点する。

`FLAG-03`。固定stepは次の順序で一度ずつ処理する。

1. epoch/入力検証、期限を迎えた復活処理、開始snapshot
2. AI意思決定、既存飛行・射撃、swept弾道/接触候補の収集
3. 同tick損傷を集約して全機同時適用。死亡確定、carrier drop、復活予約
4. dropの自動帰還→前tickから存在するdropの自軍奪還/敵再取得→前tickからhomeの旗取得（1flag最大1遷移）
5. 前項の全条件から回収候補を算出、保存則を再確認、原子的に最大1得点
6. 3点/時間切れを判定、未終了の得点ならroundReset、最後にHUD/音向け通知を発行

既発射弾は同tickの射手死亡で消さない。双方が同tick致死なら双方撃墜・双方dropであり、array走査順で片方を生存させない。敵旗を双方が携行している状態では両方の自旗がhomeでないため双方得点不可。通常stateから「両陣営同時得点」は成立しない。二つの得点候補を検出したら片側勝ちを選ばず、不変条件違反として試合をpauseし記録対象外とする。fixtureでこの防御を検査する。

### 5.4 旧世代イベントとリセット

`FLAG-04`。イベント識別子は `matchId/roundEpoch/tick/eventSeq`。機体にはslotとは別のgenerationを付ける。damage/kill/drop/respawnには対象世代、旗eventにはexpectedRevisionを必須とする。重複eventは冪等無効、旧match/epoch/世代/revisionは無効。古いbulletを新しい同slot機に当てない。

得点resetはscore以外の戦場を一括初期化する: 全機HP/弾/飛行controller/宙返り/CD、旗、弾、VFX queue、AI割当、復活予約、入力/未消費edge、camera補間元。試合playTicksと累計統計は保持。新roundEpochで全slot世代を更新し基地後方へ配置。reset中は機体移動・旗取得・戦闘なし。180 tick後のplayingには再押下を要求する。勝敗結果は一度だけimmutable snapshot化する。

## 6 戦力と復活

`LIFE-01`。各陣営slot0..4、味方slot0が自機。slotの正規識別は(team, slotId)であり、世代参照にもteamを含め、両陣営のslot0等を衝突させない。active/respawnPendingのどちらか一方、全10slot固定。死亡処理はgenerationごと1回、`respawnDuePlayTick=death+480` を1件だけ予約する。pause・設定中は減らない。期限到達時、そのslotがなお死亡し予約世代・match・epochが一致した場合のみgenerationを増やして生存化。reset/end/home/retryで旧予約を失効し、Promise/setTimeoutをspawn権限源にしない。

HP初期80。既存機体形状・当たり判定・速度65..141m/s・初期target110m/sを維持。初期spawnは基地から自陣後方へ350m、横列offset z=−200/−100/0/100/200、y=300、敵基地へ向く。味方はx=−1750、敵はx=1750。各slotは固有位置で重ならない。敵弾に即死させられないよう復活後120 playing tickは損傷・敵機衝突・射撃・旗取得/帰還を無効とし、点滅と残秒を表示する。移動/操縦は可能、海面/場外は保護対象外。手動射撃で保護を短縮しない。復活地点の敵/弾、保護終了119/120tickの敵接触を検査し、隠れた保護延長・敵消去・強制ワープでspawncampを回避しない。安全に離脱する合法経路が不足するならバランス不合格としてspawn/routeの初期案を改訂しrulesVersionを更新する。

自機死亡でも味方AIは試合続行。自機の最終追従視点を保持し、復活カウントを既存HUDへ重ね、別spectator cameraに切り替えない。自機復活時だけ初期追従姿勢へ整合的にリセットする。復活待ちにpause/ルール/設定/ホームへ到達でき、攻撃入力は蓄積しない。残機や航空隊補充キルによるHP回復は実装しない。

`COMBAT-01`。基本の機銃/機関砲は既存の左右2銃口・機銃820m/s/機関砲700m/sに機体速度を加える弾速、寿命1.5秒、弾道と距離減衰を保持。自機はfire一操作で両方、mg288/cannon96、12/4回毎秒の左右一組、双方空なら6秒再装填。片方残ならその武器だけ、残数は負にしない。

初期案としてAI全9機は双方同じ火力mg2.4/cannon9.6、発射間隔0.28/0.95秒、spread0.012を基準とし、AIにもmg288/cannon96と双方空6秒再装填を適用する。自機基礎damage4/20を維持。Kaisenの敵だけ低い火力0.32/0.64を無条件には継承しない。UI操縦の共通性とCTFの戦力調整は分離する。敵AIだけ透視/必中/弾無限/速度超過で難度を上げない。全調整値は設定・結果のrulesVersionに束ねる。

旗/基地/復活保護機へdamageなし。敵機との衝突は双方致死、友軍同士は透過。銃弾は最初の有効敵機/海面に当たった時点で1回消費し、貫通多重命中なし。戦果統計は同tick相打ち・複数弾でも犠牲機generationごと1回のみ。被害配分を必要とする場合は実HP損失を上限にし、overkillを加算しない。

## 7 AIの役割と膠着対策

`AI-01`。全AIは同じ状態機械と合法飛行入力を使用する。基本割当は各陣営attacker2・defender2、敵の余剰1機はescort/recover枠。味方の自機は自由役割でAIが操縦を奪わない。AI生存数に応じて6tickごとに再評価し、旗/死亡/得点イベント時も次の評価で反映する。

優先順位: 携行機自身の帰還 > 自旗carrierの迎撃/自旗dropの奪還 > 味方carrierの護送 > 敵旗取得 > 基地周辺巡回。carrierは自旗不在時、自基地のradius300mの合法待機円を旋回し戦闘停滞しない。自旗が戻れば回収球へ進む。自旗奪還へ原則2機、味方carrierへ原則1機護送、最低1機は攻撃を継続する。carrierを除いた利用可能AIをこの優先順位で割り当て、人数不足なら下位役割から減らす。最低1機の攻撃継続は上位必要枠も確保できる場合だけとし、生存1機なら自旗奪還を優先する。carrierは護送人数に数えない。

割当はpriority→到達予想時間→slotIdで決定、同役割を最低120tick保持する。ただしcarrier発生/死亡/自旗危機は即再割当可能。護送はcarrierから側後方100..220mの位置、defender巡回は自基地300..600m、敵を追い回して空域外へ出ない。経路追随と射撃は分け、照準条件/味方射線安全を満たすときだけ撃つ。

旗/基地状態は両陣営に公開するためAIも位置情報を使える。通常敵機位置は1500m以内の視認・共有済み最終位置だけ。公開carrier位置を根拠に迎撃できるが、将来入力/弾の結果は読まない。AI決定にrenderer乱数や実時間を使わず、seed＋tick＋slotから決定する。

`AI-02`。目標距離の改善が10秒間20m未満なら、routeを既知の待避waypoint経由に1回組み直す。さらに10秒改善なしなら別の合法route/役割へ戻し、直接teleport・旗ワープ・無敵化をしない。旗dropの到達不能が発覚した場合だけWORLD-02の理由付きhome復旧を行う。90秒得点なしで双方HUDへ「コア奪還を優先」と通知し、AIの自旗奪還優先を再評価するが、timer/火力/速度/勝利条件は変えない。これ以上の強制膠着解消は12分判定で閉じる。

## 8 共通縦速度レバーの追補契約

`INPUT-01`。固定カイセンsourceにある旧タッチ加速/減速の2ボタンは履歴参照のみ。本作Normalの完成UI・設定は「射撃」「宙返り」「速度レバー」の3操作、Easyは宙返り1操作。Easyは既存自動巡航と自動射撃/照準支援を維持し、レバーを表示/受付しない。PCは左右上下、射撃、宙返り、加速、減速、一時停止の9操作。Easyで射撃・加速・減速は無効の6操作。既定は矢印/Space/L/W/S/Esc、再割当可能。

### 8.1 速度と入力消費

- 上+1、下−1。rawを±1へclampし、絶対値0.08以下は0、外側は符号×`(abs(raw)−0.08)/0.92`。非有限値、不正なレール寸法は0
- 目標速度の変更率は最大18m/s毎秒、範囲65..141m/s。raw0.54→axis0.5→1秒で+9m/s。位置で実速度を瞬時指定しない
- 離すとレバー表示・入力は中央、調整済みtargetは保持。実速度は既存空力で追従。開始/復活/reset時のtargetは110。携行による追加速度制約なし
- PCの加速/減速は±1、両キー同時は0。pointerAxis＋キー差＋focusedAxisを加算して±1へclamp。3入力を合算してから最終clampを一度行い、pointerとfocusだけを先に合成clampしない（pointer+1、focus+1、減速key−1なら+1）。入力源を二重計上しない
- `FlightInput.throttle` は明示0も含め正本。未指定の場合だけlegacy accelerate/brakeを読む。互換フィールドは旧タッチUIを残す理由にはならない
- レバーfocus中のArrowUp/Right/Endは+1、Down/Left/Homeは−1。keyup/Escape/focusoutでfocus由来の速度入力を解除し、操縦キーへ二重配送しない。レバーのfocus移動だけで別pointer所有の操縦/射撃を解除しない。repeatで失効入力を復活させない
- sample前に押して離したキー/支援技術の短操作も実simulation tickに1回伝える。sampleだけして固定step0回のframeでは消費しない。catch-upの複数tickに短押しを再生しない。cancel/blur/pauseは未消費分も破棄

### 8.2 pointer所有と解除

レバー所有はpointer ID1つ。操縦の指・射撃の指と別に同時保持できる。別操作の指がレバーを横切っても奪わず、2本目のレバー指は先の指を上書きしない。captureを取得しレール外でも上下限継続、up/cancel/lostcaptureは当該ownerのみ解除し他操作を維持する。capture取得失敗、mouse buttons=0、stale-primary復旧も押し残りなし。

非主ボタン/非playing/無効modeは拒否。pause、blur、pagehide、visibility hidden、resize/orientation、設定表示/変更、mode変更、死亡、復活、roundReset、restart、home、result、disposeで入力0とcapture解放。復帰後は新規押下必須。IME、編集欄、native dialog/リンク、Ctrl/Alt/Meta shortcut、Tabフォーカス移動をゲーム入力へ吸い込まない。

### 8.3 配置とアクセシビリティ

ラベル「速度レバー」、上「加速」、中央「保持」、下「減速」。中央は停止でないと説明。role slider、orientation vertical、min−100/max100/now、valuetextに方向/保持、離すと中央へ戻り速度は保持する説明、tab到達、見えるfocus ringを備える。色や数値だけで状態を表さない。Screen readerへの速度逐次読み上げは毎frame行わず、操作と状態変化に限定する。

幅は既存control display size（最小44 CSS px）、高さは幅の2倍、handle中心の上下端余白は22px以上。設定previewと実画面の長方形寸法を一致させる。最小hit44px、safe-area・visualViewport・縦横・文字200%で全体が収まり、透明な巨大領域で操縦面/射撃/設定scrollを覆わない。CSS優先順位による実rect縮みと、pause/sound等HUD補助操作との衝突も実測する。

初期候補は旧共通配置の中点 `(0.17,0.75)`、size76、不透明度0.82。射撃 `(0.83,0.84),96,0.90`、宙返り `(0.83,0.66),72,0.78` は元の値を保持する。レバーだけclamp/最寄り非衝突位置へ退避し、空きがない時は他操作を移動せず、レバーを無効/非表示にして回転または設定調整の警告を出す。設定は保存を止める。左右利きは既存x/y/size/opacity編集で対応。旧2ボタンをプレビュー・選択肢・説明に残さない。

### 8.4 共通成果物の固定参照

共通契約v1の内容指紋は次のとおり。契約本文とcore/fixtureは本作実装の前提であり、今回このrepoにコードを追加しない。[固定契約本文](https://github.com/chameleonjp-lab/machimamore/blob/c4224528b83d31cccc66e04b2c146ec931ec51e0/docs/THROTTLE_LEVER_CONTRACT.md) と [固定fixture](https://github.com/chameleonjp-lab/machimamore/blob/c4224528b83d31cccc66e04b2c146ec931ec51e0/docs/fixtures/throttle-lever-v1.json) を参照する。coreの固定公開取得元は後続実装で確認し、下記hashと照合する。共通文書の公開は本体・実機試験の完了を意味しない。

| 共通成果物 | SHA256 |
| --- | --- |
| THROTTLE_LEVER_CONTRACT.md | cd0e7db83c54cf349fb6a178a8abcd22bf09f78376cb4b836784faa2ae721864 |
| throttle-lever.ts | e83fe3c570581d16cb76e08ef9a039bbe9d4a50da6575366ac7e126bf3f30cf0 |
| throttle-lever-v1.json | 416c5ac01d4d14d1f45d94385e07233090740db04382e468db1f0c64689df8ca |

fixtureはaxis11、pointer10、combine6、advance8の計35件。別途非有限値・明示0/legacy・短押し・取消・storage・実入力から製品速度更新までを試験する。fixtureを置くだけで適合とは呼ばない。

## 9 設定と記録の保全

`STORE-01`。本作が読み書きするのは `nusumidase-` 名前空間だけ。kaisen/faitofuraitoのキーは一切読み書きしない。本作初版に旧保存が存在するとは主張せず、開発途中版との非破壊互換を備える。

Normalは `nusumidase-controls-v2`、Easyは `nusumidase-controls-easy-v2`、keyは `nusumidase-keyboard-v1`。旧 `nusumidase-controls-v1` / `nusumidase-controls-easy-v1` のrawは書換え/削除しない。旧配置があれば加速/減速の有効中点、size/opacityの安全統合から候補を作る。fire/loopの個別設定を保持。ロード/プレビュー/Cancelは書かず、Saveのみ新v2へ保存する。

v2存在時はv1へ逆戻りしない。未知future versionは安全既定値と警告、rawは保存で上書きしない。v2不在でv1が未来形式なら推測移行しない。壊れたJSON、欠損/非有限値は安全既定値で読み、元rawを控える。modeごと全件preflight、未知形式/容量/重なり/値不正を検出してから書込む。保存後readback一致までactive設定へ反映しない。

`STORE-02`。複数キー保存前に対象allowlist・旧raw/null・新raw・transactionIdの復元journalを確保し、そのreadbackを検証する。journal確保失敗なら書込開始しない。途中失敗は旧rawへrollbackし、active設定不変。rollback自体が拒否されたら成功扱いせず、journalとメモリ控えを保持して「保存の復元未完了」を示す。次回起動はjournalを先に検査し、旧側の整合したsnapshotを使用、対象外キーは操作しない。未来version/別transactionの内容をrollbackで潰さず競合を通知する。

同時タブは保存直前に旧raw/revisionを再比較し変化なら中止。ロックを取れない環境で同時writeの原子性を仮定しない。全commitとreadbackに成功したjournalは完了状態を記録し、未完了journalを容量整理で消さない。旧v1控えは残す。復元不能時も操作設定は一貫した旧snapshot/安全既定値から利用できる。「今回だけ使う」を明示選択した場合だけsession適用、Cancel/×/Escはdraft破棄し元の起点へfocus復帰。停止画面から設定を閉じても停止維持。

`STORE-03`。本作の永続記録は `nusumidase-records-v1`、rulesVersion・mode・結果・回収数・playTicks・自己回収/奪還/撃墜/死亡の統計・completedMatchIdを保持。最新20件とmode/rulesVersion別bestのみ。勝敗確定後に1回appendする。bestは勝利内で回収差大→playTicks小、引分/敗北はbest勝利を置換しない。既存raw控え/journal/readback/未来version保護は設定と同じ。

無限撃墜、旗の拾い直し、自動帰還、死亡復活で得点・HP・時計・bestを増やさない。個人統計はbounded integer（最大1,000,000で飽和）で勝敗に無関係。外部送信なし。対戦中snapshotの永続再開は初版対象外。reload/crashからはホームへ戻し未完試合を中断として扱い、壊れた旗stateや残り時間を推測復元しない。設定/完了記録は上記手順で回復する。

## 10 HUDと利用者への説明

`UI-01`。ホームは「敵コアを自基地へ3回」「自軍コア不在では得点できない」「12分時は回収数、同数引分」「撃墜後8秒復活」を表示。Normal/Easyの違いは操縦/射撃支援で、回収数・試合時間は同じ。設定入口をホーム/停止/結果に保持する。

飛行中の上端は両陣営回収数0..3と残時間、両旗のhome/敵携行/味方携行/drop・帰還残秒。自機携行は常時「敵コア携行中」、持帰り不可理由、自基地への方向/距離/高度差を示す。旗位置は双方に公開、画面外は端marker、視界内は共通投影に従う。中央照準・機体を塞がず、補助情報は端へ配置する。回収数以外の撃墜統計を大きな「得点」と誤表示しない。

自機HP/高度/速度/残弾/再装填/宙返り、僚機生存数と復活待ち、pause/soundは既存様式。携行/奪還/回収/自動帰還/復活/残60秒の通知は文字と音を併用、音だけ必須にしない。旗state live regionは状態変化時のみ、同時通知は重大度順にまとめる。点滅は高速化せずreduced-motionに従う。

結果は勝利/敗北/引分/中断理由を区別し、回収数、経過有効時間、回収・奪還・撃墜・死亡の内訳、rulesVersionを表示。中断は戦績保存なし。連続クリックでも結果確定・保存・再開始は各1回。保存失敗はゲーム結果とは別の警告にする。

## 11 負荷と故障時の上限

`LIMIT-01`。生存機10、flag2、base2、respawn予約10、bullet1024、同tick意味event128、描画/音event512、wreck10・各5秒、visual粒子240を上限とする。AI決定6tickごと、最大64waypoint/map、route探索は1機1評価につき展開64node以下。弾の判定は空間grid等で候補を絞るが結果順序は安定させる。

弾上限時は左右2発を一組で予約し、入らなければ弾を出さず残弾と発射clockを消費しない。slot順の恒常優遇を避けるため発射予約開始slotをtick mod 10で循環。critical flag/death/result eventは先に予約し描画通知不足で落とさない。意味event上限超過は不変条件違反としてpause/記録対象外、古いものを捨てて続行しない。描画通知だけは古い非重大分を捨て、stateは影響しない。処理済みevent集合はepoch/tick窓で解放し試合回数に比例増大させない。

目標は393×852/DPR2相当で30fps以上、desktop1280×720/DPR1で60fps相当。10機連射とflag処理の12分soak＋20回retryで上限維持・listener/geometry/texture/audio増殖なしを測定する。機器・browser・build・計測期間・p50/p95/最悪frame・heap傾向を記録し、実機未測定を合格にしない。性能対策で機体geometry/カメラ/飛行rateを削らず、描画解像度やVFXを先に調整する。

## 12 受入条件と未検証事項

要件は [実装計画書の検査表](IMPLEMENTATION_PLAN.md#5-受入検査の実施計画) へ追跡する。最低条件は以下。

- `AC-FLAG`: 全遷移・同時接触・相打ち・自旗不在・帰還tick・時間切れ・重複/旧世代・resetを固定seedで検査し、常時2flag/単一ownerを保持
- `AC-LIFE`: 10slot保存則、二重kill/予約、8秒境界、保護、paused時間、reset/end後旧callbackを検査
- `AC-AI`: 4役の分担、合法飛行、基地/drop到達、carrier帰還、待機から奪還後の回収、再経路、12分終了を検査
- `AC-INPUT`: 35共通fixture＋製品入力→実速度target更新、pointer複数所有/cancel、短押し消費、Normal/Easy、focus/IME、200%文字/safe-areaを検査
- `AC-STORE`: 旧raw非破壊、未知future、破損、途中保存/rollback失敗、同時タブ、Cancel/今回だけ、reload、結果二重保存を検査
- `AC-VISUAL`: 同browser/version・viewport・DPR・文字倍率・フォント・seed・状態・tickで元作と本作の実画像を比較。ホーム、Normal飛行、Easy飛行、停止、Normalタッチ設定、Easyタッチ設定、キー設定、結果の8画面。ルール画面と機体正面/側面/背面/旋回、カメラ/照準の追加比較を行う
- `AC-LIMIT`: 上限・負荷・長frame・context loss・20回retry・破棄後callbackを検査

8画面ではbase画像/本作画像/diff/実測値/差分理由を対応付ける。許容差分は第2.2節のみ。設定やレバーは機能変更領域として説明して比較し、画面全体をmaskしない。未説明差分、撮れない状態、目視未確認、未実機検査は「未検証」または「不合格」と記す。source一致だけを見た目合格に置換しない。

今回の文書作成で確認したのは、対象mainがREADMEのみであること、固定sourceの実在と該当HTML/CSS/設定/入力/機体/視点/飛行/射撃処理、共通レバー契約・core・fixtureの内容である。ヌスミダセのゲーム実行・単体/ブラウザー/build・8画面撮影・iPhone実機/touch支援技術・遊びのバランスは未実施。これらは実装着手後の必須ゲートとして残す。
