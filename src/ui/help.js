// ─────────────────────────────────────────────────────────────────────────────
// 帮助 / 关于弹层：操作说明、快捷键、景点图例、数据与考据来源、制作说明、免责声明。
// ─────────────────────────────────────────────────────────────────────────────
import { h, on, focusableWithin } from './util.js';
import { icon } from './icons.js';
import { GROUP_DEFS } from './content.js';

const QUICK_KEYS = [
  { keys: ['1', '2', '3', '4'], text: '晨 / 晝 / 暮 / 夜 時段' },
  { keys: ['T'], text: '自動漫遊 開 / 關' },
  { keys: ['L'], text: '地名標籤 開 / 關' },
  { keys: ['V'], text: '步行 / 遊覽 模式切換' },
  { keys: ['W', 'A', 'S', 'D'], text: '步行：前 / 左 / 後 / 右移動' },
  { keys: ['Shift'], text: '步行：疾跑（按住）' },
  { keys: ['Space'], text: '步行：跳躍' },
  { keys: ['E'], text: '互動：開門 / 進入 / 登樓' },
  { keys: ['H'], text: '賞景模式（隱藏全部介面）' },
  { keys: ['?', 'F1'], text: '遊園說明' },
  { keys: ['Esc'], text: '關閉彈層 / 信息卡 / 退出步行 / 目錄 / 賞景' },
];

const OPS_DESKTOP = [
  ['左鍵拖曳', '旋轉視角'],
  ['右鍵拖曳', '平移'],
  ['滾輪', '縮放遠近'],
  ['點擊景點目錄 / 小地圖點位', '前往該景點（步行時傳送）'],
  ['點擊小地圖空白處', '飛至該處上方（步行時貼地傳送）'],
  ['步行：WASD', '前 / 左 / 後 / 右移動'],
  ['步行：拖曳滑鼠', '轉身'],
  ['步行：Shift / Space', '疾跑 / 跳躍'],
  ['步行：E', '互動（門前 / 樓梯 / 提示）'],
];

const OPS_TOUCH = [
  ['單指拖曳', '旋轉視角'],
  ['雙指張合', '縮放遠近'],
  ['雙指拖曳', '平移'],
  ['點擊小地圖點位 / 空白', '前往景點 / 飛至該處（步行時傳送）'],
  ['信息卡上滑 / 下滑', '展開 / 關閉信息卡'],
  ['步行：左下搖桿', '拖動控制行走方向'],
  ['步行：拖曳畫面', '轉身'],
  ['步行：右側按鈕', '疾跑 / 跳躍 / 退出'],
  ['步行：點擊提示', '互動（開門 / 進入 / 登樓）'],
];

function section(title, ...children) {
  return h('section', { class: 'h-sec' }, h('h3', { class: 'h-title', text: title }), ...children);
}

function paragraph(text) {
  return h('p', { class: 'h-p', text });
}

function opColumn(title, rows) {
  return h(
    'div',
    { class: 'op-col' },
    h('h4', { class: 'op-col-title', text: title }),
    rows.map(([key, desc]) =>
      h('div', { class: 'op-row' }, h('span', { class: 'op-key', text: key }), h('span', { class: 'op-desc', text: desc })),
    ),
  );
}

function keyRow(keys, text) {
  return h(
    'div',
    { class: 'key-row' },
    h('span', { class: 'key-keys' }, keys.map((key) => h('kbd', { text: key }))),
    h('span', { class: 'key-desc', text }),
  );
}

function legend() {
  const groups = h(
    'div',
    { class: 'legend legend-groups' },
    GROUP_DEFS.map((def) => {
      const dot = h('span', { class: 'legend-dot', attrs: { 'aria-hidden': 'true' } });
      dot.style.setProperty('--gc', def.color);
      return h('div', { class: 'legend-item' }, dot, h('span', { text: def.label }));
    }),
  );
  const symbols = h(
    'div',
    { class: 'legend legend-symbols' },
    h('div', { class: 'legend-item' }, h('span', { class: 'symbol symbol-poi', attrs: { 'aria-hidden': 'true' } }), h('span', { text: '景點點位' })),
    h('div', { class: 'legend-item' }, h('span', { class: 'symbol symbol-active', attrs: { 'aria-hidden': 'true' } }), h('span', { text: '當前景點' })),
    h('div', { class: 'legend-item' }, h('span', { class: 'symbol symbol-view', attrs: { 'aria-hidden': 'true' } }), h('span', { text: '當前視角扇形' })),
    h('div', { class: 'legend-item' }, h('span', { class: 'symbol symbol-north', attrs: { 'aria-hidden': 'true' }, text: '北' }), h('span', { text: '上北下南' })),
  );
  return h('div', { class: 'legend-wrap' }, groups, symbols);
}

export function initHelp(ctx) {
  const closeBtn = h(
    'button',
    {
      class: 'help-close',
      attrs: { type: 'button', 'aria-label': '關閉說明', title: '關閉（Esc）' },
      on: { click: () => close() },
    },
    icon('close'),
  );
  const title = h('h2', { class: 'help-title', text: '遊園指南', attrs: { id: 'help-title' } });
  const subtitle = h('p', { class: 'help-sub', text: '大觀園 · 三維體素復原' });
  const head = h('div', { class: 'help-head' }, h('div', { class: 'help-head-main' }, title, subtitle), closeBtn);

  const scroll = h(
    'div',
    { class: 'help-scroll' },
    section(
      '園林概說',
      paragraph(
        '本園依《紅樓夢》第十七、十八回賈政領寶玉題對額的遊園路徑，並參照紅學通行復原，以 1 體素 ≈ 1 米的比例重構。中軸自南門經翠嶂、沁芳亭、省親別墅牌坊，直抵正殿與大觀樓；沁芳溪自東北沁芳閘引泉，穿花溆入沁芳池，出東南牆下。四主院與群景依原文方位分踞園中。',
      ),
      paragraph('本作是體素藝術復原，不是測繪圖，也不是考古復原；尺度與細部含有藝術取捨。'),
    ),
    section(
      '操作指南',
      h('div', { class: 'ops-grid' }, opColumn('桌面', OPS_DESKTOP), opColumn('觸控 / 移動裝置', OPS_TOUCH)),
    ),
    section(
      '步行模式',
      paragraph(
        '按 V 或 Dock 的「步行」可切換第一人稱步行遊園：可穿門入室、登樓、沿水岸與山徑行走。步行時景點目錄自動收起，小地圖保留（點擊可傳送）；點擊景點會直接傳送到該景點的步行落點。',
      ),
      paragraph(
        '桌面：WASD 移動、拖曳滑鼠轉身、Shift 疾跑、Space 跳躍、E 互動、V 或 Esc 返回遊覽。移動端：左下搖桿移動、拖曳畫面轉身、右下按鈕疾跑 / 跳躍 / 退出。',
      ),
      paragraph('出現「推門進入」「登樓」等提示時，按 E 或點擊提示即可互動；離開範圍提示會自動消失。'),
    ),
    section('快捷鍵', h('div', { class: 'keys-grid' }, QUICK_KEYS.map((item) => keyRow(item.keys, item.text))), paragraph('隱藏入口：連續點擊左上角「大觀園」標題三次，可開啟 FPS 與性能面板。')),
    section('景點圖例', legend()),
    section(
      '資料與考據',
      paragraph(
        '原文引文以《紅樓夢》第十七、十八、二十三、二十七、三十八、四十、四十一、六十二回為據，依識典古籍整理本逐字核對；明顯錄訛以通行本校正，引文採簡體。',
      ),
      paragraph(
        '建築形制、尺度與植物參照明清造園通例及紅學通行復原框架（楊乃濟、周汝昌等諸家），並按 A 級原文直證 / B 級原文可推出 / C 級藝術取捨分級取用。景點文案與引文整理自項目考據文檔 docs/research.md。',
      ),
      paragraph('匾額信息卡同列「初題」與「元春改題」：如紅香綠玉→怡紅快綠、有鳳來儀→瀟湘館、杏簾在望→浣葛山莊→稻香村、天仙寶境→省親別墅。'),
    ),
    section(
      '製作說明',
      paragraph('三維部分以 three.js r169 即時渲染，配合自研體素貪心網格化（greedy meshing）壓縮面數；園林由程序化生成器依總平面重建。'),
      paragraph('界面為純前端、離線單文件：不載入任何外部字體、圖片或腳本；圖標皆為內聯 SVG，小地圖底圖由主程序即時繪製並內嵌。視覺以墨綠、金與宋體 / 襯線為基調。'),
      paragraph('時段、漫遊、地名標籤、全螢幕與賞景模式互相獨立；資訊卡、目錄與小地圖皆可用鍵盤或觸控操作。'),
    ),
    section(
      '免責聲明',
      paragraph(
        '本作是以《紅樓夢》大觀園為題材的體素藝術復原，非測繪、非考古復原，不可作為學術研究或實地參照依據。園中方位、尺度與細部包含藝術取捨（部分 C 級取捨見項目考據文檔）；引文所屬《紅樓夢》原文屬公有領域，整理本僅作考據參照。',
      ),
    ),
  );

  const foot = h(
    'div',
    { class: 'help-foot' },
    h('span', { text: '大觀園 · 體素藝術復原' }),
    h('span', { class: 'help-foot-note', text: '離線單文件 · 無外部資源' }),
  );

  const dialog = h(
    'div',
    { class: 'help', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'help-title' } },
    head,
    scroll,
    foot,
  );
  const layer = h('div', { class: 'modal-layer', attrs: { 'aria-hidden': 'true' } }, dialog);
  ctx.root.appendChild(layer);

  let open = false;
  let lastFocus = null;

  function onTab(event) {
    if (event.key !== 'Tab' || !open) return;
    const focusables = focusableWithin(dialog);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !dialog.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function openHelp() {
    if (open) return;
    open = true;
    lastFocus = document.activeElement;
    scroll.scrollTop = 0;
    layer.classList.add('is-open');
    layer.setAttribute('aria-hidden', 'false');
    ctx.body.classList.add('help-open');
    document.addEventListener('keydown', onTab, true);
    try { closeBtn.focus({ preventScroll: true }); } catch { /* ignore */ }
    if (ctx.onHelpStateChange) ctx.onHelpStateChange(true);
    ctx.announce('遊園說明已開啟');
  }

  function close() {
    if (!open) return;
    open = false;
    layer.classList.remove('is-open');
    layer.setAttribute('aria-hidden', 'true');
    ctx.body.classList.remove('help-open');
    document.removeEventListener('keydown', onTab, true);
    if (lastFocus && lastFocus.isConnected) {
      try { lastFocus.focus({ preventScroll: true }); } catch { /* ignore */ }
    }
    if (ctx.onHelpStateChange) ctx.onHelpStateChange(false);
    ctx.announce('已關閉說明');
  }

  on(layer, 'click', (event) => {
    if (event.target === layer) close();
  });

  // 点击帮助面板内的外链（本作无外链）；保留 Esc 由全局快捷键与此处双保险
  on(document, 'keydown', (event) => {
    if (!open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  });

  return { el: layer, open: openHelp, close, isOpen: () => open };
}
