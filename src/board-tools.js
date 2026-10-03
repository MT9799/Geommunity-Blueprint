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
  if (!isLevel && mode !== 'maker-play' && !restoreMaker && !roundTrip) ['elements', 'geometryElementLists', 'thumbnail', 'constructRecord', 'makerBackup', 'gridMeta'].forEach(key => sessionStorage.removeItem(key));
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
  // 标记的互斥关系：给定三项（给定 / 带标签给定 / 可移动点）互相排斥，一个对象只属于其中一个；
  // 所求判定 / 所求显示 / 探索显示**彼此可以共存**，但它们与给定那三类互斥 ——
  // 一个图形要么是题面条件，要么是目标 / 探索对象，不能两头都占（见 markExclusive）
  const givenMarkKeys = ['initial', 'named', 'movepoints'];
  const goalMarkKeys = ['result', 'resultShown', 'explore'];
  // 求解器只保留「给定」与「所求判定」，制题器保留完整的 3 + 3
  const solverMode = mode === 'solver';
  const markSetOf = key => geometryElementLists[key] || new Set();
  // 当前画布上的网格信息（没有网格时为 null）：{m, n, unit, style, ids: Set}。
  // 声明放在前面：快照（collectStorageSnapshot）在页面初始化时就会被调用
  let gridMeta = null;
  /** 网格信息（去掉 ids），供快照 / 记录使用 过程函数 */
  const gridMetaSnapshot = () => (gridMeta
    ? {m: gridMeta.m, n: gridMeta.n, unit: gridMeta.unit, style: gridMeta.style}
    : null);
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
  /**
   * 标上某一类之前先撤掉与它互斥的标记 过程函数
   * 规则：给定三项（给定 / 带标签给定 / 可移动点）互相排斥；所求判定 / 所求显示 / 探索显示
   * 彼此可以共存，但与给定三类互斥 —— 例如把「给定」的图形标成「所求判定」，
   * 它的给定标记就被撤掉（反之把「所求判定」的图形标成「给定」，所求判定也撤掉）
   * @param {string} id 对象 id
   * @param {string} key 要标的这一类（initial / named / movepoints / result / resultShown / explore）
   */
  const markExclusive = (id, key) => {
    if (givenMarkKeys.includes(key)) {
      // 给定：同类里只留这一个；所求（含多解每一组的判定与显示）与探索显示一并撤掉
      givenMarkKeys.forEach(other => { if (other !== key) markSetOf(other).delete(id); });
      resultMarkSets().forEach(item => item.set.delete(id));
      markSetOf('explore').delete(id);
      return;
    }
    if (goalMarkKeys.includes(key)) {
      // 所求类 / 探索显示：彼此共存、不动对方，只撤掉给定那三类
      givenMarkKeys.forEach(other => markSetOf(other).delete(id));
    }
  };
  // 元素一览（geometryItem.js）补标记时也要守同一条互斥规则
  window.markExclusive = (id, key) => markExclusive(id, key);
  // 标记面板「给定」一组的条目（求解器只留给定）
  const givenMarkItems = [
    ['initial', 'board.markGiven'],
    ['named', 'board.markNamed'],
    ['movepoints', 'board.markMovepoints'],
  ].filter(([key]) => !solverMode || key === 'initial');
  /**
   * 「给定」一栏要显示的对象 过程函数
   * 求解器里那栏只有一种，而带标签给定（named）也是给定 —— 不并到一起的话，
   * 载入带 named 的 gmt / 记录时那些对象会按给定染黑，却不在给定栏里露面
   */
  const givenColumnIds = () => {
    const ids = new Set(markSetOf('initial'));
    if (solverMode) markSetOf('named').forEach(id => ids.add(id));
    return ids;
  };
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
    // 网格信息随快照一起走：撤销 / 重做要能连同网格一起还原（网格当作一整块）
    return {elements: geometryManager.toStorage(), lists: lists, grid: gridMetaSnapshot()};
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
    // 画布清空了，网格元信息也得跟着清：不然导出 / 记录仍会写 #grid= 那两行，
    // 而且清空之后紧接着记的历史快照里也带着网格 —— 求解器每撤回一次就以为回到了网格模式
    // （见 gmtText / loadStorageSnapshot 里同一件事的两道保险）
    setGridMeta(null);
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
    // 工具自己的 clear 不一定清掉管理器里的缓存（geometryManager.choice[工具]）——
    // 那里面存着「画到一半」的旧对象引用，换了一整套图形之后不清的话，
    // 之后作图会取到已经不存在的对象（报 null.getCoordinate、点一下没反应、历史也记不下来）
    if (typeof geometryManager !== 'undefined' && geometryManager
      && typeof geometryManager.deleteAllCache === 'function') {
      geometryManager.deleteAllCache();
    }
    if (typeof refreshToolFloating === 'function') refreshToolFloating();
  };
  /**
   * 统一「给定」三项的读入口径 过程函数
   * 有些 gmt / 记录里同一个对象既写在 initial= 又写在 named= 里（早期导出或手工编辑过）。
   * 带标签给定是更强的说明，这种对象一律按 **named** 读：从 initial 名单里去掉。
   * 否则「给定」与「带标签给定」两栏同时挂着它，标签与颜色该听谁的也说不清
   */
  window.normalizeGivenMarks = () => {
    const named = geometryElementLists.named;
    const initial = geometryElementLists.initial;
    if (!named || !initial) return;
    named.forEach(id => initial.delete(id));
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
    // loadStorage 会按当前绘制样式（如自动配色）重新给对象上色 / 定粗细，这里按快照逐项还原。
    // 快照本身就是完整的（getDict 连颜色 / 粗细 / 标签 / 虚线都存了），所以这里还原齐全之后，
    // 撤回 / 重做就不必再让记录面板「按记录的样式表补一次」—— 那套是按**对象名**补的，
    // 而撤掉的对象名会被新画的图形复用（E / F / s1 …），补上去就把新图形改成旧对象的颜色 / 显隐
    const dicts = new Map(elements.map(item => [item.id, item]));
    const restoreStyle = (item, method, value) => {
      if (value === undefined || value === null) return;
      if (typeof GeometryElement.prototype[method] !== 'function') return;
      GeometryElement.prototype[method].call(item, value);
    };
    geometryManager.getAllByOrder().forEach(item => {
      const dict = dicts.get(item.getId());
      if (!dict) return;
      // 直接用原型上的方法：标记中的对象 modifyColor / modifyShowName 被改写为「只记样式」，
      // 而快照里存的就是当时的显示值（标记色），照它还原才对
      restoreStyle(item, 'modifyColor', dict.color);
      restoreStyle(item, 'modifyWidth', dict.width);
      restoreStyle(item, 'modifyShowName', dict.showName);
      restoreStyle(item, 'modifyDashed', dict.dashed);
    });
    // 网格：按快照确认这次还有没有网格（没有就清掉 —— 否则撤销掉网格之后导出仍会带 #grid= 行，
    // 求解器也会以为还处在网格模式）
    const gridOfSnapshot = !isList && snapshot?.grid ? snapshot.grid : null;
    setGridMeta(gridOfSnapshot
      ? {m: gridOfSnapshot.m, n: gridOfSnapshot.n, unit: gridOfSnapshot.unit, style: gridOfSnapshot.style}
      : null);
    if (!isList && snapshot?.lists) {
      // 先把所有标记表清空再按快照填：瘦身过的撤销清单会省掉**空的**标记表（见 recordStore 的
      // slimUndolist），只填不清理的话，上一步的标记会留在原地 —— 表现为撤销后「对象已经不在
      // 画布上了，标记面板里还挂着它」
      Object.keys(geometryElementLists).forEach(key => { geometryElementLists[key] = new Set(); });
      Object.entries(snapshot.lists).forEach(([key, value]) => { geometryElementLists[key] = new Set(value); });
      // 读入口径：同时写在 initial 与 named 里的对象按 named 算（撤销 / 重做恢复快照时同样守它）
      if (typeof window.normalizeGivenMarks === 'function') window.normalizeGivenMarks();
      // 快照换了整套图形，工具缓存也要扔（同 loadGmt）；duplicatedFlag 残留会吃掉下一格历史
      if (typeof window.resetToolState === 'function') window.resetToolState();
      geometryManager.duplicatedFlag = false;
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
      // 记历史前一定把「开闸」打开：没开闸时 append 是空操作（见 StorageManager.append），
      // 历史会静静变成空的 —— 之后作图就再也记不进撤销，撤回当然不正常
      manager.setStatus(true);
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
    // 网格当作一整块：它那几十个对象**不参与逐个记档**，只在「它出现的位置」整块加一次 ——
    // 既不会被一条条剥掉，撤回顺序也仍是作图顺序（网格最先作、就最后撤掉）
    const gridIds = gridMeta?.ids || new Set();
    const gridPart = full.elements.filter(item => gridIds.has(item.id));
    const batches = [];
    let gridQueued = false;
    full.elements.forEach(item => {
      if (!gridIds.has(item.id)) { batches.push([item]); return; }
      if (gridQueued) return;
      gridQueued = true;
      batches.push(gridPart);
    });
    const pushStep = elements => {
      const ids = new Set(elements.map(item => item.id));
      const lists = {};
      Object.entries(full.lists).forEach(([key, value]) => { lists[key] = value.filter(id => ids.has(id)); });
      steps.push({elements: elements, lists: lists});
    };
    let accumulated = [];
    batches.forEach(batch => {
      accumulated = accumulated.concat(batch);
      pushStep(accumulated);
    });
    // 网格信息跟着「整套网格都在」的那些档走：撤到网格那一档时它仍是网格（能识别、能上样式），
    // 撤过网格那一档才彻底没有网格 —— 只挂在最后一档的话，中间那些含网格的档会被当成「没有网格」，
    // 画布上却还留着那批格线
    const gridOfFull = gridMetaSnapshot();
    if (gridOfFull) {
      steps.forEach(step => {
        const ids = new Set(step.elements.map(item => item.id));
        if ([...gridMeta.ids].every(id => ids.has(id))) step.grid = gridOfFull;
      });
    }
    // 普通 / 所求 / 探索三套存储都以这些步骤为历史
    [storageManager, typeof storageManagerResult !== 'undefined' ? storageManagerResult : null, typeof storageManagerExplore !== 'undefined' ? storageManagerExplore : null].forEach(manager => {
      if (!manager) return;
      manager.clear();
      // 记历史前一定把「开闸」打开：没开闸时 append 是空操作（见 StorageManager.append），
      // 历史会静静变成空的 —— 那之后作图就再也记不进撤销，撤回当然不正常
      manager.setStatus(true);
      steps.forEach(step => manager.append(step));
    });
    // 残留的 duplicatedFlag 会让下一次 storage 事件被当成「这次作图作废」而不记历史（见 index.js）
    if (typeof geometryManager !== 'undefined' && geometryManager) geometryManager.duplicatedFlag = false;
    if (typeof movesStorageManager !== 'undefined') {
      [movesStorageManager, typeof movesStorageManagerResult !== 'undefined' ? movesStorageManagerResult : null, typeof movesStorageManagerExplore !== 'undefined' ? movesStorageManagerExplore : null].forEach(manager => {
        if (!manager) return;
        manager.clear();
        manager.setStatus(true);
        manager.append({e: 0, l: 0});
      });
    }
    refreshStorageButton();
    };
    /**
    * 按名单铺撤销/重做历史 过程函数
    * 记录里的 undolist 是一串「gmt 对象行序号」（与 getAllByOrder 一一对应）：
    * 第 0 格是名单外的对象（游玩模式＝关卡自带的图形），之后每加一个名单里的对象记一格 ——
    * 于是载入记录后只能逐一撤回名单里的图形，跟在关卡里一步步作图的手感一致。
    * listed 传 null 表示名单就是全部对象（把游玩模式导出的记录导入画板时用）
    * @param {number[]|null} listed 对象行序号（1 起数，只数对象行）
    * @returns {number} 铺出来的格数
    */
    window.buildStorageHistoryFromList = listed => {
    const full = collectStorageSnapshot();
    const nodes = full.elements;
    const order = nodes.map((item, at) => at + 1);
    const indexList = Array.isArray(listed) ? order.filter(index => listed.includes(index)) : order.slice();
    const baseline = order.filter(index => !indexList.includes(index));
    // 网格当作一整块：它那几十个对象要在历史里**一起**出现，否则从记录载入的网格会被一条条撤掉。
    // 位置留在它原本的地方（网格通常是文件里最先作的那批，于是最后才被撤掉，与作图顺序一致）；
    // 网格本来就在名单外（关卡自带的图形）时它属于每一格，不必并
    const gridIds = gridMeta?.ids || new Set();
    const isGridIndex = index => !!(nodes[index - 1] && gridIds.has(nodes[index - 1].id));
    const gridIndices = indexList.filter(isGridIndex);
    const batches = [];
    let gridQueued = false;
    indexList.forEach(index => {
      if (!isGridIndex(index)) { batches.push(index); return; }
      if (gridQueued) return;
      gridQueued = true;
      batches.push(gridIndices);
    });
    const snapshotOf = indices => {
      const sorted = indices.slice().sort((one, two) => one - two);
      const ids = new Set(sorted.map(index => nodes[index - 1].id));
      const lists = {};
      Object.entries(full.lists).forEach(([key, value]) => { lists[key] = value.filter(id => ids.has(id)); });
      const snapshot = {elements: sorted.map(index => nodes[index - 1]), lists: lists};
      // 网格当作一整块：只有把整套网格都含进来的那一格才算「有网格」（半套网格没有意义）
      if (gridMeta && ids.size && [...gridMeta.ids].every(id => ids.has(id))) snapshot.grid = gridMetaSnapshot();
      return snapshot;
    };
    const steps = [snapshotOf(baseline)];
    let accumulated = baseline.slice();
    batches.forEach(batch => {
      accumulated = accumulated.concat(Array.isArray(batch) ? batch : [batch]);
      steps.push(snapshotOf(accumulated));
    });
    [storageManager, typeof storageManagerResult !== 'undefined' ? storageManagerResult : null, typeof storageManagerExplore !== 'undefined' ? storageManagerExplore : null].forEach(manager => {
      if (!manager) return;
      manager.clear();
      // 同 resetStorageHistory：先开闸，否则 append 会被 StorageManager 静默丢掉
      manager.setStatus(true);
      steps.forEach(step => manager.append(step));
    });
    // 同 resetStorageHistory：别把上一次动作残留的 duplicatedFlag 带过去
    if (typeof geometryManager !== 'undefined' && geometryManager) geometryManager.duplicatedFlag = false;
    refreshStorageButton();
    return steps.length;
    };

  if (mode === 'maker' && sessionStorage.getItem('elements')) {
    document.addEventListener('DOMContentLoaded', () => {
      const elements = JSON.parse(sessionStorage.getItem('elements'));
      geometryManager.loadStorage(elements);
      const savedLists = JSON.parse(sessionStorage.getItem('geometryElementLists') || '{}');
      Object.entries(savedLists).forEach(([key, value]) => { geometryElementLists[key] = new Set(value); });
      // 网格：制题器里生成过网格时这份会话带着网格元信息（见 index.js 的 dataTransfer）——
      // 按它登记网格（藏起辅助对象）并把视图适配回网格范围
      const savedGrid = JSON.parse(sessionStorage.getItem('gridMeta') || 'null');
      if (savedGrid) setGridMeta(savedGrid);
      // 视图适配（并记下「初始视图」）：有网格就适配到网格范围，没有网格就按带过来的图形本身
      fitViewToContent();
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
      // 网格：从关卡 / 试玩带过来的网格，按同一份元信息登记并把视图适配到网格范围
      if (data.grid) {
        setGridMeta(data.grid);
        fitViewToGrid(gridMeta);
      }
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
    // 网格也带过去：求解器里按它登记网格（藏起辅助对象、上样式）并把视图适配到网格范围
    sessionStorage.setItem('solverElements', JSON.stringify({elements: elements, lists: lists, grid: gridMetaSnapshot()}));
    // from：求解器的「返回」据此回到本页并还原图形（关卡游玩 / 试玩由 savePlayBackup 存备份）
    const from = typeof savePlayBackup === 'function' ? savePlayBackup() : '';
    // 本关限定了工具（单尺 / 单规）时，把对应的求解器模式一起带过去：
    // 求解器面板的「可用工具」默认就选到同一种（2 尺规 / 1 单尺 / 0 单规）
    const levelTool = typeof window.levelTools === 'string' ? window.levelTools : '';
    // grid：这一关限定网格直尺 → 求解器默认就选「网格」模式（面板再按网格大小与步数 4 调整）
    const solverTool = levelTool === 'straightedge' ? '1' : levelTool === 'compass' ? '0' : levelTool === 'grid' ? '3' : '';
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
   * 选项弹框 过程函数
   * 一组「图标 + 文字」的选项竖排（导入 / 导出 gmt 这类）：原来是弹层菜单，
   * 手机上会占掉大半个屏幕，改成站内弹框
   * @param {string} title 标题
   * @param {Object[]} items {label, templateId, actionKey, action}
   * @returns {Object} 遮罩元素
   */
  const optionDialog = (title, items) => {
    const mask = document.createElement('div');
    mask.className = 'board-dialog-mask';
    mask.innerHTML = '<div class="board-dialog board-dialog-options"><strong></strong><div class="board-dialog-list"></div><div class="board-dialog-actions"></div></div>';
    mask.querySelector('strong').textContent = title;
    const list = mask.querySelector('.board-dialog-list');
    items.forEach(item => {
      const button = document.createElement('button');
      button.type = 'button';
      // 与弹层菜单同一套按钮样式（图标 + 文字）
      button.className = 'popup-item';
      button.dataset.action = item.actionKey;
      button.setAttribute('aria-label', item.label);
      const template = document.getElementById(`svg-${item.templateId}`);
      if (template) button.innerHTML = template.innerHTML;
      const text = document.createElement('span');
      text.textContent = item.label;
      button.appendChild(text);
      button.addEventListener('click', () => { mask.remove(); item.action(); });
      list.appendChild(button);
    });
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.textContent = t('common.cancel');
    cancelButton.addEventListener('click', () => mask.remove());
    mask.querySelector('.board-dialog-actions').appendChild(cancelButton);
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
   * 全屏看一张图 过程函数
   * 与关卡示意图（缩略图那个 .thumbnail-zoom）同一套观感：黑底铺满、点哪儿都关掉。
   * 答案图原来是在弹层里原地放大（.answer-figure.zoom），手机上会把整排在图上撑开，
   * 所以改成和示意图一样点开全屏看
   * @param {string} src 图片地址
   * @param {string} [alt] 说明文字
   * @returns {HTMLElement} 遮罩本身
   */
  const imageZoomOverlay = (src, alt) => {
    const mask = document.createElement('div');
    mask.className = 'image-zoom';
    const picture = document.createElement('img');
    picture.src = src;
    picture.alt = alt || '';
    mask.appendChild(picture);
    mask.addEventListener('click', () => mask.remove());
    document.body.appendChild(mask);
    return mask;
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
        // 点开全屏大图（与关卡示意图同一套观感），不再是原地放大 ——
        // 原地放大在手机上会把整排答案图一起撑开
        picture.addEventListener('click', () => imageZoomOverlay(picture.src, picture.alt));
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
          // 第四个参数是「已知的那个交点」，导出时一并写回去；带已知点时编号写 `-`：
          // 去掉那个点之后只剩一个候选，写不写编号结果一样，而 gmt 里就是 `Intersect[图形1,图形2,-,C]` 这种写法
          const known = base.excludeId ? `,${base.excludeId}` : '';
          const slot = base.excludeId ? '-' : value;
          return `${id}=Intersect[${args[0]},${args[1]},${slot}${known}]`;
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
  // 网格作图（模式 3「网格直尺」）：整块网格是一套用 gmt 指令**作**出来的对象 ——
  // 老版本读到也只是当普通作图，照样能把网格画出来。id 一律以 g 开头，
  // 其中网格线段是 gSX* / gSY*，其余（圆规滚出来的格点、过格点的垂线等）是作图过程的辅助对象。
  const GRID_DEFAULT_UNIT = 50;
  const GRID_MIN_SIZE = 2;
  const GRID_MAX_SIZE = 20;
  const GRID_SEGMENT_PATTERN = /^gS[XY]\d+$/;
  /** 是不是模板里的辅助对象（g 开头但不是网格线段） */
  const isGridHelperId = id => typeof id === 'string' && id.startsWith('g') && !GRID_SEGMENT_PATTERN.test(id);
  /** 是不是网格线段（网格当作一整块时真正参与作图的那部分） */
  const isGridSegmentId = id => typeof id === 'string' && GRID_SEGMENT_PATTERN.test(id);
  /**
   * 这个 id 是不是网格的一部分 过程函数
   * 网格在界面上当作**一个整体**：选择、样式、删除 / 刷子 / 线型转换的禁用都看它
   */
  const isGridId = id => !!(id && ((gridMeta?.ids && gridMeta.ids.has(id))
    || (geometryElementLists?.grid && geometryElementLists.grid.has(id))));
  /**
   * 解析 #grid=m,n[,unit] 过程函数
   * @param {string} text
   * @returns {{m: number, n: number, unit: number}|null}
   */
  const parseGridSpec = text => {
    const [mText, nText, unitText] = String(text || '').split(',').map(item => item.trim());
    const m = Math.trunc(Number(mText));
    const n = Math.trunc(Number(nText));
    if (!Number.isFinite(m) || !Number.isFinite(n) || m < 1 || n < 1 || m > GRID_MAX_SIZE || n > GRID_MAX_SIZE) return null;
    const unit = Number(unitText);
    return {m: m, n: n, unit: Number.isFinite(unit) && unit > 0 ? unit : GRID_DEFAULT_UNIT};
  };

  /**
   * 网格模板 过程函数
   * 用 gmt 的写法把 m×n 网格「作」出来：先作横轴、竖轴与首条竖线（一个单位），
   * 再用圆规在两条轴上滚动出等距格点（圆心在上一格点、过再上一格点），过格点作垂线，
   * 最后拿两端交点作线段 —— 共 m+n+2 条网格线段（gSY* 水平、gSX* 竖直）
   * @param {number} m 列数（x 方向格数）
   * @param {number} n 行数（y 方向格数）
   * @param {number} [unit=50] 单位长度
   * @returns {string}
   */
  const gridTemplateText = (m, n, unit = GRID_DEFAULT_UNIT) => {
    const size = Number(unit) > 0 ? Number(unit) : GRID_DEFAULT_UNIT;
    const rows = [
      `#grid=${m},${n},${gmtNumber(size)}`,
      // 网格线段的样式：黑色、细、不显示标签、虚线（符号与记录的样式表同一套）
      // 默认：黑色、最细一档（0.5 细）、不显示标签、虚线 —— 格线是背景，别抢图形的视线
      '#gridstyle=g#000000,g~0.5,g^,g&',
      'gO0=[0,0]',
      `gX1=[${gmtNumber(size)},0]`,
      'gy0=Line[gO0,gX1]',
      'gx0=Perp[gO0,gy0]',
      'gx1=Perp[gX1,gy0]',
    ];
    // 横向格点（y = -k·单位）：第 1 个用单位圆取，之后每格用「上一格点 + 再上一格点」作圆滚动出来。
    // 交点取第 0 个 —— 画布上 +y 朝下，所以格点落在 -y 一侧时，屏幕上是「原点在左下、网格往右上铺」
    // （右上是第一象限的习惯）；换到求解内核时由 gridToKernel 把 y 取反，内核那边仍是 [0,m]×[0,n]
    rows.push('gcy1=Circle[gO0,gX1]');
    rows.push('gY1=Intersect[gcy1,gx0,0]');
    rows.push('gy1=Perp[gY1,gx0]');
    for (let k = 2; k <= n; k++) {
      rows.push(`gcy${k}=Circle[gY${k - 1},${k === 2 ? 'gO0' : `gY${k - 2}`}]`);
      rows.push(`gY${k}=Intersect[gcy${k},gx0,0]`);
      rows.push(`gy${k}=Perp[gY${k},gx0]`);
    }
    // 竖向格点（x = k·单位）：同理，圆与横轴的交点取第 1 个
    for (let k = 2; k <= m; k++) {
      rows.push(`gcx${k}=Circle[gX${k - 1},${k === 2 ? 'gO0' : `gX${k - 2}`}]`);
      rows.push(`gX${k}=Intersect[gcx${k},gy0,1]`);
      rows.push(`gx${k}=Perp[gX${k},gy0]`);
    }
    // 每条网格线的另一端：水平线取与最右竖线的交点，竖线取与最上水平线的交点
    for (let k = 1; k <= n; k++) rows.push(`gY${k}e=Intersect[gx${m},gy${k},0]`);
    for (let k = 1; k <= m; k++) rows.push(`gX${k}e=Intersect[gy${n},gx${k},0]`);
    rows.push(`gOe=Intersect[gx${m},gy${n},0]`);
    // 网格线段：横 n+1 条、竖 m+1 条
    rows.push(`gSY0=Segment[gO0,gX${m}]`);
    for (let k = 1; k < n; k++) rows.push(`gSY${k}=Segment[gY${k},gY${k}e]`);
    rows.push(`gSY${n}=Segment[gY${n},gOe]`);
    rows.push(`gSX0=Segment[gO0,gY${n}]`);
    for (let k = 1; k < m; k++) rows.push(`gSX${k}=Segment[gX${k},gX${k}e]`);
    rows.push(`gSX${m}=Segment[gX${m},gOe]`);
    return rows.join('\n');
  };

  /**
   * 把网格样式表应用到网格对象上 过程函数
   * @param {Object} styles {id: {name?, color?, width?, showName?, visible?, dashed?}}
   * @param {Set<string>} ids 网格对象的 id
   */
  const applyGridStyles = (styles, ids) => {
    Object.keys(styles || {}).forEach(id => {
      if (ids && !ids.has(id)) return;
      const item = geometryManager.get(id);
      if (!item) return;
      const entry = styles[id] || {};
      if (entry.color && typeof item.modifyColor === 'function') item.modifyColor(entry.color);
      if (typeof entry.width === 'number' && typeof item.modifyWidth === 'function') item.modifyWidth(entry.width);
      if (entry.showName !== undefined && typeof item.modifyShowName === 'function') item.modifyShowName(!!entry.showName);
      if (entry.dashed !== undefined && typeof item.modifyDashed === 'function') item.modifyDashed(!!entry.dashed);
      if (entry.visible !== undefined && typeof item.modifyVisible === 'function') item.modifyVisible(!!entry.visible);
      if (entry.name && typeof item.modifyName === 'function') item.modifyName(entry.name);
    });
  };

  /**
   * 记下当前画布上的网格信息 过程函数
   * 有网格时：把网格对象登记进 geometryElementLists.grid，辅助对象隐藏（只留网格线段）
   * @param {{m: number, n: number, unit: number, style: string}|null} grid
   */
  const setGridMeta = grid => {
    if (!grid) {
      gridMeta = null;
      if (geometryElementLists) {
        geometryElementLists.grid = new Set();
        // 网格没了：格线也不该继续留在标记里（撤销掉网格后「给定」栏还列着一串 gSY0… 说不通）
        Object.values(geometryElementLists).forEach(set => {
          if (!(set instanceof Set)) return;
          [...set].forEach(id => { if (isGridSegmentId(id)) set.delete(id); });
        });
      }
      // 网格没了（撤销掉 / 换成没有网格的画布）：求解面板要切回尺规（见 syncSolverGridOption）
      window.syncSolverGridOption?.();
      return;
    }
    const ids = new Set(geometryManager.getAllByOrder()
      .map(item => item.getId())
      .filter(id => id.startsWith('g')));
    gridMeta = {m: grid.m, n: grid.n, unit: grid.unit, style: grid.style || '', ids: ids};
    if (geometryElementLists) geometryElementLists.grid = new Set(ids);
    // 辅助对象（格点、垂线、圆）只参与作图，画布上不显示；样式按 #gridstyle= 来
    ids.forEach(id => {
      const item = geometryManager.get(id);
      if (!item || !isGridHelperId(id)) return;
      if (typeof item.modifyVisible === 'function') item.modifyVisible(false);
    });
    if (grid.style && typeof recordStore !== 'undefined' && typeof recordStore.stylesByPrefix === 'function') {
      applyGridStyles(recordStore.stylesByPrefix(grid.style, [...ids]), ids);
    }
    // 求解参数面板跟着走（有网格 → 切网格模式 + 步数 4；网格没了 → 切回尺规）
    window.syncSolverGridOption?.();
  };

  /**
   * 画板 / 制题器 / 求解器的「初始视图」 过程函数
   * 每次把内容适配到画布（生成网格 / 载入记录 / 导入 gmt / 从游玩返回）都记一份逻辑中心 + 比例，
   * 浮动栏的「还原画布变化量」回到它（见 index.js 的 resetTransform）——
   * 与游玩页的 levelInitialView 同一套口径，只是那份在 playPage.js 里
   */
  let boardInitialView = null;

  /**
   * 把视图适配到网格范围 过程函数
   * 网格铺在逻辑坐标 [0, m·单位] × [-n·单位, 0] —— 画布 +y 朝下，
   * 所以屏幕上是「原点在左下角、网格往右上铺」
   * @returns {{centerX: number, centerY: number, scale: number}} 适配出来的逻辑中心与比例
   */
  const fitViewToGrid = grid => {
    const width = grid.m * grid.unit;
    const height = grid.n * grid.unit;
    const viewWidth = (typeof canvas !== 'undefined' && canvas ? canvas.clientWidth : 0) || 1280;
    const viewHeight = (typeof canvas !== 'undefined' && canvas ? canvas.clientHeight : 0) || 720;
    // 顶部菜单栏与各种浮层（工具面板 / 记录面板 / 元素一览…）浮在画布上，会盖住网格：
    // 适配时按「没被盖住的那块空地」算大小与圆心
    const insets = gridFitInsets();
    const usableWidth = Math.max(120, viewWidth - insets.left - insets.right);
    const usableHeight = Math.max(120, viewHeight - insets.top - insets.bottom);
    // 留点边距、最多放大 2 倍（与 fitViewToElements 同一口径）
    transform.scale = Math.min(usableWidth / (width * 1.3), usableHeight / (height * 1.3), 2);
    transform.x = insets.left + usableWidth / 2 - (width / 2) * transform.scale;
    transform.y = insets.top + usableHeight / 2 + (height / 2) * transform.scale;
    // 网格在逻辑坐标里铺在 [0, width] × [-height, 0] 上，中心就是 (width/2, -height/2)
    return {centerX: width / 2, centerY: -height / 2, scale: transform.scale};
  };

  /**
   * 画布上这批图形的外接矩形 过程函数
   * 只看**看得见、有效、且不属于网格**的对象：点取坐标，圆取「圆心 ± 半径」，线段取两端。
   * 射线 / 直线不封口，不拿它们那两个（取值任意的）坐标点撑范围 —— 一条往远处延伸的线会把
   * 缩放一路拽小；它们的定义点本身也是画布上的点，已经在范围里了
   * @returns {{minX: number, maxX: number, minY: number, maxY: number}|null}
   */
  const visibleBounds = () => {
    if (typeof geometryManager === 'undefined' || !geometryManager) return null;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    const include = (x, y) => {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    };
    geometryManager.getAllByOrder().forEach(item => {
      if (!item || typeof item.getType !== 'function') return;
      if (isGridId(item.getId())) return;
      if (typeof item.getVisible === 'function' && !item.getVisible()) return;
      if (typeof item.getValid === 'function' && !item.getValid()) return;
      // 无穷远点：坐标在很远处，画出来会让画布糊掉一大片（见 loadGmt）
      if (item.getBase?.()?.type === 'edgePoint') return;
      if (item.getType() === 'point') {
        const [x, y] = item.getCoordinate() || [];
        include(x, y);
        return;
      }
      const coord = typeof item.getCoordinate === 'function' ? item.getCoordinate() : null;
      if (!Array.isArray(coord) || coord.length < 2) return;
      const [first, second] = coord;
      if (!Array.isArray(first) || !Array.isArray(second)) return;
      if (item.getType() === 'circle') {
        const radius = Math.hypot(second[0] - first[0], second[1] - first[1]);
        include(first[0] - radius, first[1] - radius);
        include(first[0] + radius, first[1] + radius);
        return;
      }
      if (item.getType() === 'line' && item.getDrawType?.() === 'lineSegment') {
        include(first[0], first[1]);
        include(second[0], second[1]);
      }
    });
    return Number.isFinite(minX) ? {minX: minX, maxX: maxX, minY: minY, maxY: maxY} : null;
  };

  /**
   * 把视图适配到画布上这批图形 过程函数
   * 没有网格时用（从历史记录载入作图 / 导入 gmt）：图形可能是任意尺寸、任意位置，
   * 不适配就会落在画布外或者小得看不清。口径与 fitViewToGrid 完全一致 ——
   * 扣掉浮层占的地方、留 30% 边距、最多放大 2 倍
   * @returns {boolean} 有没有动过视图（画布上一个能看的图形都没有时不动）
   */
  const fitViewToElements = () => {
    const bounds = visibleBounds();
    if (!bounds) return false;
    const viewWidth = (typeof canvas !== 'undefined' && canvas ? canvas.clientWidth : 0) || 1280;
    const viewHeight = (typeof canvas !== 'undefined' && canvas ? canvas.clientHeight : 0) || 720;
    const insets = gridFitInsets();
    const usableWidth = Math.max(120, viewWidth - insets.left - insets.right);
    const usableHeight = Math.max(120, viewHeight - insets.top - insets.bottom);
    // 退化情形（只有一个点、或一条竖线）：给个最小尺寸，免得除出无穷大的比例
    const width = Math.max(bounds.maxX - bounds.minX, 1);
    const height = Math.max(bounds.maxY - bounds.minY, 1);
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;
    transform.scale = Math.max(minScale,
      Math.min(usableWidth / (width * 1.3), usableHeight / (height * 1.3), 2));
    transform.x = insets.left + usableWidth / 2 - centerX * transform.scale;
    transform.y = insets.top + usableHeight / 2 - centerY * transform.scale;
    return {centerX: centerX, centerY: centerY, scale: transform.scale};
  };

  /**
   * 把视图适配到画布上的内容 过程函数（首选的入口：导入 gmt / 载入记录 / 关卡载入都走它）
   * 有网格就适配到网格范围（网格就是作答范围），没有网格就适配到图形本身
   * @returns {{centerX: number, centerY: number, scale: number}|null} 逻辑中心与比例
   */
  const fitViewToContent = () => {
    const view = gridMeta ? fitViewToGrid(gridMeta) : fitViewToElements();
    // 记下这一刻的视图：「还原画布变化量」照它复位（有网格就是网格范围，没网格就是适配过的图形）
    if (view) boardInitialView = {centerX: view.centerX, centerY: view.centerY, scale: view.scale};
    return view;
  };

  /**
   * 网格适配要在画布的哪块空地里居中 过程函数
   * 顶部菜单栏与各种浮层（工具面板、记录面板、元素一览…）都浮在画布上，不扣掉它们，
   * 网格会有一部分压在下面。这里按各浮层的**实际矩形**量出四边各被盖住多少：
   * 浮层收起来 / 与画布不相交时算 0；压在哪一边看它整块更贴画布的哪条边
   * （记录面板贴左边、工具栏贴顶边，各自只扣对应的一侧）。
   * 侧边那串圆形按钮（一条纵向长条，横跨整屏高度）不参与，否则会被算成整屏都挡住了
   * @returns {{top: number, bottom: number, left: number, right: number}} 四边被盖住的宽度（CSS 像素）
   */
  const gridFitInsets = () => {
    const insets = {top: 0, bottom: 0, left: 0, right: 0};
    const canvasElement = document.getElementById('canvas_id1');
    if (!canvasElement) return insets;
    const canvasRect = canvasElement.getBoundingClientRect();
    if (!canvasRect.width || !canvasRect.height) return insets;
    // 顶部那条栏 + 各个浮层（.panel：工具面板 / 记录 / 元素一览 / 构造…）
    const overlays = [document.getElementById('container_more')].concat([...document.querySelectorAll('.panel')]);
    overlays.forEach(element => {
      if (!element) return;
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      // 与画布相交的那块矩形（不相交就与网格无关）
      const overlapWidth = Math.min(canvasRect.right, rect.right) - Math.max(canvasRect.left, rect.left);
      const overlapHeight = Math.min(canvasRect.bottom, rect.bottom) - Math.max(canvasRect.top, rect.top);
      if (overlapWidth <= 0 || overlapHeight <= 0) return;
      const centerX = (rect.left + rect.right) / 2;
      const centerY = (rect.top + rect.bottom) / 2;
      const distances = {
        top: Math.abs(centerY - canvasRect.top),
        bottom: Math.abs(centerY - canvasRect.bottom),
        left: Math.abs(centerX - canvasRect.left),
        right: Math.abs(centerX - canvasRect.right),
      };
      const side = Object.keys(distances).reduce((best, key) => (distances[key] < distances[best] ? key : best), 'top');
      if (side === 'top') insets.top = Math.max(insets.top, Math.min(canvasRect.bottom, rect.bottom) - canvasRect.top);
      else if (side === 'bottom') insets.bottom = Math.max(insets.bottom, canvasRect.bottom - Math.max(canvasRect.top, rect.top));
      else if (side === 'left') insets.left = Math.max(insets.left, Math.min(canvasRect.right, rect.right) - canvasRect.left);
      else insets.right = Math.max(insets.right, canvasRect.right - Math.max(canvasRect.left, rect.left));
    });
    insets.top = Math.max(0, Math.min(insets.top, canvasRect.height));
    insets.bottom = Math.max(0, Math.min(insets.bottom, canvasRect.height));
    insets.left = Math.max(0, Math.min(insets.left, canvasRect.width));
    insets.right = Math.max(0, Math.min(insets.right, canvasRect.width));
    return insets;
  };
  // 关卡游玩页 / 试玩页的「初始图形适配」也用它（那两页是另一套脚本，见 playPage.js 的 fitInitialView）
  window.gridFitInsets = gridFitInsets;

  /**
   * 生成 / 重新生成网格 过程函数
   * 画布上已有网格就先整块删掉（所以再点一次就是「改大小」），再按模板把新网格作上：
   * 登记成 grid 集合、辅助对象隐藏、网格线段按 #gridstyle= 上样式、视图适配到网格范围。
   * 整个过程只发一次 storage 事件 —— 撤销一步就把整块网格撤掉
   * @param {number} m 列数
   * @param {number} n 行数
   * @param {number} [unit=50] 单位长度
   * @returns {boolean}
   */
  const generateGrid = (m, n, unit = GRID_DEFAULT_UNIT) => {
    const columns = Math.max(GRID_MIN_SIZE, Math.min(GRID_MAX_SIZE, Math.trunc(Number(m) || 0)));
    const rows = Math.max(GRID_MIN_SIZE, Math.min(GRID_MAX_SIZE, Math.trunc(Number(n) || 0)));
    const size = Number(unit) > 0 ? Number(unit) : GRID_DEFAULT_UNIT;
    const { elements, grid } = parseGmt(gridTemplateText(columns, rows, size));
    if (!elements.length || !grid) return false;
    // 旧网格整块撤掉：删掉其中一条会连带删掉依赖它的同批对象。
    // 网格平时不可删（deleteObject 里有守卫），这里放行一下
    window.gridAllowDelete = true;
    [...(gridMeta?.ids || [])].forEach(id => {
      if (geometryManager.get(id)) geometryManager.deleteObject(id);
    });
    window.gridAllowDelete = false;
    // 旧网格连同依赖它的图形一起删了：它们身上的标记也一并清掉（见 pruneMarks）
    pruneMarks();
    setGridMeta(null);
    // 模板对象先一律可见，辅助对象随后由 setGridMeta 藏起来
    elements.forEach(item => { item.visible = true; });
    geometryManager.appendStorage(elements);
    setGridMeta(grid);
    // 适配到网格范围，并记下「初始视图」（「还原画布变化量」回到这里）
    fitViewToContent();
    // 制题器 / 求解器：生成网格就把格线记成「给定」——
    // 制题器里导出后落在 initial= 那一行（关卡 / 求解器读到的题目里网格就是题面的一部分），
    // 求解器的「给定」栏里也能看见「格线」一行（求解请求本身会跳过网格对象，不送进内核，
    // 见 buildSolverRequest）。改大小时先把旧格线的标记撤掉
    if ((mode === 'maker' || mode === 'solver') && geometryElementLists) {
      if (!geometryElementLists.initial) geometryElementLists.initial = new Set();
      // 登记完网格的 id 在 gridMeta.ids 上（setGridMeta 里算的，不是 parseGmt 给的那个对象）
      const ids = gridMeta?.ids || new Set();
      [...geometryElementLists.initial].forEach(id => {
        if (isGridSegmentId(id) && !ids.has(id)) geometryElementLists.initial.delete(id);
      });
      ids.forEach(id => { if (isGridSegmentId(id)) geometryElementLists.initial.add(id); });
    }
    if (typeof refreshElementListColors === 'function') refreshElementListColors();
    if (typeof loadGeometryElements === 'function') loadGeometryElements();
    if (typeof refreshMarks === 'function') refreshMarks();
    if (typeof drawContent === 'function') drawContent();
    // 记一步历史：整块网格是一步，撤销就把网格撤掉
    if (typeof notifyStorageChange === 'function') notifyStorageChange('grid');
    return true;
  };

  /**
   * 画布上还有网格吗 过程函数（顺手把「只剩元信息」的情况清掉）
   * 网格对象被撤销 / 清空画布清掉之后，元信息可能还挂着 —— 那会让导出、记录与撤销历史
   * 继续带 #grid= 两行，求解器也会以为还处在网格模式。这里对一次表，不一致就清干净
   * @returns {boolean}
   */
  const gridOnCanvas = () => {
    if (!gridMeta) return false;
    const ids = [...(gridMeta.ids || [])];
    if (ids.some(id => geometryManager.get(id))) return true;
    setGridMeta(null);
    return false;
  };

  const gmtText = (options = {}) => {
    const content = [];
    // 网格关卡的模板头两行（老版本读到当注释跳过，不影响）
    // 只在格线真的还在画布上时才写：万一某条路径把网格清掉了、元信息却还挂着，
    // 这里顺手把它清掉，别再往导出 / 记录 / 撤销历史里写 #grid= 两行
    if (gridOnCanvas()) {
      content.push(`#grid=${gridMeta.m},${gridMeta.n},${gmtNumber(gridMeta.unit)}`);
      content.push(`#gridstyle=${gridMeta.style || 'g#000000,g~1,g^,g&'}`);
    }
    // 「隐藏」一律只写进 styles（记录的 `a@`，见 recordStore.js），gmt 的 hidden= 行导出时留空：
    // 它只作读取用（导入别人的 gmt 时按它藏起那些对象），不再作为关卡语义的一部分
    // （options.omitHidden 是旧调用的兼容项，现在不影响输出）
    geometryManager.getAllByOrder().forEach(item => { content.push(gmtLineOf(item)); });
    // named：标成「带标签给定」的对象（标签名与对象 ID 不同时写成「ID.标签名」）。
    // 只看标记表 —— 光是显示标签、或改了个名字而没标成带标签给定的不算：
    // 那两种是样式方向的事（记录里记在 styles，见 recordStore.js），
    // 混进 named 的话读回来会被当成给定（强制显示标签 + 按给定上色）
    const namedSet = geometryElementLists?.named || new Set();
    const named = geometryManager.getAllByOrder().filter(item => namedSet.has(item.getId())).map(item => {
      const id = item.getId();
      const name = item.getName();
      return name && name !== id ? `${id}.${name}` : id;
    });
    // 设定行：无论有没有标记都写出来，没有标记的留空，方便对照与手动编辑
    const listOf = key => [...(geometryElementLists?.[key] || [])];
    // 网格线的给定与其它对象的给定分两行写：格线那串 id 又长又同质，混在一行里看不清题面
    // （读的一方按行累积，见 parseGmt 里的 lists[key].push，多写几行 initial= 等价）
    const allInitial = listOf('initial');
    const gridInitial = allInitial.filter(id => isGridSegmentId(id));
    content.push('');
    if (gridInitial.length) content.push(`initial=${gridInitial.join(',')}`);
    content.push(`initial=${allInitial.filter(id => !isGridSegmentId(id)).join(',')}`);
    content.push(`named=${named.join(',')}`);
    content.push(`movepoints=${listOf('movepoints').join(',')}`);
    // hidden= 只作**读取**用：导入别人的 gmt 时按它把那些对象藏起来，但导出时一律留空。
    // 「隐藏」是样式（记录里写在 styles 的 `a@`，见 recordStore.js），不写进关卡语义 ——
    // 写进 hidden= 的话，一次样式上的隐藏会让对象变成「关卡里预绘制 / 隐藏的图形」，
    // 求解器会因此不把它当题面条件（见 buildSolverRequest）
    content.push('hidden=');
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
    // 网格关卡：模板头两行注释记着网格大小与网格线段样式
    let grid = null;
    let gridStyle = '';
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      // 「#grid=」/「#gridstyle=」是网格关卡的元信息（老版本读到只会当注释跳过）
      if (line.startsWith('#grid=')) { grid = parseGridSpec(line.slice('#grid='.length)); continue; }
      if (line.startsWith('#gridstyle=')) { gridStyle = line.slice('#gridstyle='.length).trim(); continue; }
      // 「#」在行首表示整行注释
      if (line.startsWith('#')) continue;
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

    return {
      elements: elements,
      lists: result,
      resultGroups: groups,
      // 网格元信息（没有 #grid= 行就是 null）
      grid: grid ? Object.assign({}, grid, {style: gridStyle}) : null,
    };
  };
  const loadGmt = text => {
    const { elements, lists, grid } = parseGmt(text);
    if (!elements.length) return false;
    // 画板里所有对象都要可见：关卡中「预绘制出的解」在制作时也要能看到
    // 无穷远点（EdgePoint）除外：它是假想的点、坐标在很远处，画出来会让画布糊掉一大片
    elements.forEach(item => { item.visible = item.base?.type !== 'edgePoint'; });
    geometryManager.loadStorage(elements);
    // 换了一整套图形：画到一半的工具状态（工具缓存 + 管理器里的 choice 缓存）要一并扔掉，
    // 否则它们还指着刚被换掉的旧对象 —— 之后再作图会取到 null（报错、点一下没反应），
    // 而且整段作图都记不进撤销历史（表现为「载入记录后撤回变得极不正常」）
    if (typeof window.resetToolState === 'function') window.resetToolState();
    // 残留的 duplicatedFlag 会让下一次 storage 事件被当成「这次作图作废」而不记历史
    geometryManager.duplicatedFlag = false;
    if (typeof refreshOpenedGeometryItem === 'function') refreshOpenedGeometryItem();
    Object.keys(lists).forEach(key => { geometryElementLists[key] = new Set(lists[key]); });
    // 读入口径：同时写在 initial 与 named 里的对象按 named 算
    if (typeof window.normalizeGivenMarks === 'function') window.normalizeGivenMarks();
    // 网格关卡：登记网格对象、藏起辅助对象、按 #gridstyle= 上样式（没有网格就清掉）
    setGridMeta(grid);
    // 导入 gmt / 载入记录都走这里：有网格就适配到网格范围，没有网格就适配到图形本身
    // （图形可能是任意尺寸、任意位置，不适配就会落在画布外或小得看不清）
    fitViewToContent();
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
  // 历史记录面板（recordPanel.js，画板与关卡游玩共用）要用到的 gmt 桥：
  // 上面这些实现都在本文件的作用域里，页面脚本只能通过这里调用
  /**
   * 网格当作一整块：判断「这个 id 属不属于网格」 过程函数（全局）
   * 几何对象（删除守卫）、各工具（橡皮 / 线型 / 刷子）、元素一览、样式面板都调它
   */
  window.isGridObjectId = id => isGridId(id);
  // 网格线段（真正参与作图的那部分）
  window.isGridSegmentObjectId = id => isGridSegmentId(id);
  /**
   * 这个点是不是落在网格之外 过程函数（全局）
   * 网格模式下允许的点域就是网格那一块闭矩形 [0, m·单位] × [-n·单位, 0]（画布 +y 朝下），
   * 与求解内核的 PointAllowed 同一口径：网格外取的点不在题面里，工具里直接拒绝
   * @param {number} x
   * @param {number} y
   * @returns {boolean} 没有网格时恒为 false
   */
  window.isOutsideGrid = (x, y) => {
    if (!gridMeta || !(gridMeta.unit > 0)) return false;
    const width = gridMeta.m * gridMeta.unit;
    const height = gridMeta.n * gridMeta.unit;
    const eps = 1e-6;
    return x < -eps || x > width + eps || y > eps || y < -height - eps;
  };
  /**
   * 网格之外允许点下去的例外 过程函数（游玩模式用）
   * 网格关卡的题面就是「网格 + 直尺」（单尺作图，垂线 / 平行线那些工具根本不存在），
   * 所以规则很简单：**网格外不许作出任何图形** —— 点（自由点 / 线上点 / 交点）以及由它们
   * 带出的直线、圆一律挡掉。两个例外：移动模式（要看图形 / 平移视图），
   * 以及探索模式（探索画布本来就不受题目范围限制）
   * @returns {boolean}
   */
  window.gridClickAllowedOutside = () => {
    // 移动模式：哪里都要能点（看图形 / 平移视图）
    if (typeof tool === 'string' && tool === 'move') return true;
    // 探索模式：探索画布不受网格限制（关卡的题目范围与探索是两回事），范围外照样能作图
    return typeof exploreFlag !== 'undefined' && !!exploreFlag;
  };
  /**
   * 沿一条轴把参数区间裁进 [min, max] 过程函数
   * 起点 p + t·d：t 是解出来的参数，返回 null 表示这一段被裁没了
   */
  const clipParamRange = (lo, hi, value, dir, min, max) => {
    if (Math.abs(dir) < 1e-12) return (value >= min && value <= max) ? [lo, hi] : null;
    const first = (min - value) / dir;
    const second = (max - value) / dir;
    const nextLo = Math.max(lo, Math.min(first, second));
    const nextHi = Math.min(hi, Math.max(first, second));
    return nextLo <= nextHi ? [nextLo, nextHi] : null;
  };
  /**
   * 图形与网格矩形有没有交集 过程函数
   * @param {string} kind point / segment / ray / line / circle
   * @param {Object} p1 点坐标 / 线段射线直线的第一个端点 / 圆心
   * @param {Object} p2 第二个端点 / 圆上一点
   * @param {Object} rect {x1, y1, x2, y2}
   * @returns {boolean}
   */
  const shapeHitsRect = (kind, p1, p2, rect) => {
    if (!p1) return false;
    if (kind === 'point') {
      return p1.x >= rect.x1 && p1.x <= rect.x2 && p1.y >= rect.y1 && p1.y <= rect.y2;
    }
    if (kind === 'circle') {
      // 圆周与矩形相交 ⟺ 圆心到矩形最近点的距离 ≤ 半径 ≤ 到最远角的距离
      const radius = p2 ? Math.hypot(p2.x - p1.x, p2.y - p1.y) : 0;
      const nearestX = Math.min(Math.max(p1.x, rect.x1), rect.x2);
      const nearestY = Math.min(Math.max(p1.y, rect.y1), rect.y2);
      const nearest = Math.hypot(p1.x - nearestX, p1.y - nearestY);
      const farthest = Math.max(
        Math.hypot(p1.x - rect.x1, p1.y - rect.y1),
        Math.hypot(p1.x - rect.x2, p1.y - rect.y1),
        Math.hypot(p1.x - rect.x1, p1.y - rect.y2),
        Math.hypot(p1.x - rect.x2, p1.y - rect.y2),
      );
      return nearest <= radius && radius <= farthest;
    }
    // 线段 / 射线 / 直线：按各自的参数范围裁
    const dir = {x: p2.x - p1.x, y: p2.y - p1.y};
    const lo = kind === 'line' ? -Infinity : 0;
    const hi = kind === 'segment' ? 1 : Infinity;
    const afterX = clipParamRange(lo, hi, p1.x, dir.x, rect.x1, rect.x2);
    if (!afterX) return false;
    return !!clipParamRange(afterX[0], afterX[1], p1.y, dir.y, rect.y1, rect.y2);
  };
  /**
   * 这个图形是不是整个落在网格范围之外 过程函数
   * 「完全在外」= 它与网格矩形没有任何交集（点在外、线段 / 射线 / 直线扫不到网格、圆的圆周
   * 不穿过网格）。没有网格、或对象拿不到几何量时返回 false（当作「不限制」）
   * @param {Object} item
   * @returns {boolean}
   */
  const isItemOutsideGrid = item => {
    if (!gridMeta || !item || typeof item.getType !== 'function') return false;
    const rect = {x1: 0, y1: -gridMeta.n * gridMeta.unit, x2: gridMeta.m * gridMeta.unit, y2: 0};
    // getCoordinate() 有两种写法：点给 [x, y] 两个数，线 / 圆给 [[x1,y1],[x2,y2]]，
    // 统一成 {x, y} 再算（不归一化的话线 / 圆的端点会读成 undefined → 全被误判成「在网格外」）
    const asPoint = value => {
      if (!value) return null;
      if (Array.isArray(value) && value.length >= 2 && typeof value[0] === 'number') {
        return {x: value[0], y: value[1]};
      }
      if (typeof value.x === 'number' && typeof value.y === 'number') return {x: value.x, y: value.y};
      return null;
    };
    const type = item.getType();
    if (type === 'point') return !shapeHitsRect('point', {x: item.x, y: item.y}, null, rect);
    const coord = typeof item.getCoordinate === 'function' ? item.getCoordinate() : null;
    if (!Array.isArray(coord) || coord.length < 2) return false;
    const first = asPoint(coord[0]);
    if (!first) return false;
    if (type === 'circle') return !shapeHitsRect('circle', first, asPoint(coord[1]), rect);
    if (type === 'line') {
      const drawType = typeof item.getDrawType === 'function' ? item.getDrawType() : 'line';
      const kind = drawType === 'lineSegment' ? 'segment' : drawType === 'ray' ? 'ray' : 'line';
      const second = asPoint(coord[1]);
      if (!second) return false;
      return !shapeHitsRect(kind, first, second, rect);
    }
    return false;
  };
  // 制题器 / 求解器里，完全在网格范围外的图形不许标记：标记会把它写进题面 / 已知条件，
  // 而网格关卡的题面就该落在网格那块范围里（见 markFromCanvas 与元素一览的 select）
  const restrictMarkOutsideGrid = mode === 'maker' || mode === 'solver';
  /**
   * 这个对象是不是「在网格外、因此不给标记」 过程函数
   * @param {string} id
   * @returns {boolean}
   */
  window.markBlockedOutsideGrid = id => restrictMarkOutsideGrid
    && !!geometryManager
    && isItemOutsideGrid(geometryManager.get(id));
  window.boardGmt = {
    /**
     * 画布上的作图文本 过程函数
     * @param {{omitHidden?: boolean}} [options] 兼容旧调用：hidden= 行现在一律留空
     *   （隐藏只记在 styles 的 `a@`，见 recordStore.js），这个选项已不再影响输出
     */
    text: options => gmtText(options),
    load: text => loadGmt(text),
    /**
     * 把视图适配到画布上的内容 过程函数（有网格适配网格、没有网格适配图形本身）
     * 导入 gmt / 载入记录用它；游玩页的「初始图形适配」也用它（见 playPage 的 fitInitialView），
     * 那边拿返回的逻辑中心与比例记「初始视图」，供「还原视图」按钮回到这里
     */
    fitView: () => fitViewToContent(),
    /**
     * 画板侧记下的「初始视图」 过程函数（逻辑中心 + 比例，或 null）
     * 「还原画布变化量」照它复位（见 index.js 的 resetTransform）；null 表示还没适配过内容，
     * 那时按通用初始值（画布正中 + initialScale）复位
     */
    initialView: () => boardInitialView,
    // 网格：模板文本、当前画布上的网格信息（{m, n, unit, style, ids} 或 null）、生成 / 改大小
    gridTemplate: (m, n, unit) => gridTemplateText(m, n, unit),
    grid: () => gridMeta,
    generateGrid: (m, n, unit) => generateGrid(m, n, unit),
    // 网格当作一整块：某个 id 属不属于网格（选择 / 样式 / 禁用操作都看它）
    isGridId: id => isGridId(id),
    isGridSegmentId: id => isGridSegmentId(id),
    /**
     * 改过格线样式之后把 #gridstyle= 追平 过程函数
     * 网格样式只认 gmt 里那一行（记录里不写 styles），所以调完样式要把那一行重写一遍
     * @param {string} [newColor] 刚选的颜色（改色时由调用方传进来；不传就按对象自己的颜色）
     */
    syncGridStyle: newColor => {
      if (!gridMeta) return;
      const segment = [...gridMeta.ids]
        .map(id => geometryManager.get(id))
        .find(item => item && isGridSegmentId(item.getId()));
      if (!segment) return;
      // 颜色与标签不能回头读对象：格线在制题器里被标成「给定」，getColor() 给的是标记显示色（黑 #191919）、
      // getShowName() 由标记决定，照抄就把对象自己的样式改掉了。所以颜色由调用方给（改色的那条路径知道
      // 用户选了哪个色，见 stylePanel），没给就越过标记读原来的那一行；线径与虚实不受标记影响，直接读
      const marked = allMarkIds().has(segment.getId());
      const existing = String(gridMeta.style || '');
      const existingColor = (existing.match(/g#([0-9a-fA-F]{3,8})/) || [])[1] || '000000';
      const picked = typeof newColor === 'string' && newColor ? newColor.replace(/^#/, '') : '';
      const color = picked || (marked ? existingColor : String(segment.getColor() || '#000000').replace(/^#/, ''));
      const showName = marked ? /g\$/.test(existing) : !!segment.getShowName();
      const width = segment.getWidth() || 0.5;
      const dashed = segment.getDashed();
      // 点线径写档位号（1..5，见 recordStore 的 widthToStyleValue），与记录里的 styles 同一套
      const widthValue = typeof recordStore !== 'undefined' && typeof recordStore.widthToStyleValue === 'function'
        ? recordStore.widthToStyleValue(width) : width;
      const parts = [
        `g#${color}`,
        `g~${widthValue}`,
        showName ? 'g$' : 'g^',
      ];
      if (dashed) parts.push('g&');
      gridMeta.style = parts.join(',');
    },
    // 关卡页 / 试玩页载入 gmt 后按 #grid= 登记网格（藏辅助对象、按 #gridstyle 上样式）
    setGridFromGmt: grid => setGridMeta(grid),
    /** 更省事的全局别名：别的脚本判断「这个 id 是不是网格」用它（见 geometry.js 的删除守卫） */
    isGridObjectId: id => isGridId(id),
    /**
     * 这个对象**自己**的样式（不是标记期间的显示色） 过程函数
     * 给定 / 所求这些被标记的对象画布上是黑 / 金，但记录里要存的是它原本的样式色 ——
     * 标记载回来时再按标记重新上色（见 recordPanel 的 stylesOfCanvas / loadedStyles）。
     * 返回 null 表示「不在任何标记里，按画布上的颜色存就行」
     * @param {string} id
     * @returns {{color: string, showName: boolean}|null}
     */
    ownStyleOf: id => {
      if (!allMarkIds().has(id)) return null;
      const item = typeof geometryManager !== 'undefined' ? geometryManager.get(id) : null;
      if (!item) return null;
      // 制题器 / 求解器里 markedStyles 记着标记前的原色；游玩模式没这套，按自动配色算
      const sealed = markedStyles.get(id);
      return {
        color: sealed ? sealed.color : autoPlayModeColor(item),
        showName: !!(sealed ? sealed.showName : item.getShowName()),
      };
    },
    codeDialog: (title, text, onConfirm) => codeDialog(title, text, onConfirm),
    download: (name, text) => download(name, text, 'text/plain'),
    // 选一个 gmt 文件并把文本交给回调（导入记录用；与上面的「导入 gmt 文件」不同，它不改画布）
    pickFile: callback => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.gmt,.txt,text/plain';
      input.addEventListener('change', () => {
        const file = input.files?.[0];
        if (file) file.text().then(text => callback(text));
      });
      input.click();
    },
  };
  /**
   * 请求的「图幅」量级 过程函数（用来定内核的判定容差：eps = 1e-11 × 这个数）
   * 只能按**长度**量取：点坐标、直线到原点的距离、圆的半径、射线 / 线段的端点。
   * 不能直接把请求里所有数字取最大 —— 里面的直线系数是未归一化的
   * （c = x1·y2 − y1·x2，量级 ~L²；画布 px 下一条线就能到几万），圆的 c 是半径平方（~L²），
   * 那样算出来的 eps 会松上好几个数量级：内核判「目标点达成」用的是绝对容差，
   * 于是会收下一堆「只差 1e-5 px」的伪解（网格模式下单位是格子，更明显）。
   * @param {Object} request 请求（此时坐标已是内核坐标系）
   * @returns {number} 图幅长度量级（至少 1）
   */
  const solverLengthScale = request => {
    let extent = 1;
    const stretch = value => {
      if (Number.isFinite(value)) extent = Math.max(extent, Math.abs(value));
    };
    [request.points, request.goalPoints].forEach(list => (list || []).forEach(stretch));
    [[request.rays, 4], [request.segments, 4]].forEach(([list, stride]) => {
      const values = list || [];
      for (let i = 0; i + 3 < values.length; i += stride) {
        stretch(values[i]);
        stretch(values[i + 1]);
        stretch(values[i + 2]);
        stretch(values[i + 3]);
      }
    });
    [[request.lines, 3], [request.goalLines, 3]].forEach(([list, stride]) => {
      const values = list || [];
      for (let i = 0; i + 2 < values.length; i += stride) {
        const norm = Math.hypot(values[i], values[i + 1]);
        // 直线到原点的有向距离：|c| / √(a²+b²)，系数未归一化也不影响它
        if (norm > 0) stretch(values[i + 2] / norm);
      }
    });
    [[request.circles, 3], [request.goalCircles, 3]].forEach(([list, stride]) => {
      const values = list || [];
      for (let i = 0; i + 2 < values.length; i += stride) {
        stretch(values[i]);
        stretch(values[i + 1]);
        stretch(Math.sqrt(Math.abs(values[i + 2]))); // 半径（c 是半径平方）
      }
    });
    return extent;
  };

  /**
   * 求解器：把画布图形整理成搜索请求 过程函数
   * 已知条件 = 画布上除「所求判定」以外的对象（目标对象不能同时算作已知，否则一搜就「0 步找到」）；
   * 目标 = 标为「所求判定」的直线 / 圆 / 点，三类可以同时存在
   * @returns {Object} 画板扁平数组写法（与旧求解面板一致）：points/lines/circles + goalPoints/goalLines/goalCircles
   */
  const buildSolverRequest = () => {
    const goalIds = geometryElementLists.result || new Set();
    // 已知条件取「给定」栏：initial 与 named（带标签给定）都算给定 —— 记录 / 关卡 gmt 里
    // 带标签给定就是「题目自带、还额外显示了标签」的对象，不当条件用会漏掉题面。
    // 打开求解器时，关卡里隐藏 / 预绘制的图形，以及可移动点一类没被标成给定的对象
    // 都会被整份带过来并显示出来，当条件用就会搜出「用了题面里没有的点」的假解（4E 那种）。
    const givenIds = new Set();
    (geometryElementLists.initial || new Set()).forEach(id => givenIds.add(id));
    (geometryElementLists.named || new Set()).forEach(id => givenIds.add(id));
    const useGivenMarks = givenIds.size > 0;
    // pointIds / lineIds / circleIds 与上面三个坐标数组一一对应：
    // 求解器返回的「构造计划」靠它们把已知点、已知元素映射回画布对象，于是拖动图形时能重算解法
    const request = {
      points: [], lines: [], rays: [], segments: [], circles: [],
      goalPoints: [], goalLines: [], goalCircles: [],
      pointIds: [], lineIds: [], rayIds: [], segmentIds: [], circleIds: [],
    };
    geometryManager.getAllByOrder().forEach(item => {
      if (item.getValid && !item.getValid()) return;
      if (item.getVisible && !item.getVisible()) return;
      const id = item.getId();
      // 网格当作一整块：网格线段由内核按 m / n 自己铺（请求里的 gridM / gridN），
      // 不必再当给定送进去 —— 否则同一批线既算初始对象又算免费网格线，
      // 还会把「初始元素下标 → 画布对象」的映射整体挤偏
      if (typeof window.isGridObjectId === 'function' && window.isGridObjectId(id)) return;
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
        // 目标只支持无限直线（内核的目标就是直线 / 圆 / 点）：所求标在线段 / 射线上时按它所在直线算
        if (isGoal) {
          request.goalLines.push(...coefficients);
          return;
        }
        // 线段 / 射线按「所在直线 + 范围」送：内核是 C++ 版 bs_v8 的移植，射线 / 线段是一等类型
        // （元素存 a/b/c + bound 索引，范围外的交点直接丢弃，见 solver/bs-core.js 的 isInRange），
        // 所以不能再当成无限直线 —— 那样会搜出「用了线段延长线」的假解，步数还少算一步
        const drawType = typeof item.getDrawType === 'function' ? item.getDrawType() : 'line';
        if (drawType === 'ray') {
          // 射线：起点 + 经过点
          request.rays.push(first[0], first[1], second[0], second[1]);
          request.rayIds.push(id);
        } else if (drawType === 'lineSegment') {
          // 线段：两端点（顺序无关）
          request.segments.push(first[0], first[1], second[0], second[1]);
          request.segmentIds.push(id);
        } else {
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
    // 网格模式：内核的网格直尺以「格点＝整数坐标、点域 [0,m]×[0,n]」为前提，
    // 而画布上的网格是「单位长度 u、+y 朝下」，所以请求里的坐标与方程要换算到内核坐标系：
    //   X = x / u，Y = -y / u（格点正好落在整数上，且网格铺在 [0,m]×[0,n]）
    // 解法回来时再按同一套算式换回画布坐标（见 kernelSolutionToCanvas）
    const grid = typeof window.boardGmt?.grid === 'function' ? window.boardGmt.grid() : null;
    if (grid && grid.unit > 0) {
      const unit = grid.unit;
      const toKernel = (x, y) => [x / unit, -y / unit];
      const scalePairs = list => {
        for (let i = 0; i + 1 < list.length; i += 2) {
          const [X, Y] = toKernel(list[i], list[i + 1]);
          list[i] = X;
          list[i + 1] = Y;
        }
      };
      const scaleQuads = list => {
        for (let i = 0; i + 3 < list.length; i += 4) {
          const [x1, y1] = toKernel(list[i], list[i + 1]);
          const [x2, y2] = toKernel(list[i + 2], list[i + 3]);
          list[i] = x1;
          list[i + 1] = y1;
          list[i + 2] = x2;
          list[i + 3] = y2;
        }
      };
      // 直线 a·x + b·y = c 代进 x = uX、y = -uY：a·u·X - b·u·Y = c ⇒ [a·u, -b·u, c]
      const scaleLines = list => {
        for (let i = 0; i + 2 < list.length; i += 3) {
          list[i] *= unit;
          list[i + 1] *= -unit;
        }
      };
      // 圆 [cx, cy, r²] ⇒ [cx/u, -cy/u, r²/u²]
      const scaleCircles = list => {
        for (let i = 0; i + 2 < list.length; i += 3) {
          list[i] /= unit;
          list[i + 1] /= -unit;
          list[i + 2] /= unit * unit;
        }
      };
      scalePairs(request.points);
      scalePairs(request.goalPoints);
      scaleQuads(request.rays);
      scaleQuads(request.segments);
      scaleLines(request.lines);
      scaleLines(request.goalLines);
      scaleCircles(request.circles);
      scaleCircles(request.goalCircles);
      request.gridM = grid.m;
      request.gridN = grid.n;
      request.gridUnit = unit;
    }
    request.eps = 1e-11 * solverLengthScale(request);
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

  /**
   * 网格线段按「内核装图的顺序」排 过程函数
   * 网格模式下内核会在「给定点之后、给定线圆之前」自己铺网格线：先 m+1 条竖线（x=0…m）、
   * 再 n+1 条横线（y=0…n）（见 bs-core.js 的 addAutomaticGridLines）。
   * 构造计划里的元素下标就是这个顺序，映射回画布对象时要按同一顺序排在最前面，
   * 否则后面每一个下标都会错位（把解法里凭空作出来的线画成给定圆之类）
   * @returns {string[]} 网格线段的 id（按内核顺序）
   */
  const gridSegmentIdsInKernelOrder = () => {
    if (!gridMeta) return [];
    const vertical = [];
    const horizontal = [];
    gridMeta.ids.forEach(id => {
      const match = /^gS([XY])(\d+)$/.exec(id);
      if (!match) return;
      (match[1] === 'X' ? vertical : horizontal).push({index: Number(match[2]), id: id});
    });
    const byIndex = (one, two) => one.index - two.index;
    return vertical.sort(byIndex).concat(horizontal.sort(byIndex))
      .map(item => item.id)
      .filter(id => !!geometryManager.get(id));
  };

  /**
   * 把内核返回的解法换算回画布坐标 过程函数
   * 网格模式的请求是换算过去的（X = x/u、Y = -y/u，见 buildSolverRequest），
   * 解法里的点坐标与元素方程要按同一套算式换回来，否则覆盖层会画到别处（比例、朝向都不对）：
   *   点 [X, Y] → [x, y] = [X·u, -Y·u]
   *   直线 a·X + b·Y = c → a·x - b·y = c·u（即 [a, -b, c·u]）
   *   圆 [X, Y, r²] → [X·u, -Y·u, r²·u²]
   * @param {Object} solution 内核返回的一个解
   * @param {number} unit 网格单位长度
   * @returns {Object} 同一个对象（就地改写）
   */
  const kernelSolutionToCanvas = (solution, unit) => {
    if (!solution || !(unit > 0)) return solution;
    (solution.points || []).forEach(point => {
      point.x *= unit;
      point.y *= -unit;
    });
    (solution.elements || []).forEach(element => {
      if (element.type === 0) {
        element.a *= unit;
        element.b *= -unit;
        element.c *= unit * unit;
      } else {
        element.b *= -1;
        element.c *= unit;
      }
    });
    (solution.bounds || []).forEach(bound => {
      bound.x1 *= unit;
      bound.y1 *= -unit;
      bound.x2 *= unit;
      bound.y2 *= -unit;
    });
    return solution;
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
    // 网格模式：内核自己会铺 (m+1)+(n+1) 条网格线、并把全部格点当已知点，
    // 所以「已知点 / 初始元素」的数目都要把网格那份算上；只核对请求里发出去的那些已知点
    // （格点排在它们后面）。万一有给定对象与网格线重合、被内核当重复丢掉，数量就对不上 ——
    // 那种情况不启用计划，退回一次性覆盖层（画得对，只是拖动时解法不跟着变形）
    const grid = solverLastRequest.gridM !== undefined;
    const gridLines = grid ? (solverLastRequest.gridM + 1) + (solverLastRequest.gridN + 1) : 0;
    if (!grid && solverLastRequest.pointIds.length < result.initialPointCount) return false;
    const checkCount = grid ? solverLastRequest.pointIds.length : result.initialPointCount;
    for (let i = 0; i < checkCount; i++) {
      const item = geometryManager.get(solverLastRequest.pointIds[i]);
      const recorded = solution.points[i];
      if (!item || item.getType() !== 'point') return false;
      if (Math.abs(item.x - recorded.x) > 1e-9 || Math.abs(item.y - recorded.y) > 1e-9) return false;
    }
    const sentElements = solverLastRequest.lines.length / 3
      + solverLastRequest.rays.length / 4 + solverLastRequest.segments.length / 4
      + solverLastRequest.circles.length / 3;
    return sentElements + gridLines === result.initialElementCount;
  };

  /**
   * 组装「构造计划」的作业对象 过程函数
   * 画布按它把解法重算出来（拖动图形时解法跟着变形），解法自检也用它
   * @param {Object} solution 一条解
   * @param {Object} result 这次搜索的结果（提供 initialPointCount 等）
   * @param {number} [step] 画到第几步（默认整条解）
   * @returns {Object|null} null 表示这条解没有可动计划（对不上画布，只能一次性画覆盖层）
   */
  const solverPlanJobOf = (solution, result, step) => {
    if (!solution || !solution.plan || !solverPlanMatchesCanvas(solution, result)) return null;
    return {
      solution: solution,
      result: result,
      dag: solution.plan,
      step: step === undefined ? solution.newElementCount : Math.max(0, Math.min(solution.newElementCount, step)),
      pointIds: solverLastRequest.pointIds,
      // 顺序要与 Worker 装图的顺序一致：网格线 → 直线 → 射线 → 线段 → 圆
      // （网格模式下内核自己先铺网格线，不把它们排在最前面，构造计划里的下标会整体错位）
      elementIds: (solverLastRequest.gridUnit ? gridSegmentIdsInKernelOrder() : [])
        .concat(solverLastRequest.lineIds
          .concat(solverLastRequest.rayIds || [], solverLastRequest.segmentIds || [], solverLastRequest.circleIds)),
      // 射线 / 线段的端点表：解法里与它们的交点必须落在范围内（见 canvas.js 的 solverPlanInRange）
      bounds: solution.bounds || null,
      eps: solverLastRequest.eps,
    };
  };

  /**
   * 覆盖层离某个所求对象最近的距离 过程函数（自检用）
   * 点看最近的新点；圆看「圆心距 + 半径差」；直线 / 射线 / 线段看所求线上两个点离最近那条解法的线
   * @param {Object} goalItem 画布上的所求对象
   * @param {Object} overlay evaluateSolverSolutionPlan 的结果
   * @returns {number} 距离（画布 px），算不出来给 Infinity
   */
  const overlayGoalDistance = (goalItem, overlay) => {
    if (!goalItem || !overlay) return Infinity;
    const type = goalItem.getType?.();
    if (type === 'point') {
      if (!overlay.points || !overlay.points.length) return Infinity;
      return Math.min(...overlay.points.map(point => Math.hypot(point.x - goalItem.x, point.y - goalItem.y)));
    }
    const coordinate = goalItem.getCoordinate?.();
    if (!coordinate) return Infinity;
    if (type === 'circle') {
      const [center, on] = coordinate;
      if (!overlay.circles || !overlay.circles.length) return Infinity;
      const radius = Math.hypot(on[0] - center[0], on[1] - center[1]);
      return Math.min(...overlay.circles.map(circle =>
        Math.hypot(circle.x - center[0], circle.y - center[1]) + Math.abs(circle.r - radius)));
    }
    const [first, second] = coordinate;
    if (!overlay.lines || !overlay.lines.length) return Infinity;
    const offsetTo = (line, point) => {
      const length = Math.hypot(line.x2 - line.x1, line.y2 - line.y1) || 1;
      return Math.abs((line.x2 - line.x1) * (point.y - line.y1) - (line.y2 - line.y1) * (point.x - line.x1)) / length;
    };
    return Math.min(...overlay.lines.map(line =>
      (offsetTo(line, {x: first[0], y: first[1]}) + offsetTo(line, {x: second[0], y: second[1]})) / 2));
  };

  /**
   * 自检的候选点 过程函数
   * 画布上看得见的点都算候选，但要排掉网格自带的那一批（挪了会把整副网格拖走，
   * 而构造计划里的格点用的是记录值，对不齐）；至于某个点到底挪不挪得动，
   * 交给 modifyPointCoordinate 试一下就知道（自由点 / 线上点会动，交点 / 中点这些不动）
   * @returns {Object[]}
   */
  const selfCheckCandidates = () => geometryManager.getAllByOrder().filter(item =>
    item.getType?.() === 'point' && item.getVisible?.() &&
    !(typeof window.isGridObjectId === 'function' && window.isGridObjectId(item.getId())));

  /**
   * 解法自检 过程函数（高级选项，默认关）
   * 把每个可动点按图幅的 0.1% 轻挪一点，让画布自己把给定对象与所求对象一起重算，
   * 再用这条解的构造计划重算一遍：落点若不再命中所求，说明它只在当前这组数上成立
   * （特解），自检不通过。测完一律把点挪回原位：不留撤销历史、不动标记集合。
   * @param {Object} solution 一条解
   * @param {Object} result 这次搜索的结果
   * @returns {boolean|null} true 通过 / false 不通过 / null 判断不了（没有计划 / 没有可动点 / 挪了所求也不动）
   */
  const solutionPassesSelfCheck = (solution, result) => {
    const job = solverPlanJobOf(solution, result);
    if (!job || !solverLastRequest) return null;
    const goalItems = [...(geometryElementLists.result || new Set())]
      .map(id => geometryManager.get(id))
      .filter(item => item && item.getCoordinate?.());
    const candidates = selfCheckCandidates();
    if (!goalItems.length || !candidates.length) return null;
    // 挪动幅度取图幅的 0.1%：按 eps 的量级算这点扰动已经足够暴露特解（见「解法自检」的说明），
    // 再大反而容易把某些线圆挪成不相交（那属于题目退化了，不该算自检不通过）
    const scale = solverLengthScale(solverLastRequest) * (solverLastRequest.gridUnit || 1);
    const delta = Math.max(0.01, scale * 0.001);
    const tolerance = Math.max(1e-6, scale * 1e-9);
    const before = goalItems.map(item => item.getCoordinate());
    let verdict = null;
    for (const item of candidates) {
      const id = item.getId();
      const start = item.getCoordinate();
      if (!start) continue;
      // 两个互相垂直的一般方向（22.5° / 112.5°）：不沿坐标轴或对称轴走（那样有可能恰好保住特解关系），
      // 又保证「线上的点」至少有一个方向投影不为零（例如 Linepoint 会把某个方向投影回原地）
      for (const [sx, sy] of [[0.9238795, 0.3826834], [-0.3826834, 0.9238795]]) {
        geometryManager.modifyPointCoordinate(id, start[0] + delta * sx, start[1] + delta * sy);
        const after = item.getCoordinate();
        // 挪不动（交点 / 中点这类）就换方向
        if (!after || Math.hypot(after[0] - start[0], after[1] - start[1]) < delta * 0.1) continue;
        const now = goalItems.map(goal => goal.getCoordinate());
        const shifted = now.some((coordinate, index) => coordinate && before[index] &&
          Math.hypot(coordinate[0] - before[index][0], coordinate[1] - before[index][1]) > tolerance);
        if (!shifted) continue; // 这个点与题目无关（挪了所求也不动）：换方向 / 换下一个点
        const overlay = typeof evaluateSolverSolutionPlan === 'function' ? evaluateSolverSolutionPlan(job) : null;
        const distance = Math.max(...goalItems.map(goal => overlayGoalDistance(goal, overlay)));
        if (!(distance <= tolerance)) verdict = false;
        else if (verdict === null) verdict = true;
        break;
      }
      geometryManager.modifyPointCoordinate(id, start[0], start[1]); // 挪回原位
      if (verdict === false) break;
    }
    drawContent();
    return verdict;
  };

  /**
   * 用解法自检把「只在当前这组数上成立」的解剔掉 过程函数
   * @param {Object} result 搜索结果（就地改写 solutions / found / solutionCount 等）
   * @returns {number} 被剔掉的解数
   */
  const filterSolutionsBySelfCheck = result => {
    const kept = [];
    let rejected = 0;
    result.solutions.forEach(solution => {
      if (solutionPassesSelfCheck(solution, result) === false) {
        rejected++;
        return;
      }
      kept.push(solution);
    });
    if (!rejected) return 0;
    result.solutions = kept;
    result.solutionCount = kept.length;
    result.found = kept.length > 0;
    // 首页 / 逐步播放都读这几个字段，跟着换成留下第一条
    result.steps = kept.length ? kept[0].newElementCount : 0;
    result.points = kept.length ? kept[0].points : [];
    result.elements = kept.length ? kept[0].elements : [];
    result.bounds = kept.length ? (kept[0].bounds || []) : [];
    result.newElementCount = kept.length ? kept[0].newElementCount : 0;
    result.selfCheckRejected = rejected;
    return rejected;
  };

  const showSolverSolutionStep = (solution, result, step) => {
    const shown = Math.max(0, Math.min(solution.newElementCount, step));
    const job = solverPlanJobOf(solution, result, shown);
    if (job) {
      solverSolutionPlan = job;
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
    // 给定线段 / 射线**不再补画整条直线**：求解器已经按它们的范围夹取交点（见 buildSolverRequest），
    // 解法用到的每一段都在范围内，画布上本来就有它们，覆盖层不必再画
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

  /**
   * 求解参数面板：网格模式的联动 过程函数
   * 画布上有网格时：自动切到「网格」模式、最大步数切到 4（网格题通常 ≤4 步），并显示网格尺寸；
   * 没有网格时把「网格」那一项标灰（模式 3 必须知道 m / n 才能搜）
   * @param {HTMLElement} [target] 面板元素（默认取页面上的求解面板）
   */
  const syncSolverGridOption = (target = document.querySelector('.solver-panel')) => {
    if (!target) return;
    const select = target.querySelector('#geb-solver-tool');
    const limit = target.querySelector('#geb-solver-limit');
    const option = select ? select.querySelector('option[value="3"]') : null;
    const grid = typeof window.boardGmt?.grid === 'function' ? window.boardGmt.grid() : null;
    // 网格大小就写在这个选项上（面板里不再单列一行「网格尺寸」）
    if (option) {
      option.disabled = !grid;
      option.textContent = grid
        ? `${t('board.solverToolGrid')}（${grid.m}×${grid.n}）`
        : t('board.solverToolGrid');
    }
    // 画布上有网格就切到网格模式；已经在这个模式里就不动用户改过的选项
    if (grid && select && select.value !== '3') {
      select.value = '3';
      if (limit && limit.value !== '4') limit.value = '4';
    }
    // 网格没了（撤销掉 / 换成没有网格的画布）还停在网格模式：切回尺规 ——
    // 否则请求会带 toolType 3 而 m / n 是 0，搜出来的东西没有意义
    if (!grid && select && select.value === '3') {
      select.value = '2';
    }
  };
  // 供 setGridMeta 等更早定义的函数回调（那些函数不能直接引用这里的 const：初始化顺序在前）
  window.syncSolverGridOption = syncSolverGridOption;

  const solverPanel = () => {
    const panel = document.createElement('aside');
    panel.className = 'solver-panel';
    // 推荐的并行线程数：浏览器只有 navigator.hardwareConcurrency 这一个口径（逻辑核心数，
    // 拿不到真实物理核），留一个核心给页面本身；上限 8（再多收益很小、内存翻倍）
    const hardwareCores = Math.max(2, Number(navigator.hardwareConcurrency) || 4);
    const recommendedThreads = Math.max(2, Math.min(8, hardwareCores - 1));
    panel.innerHTML = [
      // 标题在上拉栏的标题栏里（见 wrapInSheet），这里只放设置项
      // 两两并排，省一半高度（见 index.css 的 .solver-field-row）
      '<div class="solver-field-row">' +
        `<label>${t('board.solverLimit')}<input id="geb-solver-limit" type="number" min="1" max="100" value="6"></label>` +
        `<label>${t('board.solverTool')}<select id="geb-solver-tool">` +
          `<option value="2">${t('board.solverToolBoth')}</option>` +
          `<option value="1">${t('board.solverToolLine')}</option>` +
          `<option value="0">${t('board.solverToolCircle')}</option>` +
          `<option value="3">${t('board.solverToolGrid')}</option></select></label>` +
      '</div>',

      '<div class="solver-field-row">' +
        `<label>${t('board.solverTime')}<input id="geb-solver-time" type="number" min="1" max="600" value="60"></label>` +
        `<label>${t('board.solverCount')}<input id="geb-solver-solutions" type="number" min="1" max="20" value="20"></label>` +
      '</div>',
      // 高级选项：平时收起（<details>），里面的值都对应搜索内核本来就支持的参数（见 search-worker.js）
      // 高级选项的三角是 SVG（不是 CSS 的文字三角）：展开时整个图标转 90°，风格与其它图标一致
      `<details class="solver-advanced" id="geb-solver-advanced"><summary>` +
        '<svg class="svg-icon solver-advanced-icon" viewBox="0 0 200 200" aria-hidden="true">' +
        '<polygon points="70 34, 152 100, 70 166" fill="transparent" stroke-width="20" stroke-linecap="round" stroke-linejoin="round"/>' +
        '</svg>' +
        `${t('board.solverAdvanced')}</summary>` +
        // 五个开关：前两个是「怎么搜」（逐步搜索 / 解法自检），后三个是内核原来的剪枝与内存选项
        // 逐步搜索：1 步搜一遍、2 步搜一遍 …… 一直到设定步数（短解先出来，可随时停）
        `<label class="solver-check" title="${t('board.solverStepwiseHint')}"><input id="geb-solver-stepwise" type="checkbox"><span>${t('board.solverStepwise')}</span></label>` +
        // 解法自检：默认关（每个解都要挪点重算一遍，慢一些；只在当前位置成立的特解会被剔掉）
        `<label class="solver-check" title="${t('board.solverSelfCheckHint')}"><input id="geb-solver-generic" type="checkbox"><span>${t('board.solverSelfCheck')}</span></label>` +
        `<label class="solver-check" title="${t('board.solverSymmetryHint')}"><input id="geb-solver-symmetry" type="checkbox" checked><span>${t('board.solverSymmetry')}</span></label>` +
        `<label class="solver-check" title="${t('board.solverGoalFirstHint')}"><input id="geb-solver-goal-first" type="checkbox" checked><span>${t('board.solverGoalFirst')}</span></label>` +
        `<label class="solver-check" title="${t('board.solverLowMemoryHint')}"><input id="geb-solver-low-memory" type="checkbox" checked><span>${t('board.solverLowMemory')}</span></label>` +
        '<div class="solver-field-row">' +
          `<label title="${t('board.solverTtMbHint')}">${t('board.solverTtMb')}<input id="geb-solver-tt" type="number" min="0" max="512" value="8"></label>` +
          `<label title="${t('board.solverDedupHint')}">${t('board.solverDedup')}<input id="geb-solver-dedup" type="number" min="0" max="65536" value="2048"></label>` +
        '</div>' +
        '<div class="solver-field-row">' +
          `<label title="${t('board.solverThreadsHint')}"><span class="solver-label-text">${t('board.solverThreads')}<span class="solver-recommend">${t('board.solverThreadsRecommended', {count: recommendedThreads})}</span></span><input id="geb-solver-threads" type="number" min="1" max="16" value="1"></label>` +
          `<label title="${t('board.solverEpsHint')}">${t('board.solverEps')}<input id="geb-solver-eps" type="number" min="0" step="any" placeholder="${t('board.solverEpsAuto')}"></label>` +
        '</div>' +
      '</details>' +
      `<button id="geb-solver-run">${t('board.solverRun')}</button>`,
      `<div class="solver-step-row"><button id="geb-solver-prev">${t('board.solverPrevStep')}</button>` +
        `<span id="geb-solver-stepinfo">—</span>` +
        `<button id="geb-solver-next">${t('board.solverNextStep')}</button></div>`,
      `<button id="geb-solver-clear">${t('board.solverClear')}</button>`,
      `<output id="geb-solver-status">${t('board.solverIdle')}</output>`,
      // 搜索进度条 + 右边的百分比（百分比就是条的比例，见 paintSearchProgress）
      '<div class="solver-progress-row">' +
        '<div class="solver-progress" id="geb-solver-progress"><div class="solver-progress-bar" id="geb-solver-progress-bar"></div></div>' +
        '<span class="solver-progress-text" id="geb-solver-progress-text">0.00%</span></div>',
      '<div id="geb-solver-list" class="solver-solution-list"></div>',
    ].join('');
    // 从关卡打开求解器时带了 solverTool（那一关限定单尺 / 单规）：可用工具默认就选到同一种模式
    const presetSolverTool = params.get('solverTool');
    const solverToolSelect = panel.querySelector('#geb-solver-tool');
    if (solverToolSelect && ['0', '1', '2'].includes(presetSolverTool)) {
      solverToolSelect.value = presetSolverTool;
    }
    // 画布上已经有网格（画板里生成过 / 关卡自带）：切到网格模式并把最大步数切到 4
    syncSolverGridOption(panel);
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
    // 正在跑的搜索的「取消」句柄：并行搜索另有一个总时长计时器（到点写超时），停下时得一并掐掉
    let activeSearchCancel = null;
    // 每次搜索的编号：停掉之后迟到的 worker 消息就不要再往面板上写了
    let searchToken = 0;
    // 「被停止」的次数：逐步搜索（多轮）靠它判断该不该继续下一轮（searchToken 每轮都会变，用不了）
    let searchStopToken = 0;
    // 搜索进度（进度条）：进度 = 已搜情况数 / 预估总情况数（「情况」= 搜索树的一个节点，
    // 无解的也算；见 refreshSearchProgress）。顺便记下时间上限与已找到的解数，鼠标停上去能看到
    let progressState = null;
    let progressTimer = null;

    /** 大数字加千分位 过程函数 */
    const progressNumber = value => Number(value || 0).toLocaleString();

    /**
     * 预估总情况数 过程函数
     * 「已经搜完的那几个情况」一共占了多少节点 → 平均每个情况多大 → 乘上情况总数。
     * 一路自校准：搜得越多估得越准（这也正是「没有先验、只能估」的代价）
     * @param {Object} state
     * @returns {number} 0 表示还算不出来
     */
    const estimatedSituations = state => {
      if (!(state.tasksTotal > 0) || !(state.tasksDone > 0)) return 0;
      return (state.completedNodes / state.tasksDone) * state.tasksTotal;
    };

    /** 进度条的说明文字 过程函数（鼠标停在进度条上能看到：这个条按什么算、顺带几个数字） */
    const progressTitle = state => {
      const parts = [t('board.solverProgressNote')];
      const estimated = estimatedSituations(state);
      parts.push(t('board.solverProgressNodes', {
        nodes: progressNumber(state.nodes),
        total: estimated > 0 ? progressNumber(Math.round(estimated)) : '?',
      }));
      if (state.target > 0) {
        parts.push(t('board.solverProgressFound', {found: liveResult.solutions.length, target: state.target}));
      }
      if (state.limitSeconds > 0) {
        parts.push(t('board.solverProgressTime', {
          elapsed: ((performance.now() - state.startedAt) / 1000).toFixed(1),
          limit: state.limitSeconds,
        }));
      }
      return parts.join(' · ');
    };

    /**
     * 把进度条的宽度与右边那个百分比一起写上 过程函数
     * 百分比就是条的比例（绿色那一段占满格多少），所以两处都写同一个数、只从这儿写
     * @param {number} ratio 0~1
     * @param {string} [title] 悬停说明（放在条与数字上，两边一样）
     */
    const paintSearchProgress = (ratio, title = '') => {
      const bar = panel.querySelector('#geb-solver-progress-bar');
      const text = panel.querySelector('#geb-solver-progress-text');
      const percent = Math.max(0, Math.min(1, ratio || 0)) * 100;
      // 3 位有效数字（1.00 / 50.0 / 100）：进度常在小数上磨，取整会让数字一段时间里一动不动
      const shown = `${percent.toPrecision(3)}%`;
      if (bar) {
        // 条按同一个数（多留几位给 CSS 定位，它自己会归一化）
        bar.style.width = `${Number(percent.toFixed(3))}%`;
        bar.title = title;
      }
      if (text) {
        // 与条同一位小数：进度常在小数上磨，取整会让数字一段时间里一动不动
        text.textContent = shown;
        text.title = title;
      }
    };

    /**
     * 按当前进度刷新进度条 过程函数
     * 进度 = **已搜情况数 / 预估总情况数**（情况 = 搜索树的一个节点，无解的也算一种情况）：
     *   · 分母 = 平均每个情况多大 × 情况总数（自校准外推，见 estimatedSituations）；
     *     还算不出来时（一个情况都还没搜完）条就停在 0
     *   · 凑满设定的解数时收尾会把条补满（那时搜索提前停了，本来就到不了 100%）
     *   · 其余收尾（穷尽 / 超时 / 手动停）停在原地
     */
    const refreshSearchProgress = () => {
      if (!panel.querySelector('#geb-solver-progress-bar')) return;
      if (!progressState) {
        paintSearchProgress(0);
        return;
      }
      const state = progressState;
      const estimated = estimatedSituations(state);
      // 分母是「边搜边校准」出来的：搜完的情况一多，估计值就会变，条于是可能往回缩。
      // 这里只许往前走（记住见过的最大值）—— 进度条往回跳比估得粗还难理解
      const raw = estimated > 0 ? Math.min(1, state.nodes / estimated) : 0;
      state.ratio = Math.max(state.ratio || 0, raw);
      paintSearchProgress(state.ratio, progressTitle(state));
    };

    /**
     * 收下内核报来的一次搜索进度 过程函数（单线程）
     * @param {{nodes: number, tasksDone: number, completedNodes: number, totalTasks: number}} payload
     */
    const takeSearchProgress = payload => {
      if (!progressState || !payload) return;
      progressState.nodes = payload.nodes || 0;
      progressState.tasksDone = payload.tasksDone || 0;
      progressState.completedNodes = payload.completedNodes || 0;
      if (payload.totalTasks > 0) progressState.tasksTotal = payload.totalTasks;
      refreshSearchProgress();
    };

    /** 清空进度（开始新搜索 / 面板复位时用） 过程函数 */
    const resetSearchProgress = () => {
      progressState = null;
      refreshSearchProgress();
    };

    /**
     * 凑满设定的解数时把进度条补满 过程函数
     * 只有「收满设定的解数」这一种收尾才补满：其余（穷尽 / 超时 / 手动停）条停在原地才是实情
     */
    const finishSearchProgress = () => {
      progressState = null;
      paintSearchProgress(1, `${t('board.solverProgressNote')} · ${t('board.solverProgressDone')}`);
    };

    /** 没凑满就收尾时给进度条补一句「搜索已结束」 过程函数（宽度与百分比保留实情，不补满） */
    const markSearchProgressFinished = () => {
      if (!panel.querySelector('#geb-solver-progress-bar')) return;
      const parts = progressState ? [progressTitle(progressState)] : [];
      parts.push(t('board.solverProgressDone'));
      paintSearchProgress(progressState ? (progressState.ratio || 0) : 0, parts.join(' · '));
    };

    /**
     * 开始一次搜索的进度统计 过程函数
     * @param {{target?: number, limitSeconds?: number}} options target=要几个解，limitSeconds=时间上限
     */
    const startSearchProgress = options => {
      progressState = {
        target: options.target || 0,
        limitSeconds: options.limitSeconds || 0,
        startedAt: performance.now(),
        // 「情况」计数：nodes = 已搜节点数（分子）；tasksDone / completedNodes = 已搜完的情况数
        // 与它们的节点数合计（用来算平均规模）；tasksTotal = 边界层的情况总数（分母的一部分）
        nodes: 0,
        tasksDone: 0,
        completedNodes: 0,
        tasksTotal: 0,
        // 条上已经显示到哪儿（只许往前走，见 refreshSearchProgress）
        ratio: 0,
      };
      refreshSearchProgress();
    };

    /** 切换按钮的「开始求解 / 停止求解」状态 过程函数 */
    const setSearching = searching => {
      const runButton = panel.querySelector('#geb-solver-run');
      runButton.textContent = searching ? t('board.solverStop') : t('board.solverRun');
      runButton.classList.toggle('running', searching);
      // 进度条只在搜索期间定时刷新（收尾时停在最后的位置，不重置 —— 一眼能看到搜到哪一步）
      if (searching) {
        if (!progressTimer) progressTimer = setInterval(refreshSearchProgress, 300);
      } else if (progressTimer) {
        clearInterval(progressTimer);
        progressTimer = null;
      }
    };

    /** 停掉正在跑的搜索 过程函数（返回是否真的停掉了一个） */
    const stopSearch = () => {
      if (!activeWorker && !activePool.length) return false;
      // 先把这次搜索判死：并行搜索的总时长计时器到点会写「超时（n 秒），还没有找到解法」，
      // 只 terminate worker 掐不掉它 —— 停下之后到点仍会冒出那句超时（单线程则可能收到迟到的结果）
      searchToken++;
      if (activeSearchCancel) activeSearchCancel();
      activeSearchCancel = null;
      activePool.forEach(worker => worker.terminate());
      activePool = [];
      if (activeWorker && !activePool.includes(activeWorker)) activeWorker.terminate();
      activeWorker = null;
      setSearching(false);
      return true;
    };

    // 高级选项：值都对应搜索内核本来就支持的参数（见 solver/search-worker.js 的 runSearch 设置段），
    // 改了之后记住，下次打开面板还是这次的选择
    const ADVANCED_KEY = 'solverAdvanced';
    const advancedFields = {
      symmetry: panel.querySelector('#geb-solver-symmetry'),
      goalFirst: panel.querySelector('#geb-solver-goal-first'),
      lowMemory: panel.querySelector('#geb-solver-low-memory'),
      ttMB: panel.querySelector('#geb-solver-tt'),
      streamDedup: panel.querySelector('#geb-solver-dedup'),
      threads: panel.querySelector('#geb-solver-threads'),
      eps: panel.querySelector('#geb-solver-eps'),
      generic: panel.querySelector('#geb-solver-generic'),
      stepwise: panel.querySelector('#geb-solver-stepwise'),
    };
    /** 读一遍高级选项 过程函数 */
    const readAdvanced = () => {
      const options = {
        symmetry: advancedFields.symmetry.checked,
        goalFirst: advancedFields.goalFirst.checked,
        lowMemory: advancedFields.lowMemory.checked,
        ttMB: Math.max(0, Number(advancedFields.ttMB.value) || 0),
        streamDedup: Math.max(0, Number(advancedFields.streamDedup.value) || 0),
        threads: Math.max(1, Math.min(16, Number(advancedFields.threads.value) || 1)),
        // 留空 = 自动（按图幅算，见 buildSolverRequest 里的 eps）
        eps: Number(advancedFields.eps.value) > 0 ? Number(advancedFields.eps.value) : null,
        // 解法自检：默认关（见 solutionPassesSelfCheck）
        generic: advancedFields.generic.checked,
        // 逐步搜索：默认关（见 runStepwiseSearch）—— 少了这一项的话勾了等于没勾，
        // 「逐步搜索」会退化成一次普通搜索（8E 里那堆 8 步解就会把 7 步解挤掉）
        stepwise: advancedFields.stepwise.checked,
      };
      try { localStorage.setItem(ADVANCED_KEY, JSON.stringify(options)); } catch (error) { /* 隐私模式等忽略 */ }
      return options;
    };
    /** 恢复上次的高级选项 过程函数 */
    const restoreAdvanced = () => {
      let saved = null;
      try { saved = JSON.parse(localStorage.getItem(ADVANCED_KEY) || 'null'); } catch (error) { saved = null; }
      if (!saved) return;
      advancedFields.symmetry.checked = saved.symmetry !== false;
      advancedFields.goalFirst.checked = saved.goalFirst !== false;
      advancedFields.lowMemory.checked = saved.lowMemory !== false;
      if (typeof saved.ttMB === 'number') advancedFields.ttMB.value = saved.ttMB;
      if (typeof saved.streamDedup === 'number') advancedFields.streamDedup.value = saved.streamDedup;
      if (typeof saved.threads === 'number') advancedFields.threads.value = saved.threads;
      // 解法自检默认关：只有上次明确勾上过才勾回来
      advancedFields.generic.checked = saved.generic === true;
      // 逐步搜索同样默认关
      advancedFields.stepwise.checked = saved.stepwise === true;
      if (saved.open) panel.querySelector('#geb-solver-advanced').open = true;
    };
    restoreAdvanced();
    // 展开 / 收起、改动任何一项都记一下：不必等跑一次搜索才生效
    const advancedBox = panel.querySelector('#geb-solver-advanced');
    advancedBox.addEventListener('toggle', event => {
      try {
        const saved = JSON.parse(localStorage.getItem(ADVANCED_KEY) || '{}') || {};
        saved.open = event.target.open;
        localStorage.setItem(ADVANCED_KEY, JSON.stringify(saved));
      } catch (error) { /* 忽略 */ }
    });
    advancedBox.addEventListener('change', () => readAdvanced());
    const advancedOptions = () => readAdvanced();

    // 并行搜索用到的 worker 池（单线程路径不用，见下面的 startParallelSearch）
    let activePool = [];

    /**
     * 解法列表里补一行 过程函数（「解法 n」点了画出来，「文字步骤」看中文步骤说明）
     * 收尾重画与搜索途中的边搜边显示共用它
     */
    const appendSolutionRow = (solution, index) => {
      const row = document.createElement('div');
      row.className = 'solver-solution-row';
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
    };

    // 内核「一找到解就端上来」：搜索途中收到的解攒在这一份里，随到随显示。
    // 它同时就是并行那条路的正式解表（去重、换算都只在这儿做一次），单线程那条路则只拿它显示，
    // 收尾时 showSearchResult 会按 worker 汇总的完整解表重画一遍
    const liveResult = {solutions: [], initialElementCount: 0, initialPointCount: 0};
    const streamedSignatures = new Set();

    /**
     * 解法的几何签名 过程函数（去重用：同一步数、同一批新作元素算同一条解）
     * 并行时不同前缀会把同一条解各搜一遍，页面据此只留一条
     */
    const solutionSignature = (solution, initialElementCount) => solution.newElementCount + '|'
      + solution.elements.slice(initialElementCount || 0)
        .map(element => [element.type, element.a, element.b, element.c].join(',')).join(';');

    /**
     * 记下这次搜索的「初始元素数 / 已知点数」 过程函数
     * 流式消息（每条解）、前缀任务消息都自带这两个数：知道了才能判断解法里的构造计划
     * 与画布对得上（见 solverPlanMatchesCanvas）
     */
    const rememberResultMeta = meta => {
      if (!meta || !meta.initialElementCount) return;
      liveResult.initialElementCount = meta.initialElementCount;
      liveResult.initialPointCount = meta.initialPointCount || 0;
    };

    /**
     * 收下一条「一找到就端上来」的解 过程函数
     * 去重 → 换算到画布坐标（网格模式的请求是按网格单位换算过去的，解法得换回来）→
     * 补一行到列表、顺手把状态改成「已找到 n 个」；latest 指到这份进行中的结果上，
     * 于是这些行当场就能点开逐步看（不必等搜索结束）
     * @param {Object} solution 内核发来的一条解
     * @param {Object} meta {initialElementCount, initialPointCount}（每条流式消息都自带）
     * @param {number} seconds 已用时
     * @returns {boolean} true 表示这是一条新解
     */
    const takeStreamedSolution = (solution, meta, seconds) => {
      rememberResultMeta(meta);
      if (solverLastRequest?.gridUnit) kernelSolutionToCanvas(solution, solverLastRequest.gridUnit);
      const signature = solutionSignature(solution, liveResult.initialElementCount);
      if (streamedSignatures.has(signature)) return false;
      streamedSignatures.add(signature);
      liveResult.solutions.push(solution);
      latest = liveResult;
      appendSolutionRow(solution, liveResult.solutions.length - 1);
      refreshSearchProgress();
      status.textContent = t('board.solverSearchingFound', {
        count: liveResult.solutions.length,
        seconds: seconds,
      });
      return true;
    };

    /**
     * 把一次搜索的结果画进面板 过程函数
     * 单线程与并行两条路都从这里收尾（形状与 worker 的返回值一致）
     */
    const showSearchResult = (result, seconds, timeLimitSeconds, limit) => {
      // 进度条 = 已搜情况数 / 预估总情况数：搜满设定的解数、或把搜索树搜穷了，两种都意味着
      // 「该搜的都搜完了」→ 补满；超时 / 手动停则停在估计出来的位置（那才是搜到哪儿）
      const hitQuota = result.requestedSolutions > 0 && result.solutionCount >= result.requestedSolutions;
      if (hitQuota || !result.timedOut) finishSearchProgress();
      else markSearchProgressFinished();
      // 网格模式：请求是按网格单位换算过去的，解法里的坐标与方程要换回画布坐标系 ——
      // 否则覆盖层会把解法画到别处。单线程与并行两条路都从这里收尾，所以只改这一处
      if (result.solutions && !result.gridScaledToCanvas && solverLastRequest?.gridUnit) {
        result.solutions.forEach(solution => kernelSolutionToCanvas(solution, solverLastRequest.gridUnit));
        result.gridScaledToCanvas = true;
      }
      // 解法自检（高级选项，默认关）：把可动点轻挪一点重算，只在当前这组数上成立的
      // 特解会被剔掉 —— 画布对不上（没有可动计划）、挪不动的题一律原样保留
      if (result.solutions && advancedFields.generic.checked) filterSolutionsBySelfCheck(result);
      if (!result.found) {
        if (result.selfCheckRejected) {
          // 全部被自检剔掉：搜索途中边搜边显示的行与覆盖层也要收回去，别留着误导
          list.innerHTML = '';
          latest = null;
          currentIndex = -1;
          currentStep = 0;
          stepInfo.textContent = '—';
          solverSolutionPlan = null;
          solverSolutionOverlay = null;
          drawContent();
          status.textContent = t('board.solverSelfCheckAllRejected', {count: result.selfCheckRejected});
          return;
        }
        status.textContent = result.timedOut
          ? t('board.solverTimeoutNoSolution', {seconds: timeLimitSeconds})
          : t('board.solverNoSolution', {limit: limit, seconds: seconds});
        return;
      }
      latest = result;
      status.textContent = (result.timedOut
        ? t('board.solverTimeoutPartial', {
          seconds: timeLimitSeconds,
          found: result.solutionCount,
          requested: result.requestedSolutions,
        })
        : t('board.solverFound', {count: result.solutionCount, seconds: seconds}))
        + (result.selfCheckRejected ? t('board.solverSelfCheckNote', {count: result.selfCheckRejected}) : '');
      // 搜索途中已经边搜边显示了一些行：清掉，按这份完整解表重画（顺序也照这里的排）
      list.innerHTML = '';
      result.solutions.forEach(appendSolutionRow);
      playSolution(0, true);
    };

    /**
     * 组装给 worker 的请求体 过程函数（单线程与并行共用）
     * 默认值＝内核原本的默认，所以高级选项不动时行为与以前完全一致。
     * `request` 里也带着一份 limit / solutions / timeLimitSeconds（面板值），所以它必须放在
     * **前面**：放后面会把这里的 settings 覆盖掉 —— 逐步搜索那种「每轮换一个 limit」就换不动
     * （表现：8E + 逐步搜索时，每一轮其实都是 8 步搜索，7E 的解会被一堆 8E 解挤掉）
     */
    const workerPayload = (settings, request, advanced) => Object.assign({}, request, {
      limit: settings.limit,
      toolType: settings.toolType,
      P: request.points.length / 2,
      L: request.lines.length / 3,
      // 射线 / 线段各占 4 个数字（起点与经过点 / 两端点）
      R: request.rays.length / 4,
      S: request.segments.length / 4,
      C: request.circles.length / 3,
      rays: request.rays,
      segments: request.segments,
      solutions: settings.solutions,
      timeLimitSeconds: settings.timeLimitSeconds,
      symmetry: advanced.symmetry,
      goalFirst: advanced.goalFirst,
      lowMemory: advanced.lowMemory,
      ttMB: advanced.ttMB,
      streamDedup: advanced.streamDedup,
    });

    /**
     * 并行搜索 过程函数
     * 照着 C++ 版 bs_v8 的分工：1 号 worker 把搜索树按固定深度切成一串「前缀任务」流式发回来，
     * 每个 worker 领一个前缀**独占**地搜（重放前缀 + DFS；任务内部不用置换表，与 C++ 一致），
     * 页面上汇总去重、按步数排序。与单线程一样：收够解数就收工，超时/停止随时能掐掉。
     * 解是「一找到就单发一条」的（见 search-worker.js 的 attachSolutionStream），所以收够解数
     * 那一刻就能收工 —— 不必再等在飞的前缀任务跑完（网格题里一个任务可能要好几百毫秒）。
     * @param {Object} settings {request, limit, toolType, timeLimitSeconds, solutions, advanced, threads}
     */
    const startParallelSearch = settings => {
      // 本次搜索的编号：被 stopSearch 作废（编号变了）之后，这次的一切回调都不再收尾
      const token = ++searchToken;
      const threads = Math.max(2, settings.threads | 0);
      const payload = workerPayload(settings, settings.request, settings.advanced);
      // 切分深度：线程越多就切深一层（深度 3 通常有几十上百个前缀，够分了）。
      // 但不能切到最后一层：search 在最后一步走的是「末段专用」分支、不再递归，
      // 那一层的节点不存在，按它切会一个任务都产不出来（worker 里也有同样的收紧）
      const splitDepth = Math.min(threads > 2 ? 3 : 2, Math.max(1, settings.limit - 1));
      const startedAt = performance.now();
      const deadline = startedAt + settings.timeLimitSeconds * 1000;
      // 解直接收在面板共用的那份 liveResult 里：去重、坐标换算、边搜边显示都由 takeStreamedSolution
      // 统一办，于是内核一找到解就能收下，不必等它所属的那个前缀任务跑完
      const queue = [];
      const state = new Map();
      const workers = [];
      let frontierDone = false;
      let finished = false;
      let frontierWorker = null;
      let timer = null;

      const elapsedSeconds = () => ((performance.now() - startedAt) / 1000).toFixed(2);

      /** 收下一条解 过程函数（重复的会被 takeStreamedSolution 挡掉，顺手补一行到面板） */
      const collect = (solution, meta) => takeStreamedSolution(solution, meta, elapsedSeconds());

      const teardown = () => {
        if (timer) clearTimeout(timer);
        timer = null;
        workers.forEach(worker => worker.terminate());
        workers.length = 0;
        activePool = [];
        activeWorker = null;
        activeSearchCancel = null;
        setSearching(false);
      };

      const finish = timedOut => {
        // 已经被 stopSearch 作废（编号变了）就什么都不做：停下的搜索不该再往面板上写结论
        if (finished || token !== searchToken) return;
        finished = true;
        teardown();
        // 并行时各前缀出解的先后是乱的：按步数排一下，短的在前
        const found = liveResult.solutions;
        found.sort((one, two) => one.newElementCount - two.newElementCount);
        // 多个 worker 可能各带着解一起回来，超过「解数」就只留前面这些（与单线程的口径一致）
        if (found.length > settings.solutions) found.length = settings.solutions;
        const seconds = elapsedSeconds();
        // 逐步搜索的中间轮：只把解攒进 liveResult，不往面板写结论（最后一轮由 runStepwiseSearch 统一收尾）
        if (settings.silent) {
          if (typeof settings.onDone === 'function') settings.onDone(!!timedOut);
          return;
        }
        showSearchResult({
          found: found.length > 0,
          time: seconds,
          steps: found.length ? found[0].newElementCount : 0,
          points: found.length ? found[0].points : [],
          elements: found.length ? found[0].elements : [],
          bounds: found.length ? (found[0].bounds || []) : [],
          solutions: found,
          solutionCount: found.length,
          requestedSolutions: settings.solutions,
          quotaReached: found.length >= settings.solutions,
          timedOut: !!timedOut,
          initialElementCount: liveResult.initialElementCount,
          initialPointCount: liveResult.initialPointCount,
          newElementCount: found.length ? found[0].newElementCount : 0,
          // 这些解在收到时就换算到画布坐标了（见 takeStreamedSolution），别在这再换算一次
          gridScaledToCanvas: true,
          engine: 'bs v8 (JS, ' + threads + ' workers)',
        }, seconds, settings.timeLimitSeconds, settings.limit);
      };

      const maybeFinish = () => {
        if (finished) return;
        if (liveResult.solutions.length >= settings.solutions) {
          finish(false);
          return;
        }
        const busy = [...state.values()].some(value => value === 'busy' || value === 'frontier');
        if (!busy && frontierDone && !queue.length) finish(false);
      };

      /** 给某个 worker 派活：有任务就派，没任务先记成空闲 过程函数 */
      const dispatch = worker => {
        if (finished) return;
        if (state.get(worker) === 'busy' || state.get(worker) === 'frontier') return;
        const task = queue.shift();
        if (!task) {
          state.set(worker, 'idle');
          maybeFinish();
          return;
        }
        state.set(worker, 'busy');
        worker.postMessage({type: 'prefix', id: Date.now(), data: Object.assign({}, payload, {prefix: task})});
      };

      const dispatchIdle = () => {
        workers.forEach(worker => { if (state.get(worker) === 'idle') dispatch(worker); });
      };

      for (let index = 0; index < threads; index++) {
        const worker = new Worker('./solver/search-worker.js');
        workers.push(worker);
        state.set(worker, 'idle');
        // 一号 worker 兼做「切前缀任务」这一趟
        if (index === 0) {
          frontierWorker = worker;
          state.set(worker, 'frontier');
          worker.postMessage({
            type: 'frontier',
            id: Date.now(),
            data: Object.assign({}, payload, {
              splitDepth,
              // 切分这一趟只给一小段时间：整棵搜索的预算要留给真正的搜索
              timeLimitSeconds: Math.max(1, Math.min(3, settings.timeLimitSeconds / 5)),
            }),
          });
        }
        worker.onmessage = event => {
          const message = event.data || {};
          if (finished) return;
          // 内核一找到解就单独发一条：当场收下、当场显示，收够「解数」就当场收工 ——
          // 不必再等在飞的那个前缀任务跑完（网格题里一个任务可能就是几百毫秒到几秒）
          if (message.type === 'solution') {
            if (collect(message.solution, message) && liveResult.solutions.length >= settings.solutions) finish(false);
            return;
          }
          if (message.type === 'prefix-batch') {
            queue.push(...(message.tasks || []));
            dispatchIdle();
            return;
          }
          if (message.type === 'prefix-done') {
            frontierDone = true;
            rememberResultMeta(message);
            // 进度条的分母：内核这一步拿到了「一共切了多少个情况」（边界层的情况总数）
            if (progressState && message.count) progressState.tasksTotal = message.count;
            state.set(worker, 'idle');
            dispatch(worker);
            maybeFinish();
            return;
          }
          if (message.type === 'prefix-result') {
            (message.solutions || []).forEach(solution => collect(solution, message));
            // 进度条：这个情况搜完了 —— 它的节点数记进合计，分子也跟着涨
            if (progressState) {
              progressState.tasksDone++;
              progressState.nodes += message.nodes || 0;
              progressState.completedNodes += message.nodes || 0;
            }
            state.set(worker, 'idle');
            dispatch(worker);
            if (liveResult.solutions.length >= settings.solutions) finish(false);
            return;
          }
          if (message.type === 'error') {
            // 单个任务出错就让这个 worker 歇着，别把整次搜索带塌
            console.error('solver worker error', message.error);
            state.set(worker, 'idle');
            maybeFinish();
          }
        };
        worker.onerror = () => {
          state.set(worker, 'idle');
          maybeFinish();
        };
      }

      activeWorker = workers[0];
      activePool = workers;
      // 这个总时长计时器归本次搜索所有：停下时由 activeSearchCancel 一并掐掉（见 stopSearch），
      // 否则停止之后它到点照样会 finish(true)，弹一句「超时（n 秒），还没有找到解法」
      activeSearchCancel = () => {
        finished = true;
        if (timer) clearInterval(timer);
        timer = null;
      };
      // 总时长自己看着：到点就收（worker 各自的 deadline 只管自己那个任务）
      timer = setInterval(() => {
        if (finished) return;
        if (performance.now() >= deadline) finish(true);
        else maybeFinish();
      }, 400);
      setSearching(true);
    };

    /**
     * 跑一轮搜索并等它结束 过程函数（逐步搜索用）
     * 面板不写结论（收尾交给 runStepwiseSearch 统一做），解照旧走流式那本账
     * @param {Object} settings
     * @returns {Promise<void>}
     */
    const runSearchRound = settings => new Promise(resolve => {
      if (settings.threads > 1) {
        startParallelSearch(Object.assign({}, settings, {silent: true, onDone: () => resolve()}));
        return;
      }
      const worker = new Worker('./solver/search-worker.js');
      const token = ++searchToken;
      activeWorker = worker;
      setSearching(true);
      const startedAt = performance.now();
      let done = false;
      let roundTimedOut = false;
      const finishRound = () => {
        if (done) return;
        done = true;
        worker.terminate();
        if (activeWorker === worker) activeWorker = null;
        setSearching(false);
        resolve({timedOut: roundTimedOut});
      };
      worker.onmessage = event => {
        const message = event.data;
        // 一找到就端上来：这一轮搜到的解照样当场进面板（收尾时才整体重排）
        if (message && message.type === 'solution') {
          if (token !== searchToken) return;
          takeStreamedSolution(message.solution, message, ((performance.now() - startedAt) / 1000).toFixed(2));
          return;
        }
        // 内核报来的搜索进度（已搜多少个情况）：这一轮也照样画进进度条
        if (message && message.type === 'progress') {
          if (token !== searchToken) return;
          takeSearchProgress(message);
          return;
        }
        roundTimedOut = !!(message && message.data && message.data.timedOut);
        finishRound();
      };
      worker.onerror = finishRound;
      worker.postMessage({type: 'search', id: Date.now(), data: workerPayload(settings, settings.request, settings.advanced)});
    });

    /**
     * 逐步搜索 过程函数（高级选项，默认关）
     * 步数上限 N 时按 1 步、2 步 …… N 步各搜一遍：短解先出来（例如 8E 里搜出来的都是 8 步解，
     * 7 步那条只有在「上限 7」那一轮里才不会被挤掉），收够「解数」或自己按停就收工。
     * 每轮都是一次**完整**的搜索，各自按面板里的「时间上限」单独计时（不是总共多久）——
     * 否则前面几轮就把时间吃光，后面步数更大的几轮根本轮不到，正是漏解的原因。
     * 每轮沿用同一条流式账（liveResult / streamedSignatures），解累积去重；
     * 中途只在列表里长出「解法 n」，最后一轮结束才统一排序收尾一次
     * @param {Object} settings
     */
    const runStepwiseSearch = async settings => {
      const startedAt = performance.now();
      const stopToken = searchStopToken;
      let lastTimedOut = false;
      for (let step = 1; step <= settings.limit; step++) {
        if (searchStopToken !== stopToken || liveResult.solutions.length >= settings.solutions) break;
        // 新一轮从零开始数「情况」（上一轮的计数是它自己的搜索树，不能混在一起）
        startSearchProgress({target: settings.solutions, limitSeconds: settings.timeLimitSeconds});
        const round = await runSearchRound(Object.assign({}, settings, {limit: step}));
        lastTimedOut = !!(round && round.timedOut);
      }
      // 被停止（再点一次按钮 / 清空）：面板状态交给 stopSearch，这里不再写结论
      if (searchStopToken !== stopToken) return;
      const seconds = ((performance.now() - startedAt) / 1000).toFixed(2);
      const found = liveResult.solutions;
      found.sort((one, two) => one.newElementCount - two.newElementCount);
      if (found.length > settings.solutions) found.length = settings.solutions;
      showSearchResult({
        found: found.length > 0,
        time: seconds,
        steps: found.length ? found[0].newElementCount : 0,
        points: found.length ? found[0].points : [],
        elements: found.length ? found[0].elements : [],
        bounds: found.length ? (found[0].bounds || []) : [],
        solutions: found,
        solutionCount: found.length,
        requestedSolutions: settings.solutions,
        quotaReached: found.length >= settings.solutions,
        // 最后一轮是超时结束的话，这次「逐步搜索」也算没搜穷
        timedOut: lastTimedOut,
        initialElementCount: liveResult.initialElementCount,
        initialPointCount: liveResult.initialPointCount,
        newElementCount: found.length ? found[0].newElementCount : 0,
        // 这些解在收到时就换算到画布坐标了（见 takeStreamedSolution）
        gridScaledToCanvas: true,
        engine: 'bs v8 (JS, stepwise)',
      }, seconds, settings.timeLimitSeconds, settings.limit);
    };

    panel.querySelector('#geb-solver-run').addEventListener('click', () => {
      // 正在搜索时再点一下就是停止：搜索可能跑满时间上限，不必干等
      if (stopSearch()) {
        status.textContent = t('board.solverStopped');
        return;
      }
      const request = buildSolverRequest();
      // 高级选项（高级选项栏里的值）：容差留空就用 buildSolverRequest 按图幅自动算的那个
      const advanced = advancedOptions();
      if (advanced.eps) request.eps = advanced.eps;
      // 把这次**实际生效**的自动容差写在输入框的提示里：省得以为内核按 1e-11 判定
      // （实际是 1e-11 × 图幅，而且内核坐标系在网格模式下是「格」，不是画布 px）
      else if (advancedFields.eps) advancedFields.eps.placeholder = `自动 ${request.eps.toExponential(2)}`;
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
      // 边搜边看的那本账也清空：上一次搜索留下的解不能混进来
      liveResult.solutions.length = 0;
      streamedSignatures.clear();
      drawContent();
      status.textContent = t('board.solverSearching');

      const settings = {request, limit, toolType, timeLimitSeconds, solutions, advanced, threads: advanced.threads};
      startSearchProgress({target: solutions, limitSeconds: timeLimitSeconds});
      // 逐步搜索（高级选项）：1 步搜一遍、2 步搜一遍 …… 到设定步数（见 runStepwiseSearch）
      if (advanced.stepwise) {
        runStepwiseSearch(settings);
        return;
      }
      // 并行：多个 worker 按前缀分头搜（见 startParallelSearch）；线程数 1 时走原来的单 worker
      if (settings.threads > 1) {
        startParallelSearch(settings);
        return;
      }

      const worker = new Worker('./solver/search-worker.js');
      // 本次搜索的编号：被 stopSearch 作废后，迟到的结果不再往面板上写
      const token = ++searchToken;
      activeWorker = worker;
      setSearching(true);
      const startedAt = performance.now();
      const seconds = () => ((performance.now() - startedAt) / 1000).toFixed(2);
      worker.onmessage = event => {
        const message = event.data;
        // 内核一找到解就端上来（早于 result 的一条消息）：当场收下、当场显示，
        // 去重与坐标换算都在 takeStreamedSolution 里。单线程不必提前收工 ——
        // 内核收够解数自己就停了，紧接着会把汇总结果发过来
        if (message && message.type === 'solution') {
          if (token !== searchToken) return;
          takeStreamedSolution(message.solution, message, seconds());
          return;
        }
        // 内核报来的搜索进度（已搜多少个情况）：画进进度条
        if (message && message.type === 'progress') {
          if (token !== searchToken) return;
          takeSearchProgress(message);
          return;
        }
        worker.terminate();
        activeWorker = null;
        setSearching(false);
        if (token !== searchToken) return;
        if (!message || !message.success) {
          status.textContent = t('board.solverFailed', {
            error: message && message.error ? message.error : t('board.solverUnknownError'),
          });
          return;
        }
        showSearchResult(message.data, seconds(), timeLimitSeconds, limit);
      };
      worker.onerror = () => {
        worker.terminate();
        activeWorker = null;
        setSearching(false);
        if (token !== searchToken) return;
        status.textContent = t('board.solverLoadFailed');
      };
      worker.postMessage({type: 'search', id: Date.now(), data: workerPayload(settings, request, advanced)});
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
      resetSearchProgress();
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
   * 清掉已经不在画布上的标记 过程函数
   * 制题器 / 求解器里删掉一个图形（连同它的子图形）时，标记表与「隐藏」集合里还挂着它的 id，
   * 样式色记录也留着 —— 于是标记面板里会多出一个已经不存在的对象、导出的 gmt 也会带上它，
   * 同一个 id 之后新建出来的图形还会被那份旧样式色染错。这里一并清掉
   * @returns {boolean} 有没有清掉东西
   */
  const pruneMarks = () => {
    if (typeof geometryManager === 'undefined') return false;
    let changed = false;
    allMarkSets().forEach(({set}) => {
      [...set].forEach(id => {
        if (geometryManager.get(id)) return;
        set.delete(id);
        changed = true;
      });
    });
    // 「隐藏」不在标记面板的那几组里，但同样按 id 记着（gmt 的 hidden= 行读它）
    const hidden = typeof geometryElementLists !== 'undefined' ? geometryElementLists.hidden : null;
    if (hidden) {
      [...hidden].forEach(id => {
        if (geometryManager.get(id)) return;
        hidden.delete(id);
        changed = true;
      });
    }
    if (changed) [...markedStyles.keys()].forEach(id => { if (!geometryManager.get(id)) markedStyles.delete(id); });
    return changed;
  };
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
    // near() 内部已做点优先：交点不会被背后的直线 / 圆抢先命中。
    // 网格当作一整块直接排除在命中之外（先忽略网格再找最近的图形）：否则点在格线附近会
    // 先选中网格、吃到「网格不能标记」的提示，反而选不到网格后面的图形（见 #8）
    const gridIds = (typeof geometryElementLists !== 'undefined' && geometryElementLists.grid)
      ? [...geometryElementLists.grid] : [];
    const [id] = geometryManager.near([x, y], ['point', 'line', 'circle'], 1, gridIds);
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
    // 网格当作一整块、不接受任何标记：它在 gmt / 记录里由 #grid= 两行带出，
    // 标了既进不了「给定」栏（栏里只占一行「格线」），导出时还会多出一堆普通对象
    if (isGridId(id)) {
      toast(t('board.gridNoMark'));
      return;
    }
    // 制题器 / 求解器：完全落在网格范围外的图形不许标记（会把它写进题面 / 已知条件）
    if (window.markBlockedOutsideGrid(id)) {
      toast(t('board.markOutsideGrid'));
      return;
    }
    // 可移动点只能是自由点（能拖得动的那种），交点 / 线上点 / 中点这些不算
    if (marking === 'movepoints' && (item?.getType() !== 'point' || item.getBase().type !== 'none')) {
      toast(t('board.movepointOnlyFree'));
      return;
    }
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
      // 互斥：给定三项里只能选一个，且与所求类 / 探索显示互斥
      // （所求判定与所求显示之间可以共存，见 markExclusive）
      markExclusive(id, marking);
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
    // 双指是缩放：直接放行给 index.js / playPage.js 的触摸处理（它们挂在同一个 canvas 上），
    // 否则标记模式下就没法双指缩放（手指按在图形上时被这里全吃掉，见 #3）
    if (event.touches && event.touches.length >= 2) {
      markingGesture = false;
      return;
    }
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
    // 手机那套布局（窄屏或矮屏，阈值见 index.css 末尾的媒体查询）里标记分组默认展开
    const foldOpened = solverMode || (mode === 'maker' && window.matchMedia('(max-width: 960px), (max-height: 500px)').matches);
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
    // 网格当作一整块：它可能有几十条格线，在栏里只占一行「网格（m×n）」（元素一览那边只叫「格线」，
    // 这里带上大小，制题者一眼能看出尺寸）
    const ids = [...set].filter(item => !isGridId(item));
    const hasGrid = ids.length !== set.size;
    const rows = ids.map(item => {
      const element = geometryManager.get(item);
      const equation = element ? equationOf(element) : '';
      return `<li><span class="mark-name">${item}</span>${equation ? `<span class="mark-eq">${equation}</span>` : ''}</li>`;
    }).join('');
    const gridName = gridMeta
      ? t('board.gridSize', {m: gridMeta.m, n: gridMeta.n})
      : t('board.gridLabel');
    const gridRow = hasGrid ? `<li><span class="mark-name">${gridName}</span></li>` : '';
    list.innerHTML = (gridRow + rows) || `<li class="empty">${t('board.markEmpty')}</li>`;
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
    // 每次刷新前先把「已经删掉的图形」的标记清干净（见 pruneMarks）：删除图形走的是
    // storage 事件，面板就是在这里重画的，顺手清掉最省事
    pruneMarks();
    givenMarkItems.forEach(([key]) => markListOf(key, key === 'initial' ? givenColumnIds() : markSetOf(key)));
    for (let index = 1; index <= resultGroupCount(); index++) {
      markListOf(`result-${index}`, resultSetOf(index, 'judged'));
      markListOf(`resultShown-${index}`, resultSetOf(index, 'shown'));
    }
    if (!solverMode) markListOf('explore', markSetOf('explore'));
  };
  // 给页面脚本用：删除图形后清掉它的标记（关卡游玩那条 storage 处理里调，见 playPage.js）
  window.pruneMarks = () => pruneMarks();
  // 元素一览补标记之后，画布上的黑 / 蓝 / 金高亮要跟着重画（撤掉的给定色也要退回去）
  window.refreshMarkHighlight = () => refreshMarkHighlight();
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
    { label: t('board.clearCanvas'), templateId: 'menuClearCanvas', actionKey: 'clear-canvas', action: () => menuChoice('clear-canvas') },
    { label: t('board.help'), templateId: 'help', actionKey: 'help', action: helpDialog },
  ];
  // 历史记录：试玩模式（maker-play）不进菜单 —— 试玩只是预览自己做的关卡，
  // 记录该由关卡游玩那份负责（两者共用同一份记录清单，见 recordStore.js）
  if (mode !== 'maker-play') {
    menuItems.splice(2, 0, { label: t('board.record'), templateId: 'menuRecord', actionKey: 'switch-record', action: () => menuChoice('switch-record') });
  }
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
  // gmt 的导入 / 导出（制题器专用）：原来是画布上两个弹层按钮，现在收进菜单、
  // 选项改成站内弹框（见 optionDialog）—— 排在这两行菜单里：清空画布之后、帮助之前
  if (mode === 'maker') {
    const helpIndex = menuItems.findIndex(item => item.actionKey === 'help');
    menuItems.splice(helpIndex < 0 ? menuItems.length : helpIndex, 0,
      {
        label: t('board.importGmt'), templateId: 'importGmt', actionKey: 'import-gmt',
        action: () => optionDialog(t('board.importGmt'), [
          { label: '导入 gmt 代码', templateId: 'gmtPaste', actionKey: 'gmt-paste', action: () => codeDialog('导入 gmt 代码', '', loadGmt) },
          { label: '导入 gmt 文件', templateId: 'gmtRead', actionKey: 'gmt-read', action: readGmtFile },
        ]),
      },
      {
        label: t('board.exportGmt'), templateId: 'exportGmt', actionKey: 'export-gmt',
        action: () => optionDialog(t('board.exportGmt'), [
          { label: '查看 gmt 代码', templateId: 'gmtView', actionKey: 'gmt-view', action: () => codeDialog('gmt 代码', gmtText()) },
          { label: '导出为 gmt 文件', templateId: 'gmtSave', actionKey: 'gmt-save', action: saveGmtFile },
          { label: '导出至 Issue', templateId: 'gmtIssue', actionKey: 'gmt-issue', action: submitGmtIssue },
        ]),
      });
  }
  menuItems.push({ label: t('board.closeMenu'), templateId: 'menuClose', actionKey: 'close-menu', action: closePopups });
  /**
   * 生成网格弹层 过程函数
   * 输列数 / 行数（2–20）与单位长度（默认 50）；已经生成过网格时，里面填的就是当前的尺寸 ——
   * 再确认一次就是「改大小」（旧网格会被整块换掉）
   */
  const gridDialog = () => {
    const current = gridMeta;
    const mask = document.createElement('div');
    mask.className = 'board-dialog-mask';
    mask.innerHTML = '<div class="board-dialog board-dialog-confirm">' +
      `<strong>${t('board.gridTitle')}</strong>` +
      '<div class="grid-form">' +
        `<label>${t('board.gridCols')}<input class="board-dialog-input" id="grid-cols" type="number" step="1"></label>` +
        `<label>${t('board.gridRows')}<input class="board-dialog-input" id="grid-rows" type="number" step="1"></label>` +
        `<label>${t('board.gridUnit')}<input class="board-dialog-input" id="grid-unit" type="number" step="1"></label>` +
      '</div>' +
      `<p class="board-dialog-hint">${t('board.gridRangeHint')}</p>` +
      '<div class="board-dialog-actions"></div></div>';
    const cols = mask.querySelector('#grid-cols');
    const rows = mask.querySelector('#grid-rows');
    const unit = mask.querySelector('#grid-unit');
    cols.value = String(current ? current.m : 6);
    rows.value = String(current ? current.n : 6);
    unit.value = String(current ? current.unit : GRID_DEFAULT_UNIT);
    const hint = mask.querySelector('.board-dialog-hint');
    const actions = mask.querySelector('.board-dialog-actions');
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.textContent = t('common.cancel');
    cancelButton.addEventListener('click', () => mask.remove());
    const confirmButton = document.createElement('button');
    confirmButton.type = 'button';
    confirmButton.textContent = t('common.confirm');
    confirmButton.addEventListener('click', () => {
      const columns = Math.trunc(Number(cols.value));
      const gridRows = Math.trunc(Number(rows.value));
      const size = Number(unit.value);
      if (!(columns >= GRID_MIN_SIZE && columns <= GRID_MAX_SIZE
        && gridRows >= GRID_MIN_SIZE && gridRows <= GRID_MAX_SIZE && size > 0)) {
        hint.textContent = t('board.gridRangeHint');
        return;
      }
      if (generateGrid(columns, gridRows, size)) mask.remove();
      else hint.textContent = t('board.gridFailed');
    });
    actions.appendChild(confirmButton);
    actions.appendChild(cancelButton);
    mask.addEventListener('click', event => { if (event.target === mask) mask.remove(); });
    document.body.appendChild(mask);
    cols.focus();
  };
  popupButton(t('board.menu'), { templateId: 'menu', actionKey: 'open-menu', items: menuItems });
  // 非游玩模式（画板 / 制题器 / 求解器）：菜单右边一个「生成网格」按钮（见 gridDialog）
  if (mode !== 'level' && mode !== 'maker-play') {
    add(t('board.gridButton'), () => gridDialog(), { templateId: 'grid', actionKey: 'make-grid' });
  }
  if (mode === 'level' || mode === 'maker-play') add(t('board.explore'), () => { if (typeof exploreMode === 'function') exploreMode(); }, { templateId: 'explore', actionKey: 'explore' });
  if (mode === 'maker' || mode === 'solver') addMarkTools();
  if (mode === 'maker') {    /**
     * 试玩前的数据传输 过程函数
     * 正常走页面里的 dataTransfer（图形 + 标记 + 撤销历史 + 一份备份）。复杂关卡的撤销历史动辄
     * 几 MB（几百个对象的关卡能到 4~5MB），sessionStorage 放不下会抛 QuotaExceededError ——
     * 现象就是「点了试玩没反应」。这时逐级退让：
     *   ① 历史只留最后 12 步  ② 连历史都不带（图形与标记照旧带过去）
     * 退让之后试玩页会以带过去的图形为历史起点，少撤几步，但题目照旧能玩
     * @returns {boolean} 图形是否带过去了
     */
    const transferToTestPlay = () => {
      try {
        dataTransfer();
        return true;
      } catch (error) {
        // sessionStorage 满了：往下退让
      }
      const write = (key, value) => {
        try {
          sessionStorage.setItem(key, value);
          return true;
        } catch (error) {
          return false;
        }
      };
      const lists = {};
      for (const [key, value] of Object.entries(geometryElementLists)) lists[key] = [...value];
      const elements = JSON.stringify(geometryManager.toStorage());
      const repository = (typeof storageManager !== 'undefined' && Array.isArray(storageManager.repository))
        ? storageManager.repository.slice(-12) : [];
      const history = repository.length
        ? JSON.stringify({repository: repository, pointer: repository.length - 1, status: false}) : null;
      // 先让位：备份（另外几份的翻倍）与旧的历史都清掉，图形与标记优先
      sessionStorage.removeItem('makerBackup');
      sessionStorage.removeItem('constructRecord');
      if (!write('geometryElementLists', JSON.stringify(lists))) return false;
      if (!write('elements', elements)) return false;
      // 网格元信息很小，退让时照样带上（不然试玩页会把网格辅助对象当普通作图显示出来）
      const grid = typeof window.boardGmt?.grid === 'function' ? window.boardGmt.grid() : null;
      write('gridMeta', JSON.stringify(grid || null));
      if (history && !write('constructRecord', history)) sessionStorage.removeItem('constructRecord');
      return true;
    };
    add(t('board.testPlay'), () => {
      if (typeof dataTransfer === 'function' && !transferToTestPlay()) {
        boardToast(t('board.testPlayFailed'));
        return;
      }
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
        // 网格当作一整块：悬停在任意一条格线上都显示「格线」，不显示 gSY3 这种作图名
        if (isGridId(element.getId())) {
          tip.textContent = t('board.gridLabel');
        }else{
          // named 图形的表观标签可能与作图时的变量名不同（gmt 的 named=A.M 把 A 显示成 M），
          const originalLabel = element.getId();
          const tipLabel = originalLabel && originalLabel !== element.getName() ? originalLabel : element.getName();
          tip.textContent = `${tipLabel} · ${typeLabel(element)}`;
        }
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
    /**
     * 交点工具当前状态下、光标附近的全部候选交点 过程函数（逻辑坐标）
     * 选了一个图形后：取光标下最近的**另一个**图形，返回它与第一个图形的全部范围内交点。
     * 预览要把它们都画出来 —— 工具点一下会把这几个交点都标出来，预览只画最近的一个
     * 会让人以为只标一个（见 geometryToolBag.js 的 IntersectionTool.createIntersection）
     * @param {number} logicalX
     * @param {number} logicalY
     * @returns {{x: number, y: number}[]}
     */
    const intersectionPreviewList = (logicalX, logicalY) => {
      const first = geometryManager.getToolKey('intersection', 'choice1');
      if (!first) {
        // 还没选图形：光标下确实是相交的位置才给预览
        const only = geometryManager.nearestIntersection(logicalX, logicalY);
        return only ? [{x: only.x, y: only.y}] : [];
      }
      // 已经选了一个图形：取光标下最近的**另一个**图形
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
      if (!second) return [];
      return ToolsFunction.intersectionCandidates(first, second).filter(item =>
        ToolsFunction.pointInElementRange(item.x, item.y, first) &&
        ToolsFunction.pointInElementRange(item.x, item.y, second));
    };
    const intersectionSnapOf = (logicalX, logicalY) => {
      let best = null;
      intersectionPreviewList(logicalX, logicalY).forEach(item => {
        const distance = Math.hypot(item.x - logicalX, item.y - logicalY);
        if (!best || distance < best.distance) best = {x: item.x, y: item.y, distance: distance};
      });
      return best ? {x: best.x, y: best.y, snapped: true} : {x: logicalX, y: logicalY, snapped: false};
    };
    // 供调试 / 测试直接查「这一刻预览会画出哪几个交点」
    window.intersectionPreviewList = (logicalX, logicalY) => intersectionPreviewList(logicalX, logicalY);
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
      // 样式与点图形一致（外径 POINT_RADIUS_BASE + 一半大的白芯），但整体半透明：
      // 它只是「将要落在哪里」的预览，还没有真正落下
      context.globalAlpha = 0.5;
      context.beginPath();
      context.arc(previewPoint.x, previewPoint.y, POINT_RADIUS_BASE, 0, Math.PI * 2);
      context.fillStyle = 'rgb(25, 25, 25)';
      context.fill();
      context.beginPath();
      context.arc(previewPoint.x, previewPoint.y, POINT_RADIUS_BASE / 2, 0, Math.PI * 2);
      context.fillStyle = 'rgb(255, 255, 255)';
      context.fill();
      // 交点工具：这一对图形的其他候选交点也画出来（点一下会全部标出，预览只画一个会让人以为只标一个）
      if (tool === 'intersection' && typeof intersectionPreviewList === 'function') {
        const logical = [(x - transform.x) / transform.scale, (y - transform.y) / transform.scale];
        intersectionPreviewList(logical[0], logical[1]).forEach(item => {
          const px = transform.x + item.x * transform.scale;
          const py = transform.y + item.y * transform.scale;
          if (Math.hypot(px - previewPoint.x, py - previewPoint.y) < 1) return;
          context.beginPath();
          context.arc(px, py, POINT_RADIUS_BASE, 0, Math.PI * 2);
          context.fillStyle = 'rgb(25, 25, 25)';
          context.fill();
          context.beginPath();
          context.arc(px, py, POINT_RADIUS_BASE / 2, 0, Math.PI * 2);
          context.fillStyle = 'rgb(255, 255, 255)';
          context.fill();
        });
      }
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