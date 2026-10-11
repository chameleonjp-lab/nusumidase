import type { GameMode } from './types';
import { containDialogTabFocus } from './dialog-focus';

export type GuideInput = 'touch' | 'keyboard';
export interface RulesContext { mode: GameMode; input: GuideInput; keyboardDescription: string; }
export interface RuleSection { heading: string; paragraphs: string[]; }

export function ruleSections({ mode, input, keyboardDescription }: RulesContext): RuleSection[] {
  return [
    { heading:'コアを奪って持ち帰る', paragraphs:[
      '味方5機（自機と僚機4機）、敵5機の空中旗取りです。敵基地のコアに45m以内まで接近すると取得します。敵コアを自基地へ3回持ち帰った陣営が勝利します。',
      '自軍コアが奪われている、または落ちている間は回収できません。自軍コアを奪還し、基地へ戻してから敵コアを持ち帰ってください。携行中も速度や射撃は変わりません。',
      '12分の有効プレイ時間が過ぎると回収数で判定します。同数は引分です。撃墜数は勝敗の得点にはなりません。回収後に全機と両コアを初期位置に戻し、3秒後に次のラウンドへ進みます。'
    ]},
    { heading:'撃墜・奪還・復活', paragraphs:[
      '携行機が撃墜されるとコアは合法な空中位置に浮遊します。自軍機の接近で即奪還、敵機の接近で再取得、30秒で自動帰還します。',
      '撃墜された機体は8秒後に復活し、2秒間は攻撃・被弾・コア接触が無効です。自機の復活待ちも僚機と試合時計は進みます。',
      '空域は海上の開放空間です。高度20〜900m、東西±2400m、南北±1800mの外へ出ると撃墜されます。基地のリングは通過できます。友軍弾・友軍機との接触では損傷しません。'
    ]},
    { heading:input === 'touch' ? 'タッチの操作' : 'PCの操作', paragraphs:input === 'touch' ? [
      'ボタンのない場所に触れ、その位置からドラッグして操縦します。半径36pxの相対ドラッグです。操縦しながら別の指で射撃と速度レバーを操作できます。',
      mode === 'easy' ? 'イージーは自動巡航と、照準円内・1.2km以内の敵機への自動射撃・照準支援を行います。タッチ操作は宙返りボタンだけです。' : 'ノーマルは射撃を長押し。速度レバーの上で加速、下で減速、離すと中央へ戻ります。調整した目標速度は保持します。中央は停止ではありません。',
      '宙返りは押すたびに1回。途中で操縦方向を変えると解除できます。操作設定で位置・大きさ・不透明度を調整できます。'
    ] : [keyboardDescription,
      mode === 'easy' ? 'イージーでは射撃・加減速キーは使いません。照準円内の敵機へ自動射撃します。' : 'ノーマルは手動射撃と加減速です。W/Sの両押しは保持。速度レバーはTabでも到達でき、フォーカス中は矢印またはHome/Endで操作できます。',
      '操縦キーは操作設定で再割当できます。マウスでも相対ドラッグできます。宙返りは押し直すと次の操作になります。'
    ]},
    { heading:'武器・停止・記録', paragraphs:[
      '機銃288発と機関砲96発。左右2門を同時発射し、遠いほど威力が下がります。双方の弾倉が空になると6秒で再装填します。コアと基地は破壊されません。',
      '一時停止、設定、説明、タブ切替や画面の非表示中は全ての時計が止まります。設定や説明を閉じても自動再開しません。飛行を再開を押してください。',
      '完了した試合だけをこの端末に最新20件まで保存します。途中でホームへ戻る・再出撃・再読み込みは中断です。設定は保存・今回だけ使う・破棄を選べます。'
    ]}
  ];
}

/** Native modal keeps focus and Escape inside the guide without resuming the mission. */
export class RulesGuide {
  private readonly dialog: HTMLDialogElement;
  private readonly content: HTMLElement;
  private returnFocus: HTMLElement | null = null;
  private readonly abort = new AbortController();
  get isOpen() { return this.dialog.open; }
  constructor(private readonly context: () => RulesContext, private readonly clearInput: () => void) {
    this.dialog = document.createElement('dialog'); this.dialog.id = 'rules-guide';
    this.dialog.className = 'rules-dialog'; this.dialog.setAttribute('aria-labelledby', 'rules-title');
    this.dialog.innerHTML = '<header class="rules-header"><div><p class="eyebrow">HOW TO PLAY</p><h2 id="rules-title">ルールと操作方法</h2></div><button type="button" id="rules-close" aria-label="説明を閉じる">×</button></header><div id="rules-content" class="rules-content" tabindex="0" role="region" aria-label="ルール説明の内容"></div><footer><button type="button" id="rules-back" class="primary">元の画面へ戻る</button></footer>';
    document.getElementById('app')!.append(this.dialog);
    this.content = this.dialog.querySelector('#rules-content')!;
    for (const id of ['rules-close', 'rules-back']) this.dialog.querySelector('#' + id)!.addEventListener('click', () => this.close(), { signal: this.abort.signal });
    this.dialog.addEventListener('cancel', event => { event.preventDefault(); this.close(); }, { signal: this.abort.signal });
    this.dialog.addEventListener('keydown', event => containDialogTabFocus(this.dialog, event), { signal: this.abort.signal });
    this.dialog.addEventListener('close', () => { this.clearInput(); this.returnFocus?.focus({ preventScroll: true }); }, { signal: this.abort.signal });
  }
  open(button: HTMLElement) {
    if (this.isOpen) return;
    this.returnFocus = button; this.clearInput(); this.content.replaceChildren();
    for (const section of ruleSections(this.context())) {
      const element = document.createElement('section'), heading = document.createElement('h3');
      heading.textContent = section.heading; element.append(heading);
      for (const text of section.paragraphs) { const p = document.createElement('p'); p.textContent = text; element.append(p); }
      this.content.append(element);
    }
    this.dialog.showModal(); this.content.scrollTop = 0;
    this.dialog.querySelector<HTMLButtonElement>('#rules-close')!.focus({ preventScroll: true });
  }
  close() { if (this.isOpen) this.dialog.close(); }
  dispose() { this.close(); this.abort.abort(); this.dialog.remove(); }
}
