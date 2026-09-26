(function () {
  const container = document.getElementById('container_more');
  if (!container) return;
  const params = new URLSearchParams(location.search);
  const mode = params.get('pack') ? 'level' : (params.get('mode') || 'normal');
  const isLevel = mode === 'level';
  const restoreMaker = mode === 'maker' && params.get('restore') === '1';
  const restoreSolver = mode === 'solver' && params.get('restore') === '1';
  // 带 from 说明是「游玩页 / 试玩页 → 画板」的往返流程：画板的返回按钮最终还要回到那边，
  // 而试玩返回制题器要靠 makerBackup 还原编辑状态，所以这时不能清制题器的编辑状态
  // （从首页直接进画板这类「新开」的入口才清，免得残留上一次的旧图形）
  const roundTrip = !!params.get('from');
  if (!isLevel && mode !== 'maker-play' && !restoreMaker && !roundTrip) ['elements', 'geometryElementLists', 'thumbnail', 'constructRecord', 'makerBackup'].forEach(key => sessionStorage.removeItem(key));
  // 仅当从画板主动跳转进入 solver（restore=1）时沿用图形，其余入口（首页等）清空画板
  if (!restoreSolver) sessionStorage.removeItem('solverElements');
  // 自制/求解模式的几何默认样式与关卡游玩模式保持一致（初始点红色、构造出的点与线圆灰色）
  if ((mode === 'maker' || mode === 'solver') && typeof geometryStyle !== 'undefined') {
    ['point', 'line', 'circle'].forEach(type => { geometryStyle[type].colorChoice = 'autoPlayMode'; });
  }
  if (restoreMaker && sessionStorage.getItem('makerBackup')) {
    const backup = JSON.parse(sessionStorage.getItem('makerBackup'));
    // 备份里可能是空值（没有作图记录等），这类键直接清掉，避免写成 "null" 字符串
    Object.entries(backup).forEach(([key, value]) => {
      if (typeof value === 'string' && value) sessionStorage.setItem(key, value);
      else sessionStorage.removeItem(key);
    });
  }
  document.body.classList.add(`mode-${mode}`);
  // 自由画板（首页 01 / BOARD，地址上没有 mode 参数）不做标记，元素一览只留「全部 / 隐藏」两档；
  // 初始 / 可动点 / 所求 / 探索 是制题器与求解器才需要的东西
  if (mode === 'normal') {
    const overviewSelect = document.getElementById('overview-select');
    if (overviewSelect) {
      ['initial', 'movepoints', 'result', 'explore'].forEach(value => {
        const option = overviewSelect.querySelector(`option[value="${value}"]`);
        if (option) option.remove();
      });
      // 万一停留的档位被删掉了（例如从别的模式返回），退回「全部」
      if (!['all', 'hidden'].includes(overviewSelect.value)) {
        overviewSelect.value = 'all';
        if (typeof overviewPanelSelectorChanged === 'function') overviewPanelSelectorChanged();
      }
    }
  }
  // 求解器里只有「给定」与「所求」两种标记，元素一览也就只留 全部 / 隐藏 / 给定 / 所求 四档
  if (mode === 'solver') {
    const overviewSelect = document.getElementById('overview-select');
    if (overviewSelect) {
      ['movepoints', 'explore'].forEach(value => {
        const option = overviewSelect.querySelector(`option[value="${value}"]`);
        if (option) option.remove();
      });
      // 与标记面板统一口径：这一档在求解器里叫「给定」
      const initialOption = overviewSelect.querySelector('option[value="initial"]');
      if (initialOption) {
        initialOption.removeAttribute('data-i18n');
        initialOption.textContent = t('board.markGiven');
      }
      if (!['all', 'hidden', 'initial', 'result'].includes(overviewSelect.value)) {
        overviewSelect.value = 'all';
        if (typeof overviewPanelSelectorChanged === 'function') overviewPanelSelectorChanged();
      }
    }
  }
  // 页面标题随模式走（关卡游玩页的标题由 level-loader / 试玩数据决定，这里只管画板本身）
  const modeTitles = {normal: t('board.pageTitleBoard'), maker: t('board.pageTitleMaker'), solver: t('board.pageTitleSolver')};
  if (modeTitles[mode]) document.title = `${modeTitles[mode]} | Geommunity Blueprint`;
  // 标记显示色：给定 / 带标签给定黑、可移动点蓝、所求类与探索显示金
  const markColors = {initial: '#191919', named: '#191919', movepoints: '#0099ff', result: '#ffd700', resultShown: '#ffd700', explore: '#ffd700'};
  // 标记分类：给定三项互斥（一个对象只属于其中一个）；所求的判定 / 显示可以同时标
  const markGroups = {given: ['initial', 'named', 'movepoints']};
  // 求解器只保留「给定」与「所求判定」，制题器保留完整的 3 + 3
  const solverMode = mode === 'solver';
  const markSetOf = key => geometryElementLists[key] || new Set();
  /**
   * 多解 过程变量
   * 当前往哪一组写标记、画布上点亮哪一组，分别由 resultActive 与 highlightedResult() 决定
   */
  let resultActive = 1;
  const resultJudgeKey = index => (index <= 1 ? 'result' : `result${index}`);
  const resultShownKey = index => (index <= 1 ? 'resultShown' : `resultShown${index}`);
  const resultSetOf = (index, kind) => {
    const key = kind === 'shown' ? resultShownKey(index) : resultJudgeKey(index);
    if (!geometryElementLists[key]) geometryElementLists[key] = new Set();
    return geometryElementLists[key];
  };
  /**
   * 当前有几组解 过程函数
   * 最后一组有标记的就是解数（解 1 始终存在）
   * @returns {number}
   */
  const resultGroupCount = () => {
    let count = 1;
    while (geometryElementLists[resultJudgeKey(count + 1)] || geometryElementLists[resultShownKey(count + 1)]) count++;
    return count;
  };
  /**
   * 所有「所求」类的标记集合 过程函数
   * @returns {Array<{index: number, kind: 'judged' | 'shown', set: Set}>}
   */
  const resultMarkSets = () => {
    const list = [];
    for (let index = 1; index <= resultGroupCount(); index++) {
      list.push({index: index, kind: 'judged', set: resultSetOf(index, 'judged')});
      list.push({index: index, kind: 'shown', set: resultSetOf(index, 'shown')});
    }
    return list;
  };
  /**
   * 目前该点亮哪一组解 过程函数
   * 标记所求 / 所求显示下是选中的那一组（判定与显示一起亮）；
   * 其他工具下默认解 1 的判定亮（探索显示另有自己的高亮规则）
   * @returns {{index: number, judged: boolean, shown: boolean}}
   */
  const highlightedResult = () => {
    // 标记所求判定只看判定、标记所求显示只看显示；
    // 标记探索显示时探索对象另有自己的高亮，这里不点亮任何解
    if (marking === 'result') return {index: resultActive, judged: true, shown: false};
    if (marking === 'resultShown') return {index: resultActive, judged: false, shown: true};
    if (marking === 'explore') return {index: 0, judged: false, shown: false};
    // 其他工具（含标记给定）默认点亮解 1 的判定
    return {index: 1, judged: true, shown: false};
  };
  /**
   * 一个对象被标记后应有的显示色 过程函数
   * 给定 / 带标签给定黑、可移动点蓝、所求类判定的金；「所求」只有当前点亮的解才染金，
   * 其余解的对象保持自身样式色，免得满屏金色分不清图形
   * @param {string} id
   * @returns {string|null} 颜色；没被标记（或属于没点亮的解）时返回 null
   */
  const markDisplayColor = id => {
    const sets = resultMarkSets();
    const highlight = highlightedResult();
    // 同一个对象可能同时是多组的判定 / 显示，只要在点亮的那组里、且对应类型被点亮就算亮
    const lit = sets.filter(item => item.index === highlight.index && item.set.has(id));
    const inExplore = markSetOf('explore').has(id);
    // 标记探索显示：探索对象点亮金色，其余保持原样 —— 但给定 / 可移动点的标记色要继续显示，
    // 不能整个返回 null（那样给定图形会掉回自动配色（灰），看起来「给定图形的黑色没了」）
    if (marking === 'explore') {
        if (inExplore) return markColors.explore;
        if (markSetOf('initial').has(id) || markSetOf('named').has(id)) return markColors.initial;
        if (markSetOf('movepoints').has(id)) return markColors.movepoints;
        return null;
    }
    // 所求显示 / 所求判定的金色**盖在给定（黑）之上**：既被标成给定、又在点亮的所求里时，显示金色
    if (lit.length) {
      if (highlight.shown && lit.some(item => item.kind === 'shown')) return markColors.resultShown;
      if (highlight.judged && lit.some(item => item.kind === 'judged')) return markColors.result;
    }
    if (markSetOf('initial').has(id) || markSetOf('named').has(id)) return markColors.initial;
    if (markSetOf('movepoints').has(id)) return markColors.movepoints;
    // 不在点亮的解里（或在别的解里）、或没在标记探索时的探索对象：保持自身样式色
    return null;
  };
  /**
   * 所有标记集合（含多解） 过程函数
   * 面板、清空、样式色记录都按它遍历
   * @returns {Array<{key: string, set: Set}>}
   */
  const allMarkSets = () => [
    {key: 'initial', set: markSetOf('initial')},
    {key: 'named', set: markSetOf('named')},
    {key: 'movepoints', set: markSetOf('movepoints')},
    ...resultMarkSets().map(item => ({key: item.kind === 'shown' ? 'resultShown' : 'result', set: item.set})),
    {key: 'explore', set: markSetOf('explore')},
  ];
  /**
   * 所有被标记的对象 ID 过程函数
   * @returns {Set<string>}
   */
  const allMarkIds = () => {
    const ids = new Set();
    allMarkSets().forEach(({set}) => set.forEach(id => ids.add(id)));
    return ids;
  };
  // 标记面板「给定」一组的条目（求解器只留给定）
  const givenMarkItems = [
    ['initial', 'board.markGiven'],
    ['named', 'board.markNamed'],
    ['movepoints', 'board.markMovepoints'],
  ].filter(([key]) => !solverMode || key === 'initial');
  // 制题器 / 求解器里点默认不显示标签（可在「配置点样式」里打开；带标签给定的对象仍显示自己的标签）
  if ((mode === 'maker' || mode === 'solver') && typeof geometryStyle !== 'undefined') geometryStyle.point.showName = false;
  /**
   * 采集状态快照 过程函数
   * 几何对象 + 选定栏，标记（initial / result）一类的改动也记进撤销/重做历史
   * @returns {{elements: any[], lists: Object}}
   */
  window.collectStorageSnapshot = () => {
    const lists = {};
    for (const [key, value] of Object.entries(geometryElementLists)) lists[key] = [...value];
    return {elements: geometryManager.toStorage(), lists: lists};
  };
  /**
   * 清空所有画布管理器 过程函数
   * 关卡游玩里有「结果 / 探索」两个管理器持有同一批对象，清空画布时只清当前这一个的话，
   * 重新载入关卡图形时同一个 ID 会被当成重复而改名，之后选定栏、判定与显示全乱套
   */
  window.clearAllCanvases = () => {
    const managers = [
      typeof geometryManagerResult !== 'undefined' ? geometryManagerResult : null,
      typeof geometryManagerExplore !== 'undefined' ? geometryManagerExplore : null,
      typeof geometryManager !== 'undefined' ? geometryManager : null,
    ];
    managers.filter(Boolean).forEach(manager => {
      if (typeof manager.deleteAll === 'function') manager.deleteAll();
    });
  };
  /**
   * 丢弃画到一半的工具状态 过程函数
   * 工具缓存与工具自身的选中状态都清掉，否则它们还指着已经被清空的对象，之后作图会点击错位
   */
  window.resetToolState = () => {
    if (typeof tools !== 'undefined' && tools) {
      Object.values(tools).forEach(item => {
        if (item && typeof item.clear === 'function') item.clear();
      });
    }
    if (typeof refreshToolFloating === 'function') refreshToolFloating();
  };
  /**
   * 按选定栏刷新显示色 过程函数
   * initial 黑、可移动点蓝、所求类与探索显示金，其余保持自身颜色；
   * 撤销/重做恢复快照后调用，避免颜色退回构造时的设定色
   */
  window.refreshElementListColors = () => {
    // 关卡模式：选定栏里的 ID 指向关卡自带的对象，玩家新画的图形可能与其重名，
    // 只有「属于关卡对象」的 ID 才按选定栏着色，避免被误染成黑 / 金
    // 只认关卡模式：制题器 / 求解器里若残留了 level 集合（从游玩页带过来的记录），
    // 会把不在这份名单里的对象全部跳过，标记色静默失效
    const levelIds = mode === 'level' ? geometryElementLists.level : null;
    // 关卡游玩：「所求」判定（多解就是每一组解）统统金；「所求显示」不在这里上色 ——
    // 它们多数是隐藏的，作出解之后由 setResultGroupsVisible 点亮（这里也染的话，
    // 像 ewp14 的 X 那种既在 result 冒号后又本身可见的对象会一开场就是金色）
    const levelJudged = mode === 'level' ? new Set() : null;
    if (levelJudged) resultMarkSets().forEach(({kind, set}) => { if (kind === 'judged') set.forEach(id => levelJudged.add(id)); });
    geometryManager.getAllByOrder().forEach(item => {
      const id = item.getId();
      if (levelIds?.size && !levelIds.has(id)) return;
      // 移动工具下给定的自由点被临时染蓝（toolPlayPage 的 showMovePoints），
      // 这里刷回选定栏色的话，退出探索模式 / 撤销时这些蓝点会莫名变回黑色
      if (typeof givenFreePointColors !== 'undefined' && givenFreePointColors.has(id)) return;
      let color;
      if (levelJudged) {
        if (markSetOf('initial').has(id) || markSetOf('named').has(id)) color = markColors.initial;
        else if (markSetOf('movepoints').has(id)) color = markColors.movepoints;
        else if (levelJudged.has(id)) color = markColors.result;
        else if (markSetOf('explore').has(id)) color = markColors.explore;
      }else{
        // 制题器 / 求解器：由 markDisplayColor 统一决定（含多解的点亮规则）
        color = markDisplayColor(id);
      }
      // 直接改显示色：标记中的对象其 modifyColor 已被改写为记录样式色，这里不经过它
      if (color) GeometryElement.prototype.modifyColor.call(item, color);
    });
  };
  /**
   * 载入快照 过程函数
   * @param {any} snapshot
   */
  window.loadStorageSnapshot = snapshot => {
    const isList = Array.isArray(snapshot);
    const elements = (isList ? snapshot : snapshot?.elements) || [];
    geometryManager.loadStorage(elements);
    // loadStorage 会按当前绘制样式（如自动配色）重新给对象上色，这里按快照还原各自颜色
    const dicts = new Map(elements.map(item => [item.id, item]));
    geometryManager.getAllByOrder().forEach(item => {
      const dict = dicts.get(item.getId());
      if (dict?.color) GeometryElement.prototype.modifyColor.call(item, dict.color);
    });
    if (!isList && snapshot?.lists) {
      Object.entries(snapshot.lists).forEach(([key, value]) => { geometryElementLists[key] = new Set(value); });
      // 快照重建了对象，清理不再处于标记状态的样式记录（含多解）
      const markedIds = allMarkIds();
      [...markedStyles.keys()].forEach(id => {
        if (!markedIds.has(id)) markedStyles.delete(id);
      });
    }
    refreshElementListColors();
    // 快照里的标记对象补上样式色记录，取消标记时才能恢复成红 / 灰
    seedMarkedStyles();
    // 撤销 / 重做会重建对象，工具缓存里指着旧对象的半成品要一起清掉（详见 cancelPendingToolDraw）
    if (typeof tools !== 'undefined' && tools?.[tool] && typeof tools[tool].clear === 'function') tools[tool].clear();
    if (typeof refreshMarks === 'function') refreshMarks();
    if (typeof loadGeometryElements === 'function') loadGeometryElements();
    // 元素一览详情里正看着的对象被重建了：把详情面板整块重画一次（外观、控件状态跟着刷新）
    if (typeof refreshOpenedGeometryItem === 'function') refreshOpenedGeometryItem();
    // 选中被清掉了（快照里不含选定栏），浮动栏的按钮要跟着重新判断可用性：
    // 不刷新的话「调整对象样式」「删除选中对象」「清空选择」还亮着，点了没反应
    if (typeof refreshToolFloating === 'function') refreshToolFloating();
  };
  /**
   * 重置撤销/重做历史 过程函数
   * 以当前状态作为新的历史起点，用于载入关卡/导入 gmt 等「外部基线」之后，
   * 避免撤销把初始图形一并撤掉
   */
  window.resetStorageHistory = (keepMoves = false) => {
    // 普通 / 所求 / 探索三套存储都以当前状态为起点
    [storageManager, typeof storageManagerResult !== 'undefined' ? storageManagerResult : null, typeof storageManagerExplore !== 'undefined' ? storageManagerExplore : null].forEach(manager => {
      if (!manager) return;
      manager.clear();
      manager.append(collectStorageSnapshot());
    });
    // keepMoves：从制题器 / 求解器返回游玩页时用 —— 图形重建后撤销起点要归零，
    // 但已经用掉的 L / E 是玩家挣来的，跟着清零的话勾就白点了
    if (!keepMoves && typeof movesStorageManager !== 'undefined') {
      [movesStorageManager, typeof movesStorageManagerResult !== 'undefined' ? movesStorageManagerResult : null, typeof movesStorageManagerExplore !== 'undefined' ? movesStorageManagerExplore : null].forEach(manager => {
        if (!manager) return;
        manager.clear();
        manager.append({e: 0, l: 0});
      });
    }
    refreshStorageButton();
  };
  /**
   * 按作图顺序逐步记入撤销/重做历史 过程函数
   * 载入关卡（gmt 顺序）、导入 gmt、从游玩页 / 画板带图形进来时都用它：
   * 以「第一个对象」到「完整图形」的每一步作为历史，于是载入之后可以一步步撤回，
   * 而不是只能整体撤到载入前 —— 带进来的图形本身就是一步一步作出来的
   */
  window.resetStorageHistoryInSteps = () => {
    const full = collectStorageSnapshot();
    // 第一档是空画布：否则最后一个对象会撤不掉（它成了历史的起点）
    const emptyLists = {};
    Object.keys(full.lists).forEach(key => { emptyLists[key] = []; });
    const steps = [{elements: [], lists: emptyLists}];
    for (let index = 0; index < full.elements.length; index++) {
      const prefix = full.elements.slice(0, index + 1);
      const ids = new Set(prefix.map(item => item.id));
      const lists = {};
      Object.entries(full.lists).forEach(([key, value]) => { lists[key] = value.filter(id => ids.has(id)); });
      steps.push({elements: prefix, lists: lists});
    }
    // 普通 / 所求 / 探索三套存储都以这些步骤为历史
    [storageManager, typeof storageManagerResult !== 'undefined' ? storageManagerResult : null, typeof storageManagerExplore !== 'undefined' ? storageManagerExplore : null].forEach(manager => {
      if (!manager) return;
      manager.clear();
      steps.forEach(step => manager.append(step));
    });
    if (typeof movesStorageManager !== 'undefined') {
      [movesStorageManager, typeof movesStorageManagerResult !== 'undefined' ? movesStorageManagerResult : null, typeof movesStorageManagerExplore !== 'undefined' ? movesStorageManagerExplore : null].forEach(manager => {
        if (!manager) return;
        manager.clear();
        manager.append({e: 0, l: 0});
      });
    }
    refreshStorageButton();
  };
  if (mode === 'maker' && sessionStorage.getItem('elements')) {
    document.addEventListener('DOMContentLoaded', () => {
      const elements = JSON.parse(sessionStorage.getItem('elements'));
      geometryManager.loadStorage(elements);
      const savedLists = JSON.parse(sessionStorage.getItem('geometryElementLists') || '{}');
      Object.entries(savedLists).forEach(([key, value]) => { geometryElementLists[key] = new Set(value); });
      const record = sessionStorage.getItem('constructRecord');
      // 记录只在「最后一个快照确实就是带进来的这份图形」时才沿用：
      // sessionStorage 里可能残留上一次制题器的记录（别的关卡 / 别的会话），
      // 直接套用会让历史停在别的图形上，第一个撤销就把当前图形退回那张快照。
      // 对不上（或没有记录）时以「刚载入的图形」为历史起点 —— index.js 载入画板时
      // 先 append 过一次，那时画布还是空的，不重置的话第一次撤销就是「图形全没」
      const restoreRecord = () => {
        if (!record) return false;
        try {
          const repository = JSON.parse(record).repository || [];
          const last = repository[repository.length - 1];
          const ids = (last?.elements || []).map(item => item.id).sort().join(',');
          const now = geometryManager.toStorage().map(item => item.id).sort().join(',');
          if (!ids || ids !== now) return false;
        } catch (error) {
          return false;
        }
        storageManager.deserialization(record);
        return true;
      };
      if (!restoreRecord() && typeof resetStorageHistoryInSteps === 'function') resetStorageHistoryInSteps();
      // 带上来的给定 / 所求标记要显示在制题器的标记面板里
      refreshElementListColors();
      // 同时记下这些对象本来的样式色（红 / 灰），否则取消标记后会一直停在黑 / 金
      seedMarkedStyles();
      refreshMarks();
      drawContent();
    }, { once: true });
  }
  if (restoreSolver && sessionStorage.getItem('solverElements')) {
    document.addEventListener('DOMContentLoaded', () => {
      const data = JSON.parse(sessionStorage.getItem('solverElements'));
      Object.entries(data.lists || {}).forEach(([key, value]) => { geometryElementLists[key] = new Set(value); });
      // 与制题器载入走同一条路：按快照重建图形 —— 直接用 loadStorage 的话，
      // 它会按求解器的自动配色把对象重新涂成红 / 灰，游玩时已经显示出来的「所求显示」图形
      // 就莫名变灰了；快照会按带过来的颜色还原，之后再补一次标记色（所求金）
      loadStorageSnapshot(data.elements || []);
      refreshElementListColors();
      seedMarkedStyles();
      drawContent();
      // 带入的图形（含给定 / 所求标记）按顺序成为历史：可以一步步撤回
      if (typeof resetStorageHistoryInSteps === 'function') resetStorageHistoryInSteps();
      refreshMarks();
    }, { once: true });
  }
  const clearMarking = () => {
    marking = null;
    markingTool = null;
    document.querySelectorAll('[data-marking]').forEach(button => button.classList.remove('active'));
    // 退出标记模式：所求相关的图形恢复统统标金
    if (typeof refreshMarkHighlight === 'function') refreshMarkHighlight();
  };
  // 注意：不要在这里挂「点容器就取消标记」的监听 —— #menu_toolbar 与 #container_toolbar
  // 都在 #container_more 里面，那样连 ☰ 菜单 / 撤销 / 各种弹出项都会顺手取消标记，
  // 处于「所求显示」时画布上的金色会突然变回所求判定。切换工具与切换分类各自有监听（见下）。
  // 与工具按钮互斥：选中点、线、圆、移动等工具时取消标记状态
  document.getElementById('container_toolbar')?.addEventListener('click', clearMarking);
  // 标记模式下点击分类按钮：取消标记（分类切换本身会自动选中该栏第一个工具，
  // 见 tool.js 的 toolMenuDefaultValue 与 generateTool）
  document.getElementById('menu_toolbar')?.addEventListener('click', event => {
    if (!marking) return;
    if (!event.target.closest('[data-action]')?.dataset.action?.endsWith('-bar')) return;
    clearMarking();
  });
  const add = (label, action, options = {}) => {
    const { templateId, actionKey } = options;
    const button = document.createElement('button');
    button.className = 'more-button-item board-mode-button';
    // 说明统一由工具栏上方的信息栏（#mobile-information）展示，不再使用浏览器自带的悬停提示
    button.dataset.action = actionKey || label;
    if (templateId) {
      const template = document.getElementById(`svg-${templateId}`);
      if (template) button.innerHTML = template.innerHTML;
    } else {
      button.textContent = label;
    }
    button.setAttribute('aria-label', label);
    button.addEventListener('click', event => {
      // 弹出项（导出 / 求解器 / 清空…）不改动当前标记模式：
      // 在「所求显示」下标着看时点一下菜单按钮，画布上的金色不该跟着变回所求判定
      action(event);
    });
    container.appendChild(button);
    return button;
  };
  const download = (name, content, type) => { const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([content], { type })); link.download = name; link.click(); URL.revokeObjectURL(link.href); };
  /**
   * 交给求解器的图形 过程函数
   * 关卡模式只带 initial 与玩家自己作出的图形：关卡文件里预绘制的解法不算，
   * 否则求解器一打开就已经有答案了；制题器试玩 / 画板则把画布上的图形原样带过去
   * @returns {any[]}
   */
  /**
   * 打开求解器 过程函数
   * 图形照制题器那样整份带过去（含关卡里隐藏 / 预绘制的图形），但**游玩时隐藏的仍然保持隐藏**；
   * 标记只保留「给定（initial）」与「所求判定」——判定取玩家**已经作出的那几组解**
   * （求解器里会把它当所求、并照关卡里那样染成金色），所求显示与探索显示都丢掉，
   * 求解器的标记面板也就只有这两栏
   */
  /**
   * 画布上与某个关卡对象等价的图形 过程函数
   * 关卡文件里的所求判定对象是预绘制（且隐藏）的，玩家作出的是与它等价的另一条线 / 圆；
   * 求解器的所求要用玩家作出的那个，这里按几何相等把它们的 id 找出来
   * @param {string} id 关卡里的对象 id
   * @returns {string[]} 画布上等价的对象 id（排除关卡自带的）
   */
  const equivalentElementIdsOf = id => {
    const target = geometryManager.get(id);
    if (!target) return [];
    const type = target.getType();
    const equative = type === 'point' ? ToolsFunction.pointEquative
      : type === 'line' ? ToolsFunction.lineEquative
      : type === 'circle' ? ToolsFunction.circleEquative : null;
    if (!equative) return [];
    const out = [];
    geometryManager.getAllByOrder().forEach(item => {
      if (item === target || item.getType() !== type) return;
      const itemId = item.getId();
      // 关卡自带的对象不算（可能是另一组解的预绘制图形）
      if (geometryElementLists.level?.has(itemId)) return;
      if (equative(target, item)) out.push(itemId);
    });
    return out;
  };
  const openSolver = () => {
    // 只带「结果」管理器里的图形：关卡本身 + 玩家在普通模式下画的。
    const elements = typeof geometryManagerResult !== 'undefined' ? geometryManagerResult.toStorage()
      : (typeof allCanvasElements === 'function' ? allCanvasElements()
        : (typeof geometryManager === 'undefined' ? [] : geometryManager.toStorage()));
    // 一打开求解器就全冒出来了（「隐藏」档也一并带过去，求解器里还能按隐藏筛选）
    const hiddenIds = new Set();
    elements.forEach(item => { if (item.visible === false) hiddenIds.add(item.id); });
    (geometryElementLists.hidden || []).forEach(id => hiddenIds.add(id));
    // 给定三类（给定 / 带标签给定 / 可移动点）在求解器里合并成同一栏「给定」：
    // 对搜索来说它们都只是「题面给了的对象」，分成三栏反而让人以为条件没取全。
    // 可移动点尤其不能丢 —— 很多关的给定直线就靠它的两个端点当已知点。
    // 隐藏标记相反要丢掉：那些是关卡里预绘制 / 隐藏的图形（往往是解法的中间元素），不是题面条件。
    // 给定＝给定 / 带标签给定；可移动点作为画布上的普通对象一并带过去
    const givenIds = new Set([
      ...(geometryElementLists.initial || []),
      ...(geometryElementLists.named || []),
    ]);
    // 给定图形（给定 / 带标签给定）是题面条件，在求解器里必须看得见：
    // 关卡中它们若被藏起来，带过去也要显示出来
    elements.forEach(item => {
      if (!givenIds.has(item.id)) return;
      item.visible = true;
      hiddenIds.delete(item.id);
    });
    // 可移动点同样要显示出来（关卡里它平时是藏着的，拖到它时才现形），
    // 但不算给定：按普通对象带过去，颜色交给求解器自动配色（自由点红、其余灰）
    const movepointIds = new Set(geometryElementLists.movepoints || []);
    elements.forEach(item => {
      if (!movepointIds.has(item.id) || givenIds.has(item.id)) return;
      item.visible = true;
      hiddenIds.delete(item.id);
      delete item.color;
    });
    // 所求判定：取玩家作出的**第一组**解（satisfiedResultGroups 的元素形如 {judged, shown}，
    // 顺序跟关卡文件里的 result / result2 … 一致），塞进求解器唯一的目标槽位
    // —— 求解器侧只认 geometryElementLists.result，它同时负责两件事：
    // buildSolverRequest 拿它当搜索目标，markDisplayColor 把它染成金色（#ffd700）。
    const judgedIds = new Set();
    const firstGroup = (typeof satisfiedResultGroups !== 'undefined' ? (satisfiedResultGroups || []) : [])[0];
    const firstIds = firstGroup ? ((firstGroup.judged && firstGroup.judged.length) ? firstGroup.judged : (firstGroup.shown || [])) : [];
    // 所求直接用**玩家作出的那个图形**：拿关卡判定对象去画布上找等价对象，找到就换掉，
    // 找不到（判定对象本身就是给定 / 玩家没作出）才退回原 id
    const levelJudgedIds = new Set();
    firstIds.forEach(id => {
      const matched = equivalentElementIdsOf(id);
      if (matched.length) {
        matched.forEach(itemId => judgedIds.add(itemId));
        levelJudgedIds.add(id);
      }else{
        judgedIds.add(id);
      }
    });
    if (!judgedIds.size) resultSetOf(1, 'judged').forEach(id => judgedIds.add(id));
    // 所求显示（result 冒号后的图形）是关卡作出解后的展示，载入求解器时直接隐藏 ——
    // 每一组的都要看（不止作出的那一组）
    const shownIds = new Set();
    resultMarkSets().forEach(({kind, set}) => { if (kind === 'shown') set.forEach(id => shownIds.add(id)); });
    elements.forEach(item => {
      if (!shownIds.has(item.id) || judgedIds.has(item.id)) return;
      // 给定图形（可能同时被列在「所求显示」里，如 ewp14 的 X）属于题面条件，保持显示
      if (givenIds.has(item.id)) return;
      item.visible = false;
      hiddenIds.add(item.id);
    });
    // 探索显示的标记性质也不带过去：恢复默认配色（求解器自动配色：自由点红、其余灰）
    (geometryElementLists.explore || []).forEach(id => {
      if (judgedIds.has(id) || givenIds.has(id)) return;
      const item = elements.find(element => element.id === id);
      if (item) delete item.color;
    });
    // 可见性：玩家作出的所求要看得见；被换掉的那几个关卡预绘制判定对象隐藏起来，
    // 免得它们与玩家作出的图形叠在一起把金色盖住
    elements.forEach(item => {
      if (judgedIds.has(item.id)) {
        item.visible = true;
        hiddenIds.delete(item.id);
      }
      if (levelJudgedIds.has(item.id)) {
        item.visible = false;
        hiddenIds.add(item.id);
      }
    });
    const lists = {
      initial: [...givenIds],
      result: [...judgedIds],
      name: [], named: [], movepoints: [], hidden: [...hiddenIds], resultShown: [], explore: [],
    };
    // 其余选定栏（关卡带过来的 result2 / resultShown2 / explore…）统统清空：
    // 求解器里只认「给定」与「所求」两种标记，别的标记性质不能跟着进来
    Object.keys(geometryElementLists).forEach(key => { if (!(key in lists)) lists[key] = []; });
    sessionStorage.setItem('solverElements', JSON.stringify({elements: elements, lists: lists}));
    // from：求解器的「返回」据此回到本页并还原图形（关卡游玩 / 试玩由 savePlayBackup 存备份）
    const from = typeof savePlayBackup === 'function' ? savePlayBackup() : '';
    // 本关限定了工具（单尺 / 单规）时，把对应的求解器模式一起带过去：
    // 求解器面板的「可用工具」默认就选到同一种（2 尺规 / 1 单尺 / 0 单规）
    const levelTool = typeof window.levelTools === 'string' ? window.levelTools : '';
    const solverTool = levelTool === 'straightedge' ? '1' : levelTool === 'compass' ? '0' : '';
    location.href = './board.html?mode=solver&restore=1'
      + (solverTool ? '&solverTool=' + solverTool : '')
      + (from ? '&from=' + encodeURIComponent(from) : '');
  };
  /**
   * 能否打开求解器 过程函数
   * 关卡游玩要先作出至少一个解，否则求解器里只有 initial 与关卡预绘制的对象
   * @returns {boolean}
   */
  const solverAvailable = () => {
    if (mode !== 'level') return true;
    return typeof satisfiedResultGroups !== 'undefined' && satisfiedResultGroups.length > 0;
  };

  // 弹层菜单：点击按钮展开，再次点击或点击别处收起
  const closePopups = () => document.querySelectorAll('.board-popup.open').forEach(menu => menu.classList.remove('open'));
  const openPopup = (menu, button) => {
    menu.style.visibility = 'hidden';
    menu.classList.add('open');
    const rect = button.getBoundingClientRect();
    const box = menu.getBoundingClientRect();
    const maxLeft = Math.max(8, window.innerWidth - box.width - 8);
    menu.style.left = `${Math.max(8, Math.min(rect.left, maxLeft))}px`;
    menu.style.top = `${rect.bottom + 8}px`;
    menu.style.visibility = 'visible';
  };
  const popupButton = (label, options) => {
    const { templateId, actionKey, items } = options;
    const menu = document.createElement('div');
    menu.className = 'board-popup';
    // 展开时重新判断每一项是否可用（如「打开求解器」要看画板上有没有作出解）
    const syncItems = [];
    const button = add(label, () => {
      const open = !menu.classList.contains('open');
      closePopups();
      if (open) {
        syncItems.forEach(sync => sync());
        openPopup(menu, button);
      }
    }, { templateId, actionKey });
    items.forEach(item => {
      const element = document.createElement('button');
      element.type = 'button';
      element.className = 'popup-item';
      element.dataset.action = item.actionKey;
      element.setAttribute('aria-label', item.label);
      const template = document.getElementById(`svg-${item.templateId}`);
      if (template) element.innerHTML = template.innerHTML;
      const text = document.createElement('span');
      text.textContent = item.label;
      element.appendChild(text);
      if (item.available) syncItems.push(() => element.classList.toggle('disable', !item.available()));
      element.addEventListener('click', () => {
        if (element.classList.contains('disable')) {
          // 不可用时从顶部提示一下原因，不用点确认
          closePopups();
          toast(item.disabledHint || t('board.unavailable'));
          return;
        }
        closePopups();
        item.action();
      });
      menu.appendChild(element);
    });
    document.body.appendChild(menu);
    return button;
  };
  /**
   * 确认框 过程函数
   * @param {string} title 标题（问句）
   * @param {string} message 补充说明
   * @param {Function} onConfirm 点「确定」后执行
   */
  const confirmDialog = (title, message, onConfirm) => {
    const mask = document.createElement('div');
    mask.className = 'board-dialog-mask';
    mask.innerHTML = '<div class="board-dialog board-dialog-confirm"><strong></strong><p class="board-dialog-hint"></p><div class="board-dialog-actions"></div></div>';
    mask.querySelector('strong').textContent = title;
    mask.querySelector('.board-dialog-hint').textContent = message || '';
    const actions = mask.querySelector('.board-dialog-actions');
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.textContent = t('common.cancel');
    cancelButton.addEventListener('click', () => mask.remove());
    const confirmButton = document.createElement('button');
    confirmButton.type = 'button';
    confirmButton.textContent = t('common.confirm');
    confirmButton.addEventListener('click', () => { mask.remove(); onConfirm(); });
    actions.appendChild(cancelButton);
    actions.appendChild(confirmButton);
    mask.addEventListener('click', event => { if (event.target === mask) mask.remove(); });
    document.body.appendChild(mask);
    return mask;
  };
  /**
   * 提示框 过程函数
   * 只有一句说明与一个「确定」，用于解释「当前不可用」这类情况
   * @param {string} title 说明文字
   * @param {string} [message] 补充说明
   */
  const messageDialog = (title, message) => {
    const mask = document.createElement('div');
    mask.className = 'board-dialog-mask';
    mask.innerHTML = '<div class="board-dialog board-dialog-confirm"><strong></strong><p class="board-dialog-hint"></p><div class="board-dialog-actions"></div></div>';
    mask.querySelector('strong').textContent = title;
    mask.querySelector('.board-dialog-hint').textContent = message || '';
    const actions = mask.querySelector('.board-dialog-actions');
    const confirmButton = document.createElement('button');
    confirmButton.type = 'button';
    confirmButton.textContent = t('common.confirm');
    confirmButton.addEventListener('click', () => mask.remove());
    actions.appendChild(confirmButton);
    mask.addEventListener('click', event => { if (event.target === mask) mask.remove(); });
    document.body.appendChild(mask);
    return mask;
  };
  /**
   * 顶部提示条 过程函数
   * 用于「当前不可用」这类看一眼就够的说明，不用点确认
   * @param {string} message
   */
  let toastTimer = null;
  const toast = message => {
    const previous = document.querySelector('.board-toast');
    if (previous) previous.remove();
    const element = document.createElement('div');
    element.className = 'board-toast';
    element.textContent = message;
    document.body.appendChild(element);
    // 重新播放滑入动画
    void element.offsetWidth;
    element.classList.add('trans');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      // 先播收回动画，动画结束再移除
      element.classList.remove('trans');
      setTimeout(() => element.remove(), 400);
    }, 2600);
  };
  // 供其他脚本复用同一条提示（例如工具包拦截「删除给定图形」时）
  window.boardToast = toast;
  /**
   * 输入框 过程函数
   * 内部样式的单行输入，替代浏览器自带的 prompt
   * @param {string} title
   * @param {string} message 说明文字
   * @param {string} value 初始值
   * @param {(value: string) => void} onSubmit 点「确定」后执行
   * @param {{valid?: (value: string) => boolean, onCancel?: () => void}} [options] valid 返回 false 时「确定」按不动（如非数字）；onCancel 在点「取消」/ 点遮罩关窗时执行
   */
  const inputDialog = (title, message, value, onSubmit, options = {}) => {
    const mask = document.createElement('div');
    mask.className = 'board-dialog-mask';
    mask.innerHTML = '<div class="board-dialog board-dialog-confirm"><strong></strong><p class="board-dialog-hint"></p><input class="board-dialog-input" type="text" spellcheck="false"><div class="board-dialog-actions"></div></div>';
    mask.querySelector('strong').textContent = title;
    mask.querySelector('.board-dialog-hint').textContent = message || '';
    const input = mask.querySelector('.board-dialog-input');
    input.value = value || '';
    const actions = mask.querySelector('.board-dialog-actions');
    // 记下有没有点过「确定」：取消（取消按钮 / 点遮罩关窗）时通知调用方收尾
    // （例如定值角输角度时点取消，要把这次作图作废）
    let submitted = false;
    const close = () => {
      mask.remove();
      if (!submitted && typeof options.onCancel === 'function') options.onCancel();
    };
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.textContent = t('common.cancel');
    cancelButton.addEventListener('click', close);
    const confirmButton = document.createElement('button');
    confirmButton.type = 'button';
    confirmButton.textContent = t('common.confirm');
    // 传了 valid 就按它实时开关「确定」：内容非法（空 / 非数字）时按钮点不动
    const valid = typeof options.valid === 'function' ? options.valid : null;
    const refreshConfirm = () => {
      if (!valid) return;
      confirmButton.disabled = !valid(input.value);
    };
    confirmButton.addEventListener('click', () => {
      if (valid && !valid(input.value)) return;
      submitted = true;
      const text = input.value;
      close();
      onSubmit(text);
    });
    if (valid) input.addEventListener('input', refreshConfirm);
    refreshConfirm();
    actions.appendChild(cancelButton);
    actions.appendChild(confirmButton);
    // 输入框可能在画布 mousedown 里弹出，正在进行的这次点击会落到遮罩上把窗口关掉，
    // 所以刚弹出的一小段时间里忽略遮罩点击
    const openedAt = Date.now();
    mask.addEventListener('click', event => {
      if (event.target === mask && Date.now() - openedAt > 250) close();
    });
    input.addEventListener('keydown', event => { if (event.key === 'Enter') confirmButton.click(); });
    document.body.appendChild(mask);
    input.focus();
    input.select();
    return mask;
  };
  // 其他页面的脚本（index.js / playPage.js）复用同一套弹层
  window.boardToast = toast;
  window.boardConfirm = confirmDialog;
  window.boardMessage = messageDialog;
  window.boardInput = inputDialog;
  // 答案图：写在 data/levels.json 的 solutions 字段里（图片在 data/answers/ 下），首次需要时才加载
  let solutionsById = null;
  const loadSolutionsData = () => {
    if (solutionsById) return Promise.resolve(solutionsById);
    return loadLevelsData()
      .then(({levels}) => {
        const map = new Map();
        levels.forEach(level => { if (level.solutions?.length) map.set(level.id, level.solutions); });
        solutionsById = map;
        return map;
      })
      .catch(() => { solutionsById = new Map(); return solutionsById; });
  };
  /**
   * 本关有没有收录答案图 过程函数
   * 数据还没加载完时先当作有，避免菜单项一闪变灰
   * @returns {boolean}
   */
  const levelHasAnswer = () => {
    if (!solutionsById) return true;
    return solutionsById.has(params.get('id') || '');
  };
  /**
   * 答案图窗口 过程函数
   * @param {Array<{file: string, star: string}>} images
   */
  const answerDialog = images => {
    const mask = document.createElement('div');
    mask.className = 'board-dialog-mask';
    const box = document.createElement('div');
    box.className = 'board-dialog answer-dialog';
    const title = document.createElement('strong');
    title.textContent = t('board.answerTitle');
    box.appendChild(title);
    if (!images.length) {
      const empty = document.createElement('p');
      empty.className = 'board-dialog-hint';
      empty.textContent = t('board.answerEmpty');
      box.appendChild(empty);
    }else{
      const gallery = document.createElement('div');
      gallery.className = 'answer-gallery';
      images.forEach(image => {
        const figure = document.createElement('figure');
        figure.className = 'answer-figure';
        const picture = document.createElement('img');
        picture.src = `../data/${image.file}`;
        picture.alt = image.star || t('board.answerTitle');
        picture.loading = 'lazy';
        picture.addEventListener('click', () => figure.classList.toggle('zoom'));
        const caption = document.createElement('figcaption');
        caption.textContent = image.star || '';
        figure.appendChild(picture);
        figure.appendChild(caption);
        gallery.appendChild(figure);
      });
      box.appendChild(gallery);
      const hint = document.createElement('p');
      hint.className = 'board-dialog-hint';
      hint.textContent = t('board.answerHint');
      box.appendChild(hint);
    }
    const actions = document.createElement('div');
    actions.className = 'board-dialog-actions';
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.textContent = t('common.close');
    closeButton.addEventListener('click', () => mask.remove());
    actions.appendChild(closeButton);
    box.appendChild(actions);
    mask.appendChild(box);
    mask.addEventListener('click', event => { if (event.target === mask) mask.remove(); });
    document.body.appendChild(mask);
    return mask;
  };
  /** 查看答案 过程函数 */
  const showAnswer = () => {
    const levelId = params.get('id') || '';
    confirmDialog(t('board.answerAsk'), t('board.answerWarn'), () => {
      loadSolutionsData().then(map => answerDialog(map.get(levelId) || []));
    });
  };
  /**
   * 帮助 过程函数
   * 四个工作区各给一段用法说明
   */
  const helpDialog = () => {
    const key = {level: 'help.level', maker: 'help.maker', solver: 'help.solver', normal: 'help.board', 'maker-play': 'help.makerPlay'}[mode] || 'help.board';
    const mask = document.createElement('div');
    mask.className = 'board-dialog-mask';
    mask.innerHTML = '<div class="board-dialog help-dialog"><strong></strong><div class="help-body"></div><div class="board-dialog-actions"></div></div>';
    mask.querySelector('strong').textContent = t('help.title');
    const body = mask.querySelector('.help-body');
    // 一行帮助文本：可以写 [文字](链接)（和 README 同一套写法），单独的网址也会自动变链接，其余是纯文本
    const linkPattern = /\[([^\]]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s，。；、）)]+)/g;
    t(key).split('\n').forEach(line => {
      const paragraph = document.createElement('p');
      let last = 0;
      let match;
      linkPattern.lastIndex = 0;
      while ((match = linkPattern.exec(line)) !== null) {
        if (match.index > last) paragraph.appendChild(document.createTextNode(line.slice(last, match.index)));
        const link = document.createElement('a');
        link.href = match[2] || match[3];
        link.target = '_blank';
        link.rel = 'noreferrer';
        link.textContent = match[1] || match[3];
        paragraph.appendChild(link);
        last = match.index + match[0].length;
      }
      if (last < line.length) paragraph.appendChild(document.createTextNode(line.slice(last)));
      body.appendChild(paragraph);
    });
    const actions = mask.querySelector('.board-dialog-actions');
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.textContent = t('common.close');
    closeButton.addEventListener('click', () => mask.remove());
    actions.appendChild(closeButton);
    mask.addEventListener('click', event => { if (event.target === mask) mask.remove(); });
    document.body.appendChild(mask);
    return mask;
  };
  document.addEventListener('click', event => {
    if (!event.target.closest('#container_more') && !event.target.closest('.board-popup')) closePopups();
  });

  // gmt 代码窗口：只读查看 / 可编辑导入
  const codeDialog = (title, value, onSubmit) => {
    const mask = document.createElement('div');
    mask.className = 'board-dialog-mask';
    mask.innerHTML = '<div class="board-dialog"><strong></strong><textarea class="board-dialog-code" spellcheck="false"></textarea><p class="board-dialog-hint"></p><div class="board-dialog-actions"></div></div>';
    const area = mask.querySelector('.board-dialog-code');
    const hint = mask.querySelector('.board-dialog-hint');
    const actions = mask.querySelector('.board-dialog-actions');
    mask.querySelector('.board-dialog strong').textContent = title;
    area.value = value;
    area.readOnly = !onSubmit;
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.textContent = t('common.close');
    closeButton.addEventListener('click', () => mask.remove());
    actions.appendChild(closeButton);
    if (onSubmit) {
      const confirmButton = document.createElement('button');
      confirmButton.type = 'button';
      confirmButton.textContent = t('common.import');
      confirmButton.addEventListener('click', () => { if (onSubmit(area.value)) mask.remove(); else hint.textContent = t('board.gmtImportFailed'); });
      actions.appendChild(confirmButton);
    }
    mask.addEventListener('click', event => { if (event.target === mask) mask.remove(); });
    document.body.appendChild(mask);
    return mask;
  };

  // gmt 文本：几何对象序列化 / 解析
  // 坐标写 gmt 时保留到小数点后 10 位再去掉多余的 0，既不会丢原关卡里的长小数，也不会写成 -120.000000
  const gmtNumber = value => String(Number(Number(value).toFixed(10)));
  /**
   * 对象 → 一条 gmt 作图指令 过程函数
   * 与 parseGmt 的指令表一一对应（读取怎么认、导出就怎么写），认不出的才写成注释
   * @param {Object} item 几何对象
   * @returns {string} gmt 行
   */
  const gmtLineOf = item => {
    const id = item.getId();
    const dict = item.getDict();
    const base = dict.base || {};
    const args = (base.basesId || []).slice();
    const value = base.value === undefined ? 0 : base.value;
    const coord = typeof item.getCoordinate === 'function' ? item.getCoordinate() : null;
    if (item.getType() === 'point') {
      switch (base.type) {
        case 'none': {
          const [x, y] = Array.isArray(coord) ? coord : [item.x, item.y];
          return `${id}=[${gmtNumber(x)},${gmtNumber(y)}]`;
        }
        case 'intersection': {
          // 第四个参数是「已知的那个交点」，导出时一并写回去
          const exclude = base.excludeId ? `,${base.excludeId}` : '';
          return `${id}=Intersect[${args[0]},${args[1]},${value}${exclude}]`;
        }
        case 'online': return `${id}=Linepoint[${args[0]},${value}]`;
        case 'middlePoint': return `${id}=Midpoint[${args[0]},${args[1]}]`;
        case 'center': return `${id}=CenterPoint[${args[0]}]`;
        case 'edgePoint': return `${id}=EdgePoint[${args[0]},${value}]`;
        case 'polarPoint': return `${id}=PolarPoint[${args[0]},${args[1]}]`;
        default: return `# 无法导出：${id}（${base.type || 'none'}）`;
      }
    }
    if (item.getType() === 'circle') {
      switch (base.type) {
        case 'twoPoints': return `${id}=Circle[${args[0]},${args[1]}]`;
        case 'compass': return `${id}=Compass[${args[0]},${args[1]},${args[2]}]`;
        case 'threePointCircle': return `${id}=Circle3[${args[0]},${args[1]},${args[2]}]`;
        default: return `# 无法导出：${id}（${base.type || 'none'}）`;
      }
    }
    if (item.getType() === 'line') {
      const draw = dict.drawType === 'lineSegment' ? 'Segment' : dict.drawType === 'ray' ? 'Ray' : 'Line';
      switch (base.type) {
        case 'twoPoints': return `${id}=${draw}[${args[0]},${args[1]}]`;
        case 'perpendicular': return `${id}=Perp[${args[0]},${args[1]}]`;
        case 'parallel': return `${id}=Parallel[${args[0]},${args[1]}]`;
        case 'perpendicularBisector': return `${id}=PBisect[${args[0]},${args[1]}]`;
        case 'threePointAngleBisector': return `${id}=ABisect[${args[0]},${args[1]},${args[2]}]`;
        // 两线角平分线（画板工具能画）在 gmt 里没有对应写法：ggb 的 ABisect[线,线] 不算，导出时只能标注
        case 'twoLineAngleBisector': return `# 无法导出：${id}（两线角平分线，gmt 无此语法）`;
        case 'tangent': return `${id}=Tangent[${args[0]},${args[1]},${value}]`;
        case 'polarLine': return `${id}=PolarLine[${args[0]},${args[1]}]`;
        case 'copyAngle': return `${id}=CopyAngle[${args.slice(0, 5).join(',')}]`;
        case 'fixAngle': return `${id}=FixAngle[${args[0]},${args[1]},${value}]`;
        default: return `# 无法导出：${id}（${base.type || 'none'}）`;
      }
    }
    return `# 无法导出：${id}（${item.getType()}）`;
  };
  const gmtText = () => {
    const content = [];
    geometryManager.getAllByOrder().forEach(item => { content.push(gmtLineOf(item)); });
    // named：带标签的对象，标签名与对象 ID 不同时写成「ID.标签名」
    const named = geometryManager.getAllByOrder().filter(item => item.getShowName()).map(item => {
      const name = item.getName();
      return name && name !== item.getId() ? `${item.getId()}.${name}` : item.getId();
    });
    // 设定行：无论有没有标记都写出来，没有标记的留空，方便对照与手动编辑
    const listOf = key => [...(geometryElementLists?.[key] || [])];
    content.push('', `initial=${listOf('initial').join(',')}`);
    content.push(`named=${named.join(',')}`);
    content.push(`movepoints=${listOf('movepoints').join(',')}`);
    content.push(`hidden=${listOf('hidden').join(',')}`);
    // 所求：每个解写一行（一行一组「判定:显示」，没写显示对象时只判定），
    // 空的解也留一行空行，保证第几行就是第几个解
    for (let index = 1; index <= resultGroupCount(); index++) {
      const judged = [...resultSetOf(index, 'judged')];
      const shown = [...resultSetOf(index, 'shown')];
      content.push(`result=${judged.join(',')}${shown.length ? ':' + shown.join(',') : ''}`);
    }
    content.push(`explore=${listOf('explore').join(',')}`);
    return ['# Geommunity Blueprint custom level', ...content].join('\n');
  };
  /**
   * gmt 解析 过程函数
   * 把 gmt（原版游戏关卡预绘制文件）的作图指令翻译成画板几何对象
   * 语法参考 ggb2gmt/strucmmar.md：
   *   [x,y] / Line[A,B] / Segment[A,B] / Ray[A,B] / Circle[A,B] / Compass[A,B,C] /
   *   Circle3[A,B,C] / Intersect[对象1,对象2,x] / Linepoint[对象,x] / Midpoint[A,B] /
   *   Perp[A,s] / Parallel[A,s] / PBisect[A,B] / ABisect[A,B,C] / CenterPoint[c]
   * 设定行：initial / named / hidden / movepoints / result / explore
   * 暂不支持：EdgePoint / Tangent / PolarLine / PolarPoint / FixAngle / CopyAngle / ShiftSeg
   * 以及 rules（限制条件）与 ABisect[两线]，遇到时连同依赖它的对象一并丢弃
   * @param {string} text
   * @returns {{elements: Object[], lists: Object}}
   */
  window.parseGmt = text => {
    const declarations = new Map();
    const lists = {initial: [], named: [], hidden: [], movepoints: [], result: [], resultShown: [], explore: []};
    // named=A.M 里 M 是要显示出来的标签名
    const namedLabels = new Map();
    // result 可以有多条（多解），每条各自记录：判定对象 + 判定成功后要显示的图形
    const resultGroups = [];
    // 指令名大小写不敏感（gmt 里 CenterPoint / Centerpoint 都出现过）
    const directiveNames = {
      point: 'Point', line: 'Line', segment: 'Segment', ray: 'Ray', circle: 'Circle', compass: 'Compass',
      circle3: 'Circle3', intersect: 'Intersect', linepoint: 'Linepoint', midpoint: 'Midpoint',
      perp: 'Perp', parallel: 'Parallel', bisect: 'PBisect', pbisect: 'PBisect', abisect: 'ABisect',
      centerpoint: 'CenterPoint', fixangle: 'FixAngle', tangent: 'Tangent', polarline: 'PolarLine',
      copyangle: 'CopyAngle', edgepoint: 'EdgePoint', polarpoint: 'PolarPoint',
    };
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      // 「#」在行首表示整行注释
      if (!line || line.startsWith('#')) continue;
      // 行尾注释同样去掉；rules 行里的 “#” 是「两者必须相交」，不能截断
      const content = line.startsWith('rules') ? line : line.split('#')[0].trim();
      if (!content) continue;
      const match = content.match(/^([A-Za-z_]\w*)\s*=\s*(.+?)\s*$/);
      if (!match) continue;
      const key = match[1];
      const value = match[2];
      if (key === 'result') {
        // result=判定对象:显示对象：冒号前用于判定是否作出，冒号后是判定成功后要显示的图形；
        // **没写冒号时判定对象本身就是显示对象**（关卡的「所求显示」就是它），所以两栏都记上，
        // 否则这类关卡在制题器里用「所求显示」看会是空的。多条表示多解，逐条记录
        const [judgedPart, shownPart] = value.split(':');
        const judged = judgedPart.split(',').map(item => item.trim()).filter(Boolean);
        const shown = shownPart === undefined
          ? judged.slice()
          : shownPart.split(',').map(item => item.trim()).filter(Boolean);
        // 之后的解落到 result2 / resultShown2、result3 / resultShown3 …
        const solution = resultGroups.length + 1;
        const judgedKey = solution <= 1 ? 'result' : `result${solution}`;
        const shownKey = solution <= 1 ? 'resultShown' : `resultShown${solution}`;
        if (!lists[judgedKey]) lists[judgedKey] = [];
        if (!lists[shownKey]) lists[shownKey] = [];
        lists[judgedKey].push(...judged);
        lists[shownKey].push(...shown);
        resultGroups.push({judged: judged, shown: shown});
        continue;
      }
      if (key === 'named') {
        // named=A.M：A 是作图过程中的变量名（对象 ID），M 是要显示出来的标签名；
        // 只写一个名字（named=A）时标签就取这个名字
        value.split(',').map(item => item.trim()).filter(Boolean).forEach(item => {
          const [idPart, labelPart] = item.split('.');
          const id = (idPart || '').trim();
          if (!id) return;
          lists.named.push(id);
          if (labelPart && labelPart.trim()) namedLabels.set(id, labelPart.trim());
        });
        continue;
      }
      if (Object.keys(lists).includes(key)) {
        lists[key].push(...value.split(',').map(item => item.trim()).filter(Boolean));
        continue;
      }
      if (key === 'rules' || key === 'ver' || key === 'check_level') continue;
      const call = value.match(/^([A-Za-z]\w*)\s*\[(.*)\]$/);
      if (call) {
        declarations.set(key, {name: directiveNames[call[1].toLowerCase()] || call[1], args: call[2].split(',').map(item => item.trim())});
      }else{
        declarations.set(key, {name: 'Point', args: [value]});
      }
    }

    const elements = [];
    const built = new Map();
    const building = new Set();

    const build = id => {
      if (built.has(id)) return built.get(id);
      const declaration = declarations.get(id);
      // 未声明或存在循环依赖
      if (!declaration || building.has(id)) return null;
      building.add(id);
      const dict = createElement(id, declaration);
      building.delete(id);
      if (!dict) return null;
      built.set(id, dict);
      elements.push(dict);
      return dict;
    };
    const reference = id => (build(id) ? id : null);
    // 若干基底：任一缺失则整个指令不可用
    const basesOf = (args, count) => {
      const ids = args.slice(0, count).map(item => reference(item));
      return ids.length < count || ids.includes(null) ? null : ids;
    };
    // 两个点：也允许写线段（取线段定义的两个端点）
    const pointPairOf = args => {
      const ids = args.slice(0, 2).map(item => reference(item));
      if (ids[0] && ids[1]) return ids;
      const dict = ids[0] ? built.get(ids[0]) : null;
      if (dict?.type === 'line' && dict.base.type === 'twoPoints') return dict.base.basesId.slice(0, 2);
      return null;
    };
    const numberOf = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);

    const createElement = (id, declaration) => {
      const {name, args} = declaration;
      const baseDict = {id: id, name: id, showName: false, superstructureId: [], visible: true, valid: true, color: '#191919', width: 1};
      switch (name) {
        case 'Point': {
          const coord = args[0]?.match(/^\[\s*([-\d.eE+]+)\s*,\s*([-\d.eE+]+)\s*\]$/);
          if (!coord) return null;
          return {...baseDict, type: 'point', x: Number(coord[1]), y: Number(coord[2]), base: {type: 'none', basesId: [], value: 0}};
        }
        case 'Line':
        case 'Segment':
        case 'Ray': {
          const basesId = basesOf(args, 2);
          if (!basesId) return null;
          const drawType = name === 'Segment' ? 'lineSegment' : name === 'Ray' ? 'ray' : 'line';
          return {...baseDict, type: 'line', drawType: drawType, base: {type: 'twoPoints', basesId: basesId, value: 0}};
        }
        case 'Circle': {
          const basesId = basesOf(args, 2);
          if (!basesId) return null;
          return {...baseDict, type: 'circle', base: {type: 'twoPoints', basesId: basesId, value: 0}};
        }
        case 'Compass': {
          // Compass[A,B,C]：以 C 为圆心、AB 为半径
          const basesId = basesOf(args, 3);
          if (!basesId) return null;
          return {...baseDict, type: 'circle', base: {type: 'compass', basesId: basesId, value: 0}};
        }
        case 'Circle3': {
          const basesId = basesOf(args, 3);
          if (!basesId) return null;
          return {...baseDict, type: 'circle', base: {type: 'threePointCircle', basesId: basesId, value: 0}};
        }
        case 'Intersect': {
          const basesId = basesOf(args, 2);
          if (!basesId) return null;
          // 第三个参数（x）就是交点的编号：线圆按线方向、圆圆按连心线逆时针；
          // 第四个参数是「已知的那个交点」，编号时先把它排除（可省略或写 -）
          const exclude = String(args[3] ?? '').trim();
          const excludeId = exclude && exclude !== '-' ? reference(exclude) : null;
          const base = {type: 'intersection', basesId: basesId, value: numberOf(args[2])};
          if (excludeId) {
            base.excludeId = excludeId;
            base.exclude = built.get(excludeId) || null;
          }
          return {...baseDict, type: 'point', x: 0, y: 0, base: base};
        }
        case 'Linepoint': {
          const base = reference(args[0]);
          if (!base) return null;
          return {...baseDict, type: 'point', x: 0, y: 0, base: {type: 'online', basesId: [base], value: numberOf(args[1])}};
        }
        case 'EdgePoint': {
          // EdgePoint[s,x]：线 s 上负方向（x=0）/ 正方向（x=1）的无穷远点（假想的点）
          // 画板里没有「无穷远点」这种对象，用一个很远处的位置代替：方向完全准确，
          // Line[A,E] 就是过 A 的平行线、CopyAngle 里它能当一条边的方向，位置远到不会出现在视野里，
          // 这个点本身在 parseGmt 末尾会被强制设为不显示
          const line = reference(args[0]);
          if (!line) return null;
          return {...baseDict, type: 'point', x: 0, y: 0, edgePoint: true, base: {type: 'edgePoint', basesId: [line], value: numberOf(args[1])}};
        }
        case 'PolarPoint': {
          // PolarPoint[s,c]：线 s 关于圆 c 的极点
          const line = reference(args[0]);
          const circle = reference(args[1]);
          if (!line || !circle) return null;
          return {...baseDict, type: 'point', x: 0, y: 0, base: {type: 'polarPoint', basesId: [line, circle], value: 0}};
        }
        case 'Midpoint': {
          const basesId = pointPairOf(args);
          if (!basesId) return null;
          return {...baseDict, type: 'point', x: 0, y: 0, base: {type: 'middlePoint', basesId: basesId, value: 0}};
        }
        case 'CenterPoint': {
          const base = reference(args[0]);
          if (!base) return null;
          return {...baseDict, type: 'point', x: 0, y: 0, base: {type: 'center', basesId: [base], value: 0}};
        }
        case 'Perp': {
          const point = reference(args[0]);
          const line = reference(args[1]);
          if (!point || !line) return null;
          return {...baseDict, type: 'line', drawType: 'line', base: {type: 'perpendicular', basesId: [point, line], value: 0}};
        }
        case 'Parallel': {
          const point = reference(args[0]);
          const line = reference(args[1]);
          if (!point || !line) return null;
          return {...baseDict, type: 'line', drawType: 'line', base: {type: 'parallel', basesId: [point, line], value: 0}};
        }
        case 'PBisect': {
          const basesId = pointPairOf(args);
          if (!basesId) return null;
          return {...baseDict, type: 'line', drawType: 'line', base: {type: 'perpendicularBisector', basesId: basesId, value: 0}};
        }
        case 'ABisect': {
          // ABisect[A,B,C]：B 为角的顶点（gmt 只有三点这一种，两线的是 ggb 的用法，这边不认）
          const basesId = basesOf(args, 3);
          if (!basesId) return null;
          return {...baseDict, type: 'line', drawType: 'line', base: {type: 'threePointAngleBisector', basesId: basesId, value: 0}};
        }
        case 'Tangent': {
          // Tangent[A,c]（过点的切线）或 Tangent[l,c]（与线平行的切线），value 选择两条中的哪一条
          const target = reference(args[0]);
          const circle = reference(args[1]);
          if (!target || !circle) return null;
          return {...baseDict, type: 'line', drawType: 'line', base: {type: 'tangent', basesId: [target, circle], value: numberOf(args[2])}};
        }
        case 'PolarLine': {
          const point = reference(args[0]);
          const circle = reference(args[1]);
          if (!point || !circle) return null;
          return {...baseDict, type: 'line', drawType: 'line', base: {type: 'polarLine', basesId: [point, circle], value: 0}};
        }
        case 'CopyAngle': {
          // CopyAngle[A,B,C,D,E]：以 E 为顶点、D 为始边上一点，复制角 ABC 作射线
          const ids = args.slice(0, 5).map(item => reference(item));
          if (ids.length < 5 || ids.includes(null)) return null;
          return {...baseDict, type: 'line', drawType: 'ray', base: {type: 'copyAngle', basesId: ids, value: 0}};
        }
        case 'FixAngle': {
          // FixAngle[A,B,x]：以 A 为顶点、AB 为始边逆时针转过 x 度的射线
          const point = reference(args[0]);
          const start = reference(args[1]);
          if (!point || !start) return null;
          return {...baseDict, type: 'line', drawType: 'ray', base: {type: 'fixAngle', basesId: [point, start], value: numberOf(args[2])}};
        }
        default:
          return null;
      }
    };

    // 按文件顺序构建，依赖先于自身
    declarations.forEach((declaration, id) => build(id));

    const ids = new Set(elements.map(item => item.id));
    // 无穷远点（EdgePoint）：只在作图里提供方向，不进 initial / named，也不显示（见下）
    const edgePointIds = new Set(elements.filter(item => item.base?.type === 'edgePoint').map(item => item.id));
    // 设定行里会出现 "A.M" 这种写法（点与对象的组合，多用于 named/rules），
    // 取其中在本文件里确实存在的那个；两个都不存在就丢掉
    const normalizeId = value => {
      if (ids.has(value)) return value;
      const parts = String(value).split('.').map(item => item.trim()).filter(Boolean);
      return parts.find(part => ids.has(part)) || null;
    };
    const keep = list => [...new Set(list)].map(normalizeId).filter(Boolean);
    // 设定栏原样保留：多解会在 lists 里多出 result2 / resultShown2 … 这些键，
    const result = {};
    Object.entries(lists).forEach(([key, value]) => { result[key] = keep(value); });
    ['initial', 'named'].forEach(key => { result[key] = (result[key] || []).filter(id => !edgePointIds.has(id)); });
    // 初始显示的是 initial 与 named（带标签的初始条件），其余（预绘制出的解）先隐藏；
    // 可移动点不在这里显示，由 showMovePoints 在移动工具下临时显示
    const namedIds = new Set(lists.named.filter(id => ids.has(id)));
    const visibleIds = new Set([...result.initial, ...namedIds]);
    elements.forEach(item => {
      item.visible = visibleIds.has(item.id);
      // 无穷远点（EdgePoint）是假想的点，只在作图里提供方向，任何时候都不画出来
      if (item.edgePoint) item.visible = false;
      // 只有 named 的对象显示标签：initial 的对象只显示图形
      item.showName = namedIds.has(item.id);
      // named=A.M 时把显示名换成 M（对象 ID 仍是 A）
      const label = namedLabels.get(item.id);
      if (label) item.name = label;
    });
    // name 集合表示「显示标签的对象」（画板既有的选定栏命名）
    result.name = elements.filter(item => item.showName).map(item => item.id);

    // 判定分组：过滤掉引用了缺失对象的判定项。
    // 判定为空、只有「所求显示」的组（result=:S1,H 这种）也要留下，
    // 否则这一组的冒号后图形永远不显示
    const groups = resultGroups
      .map(group => ({judged: keep(group.judged), shown: keep(group.shown)}))
      .filter(group => group.judged.length || group.shown.length);

    return {elements: elements, lists: result, resultGroups: groups};
  };
  const loadGmt = text => {
    const { elements, lists } = parseGmt(text);
    if (!elements.length) return false;
    // 画板里所有对象都要可见：关卡中「预绘制出的解」在制作时也要能看到
    // 无穷远点（EdgePoint）除外：它是假想的点、坐标在很远处，画出来会让画布糊掉一大片
    elements.forEach(item => { item.visible = item.base?.type !== 'edgePoint'; });
    geometryManager.loadStorage(elements);
    Object.keys(lists).forEach(key => { geometryElementLists[key] = new Set(lists[key]); });
    // 导入的标记要立刻上色（含多解的点亮规则），并记下样式色，取消标记时才恢复得回去
    refreshElementListColors();
    seedMarkedStyles();
    drawContent();
    if (typeof loadGeometryElements === 'function') loadGeometryElements();
    refreshMarks();
    // 导入的关卡按 gmt 顺序成为历史：可以一步步撤回
    if (typeof resetStorageHistoryInSteps === 'function') resetStorageHistoryInSteps();
    else resetStorageHistory();
    return true;
  };
  const saveGmtFile = () => download('custom-level.gmt', gmtText(), 'text/plain');
  const submitGmtIssue = () => {
    const body = encodeURIComponent('请将下面的 GMT 保存到 data/levels/custom：\n\n```\n' + gmtText() + '\n```\n');
    window.open('https://github.com/MT9799/Geommunity-Blueprint/issues/new?title=Custom%20level&body=' + body, '_blank');
  };
  const readGmtFile = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.gmt,.txt,text/plain';
    input.addEventListener('change', () => { const file = input.files?.[0]; if (file) file.text().then(loadGmt); });
    input.click();
  };
  /**
   * 求解器：把画布图形整理成搜索请求 过程函数
   * 已知条件 = 画布上除「所求判定」以外的对象（目标对象不能同时算作已知，否则一搜就「0 步找到」）；
   * 目标 = 标为「所求判定」的直线 / 圆 / 点，三类可以同时存在
   * @returns {Object} 画板扁平数组写法（与旧求解面板一致）：points/lines/circles + goalPoints/goalLines/goalCircles
   */
  const buildSolverRequest = () => {
    const goalIds = geometryElementLists.result || new Set();
    // 已知条件只取「给定」栏（initial）。打开求解器时，关卡里隐藏 / 预绘制的图形，
    // 以及可移动点一类没被标成给定的对象都会被整份带过来并显示出来，
    // 当条件用就会搜出「用了题面里没有的点」的假解（4E 那种）。
    const givenIds = new Set();
    (geometryElementLists.initial || new Set()).forEach(id => givenIds.add(id));
    const useGivenMarks = givenIds.size > 0;
    // pointIds / lineIds / circleIds 与上面三个坐标数组一一对应：
    // 求解器返回的「构造计划」靠它们把已知点、已知元素映射回画布对象，于是拖动图形时能重算解法
    const request = {
      points: [], lines: [], circles: [],
      goalPoints: [], goalLines: [], goalCircles: [],
      pointIds: [], lineIds: [], circleIds: [],
    };
    geometryManager.getAllByOrder().forEach(item => {
      if (item.getValid && !item.getValid()) return;
      if (item.getVisible && !item.getVisible()) return;
      const id = item.getId();
      const isGoal = goalIds.has(id);
      if (!isGoal && useGivenMarks && !givenIds.has(id)) return;
      const type = item.getType();
      if (type === 'point') {
        if (isGoal) {
          request.goalPoints.push(item.x, item.y);
        } else {
          request.points.push(item.x, item.y);
          request.pointIds.push(id);
        }
        return;
      }
      const coordinate = item.getCoordinate?.();
      if (!coordinate) return;
      const [first, second] = coordinate;
      if (type === 'line') {
        // a·x + b·y = c，两个定义点算一遍（与画板自己的换算一致）
        const coefficients = [second[1] - first[1], first[0] - second[0], first[0] * second[1] - first[1] * second[0]];
        if (isGoal) request.goalLines.push(...coefficients);
        else {
          request.lines.push(...coefficients);
          request.lineIds.push(id);
        }
      } else if (type === 'circle') {
        // 圆心 + 半径平方。第三个值故意用 (dx²+dy²) 而不是 Math.hypot(...) 再平方：
        // 求解器里圆的系数就是这个公式，两边保持同一条算式才不会差出 ulp（见下面 eps 的说明）
        const circle = [first[0], first[1],
          (first[0] - second[0]) * (first[0] - second[0]) + (first[1] - second[1]) * (first[1] - second[1])];
        if (isGoal) request.goalCircles.push(...circle);
        else {
          request.circles.push(...circle);
          request.circleIds.push(id);
        }
      }
    });
    // 容差按图幅量级放大：圆的比较落在半径平方上（量级 ~r²），而搜索器默认的绝对 1e-11
    // 在这个量级上比 1 ulp 还小，等于要求位级完全相同 —— 大坐标的题会出现「明明作出来了却匹配不上」。
    // 放大后仍远小于状态去重 / 网格判定用的阈值（0.5），不会把不同状态并到一起
    let extent = 1;
    [request.points, request.lines, request.circles, request.goalPoints, request.goalLines, request.goalCircles]
      .forEach(list => (list || []).forEach(value => { extent = Math.max(extent, Math.abs(value)); }));
    request.eps = 1e-11 * extent;
    return request;
  };

  /** 元素方程 → 覆盖层要画的圆 过程函数（c 是半径平方） */
  const solverOverlayCircle = element => ({
    x: element.a,
    y: element.b,
    r: Math.sqrt(Math.max(0, element.c)),
  });

  /** 元素方程 → 覆盖层要画的直线（取方程上两个点） 过程函数 */
  const solverOverlayLine = element => {
    if (Math.abs(element.b) > 1e-12) return {x1: 0, y1: element.c / element.b, x2: 1, y2: (element.c - element.a) / element.b};
    return {x1: element.c / element.a, y1: 0, x2: element.c / element.a, y2: 1};
  };

  // 最近一次求解发出的请求：构造计划靠它把已知点 / 已知元素映射回画布对象
  let solverLastRequest = null;
  // 点「开始求解」那一刻的图形状态与指纹：切换解法时把不是这个解法画出来的图形复位回去
  let solverCanvasSnapshot = null;
  let solverCanvasSignature = '';

  /**
   * 把某个解画到第几步 过程函数
   * 有构造计划就交给画布按当前图形现算 —— 拖动图形（移动给定点、给定直线的端点）时解法跟着变形；
   * 反推不出计划时才退回「一次性快照」画法（第 step 步的图形 + 那一步新出现的交点）
   */
  /**
   * 求解器给的构造计划能不能可靠地对上画布对象 过程函数
   * 请求是照 Worker 装图的顺序发的（点 → 直线 → 射线 → 线段 → 圆），
   * 但 Worker 会丢掉重复的给定对象；一旦数量或坐标对不上，映射就会整体错位 —— 那种情况不启用计划
   */
  const solverPlanMatchesCanvas = (solution, result) => {
    if (!solverLastRequest) return false;
    if (solverLastRequest.pointIds.length < result.initialPointCount) return false;
    for (let i = 0; i < result.initialPointCount; i++) {
      const item = geometryManager.get(solverLastRequest.pointIds[i]);
      const recorded = solution.points[i];
      if (!item || item.getType() !== 'point') return false;
      if (Math.abs(item.x - recorded.x) > 1e-9 || Math.abs(item.y - recorded.y) > 1e-9) return false;
    }
    const sentElements = solverLastRequest.lines.length / 3 + solverLastRequest.circles.length / 3;
    return sentElements === result.initialElementCount;
  };

  const showSolverSolutionStep = (solution, result, step) => {
    const shown = Math.max(0, Math.min(solution.newElementCount, step));
    if (solution.plan && solverPlanMatchesCanvas(solution, result)) {
      solverSolutionPlan = {
        solution: solution,
        result: result,
        dag: solution.plan,
        step: shown,
        pointIds: solverLastRequest.pointIds,
        // 顺序要与 Worker 装图的顺序一致：直线 → 射线 → 线段 → 圆（后两类求解器面板不发）
        elementIds: solverLastRequest.lineIds.concat(solverLastRequest.circleIds),
      };
      solverSolutionOverlay = null;
      drawContent();
      return;
    }
    const overlay = {points: [], lines: [], circles: []};
    for (let i = result.initialPointCount; i < solution.points.length; i++) {
      const birth = solution.pointBirth ? solution.pointBirth[i] : 0;
      // birth 0 是给定图形自己的交点（求解前就存在），不属于解法
      if (birth >= 1 && birth <= shown) overlay.points.push(solution.points[i]);
    }
    const end = Math.min(result.initialElementCount + shown, solution.elements.length);
    for (let i = result.initialElementCount; i < end; i++) {
      const element = solution.elements[i];
      if (element.type === 0) overlay.circles.push(solverOverlayCircle(element));
      else overlay.lines.push(solverOverlayLine(element));
    }
    solverSolutionPlan = null;
    solverSolutionOverlay = overlay;
    drawContent();
  };

  /** 画布几何的指纹 过程函数（坐标 + 可见性，用来判断画布有没有被改过） */
  const solverCanvasFingerprint = () => geometryManager.getAllByOrder().map(item => {
    const coordinate = item.getCoordinate?.();
    return item.getId() + (item.getVisible?.() ? '1' : '0') + (coordinate ? JSON.stringify(coordinate) : '');
  }).join('|');

  /**
   * 把画布复位到「开始求解那一刻」 过程函数
   * 求解期间可能拖过点 / 画过东西，切换解法时这些不属于解法的改动要收回去 ——
   * 只有指纹变了才重建（重建会清掉选中与工具缓存，代价不小）
   */
  const resetSolverCanvas = () => {
    if (!solverCanvasSnapshot || typeof loadStorageSnapshot !== 'function') return;
    if (solverCanvasFingerprint() === solverCanvasSignature) return;
    loadStorageSnapshot(solverCanvasSnapshot);
    solverCanvasSignature = solverCanvasFingerprint();
  };

  /** 清除画布上的解法覆盖层 过程函数 */
  const clearSolverSolution = () => {
    solverSolutionPlan = null;
    solverSolutionOverlay = null;
    drawContent();
  };

  /**
   * 圆形按钮的图标：标记（小旗）
   */
  const markSideIcon = () => '<svg class="svg-icon" viewBox="0 0 200 200">' +
    '<path d="M62 176 L62 28" fill="transparent" stroke-width="14" stroke-linecap="round"/>' +
    '<path d="M62 38 L152 66 L62 94 Z" fill="transparent" stroke-width="14" stroke-linejoin="round"/></svg>';

  /**
   * 圆形按钮的图标：求解参数（三条滑杆）
   */
  const solverSideIcon = () => '<svg class="svg-icon" viewBox="0 0 200 200">' +
    '<path d="M28 50 L172 50" fill="transparent" stroke-width="12" stroke-linecap="round"/>' +
    '<path d="M28 100 L172 100" fill="transparent" stroke-width="12" stroke-linecap="round"/>' +
    '<path d="M28 150 L172 150" fill="transparent" stroke-width="12" stroke-linecap="round"/>' +
    '<circle cx="76" cy="50" r="16" fill="#fff" stroke-width="12"/>' +
    '<circle cx="128" cy="100" r="16" fill="#fff" stroke-width="12"/>' +
    '<circle cx="68" cy="150" r="16" fill="#fff" stroke-width="12"/></svg>';

  // 上拉栏 → 对应的圆形按钮（关闭时要把按钮的高亮一起收掉）
  const sheetButtons = new Map();

  /**
   * 收起上拉栏 过程函数
   * 面板是「半展开 / 被拖到任意高度」时，高度来自 CSS 或 inline 值：
   * 直接摘掉会让它先弹回自然高度再往下滑（看着像先跳一下），所以先把当前高度冻成固定值，
   * 等滑出动画播完再清掉
   * @param {Object} sheet 上拉栏
   */
  const collapseSheet = sheet => {
    const fromHeight = sheet.classList.contains('peek') || sheet.style.height;
    if (fromHeight) sheet.style.height = `${sheet.offsetHeight}px`;
    sheet.classList.remove('open', 'peek');
    if (!fromHeight) {
      sheet.style.height = '';
      return;
    }
    setTimeout(() => {
      if (!sheet.classList.contains('open') && !sheet.classList.contains('peek')) sheet.style.height = '';
    }, 280);
  };

  /**
   * 把设置面板包进底部上拉栏 过程函数
   * 画布上只留一个圆形按钮（见 addSideButton），点开才把面板从底部拉起来
   * @param {Object} panel 面板元素
   * @param {string} title 标题栏文字
   * @returns {Object} 上拉栏容器
   */
  const wrapInSheet = (panel, title) => {
    const sheet = document.createElement('section');
    sheet.className = 'panel-sheet';
    const head = document.createElement('div');
    head.className = 'panel-sheet-head';
    const name = document.createElement('strong');
    name.textContent = title;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'panel-sheet-close';
    close.innerHTML = '&times;';
    close.setAttribute('aria-label', title);
    close.addEventListener('click', () => {
      collapseSheet(sheet);
      sheet.style.transform = '';
      const button = sheetButtons.get(sheet);
      if (button) button.classList.remove('active');
    });
    // 抓住标题栏拖动：跟手改面板高度（可以停在任意高度），拖到底收起来、拉到顶完全展开。
    // 用「高度」而不是 translateY：面板底部始终贴着屏幕底边，
    // 面板里的滚动条才滚得到最下面的内容（位移会把底边推出屏幕，最后几行永远看不到）
    let sheetDragFrom = null;
    // 面板的自然高度：被拖矮之后也能量出来（临时去掉高度与 peek 再量）
    const naturalHeightOf = () => {
      const hadPeek = sheet.classList.contains('peek');
      const previous = sheet.style.height;
      if (hadPeek) sheet.classList.remove('peek');
      sheet.style.height = '';
      const natural = sheet.offsetHeight;
      if (hadPeek) sheet.classList.add('peek');
      sheet.style.height = previous;
      return natural;
    };
    head.addEventListener('pointerdown', event => {
      if (!sheet.classList.contains('open') && !sheet.classList.contains('peek')) return;
      sheetDragFrom = {y: event.clientY, base: sheet.offsetHeight, natural: naturalHeightOf()};
      head.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    });
    head.addEventListener('pointermove', event => {
      if (!sheetDragFrom) return;
      // 跟手：往上拖变高、往下拖变矮（最高就是自然高度）
      const shown = Math.max(0, Math.min(sheetDragFrom.natural,
        sheetDragFrom.base - (event.clientY - sheetDragFrom.y)));
      sheet.style.height = `${Math.round(shown)}px`;
      sheet.style.transform = '';
      // 拖动期间按「半展开」处理：pointer-events 打开，别让面板收不到后续事件
      sheet.classList.add('peek');
      sheet.classList.remove('open');
    });
    head.addEventListener('pointerup', () => {
      if (!sheetDragFrom) return;
      const shown = sheet.offsetHeight;
      const natural = sheetDragFrom.natural;
      sheetDragFrom = null;
      const button = sheetButtons.get(sheet);
      if (shown <= 56) {
        // 拖到底：收起来
        collapseSheet(sheet);
        if (button) button.classList.remove('active');
      }else if (shown >= natural - 24) {
        // 拉到顶：完全展开
        sheet.classList.add('open');
        sheet.classList.remove('peek');
        sheet.style.height = '';
        if (button) button.classList.add('active');
      }else{
        // 停在拖到的任意高度
        sheet.classList.add('peek');
        sheet.classList.remove('open');
        if (button) button.classList.add('active');
      }
    });
    head.addEventListener('pointercancel', () => { sheetDragFrom = null; });
    head.appendChild(name);
    head.appendChild(close);
    const body = document.createElement('div');
    body.className = 'panel-sheet-body';
    body.appendChild(panel);
    sheet.appendChild(head);
    sheet.appendChild(body);
    document.body.appendChild(sheet);
    return sheet;
  };

  /**
   * 加一个圆形按钮，点开对应的上拉栏 过程函数
   * @param {string} key id 后缀
   * @param {string} svg 图标
   * @param {string} title 悬停说明 / 无障碍标签
   * @param {Object} sheet 上拉栏
   * @returns {Object} 按钮
   */
  const addSideButton = (key, svg, title, sheet) => {
    let box = document.getElementById('side-buttons');
    if (!box) {
      box = document.createElement('div');
      box.id = 'side-buttons';
      box.className = 'side-buttons';
      document.body.appendChild(box);
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.id = `side-button-${key}`;
    button.className = 'side-button';
    button.title = title;
    button.setAttribute('aria-label', title);
    button.innerHTML = svg;
    button.addEventListener('click', () => {
      const open = sheet.classList.toggle('open');
      // 半展开（或被拖到任意高度）状态下点按钮 = 直接拉满
      sheet.classList.remove('peek');
      sheet.style.height = '';
      sheet.style.transform = '';
      button.classList.toggle('active', open);
      // 同时只留一个上拉栏，免得两层叠在一起
      document.querySelectorAll('.panel-sheet.open, .panel-sheet.peek').forEach(item => {
        if (item !== sheet) {
          collapseSheet(item);
          item.style.transform = '';
        }
      });
      document.querySelectorAll('.side-button.active').forEach(item => {
        if (item !== button) item.classList.remove('active');
      });
    });
    sheetButtons.set(sheet, button);
    box.appendChild(button);
    return button;
  };

  const solverPanel = () => {
    const panel = document.createElement('aside');
    panel.className = 'solver-panel';
    panel.innerHTML = [
      // 标题在上拉栏的标题栏里（见 wrapInSheet），这里只放设置项
      // 两两并排，省一半高度（见 index.css 的 .solver-field-row）
      '<div class="solver-field-row">' +
        `<label>${t('board.solverLimit')}<input id="geb-solver-limit" type="number" min="1" max="100" value="6"></label>` +
        `<label>${t('board.solverTool')}<select id="geb-solver-tool">` +
          `<option value="2">${t('board.solverToolBoth')}</option>` +
          `<option value="1">${t('board.solverToolLine')}</option>` +
          `<option value="0">${t('board.solverToolCircle')}</option></select></label>` +
      '</div>',
      '<div class="solver-field-row">' +
        `<label>${t('board.solverTime')}<input id="geb-solver-time" type="number" min="1" max="600" value="60"></label>` +
        `<label>${t('board.solverCount')}<input id="geb-solver-solutions" type="number" min="1" max="20" value="20"></label>` +
      '</div>',
      `<button id="geb-solver-run">${t('board.solverRun')}</button>`,
      `<div class="solver-step-row"><button id="geb-solver-prev">${t('board.solverPrevStep')}</button>` +
        `<span id="geb-solver-stepinfo">—</span>` +
        `<button id="geb-solver-next">${t('board.solverNextStep')}</button></div>`,
      `<button id="geb-solver-clear">${t('board.solverClear')}</button>`,
      `<output id="geb-solver-status">${t('board.solverIdle')}</output>`,
      '<div id="geb-solver-list" class="solver-solution-list"></div>',
    ].join('');
    // 从关卡打开求解器时带了 solverTool（那一关限定单尺 / 单规）：可用工具默认就选到同一种模式
    const presetSolverTool = params.get('solverTool');
    const solverToolSelect = panel.querySelector('#geb-solver-tool');
    if (solverToolSelect && ['0', '1', '2'].includes(presetSolverTool)) {
      solverToolSelect.value = presetSolverTool;
    }
    // 收进底部上拉栏：画布上只留一个圆形按钮（见 addSideButton）
    addSideButton('solver-params', solverSideIcon(), t('board.solverParams'), wrapInSheet(panel, t('board.solverParams')));

    const status = panel.querySelector('#geb-solver-status');
    const list = panel.querySelector('#geb-solver-list');
    const stepInfo = panel.querySelector('#geb-solver-stepinfo');
    // 按步播放的间隔（毫秒）：越小画得越快
    const REPLAY_INTERVAL = 90;
    // 最近一次搜索的结果、当前画的是第几个解的第几步、以及在途播放的代号
    let latest = null;
    let currentIndex = -1;
    let currentStep = 0;
    let replayToken = 0;

    /**
     * 显示「第 index 个解的第 step 步」 过程函数
     * 上一步 / 下一步以及播放都走这里，步数与按钮高亮一起更新
     */
    const showStep = (index, step) => {
      const solution = latest && latest.solutions[index];
      if (!solution) return;
      const total = solution.newElementCount;
      currentIndex = index;
      currentStep = Math.max(0, Math.min(total, step));
      showSolverSolutionStep(solution, latest, currentStep);
      stepInfo.textContent = total
        ? t('board.solverStepInfo', {step: currentStep, total: total})
        : t('board.solverNoSteps');
      list.querySelectorAll('.solver-solution-pick').forEach((button, buttonIndex) => {
        button.classList.toggle('active', buttonIndex === index);
      });
    };

    /**
     * 画出第 index 个解 过程函数
     * @param {boolean} animate true 时从第 0 步按步画出来，false 时直接画完整版
     */
    const playSolution = (index, animate) => {
      const solution = latest && latest.solutions[index];
      if (!solution) return;
      // 换一个解法：先把画布复位到「开始求解那一刻」，再画这个解法
      if (typeof resetSolverCanvas === 'function') resetSolverCanvas();
      const token = ++replayToken;
      showStep(index, 0);
      if (!animate || !solution.newElementCount) {
        showStep(index, solution.newElementCount);
        return;
      }
      for (let step = 1; step <= solution.newElementCount; step++) {
        setTimeout(() => {
          if (token !== replayToken) return;
          showStep(index, step);
        }, step * REPLAY_INTERVAL);
      }
    };

    /** 弹出某个解的文字步骤 过程函数 */
    const showReport = index => {
      const solution = latest && latest.solutions[index];
      if (!solution) return;
      document.querySelectorAll('.board-dialog-report').forEach(item => {
        item.closest('.board-dialog-mask')?.remove();
      });
      const mask = document.createElement('div');
      // 修饰类把 z-index 提到上拉栏（手机端 z-index:12）之上
      mask.className = 'board-dialog-mask board-dialog-report-mask';
      // 界面双语，但步骤报告本身只有中文：非中文界面加一行小提示
      const hint = currentLang() === 'zh' ? ''
        : `<p class="board-dialog-hint">${t('board.solverReportChineseOnly')}</p>`;
      mask.innerHTML = '<div class="board-dialog"><strong></strong>' + hint +
        '<pre class="board-dialog-report"></pre><div class="board-dialog-actions"></div></div>';
      mask.querySelector('strong').textContent = t('board.solverReportTitle', {
        index: index + 1,
        steps: solution.newElementCount,
      });
      mask.querySelector('.board-dialog-report').textContent = solution.report || t('board.solverNoReport');
      const close = document.createElement('button');
      close.type = 'button';
      close.textContent = t('common.close');
      close.addEventListener('click', () => mask.remove());
      mask.querySelector('.board-dialog-actions').appendChild(close);
      // 点框外也关掉
      mask.addEventListener('click', event => {
        if (event.target === mask) mask.remove();
      });
      document.body.appendChild(mask);
    };

    // 正在跑的搜索 Worker（null 表示当前没有在搜索）
    let activeWorker = null;

    /** 切换按钮的「开始求解 / 停止求解」状态 过程函数 */
    const setSearching = searching => {
      const runButton = panel.querySelector('#geb-solver-run');
      runButton.textContent = searching ? t('board.solverStop') : t('board.solverRun');
      runButton.classList.toggle('running', searching);
    };

    /** 停掉正在跑的搜索 过程函数（返回是否真的停掉了一个） */
    const stopSearch = () => {
      if (!activeWorker) return false;
      activeWorker.terminate();
      activeWorker = null;
      setSearching(false);
      return true;
    };

    panel.querySelector('#geb-solver-run').addEventListener('click', () => {
      // 正在搜索时再点一下就是停止：搜索可能跑满时间上限，不必干等
      if (stopSearch()) {
        status.textContent = t('board.solverStopped');
        return;
      }
      const request = buildSolverRequest();
      const goalCount = request.goalPoints.length / 2 + request.goalLines.length / 3 + request.goalCircles.length / 3;
      if (!goalCount) {
        status.textContent = t('board.solverNeedGoal');
        return;
      }
      // 记下这次请求：解出来以后要用它的对象 id 组装「构造计划」
      solverLastRequest = request;
      // 同时记下这一刻的图形状态：切换解法时把不是这个解法画出来的图形复位回来
      solverCanvasSnapshot = typeof collectStorageSnapshot === 'function' ? collectStorageSnapshot() : null;
      solverCanvasSignature = solverCanvasFingerprint();
      const limit = Math.max(1, Number(panel.querySelector('#geb-solver-limit').value) || 1);
      const toolType = Number(panel.querySelector('#geb-solver-tool').value);
      const timeLimitSeconds = Math.max(1, Number(panel.querySelector('#geb-solver-time').value) || 30);
      const solutions = Math.max(1, Number(panel.querySelector('#geb-solver-solutions').value) || 1);

      replayToken++;
      latest = null;
      currentIndex = -1;
      currentStep = 0;
      stepInfo.textContent = '—';
      solverSolutionOverlay = null;
      list.innerHTML = '';
      drawContent();
      status.textContent = t('board.solverSearching');

      const worker = new Worker('./solver/search-worker.js');
      activeWorker = worker;
      setSearching(true);
      const startedAt = performance.now();
      const seconds = () => ((performance.now() - startedAt) / 1000).toFixed(2);
      worker.onmessage = event => {
        worker.terminate();
        activeWorker = null;
        setSearching(false);
        const message = event.data;
        if (!message || !message.success) {
          status.textContent = t('board.solverFailed', {
            error: message && message.error ? message.error : t('board.solverUnknownError'),
          });
          return;
        }
        const result = message.data;
        if (!result.found) {
          status.textContent = result.timedOut
            ? t('board.solverTimeoutNoSolution', {seconds: timeLimitSeconds})
            : t('board.solverNoSolution', {limit: limit, seconds: seconds()});
          return;
        }
        latest = result;
        status.textContent = result.timedOut
          ? t('board.solverTimeoutPartial', {
            seconds: timeLimitSeconds,
            found: result.solutionCount,
            requested: result.requestedSolutions,
          })
          : t('board.solverFound', {count: result.solutionCount, seconds: seconds()});
        result.solutions.forEach((solution, index) => {
          const row = document.createElement('div');
          row.className = 'solver-solution-row';
          // 「解法 n」选了就画出来，「文字步骤」看中文步骤说明
          const pick = document.createElement('button');
          pick.type = 'button';
          pick.className = 'solver-solution-pick';
          pick.textContent = t('board.solverSolutionIndex', {index: index + 1, steps: solution.newElementCount});
          pick.addEventListener('click', () => playSolution(index, false));
          const text = document.createElement('button');
          text.type = 'button';
          text.className = 'solver-solution-text';
          text.textContent = t('board.solverReportButton');
          text.addEventListener('click', () => showReport(index));
          row.appendChild(pick);
          row.appendChild(text);
          list.appendChild(row);
        });
        playSolution(0, true);
      };
      worker.onerror = () => {
        status.textContent = t('board.solverLoadFailed');
        worker.terminate();
        activeWorker = null;
        setSearching(false);
      };
      worker.postMessage({
        type: 'search',
        id: Date.now(),
        data: Object.assign({
          limit,
          toolType,
          P: request.points.length / 2,
          L: request.lines.length / 3,
          R: 0,
          S: 0,
          C: request.circles.length / 3,
          rays: [],
          segments: [],
          solutions,
          timeLimitSeconds,
        }, request),
      });
    });

    // 上一步 / 下一步：手动逐步看解法（正在播放时按一下即打断播放）
    panel.querySelector('#geb-solver-prev').addEventListener('click', () => {
      replayToken++;
      showStep(currentIndex, currentStep - 1);
    });

    panel.querySelector('#geb-solver-next').addEventListener('click', () => {
      replayToken++;
      showStep(currentIndex, currentStep + 1);
    });

    panel.querySelector('#geb-solver-clear').addEventListener('click', () => {
      // 还搜着就先停掉，免得停了之后又冒出一堆解法
      stopSearch();
      replayToken++;
      latest = null;
      currentIndex = -1;
      currentStep = 0;
      stepInfo.textContent = '—';
      list.innerHTML = '';
      clearSolverSolution();
      status.textContent = t('board.solverCleared');
    });
  };
  // 当前标记的集合名（initial / named / movepoints / result / resultShown）与当前标记工具（given / goal）
  let marking = null;
  let markingTool = null;
  // 标记色与样式色分离：标记期间显示色固定为标记色，
  // 样式修改只记录在 markedStyles，取消标记时把样式色与标签状态一并写回
  const markedStyles = new Map();
  const applyMarkStyle = (item, markColor, showName = false) => {
    const id = item.getId();
    if (!markedStyles.has(id)) {
      markedStyles.set(id, { color: item.getColor(), showName: item.getShowName(), name: item.getName() });
      item.modifyColor = color => { markedStyles.get(id).color = color; };
    }
    GeometryElement.prototype.modifyColor.call(item, markColor);
    item.modifyShowName(showName);
  };
  const releaseMarkStyle = (item) => {
    const id = item.getId();
    if (!markedStyles.has(id)) return;
    const style = markedStyles.get(id);
    delete item.modifyColor;
    item.modifyColor(style.color);
    item.modifyName(style.name || id);
    item.modifyShowName(style.showName);
    markedStyles.delete(id);
  };
  const releaseAllMarkStyles = () => [...markedStyles.keys()].forEach(id => {
    const item = geometryManager.get(id);
    if (item) releaseMarkStyle(item); else markedStyles.delete(id);
  });
  /**
   * 自动配色下的样式色 过程函数
   * 制题器 / 求解器用 autoPlayMode：自由点（坐标点 / 线上点）红，其余点与线圆灰
   * @param {Object} item 几何对象
   * @returns {string} 颜色
   */
  const autoPlayModeColor = item => {
    if (item?.getType() !== 'point') return '#808080';
    const baseType = item.getBase()?.type;
    return (baseType === 'none' || baseType === 'online') ? '#ff0000' : '#808080';
  };
  /**
   * 记下带入图形的样式色 过程函数
   * 关卡 / 画板带进来的对象以黑（给定）或金（所求）显示，但它们的样式色另有其人；
   * 不先记下来，取消标记时就恢复不回去（会一直停在黑 / 金）
   */
  const seedMarkedStyles = () => {
    if (mode !== 'maker' && mode !== 'solver') return;
    allMarkIds().forEach(id => {
      const item = geometryManager.get(id);
      if (!item || markedStyles.has(id)) return;
      markedStyles.set(id, {color: autoPlayModeColor(item), showName: item.getShowName(), name: item.getName()});
      // 与 applyMarkStyle 一致：标记期间改样式只记录在这里，取消标记时一并写回
      item.modifyColor = color => { markedStyles.get(id).color = color; };
    });
  };
  /**
   * 按标记集合刷新一个对象的显示色与标签 过程函数
   * 不再属于任何标记集合时恢复对象自身的样式色
   * @param {string} id
   */
  const applyMarkToElement = id => {
    const item = geometryManager.get(id);
    if (!item) return;
    // 不在任何标记里（或属于没点亮的解）就恢复对象自身的样式色
    const color = markDisplayColor(id);
    if (!color) { releaseMarkStyle(item); return; }
    // 只有「带标签给定」显示标签
    applyMarkStyle(item, color, markSetOf('named').has(id));
  };
  /**
   * 刷新标记高亮 过程函数
   * 切换标记种类、切换解或切换工具后调用，让画布上金色的范围跟着变
   */
  const refreshMarkHighlight = () => {
    if (mode !== 'maker' && mode !== 'solver') return;
    allMarkIds().forEach(id => applyMarkToElement(id));
    drawContent();
  };
  /**
   * 输入标签 过程函数
   * 带标签给定：只允许留空（用对象 ID 当标签）或单个字母 / 数字
   * @param {Object} item
   */
  const promptMarkLabel = item => {
    if (!item) return;
    const id = item.getId();
    // 只允许留空（用对象 ID 当标签）或单个字母 / 数字；
    // 两个及以上的非字母数字字符（' 之类连着输两个）等非法输入直接把「确定」置灰，
    // 不再让人点了没反应
    const isValidLabel = text => {
      const label = String(text || '').trim();
      return label === '' || /^[A-Za-z0-9]$/.test(label);
    };
    const ask = value => inputDialog(t('board.markNamed'), t('board.markLabelPrompt', {id: id}), value, raw => {
      const label = String(raw || '').trim();
      // 校验与「确定」按钮的置灰规则保持一致（非法输入根本进不到这里）
      if (label && !/^[A-Za-z0-9]$/.test(label)) { ask(label); return; }
      item.modifyName(label || id);
      drawContent();
      if (typeof loadGeometryElements === 'function') loadGeometryElements();
    }, {valid: isValidLabel});
    ask('');
  };
  // 标记手势状态：手指按在图形上时置位，松手复位（见下面的 swallowMarkingGesture）
  let markingGesture = false;
  const markFromCanvas = event => {
    if (!marking) return;
    const canvas = document.getElementById('canvas_id1');
    if (!canvas || event.target !== canvas) return;
    // 手机端没有鼠标：触摸处理里 preventDefault 掉了合成鼠标事件，所以触摸按下也要走这条路。
    // 触摸时 event.clientX 是 undefined（坐标在 touches[0] 上），不取出来就永远命中不了对象
    const source = event.touches && event.touches[0] ? event.touches[0] : event;
    if (typeof source.clientX !== 'number') return;
    const rect = event.target.getBoundingClientRect();
    const x = (source.clientX - rect.left - transform.x) / transform.scale;
    const y = (source.clientY - rect.top - transform.y) / transform.scale;
    // near() 内部已做点优先：交点不会被背后的直线 / 圆抢先命中
    const [id] = geometryManager.near([x, y], ['point', 'line', 'circle']);
    // 未命中对象时不拦截事件，交给画布拖拽（标记模式下当前工具已是「移动视图」）
    if (!id) {
      markingGesture = false;
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    // 手机端：这个手势按在图形上，整个手势都归标记，后续的 touchmove 不要再拿去平移画布
    markingGesture = true;
    const item = geometryManager.get(id);
    // 可移动点只能是自由点（能拖得动的那种），交点 / 线上点 / 中点这些不算
    if (marking === 'movepoints' && (item?.getType() !== 'point' || item.getBase().type !== 'none')) {
      toast(t('board.movepointOnlyFree'));
      return;
    }
    const group = Object.values(markGroups).find(keys => keys.includes(marking)) || [marking];
    // 多解：所求判定 / 所求显示写进当前选中的那一组解
    const set = marking === 'result' ? resultSetOf(resultActive, 'judged')
      : marking === 'resultShown' ? resultSetOf(resultActive, 'shown')
      : markSetOf(marking);
    if (!geometryElementLists[marking]) geometryElementLists[marking] = set;
    if (set.has(id)) {
      set.delete(id);
      // 同分类的其他集合还在标记就保持标记色，都不在就恢复对象自身的样式
      applyMarkToElement(id);
    }else{
      // 同分类互斥：给定（给定 / 带标签给定 / 可移动点）里只能选一个；
      // 所求判定与所求显示可以同时标在一个对象上（显示时取所求显示的橙色）
      group.forEach(key => markSetOf(key).delete(id));
      set.add(id);
      if (marking === 'named') promptMarkLabel(item);
      applyMarkToElement(id);
    }
    drawContent();
    if (typeof loadGeometryElements === 'function') loadGeometryElements();
    refreshMarks();
    // 标记改动记一步历史
    notifyStorageChange('mark');
  };
  // 手机端标记手势的后续事件（touchmove 等）用 capture 全部吃掉：
  // 手指按在图形上拖动时，既不移动图形也不平移画布，只是标记它
  const swallowMarkingGesture = event => {
    if (!markingGesture) return;
    event.preventDefault();
    // 必须用 stopImmediatePropagation：index.js 的监听挂在同一个 canvas 上，
    // 只 stopPropagation 挡不住同一元素上的其它监听
    event.stopImmediatePropagation();
    if (event.type === 'touchend' || event.type === 'touchcancel') markingGesture = false;
  };
  const canvas = document.getElementById('canvas_id1');
  if (canvas) {
    canvas.addEventListener('mousedown', markFromCanvas, true);
    canvas.addEventListener('touchstart', markFromCanvas, true);
    canvas.addEventListener('touchmove', swallowMarkingGesture, true);
    canvas.addEventListener('touchend', swallowMarkingGesture, true);
    canvas.addEventListener('touchcancel', swallowMarkingGesture, true);
  }
  const markPanel = document.createElement('aside');
  markPanel.className = 'mark-panel';
  // 面板折叠状态：结构重建（解数变化）时把用户的开合记下来
  const markFoldState = new Map();
  let markPanelSignature = '';
  /**
   * 重绘标记面板结构 过程函数
   * 给定 / 所求 / 探索显示三组可折叠，所求里每个解再各占一层（判定 / 显示两个列表）
   */
  const renderMarkPanel = () => {
    const signature = `${solverMode ? 1 : 0}|${resultGroupCount()}|${resultActive}`;
    if (signature === markPanelSignature) return;
    markPanelSignature = signature;
    const fold = (key, title, body, open = false) => {
      const opened = markFoldState.get(key) ?? open;
      return `<details class="mark-fold" data-fold="${key}"${opened ? ' open' : ''}><summary>${title}</summary>${body}</details>`;
    };
    // 哪些分组一开始就展开：求解器里本来就是（「要用的条件」与「要作的目标」），
    // 手机版制题器也照这样（面板本身还是收起的，点圆形按钮才拉起来）
    const foldOpened = solverMode || (mode === 'maker' && window.matchMedia('(max-width: 768px)').matches);
    const listOf = key => `<ul id="marked-${key}"></ul>`;
    const titled = (title, key) => `<div class="mark-item"><b>${title}</b>${listOf(key)}</div>`;
    // 标题在上拉栏的标题栏里（见 wrapInSheet），面板本体只放分组列表
    let html = '';
    // 求解器里这两栏就是「要用的条件」与「要作的目标」，默认展开省得每次点开
    if (solverMode) {
      // 求解器的给定 / 所求各只有一种，条目上不再重复「给定」「判定」的小标题
      html += fold('given', t('board.markGiven'), listOf('initial'), foldOpened);
      html += fold('goal', t('board.markGoalGroup'), listOf('result-1'), foldOpened);
    }else{
      html += fold('given', t('board.markGiven'), givenMarkItems.map(([key, labelKey]) => titled(t(labelKey), key)).join(''), foldOpened);
      let goals = '';
      for (let index = 1; index <= resultGroupCount(); index++) {
        const activeClass = index === resultActive ? ' mark-fold-active' : '';
        goals += fold(`result-${index}`, `<span class="mark-fold-title${activeClass}">${t('board.markGoalIndex', {index: index})}</span>`,
          titled(t('board.markJudged'), `result-${index}`) + titled(t('board.markShownShort'), `resultShown-${index}`), true);
      }
      html += fold('goal', t('board.markGoalGroup'), goals, foldOpened);
    }
    if (!solverMode) html += fold('explore', t('board.markExplore'), listOf('explore'), foldOpened);
    markPanel.innerHTML = html;
    // 记录用户的开合操作
    markPanel.querySelectorAll('details[data-fold]').forEach(detail => {
      detail.addEventListener('toggle', () => markFoldState.set(detail.dataset.fold, detail.open));
    });
  };
  /**
   * 对象的解析式 过程函数
   * 点给坐标，直线（含射线 / 线段所在的直线）给 y=kx+b（竖直时给 x=c），
   * 圆给 (x-x0)^2+(y-y0)^2=r^2，数值保留三位小数
   * @param {Object} item 几何对象
   * @returns {string}
   */
  const equationOf = item => {
    const coord = item?.getCoordinate?.();
    if (!coord) return '';
    const num = value => String(Math.round(value * 1000) / 1000);
    if (item.getType() === 'point') return `(${num(coord[0])}, ${num(coord[1])})`;
    if (item.getType() === 'circle') {
      const [center, on] = coord;
      const radius = Math.hypot(on[0] - center[0], on[1] - center[1]);
      // 圆的标准式太长（已标记对象框一行放不下），写成「圆心(x, y) r=半径」
      return `(${num(center[0])}, ${num(center[1])})r=${num(radius)}`;
    }
    if (item.getType() === 'line') {
      const [p1, p2] = coord;
      const dx = p2[0] - p1[0];
      const dy = p2[1] - p1[1];
      if (Math.abs(dx) < 1e-9) return `x=${num(p1[0])}`;
      const k = dy / dx;
      const b = p1[1] - k * p1[0];
      // 水平线只写 y=b，过原点的只写 y=kx，斜率 ±1 时省略 1
      if (Math.abs(k) < 1e-9) return `y=${num(b)}`;
      const slope = Math.abs(k - 1) < 1e-9 ? 'x' : Math.abs(k + 1) < 1e-9 ? '-x' : `${num(k)}x`;
      const head = `y=${slope}`;
      return Math.abs(b) < 1e-9 ? head : `${head}${b < 0 ? '-' : '+'}${num(Math.abs(b))}`;
    }
    return '';
  };
  /**
   * 刷新面板里的一栏 过程函数
   * @param {string} id 列表 ID（marked-<id>）
   * @param {Set<string>} set 对应集合
   */
  const markListOf = (id, set) => {
    const list = markPanel.querySelector(`#marked-${id}`);
    if (!list) return;
    list.innerHTML = [...set].map(item => {
      const element = geometryManager.get(item);
      const equation = element ? equationOf(element) : '';
      return `<li><span class="mark-name">${item}</span>${equation ? `<span class="mark-eq">${equation}</span>` : ''}</li>`;
    }).join('') || `<li class="empty">${t('board.markEmpty')}</li>`;
  };
  const refreshMarks = () => {
    renderMarkPanel();
    refreshMarkEquations();
  };
  /**
   * 只刷新已标记对象栏里的坐标 / 方程 过程函数
   * 拖动图形时坐标会一直变，不能只在标记变化时刷（那样面板里还是旧坐标）；
   * 结构本身不动，所以开销只有几个 <li> 的文本
   */
  window.refreshMarkEquations = () => {
    givenMarkItems.forEach(([key]) => markListOf(key, markSetOf(key)));
    for (let index = 1; index <= resultGroupCount(); index++) {
      markListOf(`result-${index}`, resultSetOf(index, 'judged'));
      markListOf(`resultShown-${index}`, resultSetOf(index, 'shown'));
    }
    if (!solverMode) markListOf('explore', markSetOf('explore'));
  };
  /**
   * 解的编号按钮 过程函数
   * 数字 / + / − 用 SVG 文本画，样式与其它切换项一致，选中项变绿
   * @param {string} label 显示的字（1、2、+、−）
   * @param {string} actionKey data-action
   * @param {string} key data-solution（用于区分同一个 action 的多个按钮）
   * @param {boolean} active 是否选中
   * @param {Function} onClick 点击回调
   * @returns {HTMLButtonElement}
   */
  const solutionButton = (label, actionKey, key, active, onClick) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tool-switch-item floating-svg-switch-button mark-solution';
    button.dataset.action = actionKey;
    button.dataset.solution = key;
    const labelKey = actionKey === 'goal-select' ? 'board.markSolution'
      : actionKey === 'goal-add' ? 'board.markSolutionAdd' : 'board.markSolutionRemove';
    button.setAttribute('aria-label', t(labelKey, {index: label}));
    button.innerHTML = `<svg class="svg-icon" viewBox="0 0 200 200"><text class="mark-solution-text" x="100" y="100" text-anchor="middle" dominant-baseline="central">${label}</text></svg>`;
    button.classList.toggle('active', active);
    button.addEventListener('click', event => {
      event.stopPropagation();
      onClick();
    });
    return button;
  };
  /**
   * 切换当前解 过程函数
   * 标记写进这一组，画布上点亮的也是这一组（判定 + 显示）
   * @param {number} index
   */
  const selectSolution = index => {
    resultActive = Math.min(Math.max(index, 1), resultGroupCount());
    renderMarkOptions();
    refreshMarkHighlight();
    refreshMarks();
    if (typeof loadGeometryElements === 'function') loadGeometryElements();
  };
  /** 增加一组解 过程函数 */
  const addSolution = () => {
    const index = resultGroupCount() + 1;
    resultSetOf(index, 'judged');
    resultSetOf(index, 'shown');
    selectSolution(index);
    notifyStorageChange('mark-goal');
  };
  /** 删除最后一组解 过程函数 */
  const removeSolution = () => {
    const count = resultGroupCount();
    if (count <= 1) return;
    const removed = new Set([...resultSetOf(count, 'judged'), ...resultSetOf(count, 'shown')]);
    delete geometryElementLists[resultJudgeKey(count)];
    delete geometryElementLists[resultShownKey(count)];
    // 被删掉的那组对象不再属于任何标记，恢复自身的样式色
    removed.forEach(id => applyMarkToElement(id));
    markFoldState.delete(`result-${count}`);
    resultActive = Math.min(resultActive, resultGroupCount());
    selectSolution(resultActive);
    notifyStorageChange('mark-goal');
  };
  // 标记工具：标记给定（给定 / 带标签给定 / 可移动点）与标记所求（所求判定 / 所求显示）
  const markTools = [
    {
      tool: 'given', labelKey: 'board.markInitial', templateId: 'markInitial', actionKey: 'mark-initial', cssClass: 'mark-initial',
      options: [
        {key: 'initial', templateId: 'markInitial', actionKey: 'mark-initial', labelKey: 'board.markGiven'},
        {key: 'named', templateId: 'markNamed', actionKey: 'mark-named', labelKey: 'board.markNamed'},
        {key: 'movepoints', templateId: 'markMovepoints', actionKey: 'mark-movepoints', labelKey: 'board.markMovepoints'},
      ].filter(option => !solverMode || option.key === 'initial'),
    },
    {
      tool: 'goal', labelKey: 'board.markResult', templateId: 'markResult', actionKey: 'mark-result', cssClass: 'mark-result',
      options: [
        {key: 'result', templateId: 'markResult', actionKey: 'mark-result', labelKey: 'board.markResultJudge'},
        {key: 'resultShown', templateId: 'markResultShown', actionKey: 'mark-result-shown', labelKey: 'board.markResultShown'},
        {key: 'explore', templateId: 'explore', actionKey: 'mark-explore', labelKey: 'board.markExplore'},
      ].filter(option => !solverMode || option.key === 'result'),
    },
  ];
  /**
   * 标记的选项条 过程函数
   * 选项直接铺在工具栏（#container_toolbar）里，替掉工具按钮；
   * 每个选项按对应标记的颜色显示，选中后与其他工具一样变绿
   */
  const renderMarkOptions = () => {
    const toolbar = document.getElementById('container_toolbar');
    const markTool = markTools.find(item => item.tool === markingTool);
    if (!toolbar || !markTool) return;
    toolbar.innerHTML = '';
    markTool.options.forEach(option => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'tool-item svg-button mark-choice';
      button.dataset.action = option.actionKey;
      button.setAttribute('aria-label', t(option.labelKey));
      const template = document.getElementById(`svg-${option.templateId}`);
      if (template) button.innerHTML = template.innerHTML;
      button.classList.toggle('active', marking === option.key);
      button.addEventListener('click', event => {
        // 不要冒泡到「点工具栏就取消标记」的监听
        event.stopPropagation();
        marking = option.key;
        // 只改选中态，不重建整条工具条：重建会换掉 DOM 节点，
        // 正在按下的那个按钮的按下动画（:active / transition）就没了
        toolbar.querySelectorAll('.mark-choice').forEach(item => item.classList.toggle('active', item === button));
        renderMarkSwitches();
        // 画布上金色的范围跟着切换（选中所求显示 / 探索显示时只标对应的图形）
        refreshMarkHighlight();
      });
      toolbar.appendChild(button);
    });
    // 与切换工具分类一样重放一次展开动画
    toolbar.style.display = 'none';
    toolbar.offsetHeight;
    toolbar.style.display = 'flex';
    renderMarkSwitches();
  };
  /**
   * 标记模式下的切换栏 过程函数
   * 标记模式下用不到当前工具自己的选项条；多解时（所求判定 / 所求显示）给出解的编号与增删按钮
   */
  const renderMarkSwitches = () => {
    const choices = document.getElementById('floating-bar-elements');
    const switches = document.getElementById('floating-bar-buttons');
    if (choices) choices.innerHTML = '';
    if (!switches) return;
    switches.innerHTML = '';
    if (!solverMode && (marking === 'result' || marking === 'resultShown')) {
      const count = resultGroupCount();
      for (let index = 1; index <= count; index++) {
        switches.appendChild(solutionButton(String(index), 'goal-select', `goal-select-${index}`, index === resultActive, () => selectSolution(index)));
      }
      switches.appendChild(solutionButton('+', 'goal-add', 'goal-add', false, addSolution));
      if (count > 1) switches.appendChild(solutionButton('−', 'goal-remove', 'goal-remove', false, removeSolution));
      switches.style.display = 'flex';
    }
  };
  /**
   * 加入标记工具 过程函数
   * 按钮放在顶部菜单栏（#menu_toolbar）里，选项填在 #floating-bar-buttons
   */
  const addMarkTools = () => {
    const toolbar = document.getElementById('menu_toolbar');
    if (!toolbar || toolbar.querySelector('[data-marking]')) return;
    const divider = document.createElement('div');
    divider.className = 'tool-separator';
    toolbar.appendChild(divider);
    markTools.forEach(markTool => {
      const button = document.createElement('button');
      // mark-initial / mark-result：图标默认用标记色（黑 / 金），选中时与其他按钮一样变绿
      button.className = `svg-button mark-tool ${markTool.cssClass}`;
      button.dataset.action = markTool.actionKey;
      button.dataset.marking = markTool.tool;
      button.setAttribute('aria-label', t(markTool.labelKey));
      const template = document.getElementById(`svg-${markTool.templateId}`);
      if (template) button.innerHTML = template.innerHTML;
      button.addEventListener('click', () => {
        // 标记按钮不再支持再点一次取消，避免出现「没有任何按钮按下」的状态；
        // 回到这个工具时用默认选项（给定 / 所求判定），此时所求相关的图形统统标金
        markingTool = markTool.tool;
        // 已经在这个标记工具里时保持用户选的选项（例如「所求显示」）：
        // 无条件退回第一个选项会让画布上的金色突然变成所求判定的图形
        if (!markTool.options.some(option => option.key === marking)) marking = markTool.options[0].key;
        document.querySelectorAll('[data-marking]').forEach(item => item.classList.toggle('active', item === button));
        // 和其他按钮一样互斥：取消工具按钮与工具分类按钮的按下状态
        document.querySelectorAll('#container_toolbar .tool-item').forEach(item => item.classList.remove('active'));
        document.querySelectorAll('#menu_toolbar .menu-tool-item').forEach(item => item.classList.remove('active'));
        // 当前工具切到「移动视图」：标记模式下拖拽画布可平移，也不会误画图形
        tool = 'move';
        subTool = 'moveView';
        renderMarkOptions();
        // 回到「标记所求」这一层时，所求相关的图形统统标金
        refreshMarkHighlight();
        drawContent();
      });
      toolbar.appendChild(button);
    });
    const clearButton = document.createElement('button');
    clearButton.className = 'svg-button mark-clear';
    clearButton.dataset.action = 'clear-marks';
    clearButton.setAttribute('aria-label', t('board.clearMarks'));
    const clearTemplate = document.getElementById('svg-clear');
    if (clearTemplate) clearButton.innerHTML = clearTemplate.innerHTML;
    clearButton.addEventListener('click', () => {
      // 所有标记一并清掉（含探索显示与多解），并把解数收回 1
      allMarkSets().forEach(({set}) => set.clear());
      for (let index = resultGroupCount(); index > 1; index--) {
        delete geometryElementLists[resultJudgeKey(index)];
        delete geometryElementLists[resultShownKey(index)];
      }
      resultActive = 1;
      releaseAllMarkStyles();
      drawContent();
      refreshMarks();
      // 清除标记记一步历史
      notifyStorageChange('clear-marks');
    });
    toolbar.appendChild(clearButton);
  };
  // 切换工具分类会重建 #container_toolbar（换回工具按钮），这时自动退出标记模式
  if (mode === 'maker' || mode === 'solver') {
    const originalGenerateTool = typeof generateTool === 'function' ? generateTool : null;
    if (originalGenerateTool && !originalGenerateTool.markWrapped) {
      const wrappedGenerateTool = (...args) => {
        originalGenerateTool(...args);
        clearMarking();
      };
      wrappedGenerateTool.markWrapped = true;
      generateTool = wrappedGenerateTool;
    }
  }
  // 缩略图只属于关卡游玩（level.html 默认隐藏，此处按模式显示，避免加载瞬间闪现）
  const thumbnail = document.getElementById('thumbnail');
  if (thumbnail && mode === 'level') thumbnail.style.display = '';
  // 菜单：与导入导出共用同一套「按钮 + 弹层」实现
  const menuItems = [
    { label: t('board.construct'), templateId: 'menuConstruct', actionKey: 'switch-construct', action: () => menuChoice('switch-construct') },
    { label: t('board.overview'), templateId: 'menuOverview', actionKey: 'switch-overview', action: () => menuChoice('switch-overview') },
    { label: t('board.record'), templateId: 'menuRecord', actionKey: 'switch-record', action: () => menuChoice('switch-record') },
    { label: t('board.clearCanvas'), templateId: 'menuClearCanvas', actionKey: 'clear-canvas', action: () => menuChoice('clear-canvas') },
    { label: t('board.help'), templateId: 'help', actionKey: 'help', action: helpDialog },
  ];
  if (mode === 'level' && typeof designMode === 'function') menuItems.push({ label: t('board.designMode'), templateId: 'menuDesign', actionKey: 'design-mode', action: () => menuChoice('design-mode') });
  if (mode === 'level') {
    // 提前把答案索引读进来，没有收录答案图的关卡直接把菜单项置灰
    loadSolutionsData();
    menuItems.push({
      label: t('board.viewAnswer'),
      templateId: 'answer',
      actionKey: 'view-answer',
      action: showAnswer,
      available: levelHasAnswer,
      disabledHint: t('board.answerEmpty'),
    });
  }
  if (mode !== 'maker' && mode !== 'solver') menuItems.push({
    label: t('board.openSolver'),
    templateId: 'openSolver',
    actionKey: 'open-solver',
    action: openSolver,
    available: solverAvailable,
    disabledHint: t('board.solverNeedSolution'),
  });
  menuItems.push({ label: t('board.closeMenu'), templateId: 'menuClose', actionKey: 'close-menu', action: closePopups });
  popupButton(t('board.menu'), { templateId: 'menu', actionKey: 'open-menu', items: menuItems });
  if (mode === 'level' || mode === 'maker-play') add(t('board.explore'), () => { if (typeof exploreMode === 'function') exploreMode(); }, { templateId: 'explore', actionKey: 'explore' });
  if (mode === 'maker' || mode === 'solver') addMarkTools();
  if (mode === 'maker') {
    popupButton(t('board.exportGmt'), {
      templateId: 'exportGmt', actionKey: 'export-gmt',
      items: [
        { label: '查看 gmt 代码', templateId: 'gmtView', actionKey: 'gmt-view', action: () => codeDialog('gmt 代码', gmtText()) },
        { label: '导出为 gmt 文件', templateId: 'gmtSave', actionKey: 'gmt-save', action: saveGmtFile },
        { label: '导出至 Issue', templateId: 'gmtIssue', actionKey: 'gmt-issue', action: submitGmtIssue },
      ],
    });
    popupButton(t('board.importGmt'), {
      templateId: 'importGmt', actionKey: 'import-gmt',
      items: [
        { label: '导入 gmt 代码', templateId: 'gmtPaste', actionKey: 'gmt-paste', action: () => codeDialog('导入 gmt 代码', '', loadGmt) },
        { label: '导入 gmt 文件', templateId: 'gmtRead', actionKey: 'gmt-read', action: readGmtFile },
      ],
    });
    add(t('board.testPlay'), () => {
      if (typeof dataTransfer === 'function') dataTransfer();
      // 把自己这条历史记录改写成带 restore=1 的地址：这样点「返回」或浏览器后退都能还原编辑状态。
      // from 要一起带上：试玩返回制题器后，返回按钮还得知道最初是从哪个界面进来的（否则会退回首页）
      const keepFrom = params.get('from') ? '&from=' + encodeURIComponent(params.get('from')) : '';
      history.replaceState(null, '', './board.html?mode=maker&restore=1' + keepFrom);
      location.href = './level.html?mode=maker-play' + keepFrom;
    }, { templateId: 'testPlay', actionKey: 'switch-to-play' });
  } else if (mode === 'solver') {
    solverPanel();
  }
  // from：从关卡游玩 / 试玩跳过来时带着来处地址，返回按钮就回到那个界面并还原图形
  const backFrom = params.get('from');
  const backLabel = backFrom ? t('board.backPrevious') : mode === 'level' ? t('board.backPack') : mode === 'maker-play' ? t('board.backMaker') : t('board.backHome');
  const backActionKey = backFrom ? 'return-to-previous' : mode === 'level' ? 'return-to-pack' : mode === 'maker-play' ? 'return-to-maker' : 'return-to-home';
  // 返回按钮排在更多栏所有按钮的最后，显示在最右侧
  // 试玩返回制题器要带 restore=1：不带的话进入制题器会清空 elements 等本地数据，制题器里的图形就没了
  add(backLabel, () => {
    if (backFrom && mode !== 'maker-play') { location.href = backFrom; return; }
    // 试玩返回制题器：restore=1 还原编辑状态，from 继续往下传（制题器的返回按钮据此回到最初的界面）
    const fromParam = backFrom ? '&from=' + encodeURIComponent(backFrom) : '';
    const pageParam = params.get('page') ? '&page=' + encodeURIComponent(params.get('page')) : '';
    location.href = mode === 'level' ? './pack.html?pack=' + encodeURIComponent(params.get('pack')) + pageParam : mode === 'maker-play' ? './board.html?mode=maker&restore=1' + fromParam : '../index.html';
  }, { templateId: 'back', actionKey: backActionKey });
  if (mode === 'maker' || mode === 'solver') {
    // 收进底部上拉栏，画布上只留一个圆形按钮（见 addSideButton）
    // （面板里的各分组默认展开与否见 renderMarkPanel 的 foldOpened；上拉栏本身仍是收起的）
    addSideButton('mark', markSideIcon(), t('board.markedTitle'), wrapInSheet(markPanel, t('board.markedTitle')));
    refreshMarks();
  }
  // 求解器里「求解参数」按钮是先于「标记」按钮创建的，这里把顺序换过来：
  // 上边是标记、下边是求解参数（与制题器一致）
  if (mode === 'solver') {
    const sideBox = document.getElementById('side-buttons');
    const solverSideButton = document.getElementById('side-button-solver-params');
    if (sideBox && solverSideButton) sideBox.appendChild(solverSideButton);
  }
  // 关卡游玩：LE 计数器放在返回按钮下方（返回按钮此时已就位）
  if (typeof updateMovesCounterPosition === 'function') updateMovesCounterPosition();
  // 刷新页面上静态文案的语言
  if (typeof applyI18n === 'function') applyI18n();

  /**
   * 画板光标与悬停提示 过程函数
   * 各个画板（制题器 / 求解器 / 普通画板 / 关卡游玩 / 试玩）共用一套：
   *   靠近对象            -> 手指（pointer，提示点下去会选中它）
   *   移动工具 / 标记模式  -> 手指 + 跟着光标浮出对象名称与类型（这两处都是「点哪个对象」为主）
   *   空处                -> 四向箭头（move，提示可以拖动看画布）
   *   拖动画布            -> 抓手（grabbing，中键拖动时）
   *   作图有半成品        -> 十字（crosshair，提示正在等下一次点击）
   */
  (() => {
    const canvasElement = document.getElementById('canvas_id1');
    if (!canvasElement || typeof geometryManager === 'undefined') return;
    const tip = document.createElement('div');
    tip.className = 'object-tip';
    tip.hidden = true;
    document.body.appendChild(tip);
    let pointerDown = false;
    let panning = false;
    const typeLabel = element => {
      const type = element.getType();
      if (type === 'point') return t('board.objectPoint');
      if (type === 'circle') return t('board.objectCircle');
      const drawType = typeof element.getDrawType === 'function' ? element.getDrawType() : 'line';
      if (drawType === 'lineSegment') return t('board.objectSegment');
      if (drawType === 'ray') return t('board.objectRay');
      return t('board.objectLine');
    };
    // 光标位置（画布坐标 -> 逻辑坐标）附近的对象，判定范围与工具取点一致（15px）
    const hoveredElement = (clientX, clientY) => {
      if (typeof transform === 'undefined') return null;
      const x = clientX - canvasLeft;
      const y = clientY - canvasTop;
      const found = geometryManager.near([(x - transform.x) / transform.scale, (y - transform.y) / transform.scale], ['point', 'line', 'circle'], 1);
      const id = found && found[0];
      return id ? geometryManager.get(id) : null;
    };
    const refresh = (clientX, clientY) => {
      if (panning) {
        canvasElement.style.cursor = 'grabbing';
        tip.hidden = true;
        return;
      }
      const element = hoveredElement(clientX, clientY);
      // 移动工具与标记模式下浮出对象信息（marking 是制题器 / 求解器的标记状态）
      const moving = marking !== null || (typeof tool === 'string' && tool === 'move');
      if (element && moving) {
        tip.hidden = false;
        // named 图形的表观标签可能与作图时的变量名不同（gmt 的 named=A.M 把 A 显示成 M），
        const originalLabel = element.getId();
        const tipLabel = originalLabel && originalLabel !== element.getName() ? originalLabel : element.getName();
        tip.textContent = `${tipLabel} · ${typeLabel(element)}`;
        tip.style.left = `${clientX + 16}px`;
        tip.style.top = `${clientY + 18}px`;
      }else{
        tip.hidden = true;
      }
      if (element) {
        canvasElement.style.cursor = 'pointer';
      }else if (pointerDown && typeof tool === 'string' && tool === 'move' && geometryManager.getToolKey('move', 'choice')) {
        // 正用移动工具拖着对象：光标即使甩到很远、身下没有对象了，也保持手指 ——
        // 四向箭头是「拖画布」的暗示，拖对象的过程中出现会很跳
        canvasElement.style.cursor = 'pointer';
      }else if (typeof tool === 'string' && tool !== 'move') {
        // 作图 / 橡皮等工具：光标下没有对象时用普通箭头（四向箭头会让人以为能拖画布，十字又太"重"）
        canvasElement.style.cursor = '';
      }else{
        canvasElement.style.cursor = 'move';
      }
    };
    /**
     * 光标下的预览点 过程函数
     * 作图工具等待取点时，光标处始终有一个预览点：靠近已有点 / 交点（15px 内）就吸附过去，
     * 否则跟随光标。画在与画布对齐的覆盖层上，不产生几何对象、也不进撤销历史
     */
    const previewCanvas = document.createElement('canvas');
    previewCanvas.className = 'cursor-preview';
    previewCanvas.hidden = true;
    if (canvasElement.parentElement) canvasElement.parentElement.appendChild(previewCanvas);
    // 预览该吸附到哪里：**点 / 交点优先**（两者都在 15px 吸附范围内时取更近的那个），
    // 附近既没有点也没有交点时，才退而吸附到线 / 圆上（把光标投到对象上）
    /**
     * 交点工具的光标吸附 过程函数
     * 交点工具取的是「两个图形的交点」，落点是算出来的、不是光标指着的位置：
     *   还没选图形 → 只有光标正压在某个相交处才给预览（其余时候连点预览都不画）；
     *   已选了一个图形 → 光标下有第二个图形且与它有交点时，预览落在那个交点上（多个取最近的）
     * @param {number} logicalX 逻辑 x
     * @param {number} logicalY 逻辑 y
     * @returns {{x: number, y: number, snapped: boolean}}
     */
    const intersectionSnapOf = (logicalX, logicalY) => {
      const first = geometryManager.getToolKey('intersection', 'choice1');
      if (!first) {
        // 还没选图形：光标下确实是相交的位置才给预览
        const only = geometryManager.nearestIntersection(logicalX, logicalY);
        return only
          ? {x: only.x, y: only.y, snapped: true}
          : {x: logicalX, y: logicalY, snapped: false};
      }
      // 已经选了一个图形：取光标下最近的**另一个**图形，预览落在它与第一个图形的交点上
      // （光标通常正压在刚选的那条线上，所以要跳过自身；near() 的返回顺序不是按距离排的，
      //  这里自己逐个算一次「光标投到它上面的距离」再挑最近的那个）
      const nearIds = geometryManager.near([logicalX, logicalY], ['line', 'circle'], 8)
        .filter(item => item !== first.getId());
      let second = null;
      let secondDistance = Infinity;
      nearIds.forEach(item => {
        const element = geometryManager.get(item);
        const coord = element?.getCoordinate?.();
        if (!coord) return;
        const p1 = {x: coord[0][0], y: coord[0][1]};
        const p2 = {x: coord[1][0], y: coord[1][1]};
        const p3 = {x: logicalX, y: logicalY};
        let on = null;
        if (element.getType() === 'line') {
          // 不夹紧的投影（nearPointOnLine 会把比例夹到 [0,1]，落在渲染段外的点会被拽回端点上）
          on = ToolsFunction.onlineCoordinateOf(p1, p2, p3);
        }else{
          on = ToolsFunction.radianToCoordinate(p1, p2, ToolsFunction.nearPointOnCircle(p1, p3));
        }
        if (!on) return;
        const distance = Math.hypot(on.x - logicalX, on.y - logicalY);
        if (distance < secondDistance) {
          secondDistance = distance;
          second = element;
        }
      });
      if (second) {
        const candidates = ToolsFunction.intersectionCandidates(first, second).filter(item =>
          ToolsFunction.pointInElementRange(item.x, item.y, first) &&
          ToolsFunction.pointInElementRange(item.x, item.y, second));
        let best = null;
        candidates.forEach(item => {
          const distance = Math.hypot(item.x - logicalX, item.y - logicalY);
          if (!best || distance < best.distance) best = {x: item.x, y: item.y, distance: distance};
        });
        if (best) return {x: best.x, y: best.y, snapped: true};
      }
      return {x: logicalX, y: logicalY, snapped: false};
    };
    /**
     * 预览吸附位置（逻辑坐标）过程函数
     * 光标的预览点、落点、以及 canvas.js 里那个半透明图形预览都用它 ——
     * 三处共用一份逻辑，才不会出现「点预览吸对了、图形预览却从邻近的另一个交点擦过去」
     * @param {number} logicalX 逻辑 x
     * @param {number} logicalY 逻辑 y
     * @returns {{x: number, y: number, snapped: boolean}}
     */
    const previewSnapLogicalOf = (logicalX, logicalY) => {
      if (typeof transform === 'undefined') return {x: logicalX, y: logicalY, snapped: false};
      if (typeof tool === 'string' && tool === 'intersection') {
        return intersectionSnapOf(logicalX, logicalY);
      }
      let best = null;
      const pointId = geometryManager.near([logicalX, logicalY], ['point'], 1)[0];
      if (pointId) {
        const coord = geometryManager.get(pointId).getCoordinate();
        best = {x: coord[0], y: coord[1], distance: Math.hypot(coord[0] - logicalX, coord[1] - logicalY)};
      }
      // 本来就相交的位置（还没有交点对象的那种）也要能吸附 —— 和点同等优先，取更近的一个
      const intersection = geometryManager.nearestIntersection(logicalX, logicalY);
      if (intersection && (!best || intersection.distance < best.distance)) {
        best = {x: intersection.x, y: intersection.y, distance: intersection.distance};
      }
      // 没有点 / 交点时才吸附线 / 圆：把光标投到最近的线或圆上（点工具落在对象上就是这个位置）
      if (!best) {
        const elementId = geometryManager.near([logicalX, logicalY], ['line', 'circle'], 1)[0];
        const element = elementId ? geometryManager.get(elementId) : null;
        const coord = element?.getCoordinate?.();
        if (coord) {
          const p1 = {x: coord[0][0], y: coord[0][1]};
          const p2 = {x: coord[1][0], y: coord[1][1]};
          const p3 = {x: logicalX, y: logicalY};
          let on = null;
          if (element.getType() === 'line') {
            const projected = ToolsFunction.onlineCoordinateOf(p1, p2, p3);
            on = {x: projected.x, y: projected.y};
          }else{
            const value = ToolsFunction.nearPointOnCircle(p1, p3);
            const projected = ToolsFunction.radianToCoordinate(p1, p2, value);
            on = {x: projected.x, y: projected.y};
          }
          if (on) best = {x: on.x, y: on.y, distance: Math.hypot(on.x - logicalX, on.y - logicalY)};
        }
      }
      if (!best) return {x: logicalX, y: logicalY, snapped: false};
      return {x: best.x, y: best.y, snapped: true};
    };
    window.previewSnapLogical = (logicalX, logicalY) => previewSnapLogicalOf(logicalX, logicalY);
    const previewSnapOf = (x, y) => {
      if (typeof transform === 'undefined') return {x: x, y: y, snapped: false};
      const logicalX = (x - transform.x) / transform.scale;
      const logicalY = (y - transform.y) / transform.scale;
      const snap = previewSnapLogicalOf(logicalX, logicalY);
      if (!snap.snapped) return {x: x, y: y, snapped: false};
      return {x: transform.x + snap.x * transform.scale, y: transform.y + snap.y * transform.scale, snapped: true};
    };
    /**
     * 吸附后的落点 过程函数
     * 作图工具（点 / 交点 / 直线 / 圆…）在取点前先把光标位置换成本函数给出的吸附位置，
     * 于是「预览点吸到哪里，草稿图与真正落下的点就在哪里」——
     * 不换的话会出现两种毛病：预览点吸到隐交点上、可线还跟着光标走；
     * 以及最后一个点点在隐交点上时点不出点也画不出图形（那个位置没有任何对象可供工具取点）
     * 移动工具与橡皮不吸附：它们的坐标是拖拽 / 拾取用的
     * @param {number} x 画布坐标
     * @param {number} y 画布坐标
     * @returns {number[]} [x, y]
     */
    window.snapCursorPosition = (x, y) => {
      if (typeof tool === 'undefined' || tool === 'move' || tool === 'eraser') return [x, y];
      const snap = previewSnapOf(x, y);
      return [snap.x, snap.y];
    };
    const drawPreview = (clientX, clientY) => {
      const context = previewCanvas.getContext('2d');
      // 预览点只在「点 / 交点工具」或「正在等下一个点的工具」下出现（后者 canvas.js 的预览同时会画图形）
      const active = typeof tool === 'string' && tool !== 'move' && tool !== 'eraser';
      if (!active || panning || typeof transform === 'undefined') {
        context.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
        previewCanvas.hidden = true;
        return;
      }
      // 光标下的点预览「下一步真的是落点」时才画，下面几种情况都不是：
      // · 平行线 / 垂线：下一步可能是「选一条线」，只有已经选中了线才画（先点了点也一样：下一步还是选线）
      // · 两直线角平分线：两步都是选直线，全程不画
      // · 复制圆规：还没点圆时下一步是「选一个圆」，点了圆之后下一步才是落圆心
      const hidePreviewPoint =
          ((tool === 'parallelLine' || tool === 'perpendicularLine') && !geometryManager.getToolKey(tool, 'line'))
          || subTool === 'twoLineAngleBisector'
          || (subTool === 'compassCopy' && !geometryManager.getToolKey(tool, 'circle'))
          // 样式刷 / 隐藏刷 / 切换线类型：光标自己已经画成圆环（或隐藏刷的方块）了，
          // 再叠一个点预览只会互相干扰
          || tool === 'styleBrush'
          || tool === 'lineType'
          // 刚点完一下、指针还没真的移动：点预览也等指针动过再出现，
          // 免得「点完一条线」的瞬间就冒出「过该点的平行线 / 垂线」那一下的落点预览
          // （与画布上半成品草稿图的规则一致，见 canvas.js 的 previewWaiting）
          || (typeof previewWaiting === 'function' && previewWaiting());
      if (hidePreviewPoint) {
        context.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
        previewCanvas.hidden = true;
        return;
      }
      const width = canvasElement.clientWidth;
      const height = canvasElement.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      if (previewCanvas.style.width !== `${width}px`) {
        previewCanvas.style.width = `${width}px`;
        previewCanvas.style.height = `${height}px`;
        previewCanvas.style.left = `${canvasElement.offsetLeft}px`;
        previewCanvas.style.top = `${canvasElement.offsetTop}px`;
        previewCanvas.width = Math.round(width * dpr);
        previewCanvas.height = Math.round(height * dpr);
      }
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);
      const x = clientX - canvasLeft;
      const y = clientY - canvasTop;
      if (x < 0 || y < 0 || x > width || y > height) {
        previewCanvas.hidden = true;
        return;
      }
      previewCanvas.hidden = false;
      const snap = previewSnapOf(x, y);
      // 圆心工具：这个工具只会作出圆心，所以点预览落在「光标靠近的那个圆」的圆心上，
      // 样式跟其他点预览完全一样（同一份代码画），只是位置不在光标处
      let previewPoint = snap;
      if (subTool === 'circleCenter') {
        const logical = [(x - transform.x) / transform.scale, (y - transform.y) / transform.scale];
        const [circleId] = geometryManager.near(logical, ['circle'], 1);
        const coord = circleId ? geometryManager.get(circleId)?.getCoordinate?.() : null;
        if (!coord) {
          previewCanvas.hidden = true;
          context.clearRect(0, 0, width, height);
          return;
        }
        previewPoint = {x: transform.x + coord[0][0] * transform.scale, y: transform.y + coord[0][1] * transform.scale};
      }
      // 交点工具取的一定是交点：还在选图形的阶段（没吸到任何交点）就不给点预览
      if (tool === 'intersection' && !snap.snapped) {
        previewCanvas.hidden = true;
        context.clearRect(0, 0, width, height);
        return;
      }
      // 样式与点图形一致（外径 8px + 内径 4px 白芯），但整体半透明：
      // 它只是「将要落在哪里」的预览，还没有真正落下
      context.globalAlpha = 0.5;
      context.beginPath();
      context.arc(previewPoint.x, previewPoint.y, 8, 0, Math.PI * 2);
      context.fillStyle = 'rgb(25, 25, 25)';
      context.fill();
      context.beginPath();
      context.arc(previewPoint.x, previewPoint.y, 4, 0, Math.PI * 2);
      context.fillStyle = 'rgb(255, 255, 255)';
      context.fill();
      context.globalAlpha = 1;
    };
    canvasElement.addEventListener('pointermove', event => {
      const clientX = event.clientX;
      const clientY = event.clientY;
      drawPreview(clientX, clientY);
      // 已标记对象栏里的坐标要跟着光标实时更新
      if (typeof refreshMarkEquations === 'function') refreshMarkEquations();
      // 中键拖画布时不刷新悬停提示（整个画面在动，提示跟着飘没意义）
      if (panning) return;
      // 作图工具按住拖动时不刷新，免得半成品还没落位、提示就跳来跳去；
      // 但移动工具拖对象时要跟着走 —— 那个提示框显示的就是「正在拖的这个对象」，它得一直贴着光标
      if (pointerDown && typeof tool === 'string' && tool !== 'move') return;
      refresh(clientX, clientY);
    });
    canvasElement.addEventListener('pointerleave', () => { previewCanvas.hidden = true; });
    canvasElement.addEventListener('pointerdown', event => {
      pointerDown = true;
      // 中键拖动 = 移动画布
      panning = event.button === 1;
      // 按下 / 松开这一帧也要把预览点重画一次：作图工具在这里会把半成品提交成对象，
      // 覆盖层如果等到下一次 pointermove 才刷新，中间那一帧预览是空的，看上去就是「预览闪了一下」
      drawPreview(event.clientX, event.clientY);
      refresh(event.clientX, event.clientY);
    });
    const endPointer = event => {
      pointerDown = false;
      panning = false;
      drawPreview(event.clientX, event.clientY);
      refresh(event.clientX, event.clientY);
    };
    canvasElement.addEventListener('pointerup', endPointer);
    canvasElement.addEventListener('pointercancel', endPointer);
    canvasElement.addEventListener('pointerleave', () => {
      panning = false;
      tip.hidden = true;
      canvasElement.style.cursor = '';
    });
  })();
})();