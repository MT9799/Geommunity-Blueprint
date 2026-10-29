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
  // 精简画板（答案的「逐步绘制」）也带 from（返回要回到关卡页），但它要自己载入那份记录，
  // 不能让上一页残留的图形先冒出来，所以照「新开」处理、照样清一遍
  if (!isLevel && mode !== 'maker-play' && !restoreMaker && (!roundTrip || mode === 'stepview')) ['elements', 'geometryElementLists', 'thumbnail', 'constructRecord', 'makerBackup', 'gridMeta', 'boardBaseline'].forEach(key => sessionStorage.removeItem(key));
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
  // 入群题（quizMode）自行管理标题（选关页 / 具体题），不在这里覆盖，否则选关页会被写成「画板」
  if (!window.quizMode) {
    const modeTitles = {normal: t('board.pageTitleBoard'), maker: t('board.pageTitleMaker'), solver: t('board.pageTitleSolver')};
    if (modeTitles[mode]) document.title = `${modeTitles[mode]} | Geommunity Blueprint`;
  }
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
  // 精简画板（答案的「逐步绘制」）里「解题者自己作的图形」的 id 集合：
  // 由 buildStorageHistoryFromList 按记录的 undolist 记下，判定「所求作出来了没有」时用来排除预绘制图形
  // （与游玩模式按 geometryElementLists.level 排除同一口径，见 stepviewResultProduced）
  let stepviewPlayerIds = null;
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
  /**
   * 精简画板里某个所求判定对象是否已「作出来」 过程函数
   * 与游玩模式载入记录后那次判定**同一口径**（见 playPage 的 isResultProduced / segmentEndpointsProduced）：
   * 判定对象自身不算、关卡预绘制的图形也不算（这里按记录的 undolist 认定预绘制），
   * 画布上另有等价图形才算作出来了。于是「撤回解法 = 等价图形被撤掉」→ 判定不成立 →
   * 所求显示跟着消失，与游玩模式里一步步撤回的手感完全一致。
   * @param {string} id 所求判定对象 id
   * @returns {boolean}
   */
  const stepviewResultProduced = id => {
    const target = geometryManager.get(id);
    if (!target) return false;
    const type = target.getType();
    const equative = type === 'point' ? ToolsFunction.pointEquative
      : type === 'line' ? ToolsFunction.lineEquative
      : type === 'circle' ? ToolsFunction.circleEquative : null;
    if (!equative) return false;
    return geometryManager.getAllByOrder().some(element => {
      if (element.getType() !== type) return false;
      const otherId = element.getId();
      if (otherId === id) return false;                                 // 判定对象自身不算
      if (stepviewPlayerIds && !stepviewPlayerIds.has(otherId)) return false;   // 预绘制的不算
      if (!equative(target, element)) return false;
      return stepviewSegmentEndpointsProduced(target);
    });
  };
  /**
   * 判定的线段两个端点是否都作出来了 过程函数
   * 同 playPage 的 segmentEndpointsProduced：光有「所在直线」不算，两个端点得真的看得见
   * @param {Object} target 所求判定里的线段
   * @returns {boolean}
   */
  const stepviewSegmentEndpointsProduced = target => {
    if (typeof target.getDrawType !== 'function' || target.getDrawType() !== 'lineSegment') return true;
    const figures = target.getBase()?.figure || [];
    if (figures.length < 2) return false;
    const drawnPoint = end => {
      if (end.getVisible && end.getVisible() && !(end.getValid && !end.getValid())) return true;
      const coordinate = end.getCoordinate?.();
      if (!coordinate) return false;
      const [ex, ey] = coordinate;
      return geometryManager.getAllByOrder().some(element => {
        if (element.getType() !== 'point') return false;
        if (element.getVisible && !element.getVisible()) return false;
        if (element.getValid && !element.getValid()) return false;
        const other = element.getCoordinate?.();
        if (!other) return false;
        return Math.hypot(other[0] - ex, other[1] - ey) < 1e-6;
      });
    };
    return figures.every(drawnPoint);
  };
  /**
   * 精简画板里已经作出来的解的分组下标 过程函数
   * 同 playPage 的 resultVerifyFunction：判定非空、且判定的每个对象都作出来了才算这一组作出来了
   * @returns {number[]}
   */
  const stepviewSatisfiedGroups = () => {
    const list = [];
    for (let index = 1; index <= resultGroupCount(); index++) {
      const judged = [...resultSetOf(index, 'judged')];
      if (!judged.length) continue;
      if (judged.every(id => stepviewResultProduced(id))) list.push(index);
    }
    return list;
  };
  const highlightedResult = () => {
    // 「逐步绘制」的精简画板：哪一组解真的作出来了，就点亮那一组的「所求显示」——
    // 与游玩模式载入记录后的一次判定同一口径；一组都没作出来（解法被撤回了）时不点亮，
    // 显示组也一并隐藏（见 refreshElementListColors），于是「撤回解法 → 答案消失」与游玩模式一致
    if (mode === 'stepview') {
      const satisfied = stepviewSatisfiedGroups();
      return {index: satisfied.length ? satisfied[0] : 1, judged: true, shown: satisfied.length > 0};
    }
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
   * 一个对象能不能被玩家隐藏 / 显示 过程函数（画板 / 制题器 / 求解器 / 试玩）
   * 题面对象（给定 / 带标签给定 / 所求及其显示 / 关卡自带）与网格不给动，其余（玩家自己画的）都行。
   * 游玩页（level.html）有自己的一套（看 isProtectedElement，见 toolPlayPage.js 的 playHideAllowed）
   * @param {string} id
   * @returns {boolean}
   */
  window.boardHideAllowed = id => {
    if (!id) return false;
    if (typeof window.isGridObjectId === 'function' && window.isGridObjectId(id)) return false;
    // initial / named / level / result / result2 / resultShown / resultShown2 … 都算题面
    return !Object.keys(geometryElementLists).some(key =>
      /^(initial|named|level|result)/.test(key) && geometryElementLists[key] && geometryElementLists[key].has(id));
  };
  /**
   * 几何被整体替换（载入历史记录 / 撤销重做 / 导入 gmt / 清空画布 / 从游玩返回）时，
   * 自动清空求解器里「求解」「探测」两块的结果 —— 它们都指着旧几何，留着会误导
   * （非求解器模式下两个全局句柄都是 undefined，这里直接跳过，是安全无操作）
   */
  const clearSolverOutputs = () => {
    if (window.relationRadarPanel && typeof window.relationRadarPanel.clear === 'function') {
      window.relationRadarPanel.clear();
    }
    if (typeof window.solverSolveClear === 'function') window.solverSolveClear();
  };
  /**
   * 清空所有画布管理器 过程函数
   * 关卡游玩里有「结果 / 探索」两个管理器持有同一批对象，清空画布时只清当前这一个的话，
   * 重新载入关卡图形时同一个 ID 会被当成重复而改名，之后选定栏、判定与显示全乱套
   */
  window.clearAllCanvases = () => {
    // 画布都要清空了，求解 / 探测的结果自然作废
    clearSolverOutputs();
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
    // 丢掉画到一半的状态之前，先把取点时「顺手」作出的交点 / 显示出来的隐藏交点退回去 ——
    // 它们没有自己的历史格，跟着这一步走（见 geometryToolBag.js 的 revertIncidentalDrawEffects）
    if (typeof window.revertIncidentalDrawEffects === 'function') window.revertIncidentalDrawEffects();
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
    // 精简画板（答案的「逐步绘制」）：与游玩模式载入记录后的判定同一口径 ——
    // 作出来的那一组解，其「所求显示」显示出来（并点亮金色，见 markDisplayColor）；
    // 没作出来的那一组（解法被撤回了）跟着隐藏。给定对象一直显示（同 setResultGroupsVisible）
    if (mode === 'stepview') {
      const satisfied = new Set(stepviewSatisfiedGroups());
      resultMarkSets().forEach(({index, kind, set}) => {
        if (kind !== 'shown') return;
        set.forEach(id => {
          if (markSetOf('initial').has(id) || markSetOf('named').has(id)) return;
          const item = geometryManager.get(id);
          if (item) item.modifyVisible(satisfied.has(index));
        });
      });
    }
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
   * 记下当前画布上所有点的坐标 过程函数
   * 撤销 / 重做在「移动不进历史」的模式（逐步绘制 / 游玩）里用它保住移动后的位置：
   * 快照只负责增删图形，不该把点拽回快照里的旧坐标
   * @returns {Map<string, number[]>}
   */
  window.capturePointCoordinates = () => {
    const map = new Map();
    if (typeof geometryManager === 'undefined' || !geometryManager) return map;
    geometryManager.getAllByOrder().forEach(item => {
      if (item.getType?.() !== 'point') return;
      const coord = item.getCoordinate?.();
      if (Array.isArray(coord) && Number.isFinite(coord[0]) && Number.isFinite(coord[1])) {
        map.set(item.getId(), [coord[0], coord[1]]);
      }
    });
    return map;
  };
  /**
   * 载入快照 过程函数
   * @param {any} snapshot
   * @param {Map<string, number[]>} [keepPoints] 撤 / 重做时要保持在当前位置的点（见 capturePointCoordinates）
   */
  window.loadStorageSnapshot = (snapshot, keepPoints = null) => {
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
    // 移动不进历史的模式（逐步绘制 / 游玩）：撤 / 重做只负责增删图形，
    // 把移动过、且在新快照里还保留的点按当前位置放好（不能拽回快照里的旧坐标）
    if (keepPoints && keepPoints.size) {
      keepPoints.forEach((coord, id) => {
        const item = geometryManager.get(id);
        if (item && item.getType?.() === 'point') {
          geometryManager.modifyPointCoordinate(id, coord[0], coord[1]);
        }
      });
    }
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
    // 撤销 / 重做 / 载入记录换了一整套图形：「调整对象样式」弹层要连同「想开着」的意图一起清掉
    if (typeof window.resetObjectStylePopup === 'function') window.resetObjectStylePopup();
    if (typeof refreshToolFloating === 'function') refreshToolFloating();
    // 几何被整套替换（载入记录 / 撤销重做 / 从游玩返回），求解与探测结果一并清空
    clearSolverOutputs();
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
    // 精简画板：「名单里的」就是解题者自己作的图形（其余是关卡预绘制 / 给定）。
    // 求「所求是否作出来了」时要照它排除预绘制图形 —— 与游玩模式按 level 集合排除同一口径
    // （见 stepviewResultProduced）。名单为 null（裸 gmt）时全体都算解题者的作图
    stepviewPlayerIds = new Set(indexList.map(index => nodes[index - 1].id));
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

  // 自由画板从求解器返回（restore=1）：按 boardBackup 还原图形、标记、网格与视图
  if (mode === 'normal' && params.get('restore') === '1' && sessionStorage.getItem('boardBackup')) {
    document.addEventListener('DOMContentLoaded', () => {
      let backup = null;
      try { backup = JSON.parse(sessionStorage.getItem('boardBackup')); } catch (error) { backup = null; }
      sessionStorage.removeItem('boardBackup');
      if (!backup) return;
      // 还原离开时的基线：已有内容（含用户作图）不算初始内容，再退出仍会提示
      if (backup.baseline && typeof window.__boardUseRestoredBaseline === 'function') window.__boardUseRestoredBaseline(backup.baseline);
      if (Array.isArray(backup.elements)) geometryManager.loadStorage(backup.elements);
      if (backup.lists) Object.entries(backup.lists).forEach(([key, value]) => { geometryElementLists[key] = new Set(value || []); });
      if (backup.grid && typeof setGridMeta === 'function') setGridMeta(backup.grid);
      if (typeof refreshElementListColors === 'function') refreshElementListColors();
      if (typeof loadGeometryElements === 'function') loadGeometryElements();
      // 撤销 / 重做历史：带回备份就照它恢复（返回后还能继续撤销之前的作图）；
      // 没带（配额不足）就以「刚还原的图形」为起点，至少不会一撤销就把图形撤没
      if (backup.record && typeof storageManager !== 'undefined' && storageManager
        && typeof storageManager.deserialization === 'function') {
        storageManager.deserialization(backup.record);
      } else if (typeof resetStorageHistory === 'function') {
        resetStorageHistory();
      }
      if (typeof refreshStorageButton === 'function') refreshStorageButton();
      // 视图复位到离开前的状态（位置 + 缩放）；三套管理器持有的是同一个 transform 引用
      if (backup.view && typeof transform !== 'undefined') {
        transform.x = backup.view.x;
        transform.y = backup.view.y;
        transform.scale = backup.view.scale;
        [typeof geometryManager !== 'undefined' ? geometryManager : null,
          typeof geometryManagerResult !== 'undefined' ? geometryManagerResult : null,
          typeof geometryManagerExplore !== 'undefined' ? geometryManagerExplore : null]
          .forEach(manager => { if (manager) manager.transform = transform; });
      }
      if (typeof drawContent === 'function') drawContent();
      if (!backup.view && typeof fitViewToContent === 'function') fitViewToContent();
    });
  }
  // 精简画板（mode=stepview）：给答案的「逐步绘制」用 —— 只载入这份 gmt，
  // 按对象逐个铺历史（可以一步步撤回），工具只留移动（界面由 index.css 的 .mode-stepview 收掉）
  if (mode === 'stepview') {
    document.addEventListener('DOMContentLoaded', () => {
      const gmtPath = params.get('gmt') || '';
      if (!gmtPath) return;
      fetch('../data/' + gmtPath)
        .then(response => (response.ok ? response.text() : ''))
        .then(text => {
          if (!text) {
            if (typeof boardToast === 'function') boardToast(t('board.gmtImportFailed'));
            return;
          }
          // 答案文件是**记录文本**（gmt 的对象行 / 标记行 + 附加信息段里的 undolist、styles 等）：
          // 走记录面板同一条载入路径，才能把样式表与「逐个撤回」的清单一起读进来。
          // 传的若是裸 gmt（没有 undolist / styles），退回普通的 gmt 载入
          if (typeof window.recordPanelLoadText === 'function' && window.recordPanelLoadText(text)) {
            // 记录载入中途撤/重做历史还没铺好，那时判「所求该不该显示」会看错状态：
            // 历史铺好后重量一次（见 stepviewJudgedAlive）
            refreshElementListColors();
            drawContent();
            return;
          }
          loadGmt(text);
        })
        .catch(() => {});
    });
  }
  if (mode === 'maker' && sessionStorage.getItem('elements')) {
    document.addEventListener('DOMContentLoaded', () => {
      const elements = JSON.parse(sessionStorage.getItem('elements'));
      geometryManager.loadStorage(elements);
      // 从试玩返回：还原离开制题器时的基线，已有内容（含用户作图）不算初始内容，再退出仍会提示
      const savedBaseline = sessionStorage.getItem('boardBaseline');
      if (savedBaseline) {
        sessionStorage.removeItem('boardBaseline');
        if (typeof window.__boardUseRestoredBaseline === 'function') window.__boardUseRestoredBaseline(savedBaseline);
      }
      const savedLists = JSON.parse(sessionStorage.getItem('geometryElementLists') || '{}');
      Object.entries(savedLists).forEach(([key, value]) => { geometryElementLists[key] = new Set(value); });
      // 网格：制题器里生成过网格时这份会话带着网格元信息（见 index.js 的 dataTransfer）——
      // 按它登记网格（藏起辅助对象）并把视图适配回网格范围
      const savedGrid = JSON.parse(sessionStorage.getItem('gridMeta') || 'null');
      if (savedGrid) setGridMeta(savedGrid);
      // 视图适配（并记下「初始视图」）：按网格 + 图形各点的并集确定画幅
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
      // 网格：从关卡 / 试玩带过来的网格，按同一份元信息登记
      if (data.grid) setGridMeta(data.grid);
      refreshElementListColors();
      seedMarkedStyles();
      // 视图适配：带入的图形可能是任意尺寸，按网格 + 各点确定画幅
      fitViewToContent();
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
    // 网格也带过去：求解器里按它登记网格（藏起辅助对象、上样式），返回时按网格 + 各点确定画幅
    sessionStorage.setItem('solverElements', JSON.stringify({elements: elements, lists: lists, grid: gridMetaSnapshot()}));
    // from：求解器的「返回」据此回到本页并还原图形（关卡游玩 / 试玩由 savePlayBackup 存备份）
    let from = typeof savePlayBackup === 'function' ? savePlayBackup() : '';
    // 自由画板（normal）没有 savePlayBackup：自己存一份图形 + 标记 + 网格 + 视图，
    // 返回地址带 restore=1，回到画板后按下它还原（含画布位置与缩放）
    if (!from && mode === 'normal') {
      const lists = {};
      Object.keys(geometryElementLists).forEach(key => { lists[key] = [...(geometryElementLists[key] || [])]; });
      const backup = {
        elements: geometryManager.toStorage(),
        lists: lists,
        grid: typeof gridMetaSnapshot === 'function' ? gridMetaSnapshot() : null,
        view: typeof transform !== 'undefined' ? {x: transform.x, y: transform.y, scale: transform.scale} : null,
        // 离开时的基线也带走：返回后已有内容不算初始内容，再退出仍会提示
        baseline: typeof window.__boardGetBaselineSnapshot === 'function' ? window.__boardGetBaselineSnapshot() : null,
      };
      // 撤销 / 重做历史也带上：不带的话返回后只能把「刚还原的图形」当历史起点，就再也撤不动了
      try {
        if (typeof storageManager !== 'undefined' && storageManager && typeof storageManager.serialization === 'function') {
          backup.record = storageManager.serialization();
        }
      } catch (error) { /* 序列化失败就不带历史 */ }
      try {
        sessionStorage.setItem('boardBackup', JSON.stringify(backup));
      } catch (error) {
        // 配额不足：退一步，先保证图形与视图能回去（丢掉历史）
        delete backup.record;
        try { sessionStorage.setItem('boardBackup', JSON.stringify(backup)); } catch (error2) { /* 还是放不下就算了 */ }
      }
      from = './board.html?mode=normal&restore=1';
    }
    // 本关限定了工具（单尺 / 单规）时，把对应的求解器模式一起带过去：
    // 求解器面板的「可用工具」默认就选到同一种（2 尺规 / 1 单尺 / 0 单规）
    const levelTool = typeof window.levelTools === 'string' ? window.levelTools : '';
    // grid：这一关限定网格直尺 → 求解器默认就选「网格」模式（面板再按网格大小与步数 4 调整）
    const solverTool = levelTool === 'straightedge' ? '1' : levelTool === 'compass' ? '0' : levelTool === 'grid' ? '3' : '';
    // 前进式跳转（关卡游玩 / 自由画板 → 求解器）：作图已临时存好、不算离开，放行 beforeunload
    window.__boardSuppressUnload = true;
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
  /**
   * 关闭弹层 过程函数
   * 先加 .closing 播退场动画，再移除；重复点击 / 点遮罩时不会重复触发
   * @param {HTMLElement} mask
   */
  const dismissMask = element => {
    if (!element || element.classList.contains('closing')) return;
    element.classList.add('closing');
    setTimeout(() => element.remove(), 160);
  };
  // 记录面板等其它脚本也走同一套退场
  window.boardDismissMask = dismissMask;
  /**
   * FLIP 过程函数：记录容器里带 key 的子元素位置，更新 DOM 后让留下的元素平滑滑到新位置
   * 用 offsetLeft/offsetTop 量位置，避免上一次动画的 transform 干扰测量；新元素淡入。
   * 比「整体重建 + 每项播放入场动画」更稳：留下的按钮不会先消失再出现。
   * @param {HTMLElement} container
   * @param {Function} update 真正改 DOM 的函数
   * @param {{key?: Function, enter?: boolean}} [options]
   */
  const flipChildren = (container, update, options = {}) => {
    if (!container) { update(); return; }
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { update(); return; }
    const keyOf = options.key || (element => element.dataset.solution || element.id || element.dataset.action || '');
    const before = new Map();
    [...container.children].forEach(element => {
      const key = keyOf(element);
      if (!key) return;
      element.getAnimations?.().forEach(animation => animation.cancel());
      before.set(key, {
        left: element.offsetLeft,
        top: element.offsetTop,
        rect: element.getBoundingClientRect(),
        element,
      });
    });
    update();
    const after = new Set();
    [...container.children].forEach(element => {
      const key = keyOf(element);
      if (!key) return;
      after.add(key);
      const old = before.get(key);
      if (!old) {
        if (options.enter !== false) {
          element.animate(
            [{opacity: 0, transform: 'scale(.86)'}, {opacity: 1, transform: 'none'}],
            {duration: 160, easing: 'cubic-bezier(.2, .8, .2, 1)'}
          );
        }
        return;
      }
      const dx = old.left - element.offsetLeft;
      const dy = old.top - element.offsetTop;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      element.animate(
        [{transform: `translate(${dx}px, ${dy}px)`}, {transform: 'none'}],
        {duration: 220, easing: 'cubic-bezier(.2, .8, .2, 1)'}
      );
    });
    // 被移除的元素：克隆一份留在原位置淡出，别让它瞬间消失、只留下别人滑过来
    if (options.leave !== false) {
      before.forEach((old, key) => {
        if (after.has(key)) return;
        const rect = old.rect;
        const ghost = old.element.cloneNode(true);
        ghost.removeAttribute('id');
        ghost.style.position = 'fixed';
        ghost.style.left = `${rect.left}px`;
        ghost.style.top = `${rect.top}px`;
        ghost.style.width = `${rect.width}px`;
        ghost.style.height = `${rect.height}px`;
        ghost.style.margin = '0';
        ghost.style.pointerEvents = 'none';
        ghost.style.zIndex = '1000';
        document.body.appendChild(ghost);
        const animation = ghost.animate(
          [{opacity: 1, transform: 'scale(1)'}, {opacity: 0, transform: 'scale(.8)'}],
          {duration: 160, easing: 'cubic-bezier(.2, .8, .2, 1)'}
        );
        animation.finished.then(() => ghost.remove()).catch(() => ghost.remove());
      });
    }
  };
  // 其它脚本（工具栏 / 浮动栏）也可以复用
  window.flipChildren = flipChildren;
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
  const confirmDialog = (title, message, onConfirm, onCancel) => {
    const mask = document.createElement('div');
    mask.className = 'board-dialog-mask';
    mask.innerHTML = '<div class="board-dialog board-dialog-confirm"><strong></strong><p class="board-dialog-hint"></p><div class="board-dialog-actions"></div></div>';
    mask.querySelector('strong').textContent = title;
    mask.querySelector('.board-dialog-hint').textContent = message || '';
    const actions = mask.querySelector('.board-dialog-actions');
    // 统一收尾：确认执行 onConfirm，取消（取消按钮 / 点遮罩关窗）执行 onCancel
    const close = confirmed => {
      dismissMask(mask);
      if (confirmed && typeof onConfirm === 'function') onConfirm();
      else if (!confirmed && typeof onCancel === 'function') onCancel();
    };
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.textContent = t('common.cancel');
    cancelButton.addEventListener('click', () => close(false));
    const confirmButton = document.createElement('button');
    confirmButton.type = 'button';
    confirmButton.className = 'main-button';
    confirmButton.textContent = t('common.confirm');
    confirmButton.addEventListener('click', () => close(true));
    actions.appendChild(cancelButton);
    actions.appendChild(confirmButton);
    mask.addEventListener('click', event => { if (event.target === mask) close(false); });
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
    confirmButton.addEventListener('click', () => dismissMask(mask));
    actions.appendChild(confirmButton);
    mask.addEventListener('click', event => { if (event.target === mask) dismissMask(mask); });
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
      button.addEventListener('click', () => { dismissMask(mask); item.action(); });
      list.appendChild(button);
    });
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.textContent = t('common.cancel');
    cancelButton.addEventListener('click', () => dismissMask(mask));
    mask.querySelector('.board-dialog-actions').appendChild(cancelButton);
    mask.addEventListener('click', event => { if (event.target === mask) dismissMask(mask); });
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
      dismissMask(mask);
      if (!submitted && typeof options.onCancel === 'function') options.onCancel();
    };
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.textContent = t('common.cancel');
    cancelButton.addEventListener('click', close);
    const confirmButton = document.createElement('button');
    confirmButton.type = 'button';
    confirmButton.className = 'main-button';
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
    mask.addEventListener('click', () => dismissMask(mask));
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
        const frame = document.createElement('div');
        frame.className = 'answer-figure-image';
        frame.appendChild(picture);
        const caption = document.createElement('figcaption');
        // 步数文本与「逐步绘制」按钮放在同一行（flex）：两者同高、左右分开，
        // 卡片窄时按钮也不会盖住步数
        const captionText = document.createElement('span');
        captionText.className = 'answer-figure-label';
        captionText.textContent = image.star || '';
        caption.appendChild(captionText);
        if (image.gmt) {
          const stepButton = document.createElement('button');
          stepButton.type = 'button';
          stepButton.className = 'answer-stepview-button';
          stepButton.textContent = t('board.answerStepDraw');
          stepButton.addEventListener('click', () => {
            // 带上 from：精简画板的「返回」据此回到本页（答案是在关卡游玩 / 试玩页打开的），
            // 不带的话返回会落到首页。
            // 关卡游玩 / 试玩页先存一份备份（playBackup），返回时带 restorePlay=1 让关卡页
            // 把玩家刚才的作图、步数与撤销历史原样恢复 —— 不然从答案窗口回来画的东西就没了
            const backUrl = typeof savePlayBackup === 'function' ? savePlayBackup() : location.href;
            // 前进式跳转（关卡游玩 → 逐步绘制）：作图已临时存好、不算离开，放行 beforeunload
            window.__boardSuppressUnload = true;
            location.href = './board.html?mode=stepview&gmt=' + encodeURIComponent(image.gmt)
              + '&from=' + encodeURIComponent(backUrl);
          });
          caption.appendChild(stepButton);
        }
        figure.appendChild(frame);
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
    closeButton.addEventListener('click', () => dismissMask(mask));
    actions.appendChild(closeButton);
    box.appendChild(actions);
    mask.appendChild(box);
    mask.addEventListener('click', event => { if (event.target === mask) dismissMask(mask); });
    document.body.appendChild(mask);
    return mask;
  };
  /** 查看答案 过程函数 */
  // 本关已经确认查看过答案：在退出游玩（整页跳转）之前再点「查看答案」不再弹确认框
  let answerViewed = false;
  const showAnswer = () => {
    const levelId = params.get('id') || '';
    const openAnswer = () => loadSolutionsData().then(map => answerDialog(map.get(levelId) || []));
    if (answerViewed) {
      openAnswer();
      return;
    }
    confirmDialog(t('board.answerAsk'), t('board.answerWarn'), () => {
      answerViewed = true;
      openAnswer();
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
    closeButton.addEventListener('click', () => dismissMask(mask));
    actions.appendChild(closeButton);
    mask.addEventListener('click', event => { if (event.target === mask) dismissMask(mask); });
    document.body.appendChild(mask);
    return mask;
  };
  document.addEventListener('click', event => {
    if (!event.target.closest('#container_more') && !event.target.closest('.board-popup')) closePopups();
  });

  // gmt 代码窗口：只读查看 / 可编辑导入
  const COPY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true">'
    + '<rect x="9" y="9" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/>'
    + '<path d="M5 15V6a2 2 0 0 1 2-2h9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'
    + '</svg>';
  const COPIED_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true">'
    + '<polyline points="4 12, 10 18, 20 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
    + '</svg>';
  /**
   * 复制文本到剪贴板 过程函数
   * 优先 Clipboard API；不可用时退回临时 textarea + execCommand
   * @param {string} text
   * @returns {Promise<boolean>}
   */
  const copyToClipboard = async text => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (error) { /* 退回下面的方案 */ }
    try {
      const helper = document.createElement('textarea');
      helper.value = text;
      helper.setAttribute('readonly', '');
      helper.style.position = 'fixed';
      helper.style.top = '-1000px';
      helper.style.opacity = '0';
      document.body.appendChild(helper);
      helper.select();
      const ok = document.execCommand('copy');
      helper.remove();
      return ok;
    } catch (error) {
      return false;
    }
  };
  /**
   * 代码框右上角的复制图标按钮 过程函数
   * @param {string|Function} value 要复制的文本；传函数时每次点击取最新值
   * @returns {HTMLButtonElement}
   */
  const codeCopyButton = value => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'board-dialog-copy';
    button.title = t('board.recordCopy');
    button.setAttribute('aria-label', button.title);
    button.innerHTML = COPY_ICON;
    button.addEventListener('click', async () => {
      const text = typeof value === 'function' ? value() : value;
      // 复制成功后勾一直保留到关闭这个代码框
      if (!(await copyToClipboard(String(text ?? '')))) return;
      button.innerHTML = COPIED_ICON;
      button.classList.add('copied');
    });
    return button;
  };

  const codeDialog = (title, value, onSubmit) => {
    const mask = document.createElement('div');
    mask.className = 'board-dialog-mask';
    mask.innerHTML = '<div class="board-dialog"><div class="board-dialog-head"><strong></strong></div><textarea class="board-dialog-code" spellcheck="false"></textarea><p class="board-dialog-hint"></p><div class="board-dialog-actions"></div></div>';
    const head = mask.querySelector('.board-dialog-head');
    const area = mask.querySelector('.board-dialog-code');
    const hint = mask.querySelector('.board-dialog-hint');
    const actions = mask.querySelector('.board-dialog-actions');
    mask.querySelector('.board-dialog strong').textContent = title;
    area.value = value;
    area.readOnly = !onSubmit;
    // 导出 / 查看代码框在右上角给一个复制按钮；可编辑的导入框不加
    if (!onSubmit) head.appendChild(codeCopyButton(() => area.value));
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    // 导入框里这个键是「取消导入」，只读查看框里才是「关闭」
    closeButton.textContent = onSubmit ? t('common.cancel') : t('common.close');
    closeButton.addEventListener('click', () => dismissMask(mask));
    if (onSubmit) {
      const confirmButton = document.createElement('button');
      confirmButton.type = 'button';
      // 与「查看答案 / 生成网格」的确定键同一套主按钮样式，并且排在取消（关闭）前面
      confirmButton.className = 'main-button';
      confirmButton.textContent = t('common.import');
      confirmButton.addEventListener('click', () => { if (onSubmit(area.value)) dismissMask(mask); else hint.textContent = t('board.gmtImportFailed'); });
      actions.appendChild(confirmButton);
    }
    actions.appendChild(closeButton);
    mask.addEventListener('click', event => { if (event.target === mask) dismissMask(mask); });
    document.body.appendChild(mask);
    // 打开就把焦点放进文本框：否则焦点还停在画布上，Ctrl/Cmd+A 会触发画布全选而非选中代码文本
    // （keydown 处理器对 INPUT/TEXTAREA 让路，见下方 isTyping 分支）。只读查看框顺手全选代码便于复制。
    area.focus();
    // if (area.readOnly) area.select();
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
        case 'semicircle': return `${id}=Circle[${args[0]},${args[1]}]`;
        case 'arc': return `${id}=Circle[${args[0]},${args[1]}]`;
        case 'arc3': return `${id}=Circle3[${args[0]},${args[1]},${args[2]}]`;
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
   * 画布上这批图形的外接矩形 过程函数
   * 只看**看得见、有效、且不属于网格**的对象：点取坐标，圆取「圆心 ± 半径」，线段取两端。
   * 射线 / 直线不封口，不拿它们那两个（取值任意的）坐标点撑范围 —— 一条往远处延伸的线会把
   * 缩放一路拽小；它们的定义点本身也是画布上的点，已经在范围里了
   * @returns {{minX: number, maxX: number, minY: number, maxY: number}|null}
   */
  const visibleBounds = (extraItems) => {
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
    // 把一个对象的坐标撑进范围：点取坐标，圆取「圆心 ± 半径」，线段取两端。
    // 射线 / 直线不封口（它们的延伸定义点会一路把缩放拽小，但定义点本身已是画布上的点，已在范围内）。
    // force=true 时跳过可见性 / 有效性检查，强制计入（用于关卡「所求」点：普通模式被藏起也要入画幅）
    const collect = (item, force) => {
      if (!item || typeof item.getType !== 'function') return;
      if (isGridId(item.getId())) return;
      if (!force) {
        if (typeof item.getVisible === 'function' && !item.getVisible()) return;
        if (typeof item.getValid === 'function' && !item.getValid()) return;
        // 无穷远点：坐标在很远处，画出来会让画布糊掉一大片（见 loadGmt）
        if (item.getBase?.()?.type === 'edgePoint') return;
      }
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
    };
    geometryManager.getAllByOrder().forEach(item => collect(item, false));
    // 额外要纳入画幅的对象（如关卡所求点 explore）：不查可见性，强制计入，
    // 这样即便答案点在普通模式被藏起，进入关卡时画幅也会把它们罩进去
    (extraItems || []).forEach(item => collect(item, true));
    return Number.isFinite(minX) ? {minX: minX, maxX: maxX, minY: minY, maxY: maxY} : null;
  };

  /**
   * 把视图适配到一组逻辑坐标范围 过程函数
   * 按内容自然缩放，不设放大上限（小坐标的图也能铺满画布）。
   * @param {{minX: number, maxX: number, minY: number, maxY: number}|null} bounds
   * @returns {{centerX: number, centerY: number, scale: number}|false}
   */
  const fitViewToBounds = bounds => {
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
      Math.min(usableWidth / (width * 1.3), usableHeight / (height * 1.3)));
    transform.x = insets.left + usableWidth / 2 - centerX * transform.scale;
    transform.y = insets.top + usableHeight / 2 - centerY * transform.scale;
    return {centerX: centerX, centerY: centerY, scale: transform.scale};
  };

  /**
   * 把视图适配到画布上的内容 过程函数
   * 导入 gmt / 载入记录 / 关卡载入 / 从游玩返回都走它：
   *   1. 先把各点坐标算一遍（交点 / 中点 / 圆心等依赖点要等基底接好后才有坐标）；
   *   2. 有网格时只按网格范围（网格就是作答区域）；没有网格时按图形各点（含 extraItems）的范围；
   *   3. 按内容自然缩放，不再限制 2 倍 —— 小坐标的图（如 0~10）也能铺满画布。
   * @param {Object[]} [extraItems] 无网格时额外纳入画幅的对象（如关卡「所求」点）
   * @returns {{centerX: number, centerY: number, scale: number}|null} 逻辑中心与比例
   */
  const fitViewToContent = (extraItems) => {
    // 载入后的依赖点可能还没算坐标；先按 gmt / 记录的存储顺序算一遍
    if (typeof geometryManager !== 'undefined' && geometryManager) {
      geometryManager.getAllByOrder().forEach(item => {
        if (typeof item.updateCoordinate === 'function') item.updateCoordinate();
      });
    }
    let bounds = null;
    if (gridMeta) {
      const width = gridMeta.m * gridMeta.unit;
      const height = gridMeta.n * gridMeta.unit;
      bounds = {minX: 0, maxX: width, minY: -height, maxY: 0};
    } else {
      bounds = visibleBounds(extraItems);
    }
    const view = fitViewToBounds(bounds);
    // 记下这一刻的视图：「还原画布变化量」照它复位
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
  const gridFitInsets = (ignoreMobileInfo = false) => {
    const insets = {top: 0, bottom: 0, left: 0, right: 0};
    const canvasElement = document.getElementById('canvas_id1');
    if (!canvasElement) return insets;
    const canvasRect = canvasElement.getBoundingClientRect();
    if (!canvasRect.width || !canvasRect.height) return insets;
    // 「还原画布变化量」不计 mobile info 的高度：它在工具栏面板里，展开 / 收起会让
    // 面板高度变化，按它算出来的视图会在提示消失后显得太靠上
    const mobileInfo = ignoreMobileInfo ? document.getElementById('mobile-information') : null;
    // 顶部那条栏 + 各个浮层（.panel：工具面板 / 记录 / 元素一览 / 构造…）
    const overlays = [document.getElementById('container_more')].concat([...document.querySelectorAll('.panel')]);
    overlays.forEach(element => {
      if (!element) return;
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      // 忽略 mobile info 时按不含它的面板区域算：信息栏在面板的哪一头，
      // 就把那一头收回来（底部工具栏的信息栏在面板顶部，顶部工具栏的则在底部）
      let effectiveTop = rect.top;
      let effectiveBottom = rect.bottom;
      if (mobileInfo && element.contains(mobileInfo)) {
        const infoRect = mobileInfo.getBoundingClientRect();
        if (infoRect.height > 0) {
          const topGap = Math.abs(infoRect.top - rect.top);
          const bottomGap = Math.abs(rect.bottom - infoRect.bottom);
          if (topGap <= bottomGap) effectiveTop = infoRect.bottom;
          else effectiveBottom = infoRect.top;
        }
      }
      // 与画布相交的那块矩形（不相交就与网格无关）
      const overlapWidth = Math.min(canvasRect.right, rect.right) - Math.max(canvasRect.left, rect.left);
      const overlapHeight = Math.min(canvasRect.bottom, effectiveBottom) - Math.max(canvasRect.top, effectiveTop);
      if (overlapWidth <= 0 || overlapHeight <= 0) return;
      const centerX = (rect.left + rect.right) / 2;
      const centerY = (effectiveTop + effectiveBottom) / 2;
      const distances = {
        top: Math.abs(centerY - canvasRect.top),
        bottom: Math.abs(centerY - canvasRect.bottom),
        left: Math.abs(centerX - canvasRect.left),
        right: Math.abs(centerX - canvasRect.right),
      };
      const side = Object.keys(distances).reduce((best, key) => (distances[key] < distances[best] ? key : best), 'top');
      if (side === 'top') insets.top = Math.max(insets.top, Math.min(canvasRect.bottom, effectiveBottom) - canvasRect.top);
      else if (side === 'bottom') insets.bottom = Math.max(insets.bottom, canvasRect.bottom - Math.max(canvasRect.top, effectiveTop));
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
   * 登记成 grid 集合、辅助对象隐藏、网格线段按 #gridstyle= 上样式、视图按网格 + 已有图形确定画幅。
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
    // 按网格 + 已有图形确定画幅，并记下「初始视图」（「还原画布变化量」回到这里）
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
    const orderedItems = geometryManager.getAllByOrder();
    const itemsById = new Map(orderedItems.map(item => [item.getId(), item]));
    // Arc 按自然作图顺序输出：先是兼容 GMT 的基础圆，再是第三点，
    // 最后用 #geom 标记弧段。第三点不延迟到整个文件末尾。
    const emitted = new Set();
    const appendGeometryExtension = (item, base) => {
      if (item.getInternal?.()) content.push(`#internal=${item.getId()}`);
      if (base.type === 'semicircle') content.push(`#geom=${item.getId()}:SemiCircle[${base.basesId[1]},${base.basesId[2]}]`);
      if (base.type === 'arc') content.push(`#geom=${item.getId()}:Arc[${base.basesId[0]},${base.basesId[1]},${base.basesId[2]}]`);
      if (base.type === 'arc3') content.push(`#geom=${item.getId()}:Arc3[${base.basesId[0]},${base.basesId[1]},${base.basesId[2]}]`);
    };
    orderedItems.forEach(item => {
      const base = item.getDict().base || {};
      // Arc 的整圆只是兼容 GMT 的基础回退，不是用户图形，也不应导出成 med。
      if (item.getInternal?.() && item.getType() === 'circle' && base.type === 'twoPoints') return;
      if (emitted.has(item.getId())) return;
      content.push(gmtLineOf(item));
      emitted.add(item.getId());
      if (base.type === 'arc') {
        const endpoint = itemsById.get(base.basesId[2]);
        // C 已经在前面时已被 emitted；C 在后面时在 #geom 前补出。
        if (endpoint && !emitted.has(endpoint.getId())) {
          content.push(gmtLineOf(endpoint));
          emitted.add(endpoint.getId());
        }
      }
      appendGeometryExtension(item, base);
    });
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
   * 暂不支持：ShiftSeg 以及 rules（限制条件），遇到时连同依赖它的对象一并丢弃
   * @param {string} text
   * @returns {{elements: Object[], lists: Object}}
   */
  window.parseGmt = text => {
    const declarations = new Map();
    const shapeExtensions = new Map();
    const internalIds = new Set();
    const lists = {initial: [], named: [], hidden: [], movepoints: [], result: [], resultShown: [], explore: []};
    // named=A.M 里 M 是要显示出来的标签名
    const namedLabels = new Map();
    // result 可以有多条（多解），每条各自记录：判定对象 + 判定成功后要显示的图形
    const resultGroups = [];
    // 指令名大小写不敏感
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
      if (line.startsWith('#internal=')) {
        line.slice('#internal='.length).split(',').map(item => item.trim()).filter(Boolean).forEach(id => internalIds.add(id));
        continue;
      }
      if (line.startsWith('#geom=')) {
        const extension = line.slice('#geom='.length).trim();
        const separator = extension.indexOf(':');
        if (separator > 0) shapeExtensions.set(extension.slice(0, separator).trim(), extension.slice(separator + 1).trim());
        continue;
      }
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
      const extension = shapeExtensions.get(id);
      if (dict && extension) {
        const match = extension.match(/^([A-Za-z]+)\s*\[(.*)\]$/);
        const args = match ? match[2].split(',').map(item => item.trim()) : [];
        const name = match ? match[1].toLowerCase() : '';
        if (dict.type === 'circle' && ['semicircle', 'arc', 'arc3'].includes(name)) {
          // Arc 的第三点可能是 Intersect[c1,...]，而 c1 自身又由 #geom
          // 标成 Arc。这里不能在 c1 仍处于 building 状态时递归 build(C)，
          // 否则会把合法的 GMT 顺序误判成循环依赖。先保存引用 ID，
          // 由 loadStorage 在全部声明建立后统一接线。
          const required = name === 'semicircle' ? 2 : 3;
          const refsAvailable = args.length >= required
            && args.slice(0, required).every(item => declarations.has(item));
          if (refsAvailable) {
            dict.base.type = name;
            if (name === 'semicircle') dict.base.basesId = [dict.base.basesId[0], args[0], args[1]];
            else if (name === 'arc') dict.base.basesId = [dict.base.basesId[0], args[1], args[2]];
            else dict.base.basesId = args.slice(0, required);
          }
        }
      }
      if (dict && (internalIds.has(id) || id.startsWith('med'))) dict.internal = true;
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
      // 不带 width：gmt 本来就不写粗细，读取时由各模式按自己的默认（档位 2「较小」）补，
      // 原来这里写死 1（档位 3「中」），载入 gmt / 记录出来的图形比新画的粗一档
      const baseDict = {id: id, name: id, showName: false, superstructureId: [], visible: true, valid: true, color: '#191919'};
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

    // 按文件顺序触发构建；build 会递归先构建依赖，所以 elements 此时是
    // 「依赖后序」而不是 GMT 文件顺序。这里必须恢复声明顺序，否则载入后
    // 第一次导出或撤回重做会把 C、Arc 端点以及其它无直接依赖的对象重新排序。
    declarations.forEach((declaration, id) => build(id));
    const builtInDeclarationOrder = [];
    declarations.forEach((declaration, id) => {
      const element = built.get(id);
      if (element) builtInDeclarationOrder.push(element);
    });
    elements.splice(0, elements.length, ...builtInDeclarationOrder);

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
    elements.forEach(item => { item.visible = item.base?.type !== 'edgePoint' && !item.internal; });
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
    // 导入后立即算各点坐标并确定画幅（fitViewToContent 内部会先算点，再取网格与各点的并集）
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
    // 导入 gmt 换掉了整套图形，求解 / 探测的结果一并清空
    clearSolverOutputs();
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
     * 把视图适配到画布上的内容 过程函数（按网格 + 图形各点确定画幅）
     * 导入 gmt / 载入记录用它；游玩页的「初始图形适配」也用它（见 playPage 的 fitInitialView），
     * 那边拿返回的逻辑中心与比例记「初始视图」，供「还原视图」按钮回到这里
     */
    fitView: (extraItems) => fitViewToContent(extraItems),
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
   * 圆形按钮的图标：已标记对象（清单 + 勾）
   * 原来是一面小旗，与「标记所求」那个按钮的图标撞脸 —— 改成清单 + 勾区分开
   */
  const markSideIcon = () => '<svg class="svg-icon" viewBox="0 0 200 200">' +
    '<path d="M30 44 L112 44" fill="transparent" stroke-width="14" stroke-linecap="round"/>' +
    '<path d="M30 100 L112 100" fill="transparent" stroke-width="14" stroke-linecap="round"/>' +
    '<path d="M30 156 L112 156" fill="transparent" stroke-width="14" stroke-linecap="round"/>' +
    '<path d="M130 128 L150 150 L188 100" fill="transparent" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/></svg>';

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

  /**
   * 圆形按钮的图标：关系雷达（三角形内接于圆 —— 共线、共圆、各种隐含关系）
   */
  const radarSideIcon = () => '<svg class="svg-icon" viewBox="0 0 200 200">' +
    '<circle cx="100" cy="100" r="66" fill="transparent" stroke-width="12"/>' +
    '<path d="M100 34 L157 133 L43 133 Z" fill="transparent" stroke-width="12" stroke-linejoin="round"/>' +
    '<circle cx="100" cy="34" r="15" fill="#fff" stroke-width="12"/>' +
    '<circle cx="157" cy="133" r="15" fill="#fff" stroke-width="12"/>' +
    '<circle cx="43" cy="133" r="15" fill="#fff" stroke-width="12"/></svg>';

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
  // 可折叠分组（求解高级选项 / 雷达「更多」/ 标记面板各栏）统一用高度动画：
  // 原生 <details> 是硬切，这里接管 summary 点击，内容在 0 ↔ scrollHeight 之间平滑展开收起。
  const FOLD_ANIM_SELECTOR = '.solver-advanced, .radar-more, .radar-group, .radar-chunk, .mark-fold';
  /** 取 / 建 <details> 的内容容器（summary 以外的节点都挪进去） */
  const foldBodyOf = details => {
    const summary = details.querySelector(':scope > summary');
    if (!summary) return null;
    let body = details.querySelector(':scope > .fold-body');
    if (body) return body;
    body = document.createElement('div');
    body.className = 'fold-body';
    [...details.childNodes].forEach(node => {
      if (node !== summary) body.appendChild(node);
    });
    details.appendChild(body);
    return body;
  };
  /** 展开 / 收起一个 details（内容高度动画） 过程函数 */
  const toggleFold = details => {
    if (details.dataset.foldAnimating === '1') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      details.open = !details.open;
      return;
    }
    const body = foldBodyOf(details);
    if (!body) {
      details.open = !details.open;
      return;
    }
    details.dataset.foldAnimating = '1';
    // 高度收展不要用很急的 ease-out：那样开头一下收到很低，剩下的时间几乎不动，
    // 看起来就像先跳到某个高度再停住。用平缓的标准曲线。
    const easing = 'cubic-bezier(.4, 0, .2, 1)';
    if (!details.open) {
      details.open = true;
      const target = body.scrollHeight;
      body.style.overflow = 'hidden';
      body.style.height = '0px';
      body.style.opacity = '0';
      const animation = body.animate([
        {height: '0px', opacity: 0},
        {height: `${target}px`, opacity: 1},
      ], {duration: 180, easing: easing});
      animation.onfinish = () => {
        body.style.cssText = '';
        details.dataset.foldAnimating = '';
      };
    } else {
      const from = body.getBoundingClientRect().height;
      body.style.overflow = 'hidden';
      const animation = body.animate([
        {height: `${from}px`, opacity: 1},
        {height: '0px', opacity: 0},
      ], {duration: 180, easing: easing});
      animation.onfinish = () => {
        // 先收起再清 inline 高度：反过来会有一帧显示完整内容，看起来像跳一下
        details.open = false;
        body.style.cssText = '';
        details.dataset.foldAnimating = '';
      };
    }
  };
  document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : null;
    const summary = target?.closest('summary');
    if (!summary) return;
    const details = summary.parentElement;
    if (!details || details.tagName !== 'DETAILS' || !details.matches(FOLD_ANIM_SELECTOR)) return;
    event.preventDefault();
    event.stopPropagation();
    toggleFold(details);
  }, true);

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
      // 关闭上拉栏时再收焦点（不在 pointerdown 阶段抢），键盘不会留在已收起的面板上
      document.activeElement?.blur?.();
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
      // 收起上拉栏时顺手收掉输入框焦点，键盘不留在已隐藏的面板上
      if (!open) document.activeElement?.blur?.();
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

  /**
   * 关系雷达的画板快照 过程函数
   * 把画布上看得见、有效的点 / 直线射线线段 / 圆整理成 bs-relations 认的三张表（世界坐标）。
   * 网格整块不算（铺进去会把「共线」刷成一堆没用的结论）；span 按**长度**量取（容差按它缩放，
   * 与求解请求的 eps 同一口径：不拿未归一化的系数比大小）
   * @returns {Object} {span, points, lines, circles}
   */
  const relationBoardSnapshot = () => {
    const snapshot = {span: 1, points: [], lines: [], circles: []};
    const stretch = value => {
      if (Number.isFinite(value)) snapshot.span = Math.max(snapshot.span, Math.abs(value));
    };
    geometryManager.getAllByOrder().forEach(item => {
      if (item.getValid && !item.getValid()) return;
      if (item.getVisible && !item.getVisible()) return;
      const id = item.getId();
      if (typeof window.isGridObjectId === 'function' && window.isGridObjectId(id)) return;
      const coordinate = item.getCoordinate?.();
      if (!coordinate) return;
      const type = item.getType();
      if (type === 'point') {
        const [x, y] = coordinate;
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        stretch(x);
        stretch(y);
        snapshot.points.push({id: id, x: x, y: y});
        return;
      }
      if (type === 'circle') {
        const [[cx, cy], [px, py]] = coordinate;
        const radius = Math.hypot(px - cx, py - cy);
        if (!(radius > 0) || !Number.isFinite(radius)) return;
        stretch(cx + radius);
        stretch(cy + radius);
        // 圆心那个点对象：等距中心要据它判断「这两个点本来就在同一个圆上」（见 bs-relations 的 scanEquidistant）
        const figure = item.getDefine?.();
        const centerId = figure && figure[0] && figure[0].getType?.() === 'point' ? figure[0].getId() : null;
        snapshot.circles.push({id: id, cx: cx, cy: cy, r: radius, centerId: centerId});
        return;
      }
      if (type === 'line') {
        const [[x1, y1], [x2, y2]] = coordinate;
        if (![x1, y1, x2, y2].every(Number.isFinite)) return;
        stretch(x1);
        stretch(y1);
        stretch(x2);
        stretch(y2);
        snapshot.lines.push({id: id, x1: x1, y1: y1, x2: x2, y2: y2, drawType: item.getDrawType?.() || 'line'});
      }
    });
    return snapshot;
  };

  /**
   * 造一块关系雷达面板 过程函数
   * 与求解面板一样放在本文件里（画板上各面板都是这么办的）；只有判定内核 `solver/bs-relations.js`
   * 是单独一份，因为 worker 里的启发式打分以后也要用它。
   * @param {Object} config
   *   config.t              i18n 取值函数
   *   config.snapshot()     画板快照（见 bs-relations 的 board 结构）
   *   config.draw()         重绘画布（写入覆盖层之后调）
   *   config.lookup(id)     画布对象 → 纯几何（见 canvas.js 的 relationRadarLookup）
   *   config.toolType()     当前可用工具（0 单规 / 1 单尺 / 2 尺规 / 3 网格）
   *   config.nameOf(id)     画布对象的名字（结果里显示用）
   * @returns {Object} {panel, scan, clear, refreshMode, state}
   */
  /**
   * 雷达结果里一个 id 的显示名 过程函数
   * 真对象用它的标签；合成对象（@ix: 交点 / @seg: 两点连线 / @circ: 两点圆）现拼一个名字：
   * 交点写成「A∩s1」，两点连线写成「AB」，两点圆写成「⊙(A,B)」
   */
  const radarDisplayName = id => {
    if (typeof id !== 'string') return null;
    // 合成 id（交点 / 两点连线 / 两点圆，且会嵌套）交给内核拆：里面自己按语法递归解析，
    // 自己在这边 split 会把嵌套的 `|` 拆错（末端就成了 undefined）
    const synthetic = typeof GeoRelations !== 'undefined' && typeof GeoRelations.syntheticName === 'function'
      ? GeoRelations.syntheticName(id, raw => geometryManager.get(raw)?.getName?.() || null)
      : null;
    if (synthetic) return synthetic;
    return geometryManager.get(id)?.getName?.() || null;
  };

  const createRelationRadarPanel = config => {
    const t = config.t;
    /** 一个勾选类别 → 扫描里的选项与结果分组（常用四类直接列出，其余折进「更多」） */
    const SPECS = [
      {option: 'collinear', i18n: 'board.radarCollinear', groups: ['collinear'],
        param: {i18n: 'board.radarMinPoints', type: 'number', min: 2, max: 12, key: 'collinear'}},
      {option: 'concyclic', i18n: 'board.radarConcyclic', groups: ['concyclic'],
        param: {i18n: 'board.radarMinPoints', type: 'number', min: 3, max: 20, key: 'concyclic'}},
      {option: 'parallel', i18n: 'board.radarParallel', groups: ['parallel', 'perpendicular']},
      {option: 'equidistant', i18n: 'board.radarEquidistant', groups: ['equidistant'],
        param: {i18n: 'board.radarMinPoints', type: 'number', min: 2, max: 20, key: 'equidistant'}},
      {option: 'angle', i18n: 'board.radarAngle', groups: ['angle'],
        param: {i18n: 'board.radarAngleSpec', type: 'text', key: 'angle', hint: 'board.radarAngleSpecHint'}},
      {option: 'bisector', i18n: 'board.radarBisector', groups: ['bisector']},
      {option: 'ratio', i18n: 'board.radarRatio', groups: ['ratio'],
        param: {i18n: 'board.radarRatioSpec', type: 'text', hint: 'board.radarRatioSpecHint'}},
      // 紧圆规只在能作圆的模式（尺规 / 单规）下有意义，单尺模式下这一项是灰的
      {option: 'radius', i18n: 'board.radarRadius', groups: ['radius'], compassOnly: true},
    ];
    /** 结果分组 → 标题文案 */
    const GROUP_LABELS = {
      collinear: 'board.radarCollinear',
      concyclic: 'board.radarConcyclic',
      parallel: 'board.radarParallelGroup',
      perpendicular: 'board.radarPerpendicularGroup',
      angle: 'board.radarAngle',
      ratio: 'board.radarRatio',
      equidistant: 'board.radarEquidistant',
      bisector: 'board.radarBisector',
      radius: 'board.radarRadius',
    };
    /** 一个分组最多列出多少条（再多只报个数） */
    const MAX_ROWS_PER_GROUP = 60;
    /** 数字的显示写法 过程函数 */
    const formatNumber = value => {
      if (!Number.isFinite(value)) return '—';
      if (value === 0) return '0';
      if (Math.abs(value) < 1e-3) return value.toExponential(2);
      return String(Math.round(value * 1e4) / 1e4);
    };

    const defaults = GeoRelations.defaultOptions();
    const panel = document.createElement('aside');
    panel.className = 'solver-panel radar-panel';

    // ① 容差档位
    const toleranceOptions = ['strict', 'normal', 'loose'].map(level =>
      `<option value="${level}"${defaults.tolerance === level ? ' selected' : ''}>`
      + `${t('board.radarTolerance' + level.charAt(0).toUpperCase() + level.slice(1))}</option>`).join('');
    const html = [`<label>${t('board.radarTolerance')}<select id="geb-radar-tolerance">${toleranceOptions}</select></label>`];

    // ② 常用类别直接列出；定点角 / 线上比 / 角平分线 / 紧圆规折进「更多」，平时收起。
    //    （带参数的类别：勾上才显示参数输入，参数就放在同一格里）
    const MORE_ORDER = ['angle', 'ratio', 'bisector', 'radius'];
    const kindCell = spec => {
      const checked = defaults.kinds[spec.option] ? ' checked' : '';
      let cell = '<div class="radar-option">'
        + `<label class="solver-check" title="${t(spec.i18n + 'Hint')}">`
        + `<input id="geb-radar-${spec.option}" type="checkbox"${checked}><span>${t(spec.i18n)}</span></label>`;
      if (spec.param) {
        const param = spec.param;
        const value = param.type === 'number'
          ? String(defaults.minPoints[param.key])
          : (param.key === 'angle' ? defaults.angleSpec : defaults.ratioSpec);
        const attributes = param.type === 'number'
          ? ` type="number" min="${param.min}" max="${param.max}" value="${value}"`
          : ` type="text" value="${value}" spellcheck="false"`;
        cell += `<label class="radar-field radar-field-off" id="geb-radar-${spec.option}-field"`
          + `${param.hint ? ` title="${t(param.hint)}"` : ''}>`
          + `<span>${t(param.i18n)}</span><input id="geb-radar-${spec.option}-param"${attributes}></label>`;
      }
      return cell + '</div>';
    };
    html.push('<div class="radar-kinds">');
    SPECS.filter(spec => !MORE_ORDER.includes(spec.option)).forEach(spec => {
      html.push(kindCell(spec));
    });
    html.push('</div>');
    // 「更多」里按 定点角 → 线上比 → 角平分线 → 紧圆规 的顺序（与 SPECS 的顺序不同，单独排）
    const moreSpecs = MORE_ORDER.map(option => SPECS.find(spec => spec.option === option)).filter(Boolean);
    // 三角与求解参数的高级选项同款（SVG）：收起朝右、展开转 90°
    html.push('<details class="radar-more"><summary>'
      + '<svg class="svg-icon radar-more-icon" viewBox="0 0 200 200" aria-hidden="true">'
      + '<polygon points="70 34, 152 100, 70 166" fill="transparent" stroke-width="20" stroke-linecap="round" stroke-linejoin="round"/>'
      + '</svg>'
      + `${t('board.radarMore')}</summary><div class="radar-kinds">`);
    moreSpecs.forEach(spec => {
      html.push(kindCell(spec));
    });
    html.push('</div></details>');

    // ③ 按钮 + 状态 + 结果
    html.push(`<button id="geb-radar-run">${t('board.radarRun')}</button>`);
    html.push(`<button id="geb-radar-clear">${t('board.radarClear')}</button>`);
    html.push(`<output id="geb-radar-status">${t('board.radarIdle')}</output>`);
    html.push('<div class="radar-results" id="geb-radar-results"></div>');
    panel.innerHTML = html.join('');

    const toleranceSelect = panel.querySelector('#geb-radar-tolerance');
    const runButton = panel.querySelector('#geb-radar-run');
    const clearButton = panel.querySelector('#geb-radar-clear');
    const status = panel.querySelector('#geb-radar-status');
    const results = panel.querySelector('#geb-radar-results');
    const fields = {};
    SPECS.forEach(spec => {
      fields[spec.option] = {
        check: panel.querySelector(`#geb-radar-${spec.option}`),
        field: panel.querySelector(`#geb-radar-${spec.option}-field`),
        input: panel.querySelector(`#geb-radar-${spec.option}-param`),
      };
    });

    // 面板状态：最近一次扫描 + 当前选中要标出来的条目（键 = 分组#下标）
    // token：扫描放到下一帧跑，中途「清除结果」或再点一次探测时让旧的那一轮作废
    // live：实时探测（开启后画布增删 / 拖动图形会自动重扫，再点一次按钮结束）
    const state = {result: null, selected: new Set(), snapshotProvider: config.snapshot, scanning: false, token: 0, groupOpen: {}, chunkOpen: {}, resultRendered: false, live: false};

    /** 勾选状态 → 参数输入的显隐 过程函数 */
    const syncFields = () => {
      SPECS.forEach(spec => {
        const item = fields[spec.option];
        if (!item.field) return;
        item.field.classList.toggle('radar-field-off', !item.check.checked);
      });
    };

    /** 「勾选 + 参数」的指纹 过程函数（变了就把上次的结果清掉：结果和勾选项对不上会误导） */
    const configFingerprint = () => SPECS.map(spec => {
      const item = fields[spec.option];
      return `${spec.option}:${item.check.checked ? 1 : 0}:${item.input ? item.input.value : ''}`;
    }).join('|') + `|${toleranceSelect.value}`;
    let lastFingerprint = configFingerprint();
    // 实时探测用：上一次扫描时画板的签名（增删 / 拖动后签名变了才重扫，避免「自己重绘」触发死循环）
    let lastBoardSignature = null;
    let liveTimer = null;

    /** 读面板上的勾选与参数 过程函数 */
    const readOptions = () => {
      const options = GeoRelations.defaultOptions();
      options.tolerance = toleranceSelect.value;
      const minPoints = Object.assign({}, options.minPoints);
      SPECS.forEach(spec => {
        const item = fields[spec.option];
        options.kinds[spec.option] = item.check.checked;
        if (spec.option === 'parallel') options.kinds.perpendicular = item.check.checked;
        if (!spec.param) return;
        if (spec.param.type === 'number') {
          const value = Math.max(spec.param.min, Math.min(spec.param.max, Number(item.input.value) || spec.param.min));
          minPoints[spec.param.key] = Math.round(value);
        }
      });
      options.minPoints = minPoints;
      options.angles = GeoRelations.parseAngleList(fields.angle.input.value, GeoRelations.DEFAULT_ANGLES);
      options.angleSpec = fields.angle.input.value;
      options.ratioSpec = fields.ratio.input.value.trim() || GeoRelations.DEFAULT_RATIO_SPEC;
      return options;
    };

    /** 一个对象 id 的显示名 过程函数 */
    const nameOf = id => (config.nameOf ? config.nameOf(id) : null) || id;
    const nameList = ids => ids.map(nameOf).join(t('board.radarSeparator'));

    /** 一条结果怎么读 过程函数 */
    const describe = entry => {
      switch (entry.kind) {
        case 'collinear':
          return t('board.radarRowCollinear', {count: entry.count, list: nameList(entry.pointIds)});
        case 'concyclic':
          return t('board.radarRowConcyclic', {count: entry.count, list: nameList(entry.pointIds),
            radius: formatNumber(entry.radius)});
        case 'parallel':
          return t('board.radarRowParallel', {first: nameOf(entry.lineIds[0]), second: nameOf(entry.lineIds[1])});
        case 'perpendicular':
          return t('board.radarRowPerpendicular', {first: nameOf(entry.lineIds[0]), second: nameOf(entry.lineIds[1])});
        case 'angle':
          return t('board.radarRowAngle', {vertex: nameOf(entry.vertexId),
            first: nameOf(entry.lineIds[0]), second: nameOf(entry.lineIds[1]),
            degrees: formatNumber(entry.degrees)});
        case 'ratio':
          return t('board.radarRowRatio', {first: nameOf(entry.pointIds[0]), second: nameOf(entry.pointIds[1]),
            third: nameOf(entry.pointIds[2]), label: entry.label});
        case 'equidistant':
          return t('board.radarRowEquidistant', {center: nameOf(entry.centerId),
            list: nameList(entry.pointIds), radius: formatNumber(entry.radius)});
        case 'bisector':
          return t('board.radarRowBisector', {vertex: nameOf(entry.vertexId),
            bisector: nameOf(entry.bisectorId), first: nameOf(entry.lineIds[0]),
            second: nameOf(entry.lineIds[1]), degrees: formatNumber(entry.degrees)});
        case 'radius':
          return t('board.radarRowRadius', {center: nameOf(entry.centerId),
            through: nameOf(entry.throughId), source: nameOf(entry.sourceCircleId)});
        default:
          return entry.kind;
      }
    };

    /** 把选中的条目写进画布覆盖层并重绘 过程函数 */
    const applyOverlay = () => {
      const result = state.result;
      if (!result || !state.selected.size) {
        relationRadarOverlay = null;
        config.draw();
        return;
      }
      const entries = [];
      Object.keys(result.kind).forEach(kind => {
        result.kind[kind].forEach((entry, index) => {
          if (state.selected.has(`${kind}#${index}`)) entries.push(entry);
        });
      });
      relationRadarOverlay = {
        entries: entries,
        tolerance: result.tolerance,
        angleTolerance: result.angleTolerance,
        span: result.span,
      };
      config.draw();
    };

    /** 结果里每条在画布上还成不成立 过程函数（给「已失效」标注用） */
    const staleIndices = () => {
      if (!state.result || !relationRadarOverlay) return new Set();
      const overlay = GeoRelations.evaluateOverlay(relationRadarOverlay, config.lookup);
      const stale = new Set();
      // evaluateOverlay 的 stale 下标对应 overlay.entries 的顺序，这里换算回「分组#下标」
      const order = [];
      Object.keys(state.result.kind).forEach(kind => {
        state.result.kind[kind].forEach((entry, index) => {
          if (state.selected.has(`${kind}#${index}`)) order.push(`${kind}#${index}`);
        });
      });
      overlay.stale.forEach(position => { if (order[position]) stale.add(order[position]); });
      return stale;
    };

    /** 画结果列表 过程函数 */
    const render = () => {
      const result = state.result;
      // 同一次结果的刷新（点条目会触发）才保留各分组的展开/收起状态；
      // 新一次扫描要重置成 autoOpen（见 scan 里把 resultRendered 置回 false）。
      // 注意：<details> 的 toggle 事件是异步派发的，所以直接读 DOM 的 open 才是当下真实状态
      if (state.resultRendered) {
        results.querySelectorAll('.radar-group').forEach(d => { if (d.dataset.kind) state.groupOpen[d.dataset.kind] = d.open; });
        results.querySelectorAll('.radar-chunk').forEach(d => { if (d.dataset.chunk) state.chunkOpen[d.dataset.chunk] = d.open; });
      }
      results.innerHTML = '';
      if (!result) return;
      const stale = staleIndices();
      Object.keys(result.kind).forEach(kind => {
        const entries = result.kind[kind];
        const details = document.createElement('details');
        details.className = 'radar-group';
        details.dataset.kind = kind;
        // 条目一多默认收起；同次结果刷新时按用户手动状态保留
        const autoOpen = entries.length > 0 && entries.length <= 12;
        details.open = (kind in state.groupOpen) ? state.groupOpen[kind] : autoOpen;
        const summary = document.createElement('summary');
        summary.textContent = `${t(GROUP_LABELS[kind] || kind)} · ${entries.length}${t('board.radarCountSuffix')}`;
        details.appendChild(summary);
        if (!entries.length) {
          const empty = document.createElement('p');
          empty.className = 'radar-empty';
          empty.textContent = t('board.radarGroupEmpty');
          details.appendChild(empty);
        }
        /** 画一条结果 过程函数 */
        const rowFor = (entry, index) => {
          const key = `${kind}#${index}`;
          const row = document.createElement('button');
          row.type = 'button';
          row.className = 'radar-row' + (state.selected.has(key) ? ' active' : '') + (stale.has(key) ? ' stale' : '');
          row.dataset.key = key;
          const deviation = Number.isFinite(entry.deviation) && entry.deviation > 0
            ? `　${t('board.radarDeviation', {value: formatNumber(entry.deviation)})}` : '';
          // base 存正文：「已失效」这个尾巴由 refreshStale 加减，不用重建行
          const base = describe(entry) + deviation;
          row.dataset.base = base;
          row.textContent = base + (stale.has(key) ? `　${t('board.radarStale')}` : '');
          row.addEventListener('click', () => {
            // 结果一次只标一条（互斥）：点已选的那条＝取消，否则清掉其它、只选它
            if (state.selected.has(key)) {
              state.selected.delete(key);
            } else {
              state.selected.clear();
              state.selected.add(key);
            }
            applyOverlay();
            render();
          });
          return row;
        };
        // 结果**全部列出**：每 MAX_ROWS_PER_GROUP 条折成一个可展开的块（第一块默认展开）
        const blocks = Math.max(1, Math.ceil(entries.length / MAX_ROWS_PER_GROUP));
        for (let block = 0; block < blocks; block++) {
          const from = block * MAX_ROWS_PER_GROUP;
          const slice = entries.slice(from, from + MAX_ROWS_PER_GROUP);
          let parent = details;
          if (blocks > 1) {
            const chunk = document.createElement('details');
            chunk.className = 'radar-chunk';
            const chunkKey = `${kind}#${block}`;
            chunk.dataset.chunk = chunkKey;
            chunk.open = (chunkKey in state.chunkOpen) ? state.chunkOpen[chunkKey] : block === 0;
            const chunkSummary = document.createElement('summary');
            chunkSummary.textContent = t('board.radarChunk', {from: from + 1, to: from + slice.length});
            chunk.appendChild(chunkSummary);
            details.appendChild(chunk);
            parent = chunk;
          }
          slice.forEach((entry, offset) => parent.appendChild(rowFor(entry, from + offset)));
        }
        results.appendChild(details);
      });
      if (!Object.keys(result.kind).length) {
        const none = document.createElement('p');
        none.className = 'radar-empty';
        none.textContent = t('board.radarNothingChecked');
        results.appendChild(none);
      }
      state.resultRendered = true;
      state.scanning = false;
      updateRunButton();
    };

    /**
     * 只刷「已失效」标记 过程函数（不重建列表）
     * 画布每重绘一次喊一声（见 canvas.js 的 drawContent），这里节流到 200ms：
     * 拖动图形时紫色高亮自动跟着走，走散了的那条关系在列表里也就地标成「已失效」
     */
    let lastStaleAt = 0;
    const refreshStale = () => {
      if (!state.result || !state.selected.size) return;
      const now = Date.now();
      if (now - lastStaleAt < 200) return;
      lastStaleAt = now;
      const stale = staleIndices();
      results.querySelectorAll('.radar-row').forEach(row => {
        const isStale = stale.has(row.dataset.key);
        if (row.classList.contains('stale') === isStale) return;
        row.classList.toggle('stale', isStale);
        row.textContent = (row.dataset.base || '') + (isStale ? `　${t('board.radarStale')}` : '');
      });
    };
    // 画布每重绘一次：先刷「已失效」标注；实时探测开着时再安排一次重扫（拖动图形也能跟上）
    window.relationRadarAfterDraw = () => {
      refreshStale();
      scheduleRescan();
    };
    // 增删图形会派发 storage 事件；实时探测开着时据此重扫（拖动走上面的重绘钩子）
    const onStorageChange = () => scheduleRescan();
    window.addEventListener('storage', onStorageChange);

    /** 画板签名 过程函数（点 / 线 / 圆 的 id 与坐标；实时探测据它判断要不要重扫） */
    const signatureOf = board => {
      if (!board) return null;
      const round = value => Math.round(value * 1e6) / 1e6;
      const points = (board.points || []).map(p => `${p.id}:${round(p.x)},${round(p.y)}`).join(';');
      const lines = (board.lines || []).map(l => `${l.id}:${round(l.x1)},${round(l.y1)},${round(l.x2)},${round(l.y2)}`).join(';');
      const circles = (board.circles || []).map(c => `${c.id}:${round(c.cx)},${round(c.cy)},${round(c.r)}`).join(';');
      return `${points}|${lines}|${circles}`;
    };

    /** 更新「开始探测 / 结束探测」按钮外观 过程函数 */
    const updateRunButton = () => {
      if (state.live) {
        runButton.textContent = t('board.radarStop');
        runButton.classList.add('running');
        return;
      }
      runButton.textContent = state.scanning ? t('board.radarScanning') : t('board.radarRun');
      runButton.classList.toggle('running', state.scanning);
    };

    /** 实时探测：安排一次重扫 过程函数（去抖 250ms；画板签名没变就跳过，免得自己重绘触发死循环） */
    const scheduleRescan = () => {
      if (!state.live) return;
      if (liveTimer !== null) window.clearTimeout(liveTimer);
      liveTimer = window.setTimeout(() => {
        liveTimer = null;
        if (!state.live) return;
        let board = null;
        try { board = state.snapshotProvider(); } catch (error) { board = null; }
        if (!board) return;
        if (signatureOf(board) === lastBoardSignature) return;   // 只是重绘，图形没变
        scan();
      }, 250);
    };

    /** 清空结果与高亮 过程函数 */
    const clear = message => {
      state.token++;              // 在跑的那一轮扫描就此作废
      state.result = null;
      state.selected.clear();
      state.groupOpen = {};
      state.chunkOpen = {};
      state.resultRendered = false;
      state.scanning = false;
      lastBoardSignature = null;          // 结果已清：下一次实时重扫不受签名比对拦截
      results.innerHTML = '';
      relationRadarOverlay = null;
      config.draw();
      updateRunButton();
      status.textContent = message || t('board.radarIdle');
    };

    /** 探一遍 过程函数 */
    const scan = () => {
      if (state.scanning) return null;
      const options = readOptions();
      if (!Object.keys(options.kinds).some(kind => options.kinds[kind])) {
        clear(t('board.radarNothingChecked'));
        return null;
      }
      let board = null;
      try {
        board = state.snapshotProvider();
      } catch (error) {
        board = null;
      }
      if (!board || !board.points.length) {
        clear(t('board.radarEmptyBoard'));
        return null;
      }
      state.scanning = true;
      lastBoardSignature = signatureOf(board);   // 记下本次快照：实时探测据此判断「图形变没变」
      runButton.textContent = state.live ? t('board.radarStop') : t('board.radarScanning');
      runButton.classList.add('running');
      status.textContent = state.live ? t('board.radarLive') : t('board.radarScanning');
      state.selected.clear();
      relationRadarOverlay = null;
      config.draw();
      // 先让「探测中…」这一帧画出来再算（图形多时扫描要跑一会儿）
      const token = ++state.token;
      window.setTimeout(() => {
        if (token !== state.token) return;   // 中途点了「清除结果」或又探了一次：这一轮作废
        let result = null;
        try {
          result = GeoRelations.scan(board, options);
        } catch (error) {
          result = null;
        }
        if (!result) {
          clear(t('board.radarFailed'));
          return;
        }
        state.result = result;
        // 新一轮探测：展开记忆清空，分组回到默认（<12 展开、>12 收起），不再沿用上轮遗留的收起态
        state.groupOpen = {};
        state.chunkOpen = {};
        state.resultRendered = false;
        lastFingerprint = configFingerprint();
        status.textContent = (result.count
          ? t('board.radarFound', {count: result.count})
          : t('board.radarNone'))
          + (result.truncated ? `　${t('board.radarTruncated')}` : '');
        render();
      }, 0);
      return null;
    };

    // 交互接线
    // 参数 / 勾选变了：清掉旧结果；实时探测开着就顺着重扫一次（签名已被 clear 清空，不会被拦）
    const onConfigChange = () => {
      clear(t('board.radarConfigChanged'));
      scheduleRescan();
    };
    toleranceSelect.addEventListener('change', onConfigChange);
    SPECS.forEach(spec => {
      const item = fields[spec.option];
      item.check.addEventListener('change', () => {
        syncFields();
        onConfigChange();
      });
      if (item.input) item.input.addEventListener('change', onConfigChange);
    });
    // 「开始探测 / 结束探测」是一颗开关：开着实时探测，再点一下关掉
    runButton.addEventListener('click', () => {
      if (state.live) {
        state.live = false;
        if (liveTimer !== null) { window.clearTimeout(liveTimer); liveTimer = null; }
        status.textContent = state.result
          ? t('board.radarFound', {count: state.result.count})
          : t('board.radarIdle');
        updateRunButton();
        return;
      }
      state.live = true;
      updateRunButton();
      if (!state.scanning) scan();
    });
    clearButton.addEventListener('click', () => {
      // 手动清除结果同时退出实时探测，免得刚清完又被重扫填回来
      state.live = false;
      if (liveTimer !== null) { window.clearTimeout(liveTimer); liveTimer = null; }
      clear();
    });
    syncFields();

    /** 单尺模式下紧圆规没有意义：勾不了，并给出说明 过程函数 */
    const refreshMode = () => {
      const compass = (config.toolType ? config.toolType() : 2) !== 1;
      const item = fields.radius;
      item.check.disabled = !compass;
      if (!compass) item.check.checked = false;
      item.check.parentElement.classList.toggle('radar-disabled', !compass);
      item.check.parentElement.title = compass ? t('board.radarRadiusHint') : t('board.radarRadiusNoCompass');
      syncFields();
    };
    refreshMode();

    return {
      panel: panel,
      scan: scan,
      clear: clear,
      refreshMode: refreshMode,
      setSnapshotProvider: provider => { state.snapshotProvider = provider; },
      /** 供别的入口（如以后 worker 里的打分）读最近一次的结果 */
      result: () => state.result,
      /** 当前是否已经有高亮（关面板时用得上） */
      hasHighlight: () => !!(relationRadarOverlay && relationRadarOverlay.entries.length),
      state: state,
      lastFingerprint: () => lastFingerprint,
    };
  };

  const solverPanel = () => {
    const panel = document.createElement('aside');
    panel.className = 'solver-panel';
    // 推荐的并行线程数：浏览器只有 navigator.hardwareConcurrency 这一个口径（逻辑核心数，
    // 拿不到真实物理核），留一个核心给页面本身；上限 8（再多收益很小、内存翻倍）
    const hardwareCores = Math.max(2, Number(navigator.hardwareConcurrency) || 4);
    const recommendedThreads = Math.max(2, Math.min(8, hardwareCores - 1));
    // 页签条：求解参数 / 关系雷达两块面板各在自己**内部**的顶部放一条（两条内容一样、联动切换）。
    // 手机端这条由 CSS 收起来（那里是两个圆形按钮 + 各自的上拉栏）
    const tabsHtml = '<div class="solver-tabs">'
      + `<button type="button" data-panel="solver">${t('board.solverParams')}</button>`
      + `<button type="button" data-panel="radar">${t('board.radarTitle')}</button></div>`;
    panel.innerHTML = [
      tabsHtml,
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
        `<label>${t('board.solverTime')}<input id="geb-solver-time" type="number" min="1" max="6000" value="300"></label>` +
        `<label>${t('board.solverCount')}<input id="geb-solver-solutions" type="number" min="1" max="1000" value="30"></label>` +
      '</div>',
      // 高级选项：平时收起（<details>），里面的值都对应搜索内核本来就支持的参数（见 search-worker.js）
      // 高级选项的三角是 SVG（不是 CSS 的文字三角）：展开时整个图标转 90°，风格与其它图标一致
      `<details class="solver-advanced" id="geb-solver-advanced"><summary>` +
        '<svg class="svg-icon solver-advanced-icon" viewBox="0 0 200 200" aria-hidden="true">' +
        '<polygon points="70 34, 152 100, 70 166" fill="transparent" stroke-width="20" stroke-linecap="round" stroke-linejoin="round"/>' +
        '</svg>' +
        `${t('board.solverAdvanced')}</summary>` +
        // 六个开关，按面板里的顺序排成「逐步搜索 / 解法自检」一行、「启发式搜索」一行、
        // 「对称剪枝 / 目标优先」一行、「低内存」一行
        // 逐步搜索：1 步搜一遍、2 步搜一遍 …… 一直到设定步数（短解先出来，可随时停）
        // 解法自检：默认关（每个解都要挪点重算一遍，慢一些；只在当前位置成立的特解会被剔掉）
        '<div class="solver-check-row">' +
          `<label class="solver-check" title="${t('board.solverStepwiseHint')}"><input id="geb-solver-stepwise" type="checkbox"><span>${t('board.solverStepwise')}</span></label>` +
          `<label class="solver-check" title="${t('board.solverSelfCheckHint')}"><input id="geb-solver-generic" type="checkbox"><span>${t('board.solverSelfCheck')}</span></label>` +
        '</div>' +
        // 启发式搜索：默认关（内核见 solver/bs-heuristic.js）—— 先 beam 找一条，找不到再回退 DFS
        `<label class="solver-check" title="${t('board.solverHeuristicHint')}"><input id="geb-solver-heuristic" type="checkbox"><span>${t('board.solverHeuristic')}</span></label>` +
        '<div class="solver-check-row">' +
          `<label class="solver-check" title="${t('board.solverSymmetryHint')}"><input id="geb-solver-symmetry" type="checkbox" checked><span>${t('board.solverSymmetry')}</span></label>` +
          `<label class="solver-check" title="${t('board.solverGoalFirstHint')}"><input id="geb-solver-goal-first" type="checkbox" checked><span>${t('board.solverGoalFirst')}</span></label>` +
        '</div>' +
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
      `<button id="geb-solver-clear">${t('board.solverClear')}</button>`,
      // 逐步查看解法：放在「清除解法」下面；没显示解时由 syncStepRow 收起
      `<div class="solver-step-row"><button id="geb-solver-prev">${t('board.solverPrevStep')}</button>` +
        `<span id="geb-solver-stepinfo">—</span>` +
        `<button id="geb-solver-next">${t('board.solverNextStep')}</button></div>`,
      `<output id="geb-solver-status">${t('board.solverIdle')}</output>`,
      // 搜索进度条 + 右边的百分比（百分比就是条的比例，见 paintSearchProgress）
      '<div class="solver-progress-row">' +
        '<div class="solver-progress" id="geb-solver-progress"><div class="solver-progress-bar" id="geb-solver-progress-bar"></div></div>' +
        '<span class="solver-progress-text" id="geb-solver-progress-text">0.00%</span></div>',
      '<div id="geb-solver-list" class="solver-solution-list"></div>',
    ].join('');
    // 页签条留在面板上，其余内容包一层：切页签时只平移内容，面板底色 / 外框不动
    {
      const inner = document.createElement('div');
      inner.className = 'solver-panel-inner';
      [...panel.children].forEach(child => {
        if (!child.classList.contains('solver-tabs')) inner.appendChild(child);
      });
      panel.appendChild(inner);
    }
    // 从关卡打开求解器时带了 solverTool（那一关限定单尺 / 单规）：可用工具默认就选到同一种模式
    const presetSolverTool = params.get('solverTool');
    const solverToolSelect = panel.querySelector('#geb-solver-tool');
    if (solverToolSelect && ['0', '1', '2', '3'].includes(presetSolverTool)) {
      solverToolSelect.value = presetSolverTool;
    }
    // 画布上已经有网格（画板里生成过 / 关卡自带）：切到网格模式并把最大步数切到 4
    syncSolverGridOption(panel);
    // 收进底部上拉栏：画布上只留一个圆形按钮（见 addSideButton）
    addSideButton('solver-params', solverSideIcon(), t('board.solverParams'), wrapInSheet(panel, t('board.solverParams')));

    // 手机端画布 / 其他区域的 touchstart 会 preventDefault，输入框不会自动失焦；
    // 点到输入类控件之外时手动收掉焦点。但上拉栏（含标题 / 关闭按钮）和按钮 / 链接等
    // 交给它们自己的点击处理：在 pointerdown 阶段 blur 会让键盘和面板先缩一下，
    // 结果就是关闭按钮点不到
    document.addEventListener('pointerdown', event => {
        const active = document.activeElement;
        if (!active || typeof active.closest !== 'function' || !active.closest('.solver-panel')) return;
        const target = event.target instanceof Element ? event.target : null;
        if (!target || target === active) return;
        if (target.closest('.panel-sheet')) return;
        if (target.closest('button, a, input, textarea, select, label, summary, [role="button"]')) return;
        active.blur();
    }, true);

    // 关系雷达（面板就在本文件里，与画板上其它面板一致；判定在 solver/bs-relations.js）：
    //   桌面端 —— 与求解面板共用右上角那一块浮层，靠面板顶部那条页签条切换（两块不能叠在一起）；
    //   手机端 —— 在求解图标下面多一个圆形按钮，各自一块底部上拉栏
    const radar = createRelationRadarPanel({
      t: t,
      snapshot: relationBoardSnapshot,
      lookup: id => (typeof relationRadarLookup === 'function' ? relationRadarLookup(id) : null),
      draw: () => drawContent(),
      toolType: () => Number(panel.querySelector('#geb-solver-tool')?.value ?? 2),
      nameOf: id => radarDisplayName(id) || id,
    });
    // 雷达面板自己也放一条同样的页签条（两条内容一致，切换时一起变）
    radar.panel.insertAdjacentHTML('afterbegin', tabsHtml);
    {
      const inner = document.createElement('div');
      inner.className = 'solver-panel-inner';
      [...radar.panel.children].forEach(child => {
        if (!child.classList.contains('solver-tabs')) inner.appendChild(child);
      });
      radar.panel.appendChild(inner);
    }
    addSideButton('radar', radarSideIcon(), t('board.radarTitle'), wrapInSheet(radar.panel, t('board.radarTitle')));
    window.relationRadarPanel = radar;   // 调试 / 以后 worker 里的打分要读最近一次的结果
    {
      // 桌面端两块面板叠在同一处：页签切哪块就显示哪块
      const showPanel = (which, animate = true) => {
        const next = which === 'solver' ? panel : radar.panel;
        const wasHidden = next.classList.contains('panel-tab-hidden');
        panel.classList.toggle('panel-tab-hidden', which !== 'solver');
        radar.panel.classList.toggle('panel-tab-hidden', which !== 'radar');
        document.querySelectorAll('.solver-tabs button').forEach(button =>
          button.classList.toggle('active', button.dataset.panel === which));
        if (!animate || !wasHidden) return;
        const target = next.querySelector(':scope > .solver-panel-inner') || next;
        target.classList.remove('panel-tab-in-left', 'panel-tab-in-right');
        void target.offsetWidth;
        // 面板在页签里的左右位置：雷达在右、求解参数在左，从对应方向平移进来
        target.classList.add(which === 'radar' ? 'panel-tab-in-right' : 'panel-tab-in-left');
        target.addEventListener('animationend', () => {
          target.classList.remove('panel-tab-in-left', 'panel-tab-in-right');
        }, {once: true});
      };
      // 与 index.css 里那档「手机布局」的媒体查询保持一致（窄屏或矮屏都算）
      const narrowLayout = () => window.matchMedia('(max-width: 900px), (max-height: 600px)').matches;
      const syncTabs = () => {
        if (narrowLayout()) {
          // 手机端两块面板各在自己的上拉栏里：谁都不该被页签藏起来
          panel.classList.remove('panel-tab-hidden');
          radar.panel.classList.remove('panel-tab-hidden');
          document.querySelectorAll('.solver-tabs button').forEach(button => button.classList.remove('active'));
          radar.refreshMode();
          return;
        }
        const active = document.querySelector('.solver-tabs button.active');
        showPanel(active ? active.dataset.panel : 'solver', false);
      };
      document.querySelectorAll('.solver-tabs').forEach(tabs => {
        tabs.addEventListener('click', event => {
          const button = event.target.closest('button[data-panel]');
          if (button) showPanel(button.dataset.panel);
        });
      });
      showPanel('solver', false);
      window.addEventListener('resize', syncTabs);
      // 可用工具改成单尺了：雷达里的「紧圆规」要跟着灰掉（单尺作不了圆，那一项没有意义）
      panel.querySelector('#geb-solver-tool')?.addEventListener('change', () => radar.refreshMode());
      // 切面板时雷达那侧的覆盖层不用动：它本来就按对象 id 在线复算
      syncTabs();
    }

    const status = panel.querySelector('#geb-solver-status');
    const list = panel.querySelector('#geb-solver-list');
    const stepInfo = panel.querySelector('#geb-solver-stepinfo');
    const stepRow = panel.querySelector('.solver-step-row');
    // 按步播放的间隔（毫秒）：越小画得越快
    const REPLAY_INTERVAL = 90;
    // 最近一次搜索的结果、当前画的是第几个解的第几步、以及在途播放的代号
    let latest = null;
    let currentIndex = -1;
    let currentStep = 0;
    let replayToken = 0;
    // 「清除解法」只清覆盖层与列表选中、搜索继续：期间用它抑制搜索收尾时的自动点亮第一个解
    let solverSuppressAutoPlay = false;

    /**
     * 「上一步 / 下一步」在解法列表里还有解时就露出（不要求当前正画着某一个）：
     * 点掉当前解法只是清掉画布显示，行不能跟着消失，否则下面的列表会往上跳一格。
     * 等待搜索、搜索中还没出解、已清除画出的解法（列表清空）等状态收起 过程函数
     */
    const syncStepRow = () => {
      const showing = !!(list && list.querySelector('.solver-solution-row'));
      if (stepRow) stepRow.style.display = showing ? '' : 'none';
    };
    syncStepRow();

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
      syncStepRow();
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

    /**
     * 只清画布上的解法显示（品红覆盖层 + 列表选中），不动解法列表、也不停搜索 过程函数
     * 「清除解法」按钮、以及再点一次已选中的那条解法都走它
     */
    const clearSolutionDisplay = () => {
      replayToken++;                 // 作废在途的按步播放
      currentIndex = -1;
      currentStep = 0;
      syncStepRow();
      stepInfo.textContent = '—';
      list.querySelectorAll('.solver-solution-pick.active').forEach(button => button.classList.remove('active'));
      clearSolverSolution();
    };

    /** 弹出某个解的文字步骤 过程函数 */
    const showReport = index => {
      const solution = latest && latest.solutions[index];
      if (!solution) return;
      document.querySelectorAll('.board-dialog-report').forEach(item => {
        dismissMask(item.closest('.board-dialog-mask'));
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
      close.addEventListener('click', () => dismissMask(mask));
      mask.querySelector('.board-dialog-actions').appendChild(close);
      // 点框外也关掉
      mask.addEventListener('click', event => {
        if (event.target === mask) dismissMask(mask);
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
      const parts = [];
      if (state.heuristic) {
        // 启发式没有「情况总数」：分母用时间上限，进度按已用时间估（见 refreshSearchProgress）
        parts.push(t('board.solverProgressHeuristic'));
        parts.push(t('board.solverProgressHeuristicNodes', {nodes: progressNumber(state.nodes)}));
        if (state.limitSeconds > 0) {
          parts.push(t('board.solverProgressTime', {
            elapsed: ((performance.now() - state.startedAt) / 1000).toFixed(1),
            limit: state.limitSeconds,
          }));
        }
        if (state.target > 0) {
          parts.push(t('board.solverProgressFound', {found: liveResult.solutions.length, target: state.target}));
        }
        return parts.join(' · ');
      }
      parts.push(t('board.solverProgressNote'));
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
      // 启发式没有「情况」可数：进度 = 已用时间 / 时间上限（随定时器持续推进）；
      // 没有时间上限时按节点数给一个渐近值，避免永远停在 0
      if (state.heuristic) {
        if (state.limitSeconds > 0) {
          const elapsed = (performance.now() - state.startedAt) / 1000;
          state.ratio = Math.max(state.ratio || 0, Math.min(1, elapsed / state.limitSeconds));
        } else {
          state.ratio = Math.max(state.ratio || 0, 1 - Math.pow(0.5, (state.nodes || 0) / 1000));
        }
        paintSearchProgress(state.ratio, progressTitle(state));
        return;
      }
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
      if (payload.heuristic) {
        // 启发式只报节点数，进度由「已用时间 / 时间上限」在 refreshSearchProgress 里推进
        progressState.heuristic = true;
        progressState.nodes = payload.nodes || 0;
        if (payload.budgetSeconds > 0) progressState.limitSeconds = payload.budgetSeconds;
        refreshSearchProgress();
        return;
      }
      progressState.heuristic = false;
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
        // 启发式没有「情况总数」，进度改用「已用时间 / 时间上限」
        heuristic: !!options.heuristic,
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
      heuristic: panel.querySelector('#geb-solver-heuristic'),
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
        // 启发式搜索：默认关（见 solver/bs-heuristic.js；勾了就走 beam 找一个解，不做穷尽证明）
        heuristic: advancedFields.heuristic.checked,
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
      // 启发式搜索也默认关：只有上次明确勾上过才勾回来
      advancedFields.heuristic.checked = saved.heuristic === true;
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
      // 再点一次已经选中的那条：清掉画布上的显示（与关系雷达一致），不重新画
      pick.addEventListener('click', () => {
        if (pick.classList.contains('active')) { clearSolutionDisplay(); return; }
        playSolution(index, false);
      });
      const text = document.createElement('button');
      text.type = 'button';
      text.className = 'solver-solution-text';
      text.textContent = t('board.solverReportButton');
      text.addEventListener('click', () => showReport(index));
      row.appendChild(pick);
      row.appendChild(text);
      list.appendChild(row);
      // 列表里一有解就把「上一步 / 下一步」露出来（收尾重画与边搜边显示都走这里）
      syncStepRow();
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
          syncStepRow();
          stepInfo.textContent = '—';
          solverSolutionPlan = null;
          solverSolutionOverlay = null;
          drawContent();
          status.textContent = t('board.solverSelfCheckAllRejected', {count: result.selfCheckRejected});
          return;
        }
        // 只有启发式跑过、又没找到解 ≠ 搜尽（它只**找**解）：文案必须说清楚，别让人以为这题无解。
        // 已经回退跑过 DFS 的话就照常报「已搜尽 / 超时」，别加这层提示
        if (result.heuristicOnly) {
          status.textContent = t('board.solverHeuristicNoSolution', {seconds: seconds});
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
        + (result.selfCheckRejected ? t('board.solverSelfCheckNote', {count: result.selfCheckRejected}) : '')
        // 只有启发式找到的（没跑兜底 DFS）才要提醒「这不是穷尽搜索的结论」
        + (result.heuristicOnly ? t('board.solverHeuristicNote') : '');
      // 搜索途中已经边搜边显示了一些行：清掉，按这份完整解表重画（顺序也照这里的排）
      list.innerHTML = '';
      result.solutions.forEach(appendSolutionRow);
      syncStepRow();
      // 正常收尾自动点亮第一个解；但用户中途点过「清除解法」就按住不动，
      // 不然刚清掉的品红又被重新画出来（抑制只对这次搜索有效，下次搜索开头会复位）
      if (!solverSuppressAutoPlay) playSolution(0, true);
      solverSuppressAutoPlay = false;
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
      // 启发式搜索（测试）：worker 里走 solver/bs-heuristic.js 的 beam 路径
      heuristic: advanced.heuristic === true,
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
        startSearchProgress({target: settings.solutions, limitSeconds: settings.timeLimitSeconds,
          heuristic: !!(settings.advanced && settings.advanced.heuristic)});
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
      solverSuppressAutoPlay = false;   // 新一轮搜索：恢复「收尾自动点亮第一个解」
      list.innerHTML = '';
      syncStepRow();
      // 边搜边看的那本账也清空：上一次搜索留下的解不能混进来
      liveResult.solutions.length = 0;
      streamedSignatures.clear();
      drawContent();
      status.textContent = t('board.solverSearching');

      // 启发式搜索是单线程的（见 solver/bs-heuristic.js），而并行那套前缀切分走的仍是 DFS ——
      // 勾了它就按 1 个线程算，免得同时跑两套引擎
      const settings = {request, limit, toolType, timeLimitSeconds, solutions, advanced,
        threads: advanced.heuristic ? 1 : advanced.threads};
      startSearchProgress({target: solutions, limitSeconds: timeLimitSeconds,
        heuristic: advanced.heuristic === true});
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

    /** 清除解法：清掉画布上的品红显示与解法列表，但搜索继续进行 过程函数 */
    const clearSolveView = () => {
      clearSolutionDisplay();
      // 列表整块清掉，边搜边追加的那本账也跟着清空：之后新搜到的解会从第 1 条重新排进来
      if (latest) latest.solutions = [];
      if (liveResult && liveResult !== latest) liveResult.solutions = [];
      list.innerHTML = '';
      syncStepRow();
      // 搜索收尾会自动点亮第一个解：按住它，别把刚清掉的品红又画回来
      solverSuppressAutoPlay = true;
      status.textContent = t('board.solverCleared');
    };

    /** 彻底清空求解结果（几何被外部替换时用）：停掉搜索、清列表与覆盖层 过程函数 */
    const clearSolveAll = () => {
      stopSearch();
      resetSearchProgress();
      replayToken++;
      latest = null;
      currentIndex = -1;
      currentStep = 0;
      solverSuppressAutoPlay = false;
      stepInfo.textContent = '—';
      list.innerHTML = '';
      syncStepRow();
      clearSolverSolution();
      status.textContent = t('board.solverCleared');
    };
    // 面板上的「清除解法」：只清覆盖层与列表选中，搜索继续
    panel.querySelector('#geb-solver-clear').addEventListener('click', clearSolveView);
    // 暴露给 clearSolverOutputs：载入记录 / 撤销重做 / 导入 gmt / 清空画布时**彻底**清空求解结果
    window.solverSolveClear = clearSolveAll;
  };
  // 当前标记的集合名（initial / named / movepoints / result / resultShown）与当前标记工具（given / goal）
  let marking = null;
  let markingTool = null;
  /**
   * 标记模式下「光标指着哪个对象」 过程函数（逻辑坐标）
   * **点优先，其余按离光标最近**（near 本身是距离优先）。标记是逐个对象点的操作：
   * 交点 / 线上的点常常正压在直线 / 圆上，纯按距离比的话点到线的距离更小，永远抢不过背后那条线
   * —— 表现就是「标不了点，标到了后面的线和圆」。15px 半径内先找点、没有点再看线 / 圆
   * @param {number} x 逻辑坐标
   * @param {number} y 逻辑坐标
   * @param {string[]} [ignore] 要跳过的对象 id（网格当作一整块排除）
   * @returns {string|null}
   */
  const markTargetAt = (x, y, ignore = []) => {
    // 与作图取对象同一套口径（点优先、其余按距离，见 geometry.js 的 near）
    const [id] = geometryManager.near([x, y], ['point', 'line', 'circle'], 1, ignore);
    return id || null;
  };
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
    // 取要标记的对象：点优先，其余按距离（见 markTargetAt）。
    // 网格当作一整块直接排除在命中之外（先忽略网格再找最近的图形）：否则点在格线附近会
    // 先选中网格、吃到「网格不能标记」的提示，反而选不到网格后面的图形（见 #8）
    const gridIds = (typeof geometryElementLists !== 'undefined' && geometryElementLists.grid)
      ? [...geometryElementLists.grid] : [];
    const id = markTargetAt(x, y, gridIds);
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
  let pendingNewResultGroup = null;
  /**
   * 重绘标记面板结构 过程函数
   * 给定 / 所求 / 探索显示三组可折叠，所求里每个解再各占一层（判定 / 显示两个列表）
   */
  const renderMarkPanel = () => {
    const count = resultGroupCount();
    const signature = `${solverMode ? 1 : 0}|${count}|${resultActive}`;
    if (signature === markPanelSignature) return;
    const firstRender = !markPanelSignature;
    const previousCount = firstRender ? count : (Number(markPanelSignature.split('|')[1]) || count);
    // 手机端是外层上拉栏在滚，桌面端才是面板自己滚：两个位置都记下来
    const sheetBody = markPanel.closest('.panel-sheet-body');
    const previousScroll = markPanel.scrollTop;
    const previousSheetScroll = sheetBody ? sheetBody.scrollTop : 0;
    markPanelSignature = signature;
    // 增解时只让新出现的「所求 n」分组从 0 展开；减解由 removeSolution 先收该分组
    pendingNewResultGroup = (!firstRender && count > previousCount) ? `result-${count}` : null;
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
    // 内容容器：面板底色 / 位置不动，增删解只让面板高度从小变到大（或反过来）
    markPanel.innerHTML = `<div class="mark-panel-inner">${html}</div>`;
    // 重建后尽量停在原来的滚动位置（加解时内容变长，不要跳回顶部）
    const restoreScroll = () => {
      markPanel.scrollTop = previousScroll;
      if (sheetBody) sheetBody.scrollTop = previousSheetScroll;
    };
    restoreScroll();
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
  /**
   * 内容收缩时同步带动滚动位置 过程函数
   * 面板已经滚到底部、内容又突然变短时，浏览器会立刻把 scrollTop 裁到新的最大值，
   * 画面会闪一下。这里让 scrollTop 随着内容高度一起减小。
   * @param {HTMLElement} element 正在收缩的元素
   * @param {number} fromHeight 收缩前高度
   * @returns {Function} 停止跟随
   */
  const followShrinkScroll = (element, fromHeight) => {
    const hosts = [markPanel, markPanel.closest('.panel-sheet-body')].filter(Boolean);
    if (!hosts.length) return () => {};
    const starts = hosts.map(host => host.scrollTop);
    let running = true;
    const step = () => {
      // 面板在动画途中被重建时元素已脱离文档，循环要自己停掉
      if (!running || !element.isConnected) {
        running = false;
        return;
      }
      const current = element.getBoundingClientRect().height;
      const shrink = Math.max(0, fromHeight - current);
      hosts.forEach((host, index) => {
        const target = Math.max(0, starts[index] - shrink);
        if (Math.abs(host.scrollTop - target) > 0.5) host.scrollTop = target;
      });
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    return () => { running = false; };
  };
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
    // 列表本身也做高度动画：标记 / 取消标记一个对象时，列表平滑变长 / 变短。
    // 第一次填内容（面板刚重建）不播，避免和新增解分组动画叠加。
    const listReady = list.dataset.markReady === '1';
    const listFrom = list.getBoundingClientRect().height;
    list.innerHTML = (gridRow + rows) || `<li class="empty">${t('board.markEmpty')}</li>`;
    list.dataset.markReady = '1';
    const listTo = list.getBoundingClientRect().height;
    if (listReady && listFrom > 0 && Math.abs(listTo - listFrom) > 1
      && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      list.style.overflow = 'hidden';
      const stopFollow = listTo < listFrom ? followShrinkScroll(list, listFrom) : null;
      const animation = list.animate(
        [{height: `${listFrom}px`}, {height: `${listTo}px`}],
        {duration: 160, easing: 'cubic-bezier(.4, 0, .2, 1)'}
      );
      animation.onfinish = () => {
        if (stopFollow) stopFollow();
        list.style.cssText = '';
      };
    }
  };
  /** 新解分组在列表内容填好后从 0 高度展开 */
  const animateNewResultGroup = () => {
    const key = pendingNewResultGroup;
    pendingNewResultGroup = null;
    if (!key || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const group = markPanel.querySelector(`details[data-fold="${key}"]`);
    if (!group || !group.open) return;
    const to = group.getBoundingClientRect().height;
    if (!to) return;
    group.style.overflow = 'hidden';
    group.style.height = '0px';
    group.style.opacity = '0';
    group.offsetHeight;
    const animation = group.animate(
      [{height: '0px', opacity: 0}, {height: `${to}px`, opacity: 1}],
      {duration: 180, easing: 'cubic-bezier(.4, 0, .2, 1)'}
    );
    animation.onfinish = () => { group.style.cssText = ''; };
  };
  const refreshMarks = () => {
    renderMarkPanel();
    refreshMarkEquations();
    animateNewResultGroup();
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
    // 切解只影响解编号与画布高亮；工具栏上的标记选项（判定 / 显示 / 探索）与当前解无关，
    // 不必整条重建 —— 重建会换掉节点、带来一次无谓的重排闪烁
    renderMarkSwitches();
    refreshMarkHighlight();
    refreshMarks();
    if (typeof loadGeometryElements === 'function') loadGeometryElements();
  };
  /** 增加一组解 过程函数 */
  const addSolution = () => {
    if (removingSolution) return;
    const index = resultGroupCount() + 1;
    resultSetOf(index, 'judged');
    resultSetOf(index, 'shown');
    selectSolution(index);
    notifyStorageChange('mark-goal');
  };
  /** 删除最后一组解 过程函数 */
  let removingSolution = false;
  const removeSolution = () => {
    const count = resultGroupCount();
    if (count <= 1 || removingSolution) return;
    const proceed = () => {
      removingSolution = false;
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
    // 让「所求 n」这一行自己收起来，而不是整块面板从「所求」那一行开始移动
    const group = markPanel.querySelector(`details[data-fold="result-${count}"]`);
    if (group && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const from = group.getBoundingClientRect().height;
      if (from > 0) {
        removingSolution = true;
        group.style.overflow = 'hidden';
        const stopFollow = followShrinkScroll(group, from);
        const animation = group.animate(
          [{height: `${from}px`, opacity: 1}, {height: '0px', opacity: 0}],
          {duration: 180, easing: 'cubic-bezier(.4, 0, .2, 1)'}
        );
        animation.onfinish = () => {
          stopFollow();
          group.style.cssText = '';
          proceed();
        };
        return;
      }
    }
    proceed();
  };
  // 标记工具：标记给定（给定 / 带标签给定 / 可移动点）与标记所求（所求判定 / 所求显示）
  const markTools = [
    {
      tool: 'given', labelKey: 'board.markInitial', templateId: 'markInitial', actionKey: 'mark-initial', cssClass: 'mark-initial',
      options: [
        // 选项不要和上一级的总按钮共用 actionKey：移动端信息栏按 data-action 取文案，
        // 共用就会把「标记给定 / 标记所求」的总说明当成这个选项的说明
        {key: 'initial', templateId: 'markInitial', actionKey: 'mark-given', labelKey: 'board.markGiven'},
        {key: 'named', templateId: 'markNamed', actionKey: 'mark-named', labelKey: 'board.markNamed'},
        {key: 'movepoints', templateId: 'markMovepoints', actionKey: 'mark-movepoints', labelKey: 'board.markMovepoints'},
      ].filter(option => !solverMode || option.key === 'initial'),
    },
    {
      tool: 'goal', labelKey: 'board.markResult', templateId: 'markResult', actionKey: 'mark-result', cssClass: 'mark-result',
      options: [
        {key: 'result', templateId: 'markResult', actionKey: 'mark-result-judge', labelKey: 'board.markResultJudge'},
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
    // 标记选项之间切换时用 FLIP：相同的选项留在原地，新选项淡入；
    // 不再做 display:none → flex 的往返（会闪一下）
    flipChildren(toolbar, () => {
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
          // stopPropagation 会挡掉 window 上的 mobile info（showInformationMobile），这里补一次；
          // 桌面端它自己会按 widthTypeEquipment 直接返回
          if (typeof showInformationMobile === 'function') showInformationMobile(event);
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
    }, {key: element => element.dataset.action});
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
    if (solverMode || (marking !== 'result' && marking !== 'resultShown')) {
      switches.innerHTML = '';
      return;
    }
    // 先保证可见，再 FLIP：留下的编号 / +/− 滑到新位置，新出现的编号淡入；
    // 不再做 display:none → flex 的强制回流（那一下会闪，手机上尤其明显）
    switches.style.display = 'flex';
    // 上一次的收缩动画还没结束就又被重新渲染：先清掉
    switches.querySelectorAll('.is-collapsing').forEach(element => element.remove());
    // 标记模式下这里只应该有解编号 / + / −；从工具模式切过来时先清掉工具按钮
    [...switches.children].forEach(element => { if (!element.dataset.solution) element.remove(); });
    const count = resultGroupCount();
    // 按目标顺序列出要保留 / 新建的按钮。已经存在的按钮直接复用同一个 DOM 节点，
    // 这样平移的是整个按钮（含图标 / 文字 / 边框），不会出现「删掉一个键、再把文字换掉」的错觉。
    const wanted = [];
    for (let index = 1; index <= count; index++) {
      wanted.push({
        key: `goal-select-${index}`,
        label: String(index),
        action: 'goal-select',
        active: index === resultActive,
        onClick: () => selectSolution(index),
      });
    }
    wanted.push({key: 'goal-add', label: '+', action: 'goal-add', active: false, onClick: addSolution});
    if (count > 1) {
      wanted.push({key: 'goal-remove', label: '−', action: 'goal-remove', active: false, onClick: removeSolution});
    }
    const wantedKeys = new Set(wanted.map(item => item.key));
    const existing = new Map([...switches.children].map(element => [element.dataset.solution, element]));
    const removedKeys = [...existing.keys()].filter(key => !wantedKeys.has(key));
    const removedNumbers = removedKeys.filter(key => key.startsWith('goal-select-'));
    // 只在「正好删掉一个编号（以及可能同时收掉 −）」时走收缩动画；
    // 其它情况（例如外部载入快照一次少了好几组）仍整条重建
    const removedNumber = removedNumbers.length === 1
      && removedKeys.every(key => key === removedNumbers[0] || key === 'goal-remove')
      ? removedNumbers[0] : null;

    // 减解：被删的编号原地**收缩 + 淡出**，+ / − 作为同一颗按钮被布局带着滑过去；
    // 不再让它瞬间消失，也不做幽灵叠影（叠影会看起来像换了文字）
    if (removedNumber) {
      const button = existing.get(removedNumber);
      button.classList.add('is-collapsing');
      button.style.pointerEvents = 'none';
      wanted.forEach(item => {
        const element = existing.get(item.key);
        if (element) {
          element.classList.toggle('active', item.active);
        } else {
          switches.insertBefore(solutionButton(item.label, item.action, item.key, item.active, item.onClick), button);
        }
      });
      // 解的个数回到 1 时，− 按钮直接收掉（它在最右，不影响别的按钮）
      if (!wantedKeys.has('goal-remove')) existing.get('goal-remove')?.remove();
      const width = button.getBoundingClientRect().width;
      // 编号之间还有一段 flex gap：宽度收到 0 后这段 gap 仍在，+ / − 会停在偏右 5px 的地方，
      // 等按钮移除才瞬移。这里同时把右侧 gap 收成 0（负 margin），结束时正好落在最终位置。
      const gap = parseFloat(getComputedStyle(switches).columnGap) || 0;
      button.style.overflow = 'hidden';
      button.style.flexShrink = '0';
      button.style.width = `${width}px`;
      void button.offsetWidth;
      const animation = button.animate(
        [
          {width: `${width}px`, marginRight: '0px', opacity: 1},
          {width: '0px', marginRight: `-${gap}px`, opacity: 0},
        ],
        {duration: 180, easing: 'cubic-bezier(.2, 0, .2, 1)', fill: 'forwards'}
      );
      animation.finished.then(() => button.remove()).catch(() => button.remove());
      return;
    }

    // 加解 / 只切换选中态：FLIP 平移留下的按钮，新编号淡入
    flipChildren(switches, () => {
      const fragment = document.createDocumentFragment();
      wanted.forEach(item => {
        let button = existing.get(item.key);
        if (button) {
          // 复用：只更新选中态，文字与点击回调都不动
          button.classList.toggle('active', item.active);
        }else{
          button = solutionButton(item.label, item.action, item.key, item.active, item.onClick);
        }
        fragment.appendChild(button);
      });
      // 不再需要的按钮先留在容器里，flipChildren 会给它们做原地淡出
      [...switches.children].forEach(element => {
        if (!wantedKeys.has(element.dataset.solution)) element.remove();
      });
      switches.appendChild(fragment);
    }, {key: element => element.dataset.solution, leave: false});
  };
  /**
   * 加入标记工具 过程函数
   * 按钮放在顶部菜单栏（#menu_toolbar）里，选项填在 #floating-bar-buttons
   */
  const addMarkTools = () => {
    const toolbar = document.getElementById('menu_toolbar');
    if (!toolbar || toolbar.querySelector('[data-marking]')) return;
    // 标记工具收进一个容器：桌面端照旧排在菜单栏里；手机端由 index.css 把它 fixed 到
    // 屏幕右侧（与左侧的「已标记对象」圆形按钮相对）
    const box = document.createElement('div');
    box.id = 'mark-toolbar';
    box.className = 'mark-toolbar';
    const divider = document.createElement('div');
    divider.className = 'tool-separator';
    box.appendChild(divider);
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
        // 移动模式下选中的图形要取消选中：那一箱选中是「移动工具缓存」，
        // 切到标记模式后浮动栏已变成标记相关按钮，留着选中会与标记操作互相打架
        // （这里不调 refreshToolFloating：标记模式下浮动栏归 mark switches 管，重刷会把它冲掉）
        if (typeof geometryManager !== 'undefined' && geometryManager
          && typeof geometryManager.deleteTool === 'function') {
          geometryManager.deleteTool('move');
        }
        renderMarkOptions();
        // 回到「标记所求」这一层时，所求相关的图形统统标金
        refreshMarkHighlight();
        drawContent();
      });
      box.appendChild(button);
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
    box.appendChild(clearButton);
    toolbar.appendChild(box);
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
  /**
   * 截图 过程函数
   * 只截画板那一块 canvas（所有面板 / 工具栏都是独立 DOM 覆盖层、不在 canvas 内，天然不含 UI），
   * 按当前视角与像素分辨率导出 PNG。文件名：关卡游玩用「关卡 id_年-月-日-时-分-秒」，其余用模式名
   */
  const captureBoardImage = () => {
    const canvas = document.getElementById('canvas_id1');
    if (!canvas || typeof canvas.toDataURL !== 'function') return;
    const pad = value => String(value).padStart(2, '0');
    const now = new Date();
    const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
      + `-${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
    const name = mode === 'level' ? `${params.get('id') || 'level'}_${stamp}` : `${mode}_${stamp}`;
    // 关卡游玩：L / E 步数是独立 DOM（不在画板 canvas 内），直接导 canvas 会丢掉，
    // 这里把画板复制到一张同样尺寸的画布上，把当前 L/E 直接写在图上底部居中（不另加白条，
    // 免得像把底下线条截断）；描一圈淡白光晕保证压在深色图形上也看得清。复制而非改动原画布，
    // 否则文字会残留在屏幕上直到下次重绘
    let imageCanvas = canvas;
    if (mode === 'level' || mode === 'maker-play') {
      const composed = document.createElement('canvas');
      composed.width = canvas.width;
      composed.height = canvas.height;
      const ctx = composed.getContext('2d');
      ctx.drawImage(canvas, 0, 0);
      const movesText = (document.getElementById('moves')?.textContent || '').trim();
      if (movesText) {
        const fontSize = Math.max(20, Math.round(canvas.height * 0.035));
        ctx.font = `${fontSize}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = 'rgba(255, 255, 255, 0.9)';
        ctx.shadowBlur = Math.round(fontSize * 0.5);
        ctx.fillStyle = '#191919';
        ctx.fillText(movesText, composed.width / 2, composed.height - fontSize);
      }
      imageCanvas = composed;
    }
    const link = document.createElement('a');
    link.href = imageCanvas.toDataURL('image/png');
    link.download = `${name}.png`;
    link.click();
    if (typeof boardToast === 'function') boardToast(t('board.screenshotSaved'));
  };
  // 菜单：与导入导出共用同一套「按钮 + 弹层」实现
  const menuItems = [
    { label: t('board.construct'), templateId: 'menuConstruct', actionKey: 'switch-construct', action: () => menuChoice('switch-construct') },
    { label: t('board.overview'), templateId: 'menuOverview', actionKey: 'switch-overview', action: () => menuChoice('switch-overview') },
    { label: t('board.screenshot'), templateId: 'capture', actionKey: 'screenshot', action: captureBoardImage },
    { label: t('board.clearCanvas'), templateId: 'menuClearCanvas', actionKey: 'clear-canvas', action: () => menuChoice('clear-canvas') },
    { label: t('board.help'), templateId: 'help', actionKey: 'help', action: helpDialog },
  ];
  // 历史记录：试玩模式（maker-play）不进菜单 —— 试玩只是预览自己做的关卡，
  // 记录该由关卡游玩那份负责（两者共用同一份记录清单，见 recordStore.js）
  // 入群题不提供历史记录功能（菜单里不进「记录」，也不自动保存）；否则在 mode==='level' 下会照常出现
  if (mode !== 'maker-play' && !window.quizMode) {
    menuItems.splice(2, 0, { label: t('board.record'), templateId: 'menuRecord', actionKey: 'switch-record', action: () => menuChoice('switch-record') });
  }
  if (mode === 'level' && !window.quizMode && typeof designMode === 'function') menuItems.push({ label: t('board.designMode'), templateId: 'menuDesign', actionKey: 'design-mode', action: () => menuChoice('design-mode') });
  if (mode === 'level' && !window.quizMode) {
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
  if (mode !== 'maker' && mode !== 'solver' && !window.quizMode) menuItems.push({
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
    cancelButton.addEventListener('click', () => dismissMask(mask));
    const confirmButton = document.createElement('button');
    confirmButton.type = 'button';
    confirmButton.className = 'main-button';
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
      if (generateGrid(columns, gridRows, size)) dismissMask(mask);
      else hint.textContent = t('board.gridFailed');
    });
    actions.appendChild(confirmButton);
    actions.appendChild(cancelButton);
    mask.addEventListener('click', event => { if (event.target === mask) dismissMask(mask); });
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
      // 试玩往返：把当前基线一并存下，试玩返回制题器后还原，已有内容（含用户作图）不算初始内容
      try { sessionStorage.setItem('boardBaseline', (typeof window.__boardGetBaselineSnapshot === 'function' ? window.__boardGetBaselineSnapshot() : '') || ''); } catch (e) {}
      if (typeof dataTransfer === 'function' && !transferToTestPlay()) {
        boardToast(t('board.testPlayFailed'));
        return;
      }
      // 把自己这条历史记录改写成带 restore=1 的地址：这样点「返回」或浏览器后退都能还原编辑状态。
      // from 要一起带上：试玩返回制题器后，返回按钮还得知道最初是从哪个界面进来的（否则会退回首页）
      const keepFrom = params.get('from') ? '&from=' + encodeURIComponent(params.get('from')) : '';
      history.replaceState(null, '', './board.html?mode=maker&restore=1' + keepFrom);
      window.__boardSuppressUnload = true; // 试玩切画板：不算离开，放行 beforeunload
      location.href = './level.html?mode=maker-play' + keepFrom;
    }, { templateId: 'testPlay', actionKey: 'switch-to-play' });
  } else if (mode === 'solver') {
    solverPanel();
  }
  // from：从关卡游玩 / 试玩跳过来时带着来处地址，返回按钮就回到那个界面并还原图形
  const backFrom = params.get('from');
  const backLabel = backFrom ? t('board.backPrevious') : mode === 'level' ? (window.quizMode ? t('board.backQuiz') : t('board.backPack')) : mode === 'maker-play' ? t('board.backMaker') : t('board.backHome');
  const backActionKey = backFrom ? 'return-to-previous' : mode === 'level' ? 'return-to-pack' : mode === 'maker-play' ? 'return-to-maker' : 'return-to-home';
  // 返回按钮排在更多栏所有按钮的最后，显示在最右侧
  // 试玩返回制题器要带 restore=1：不带的话进入制题器会清空 elements 等本地数据，制题器里的图形就没了
  // —— 离开确认框（本段）只做两件事：① 点「返回」键时若确实改过就弹一次自定义确认；
  // ② 浏览器后退 / 关闭 / 刷新用 beforeunload 拦一下。不改动任何跳转地址、传参或历史恢复逻辑。
  // 「有没有改过」= 当前画布内容快照 与 刚进本页时的基线 是否不同；光点了画布（平移 / 没作出东西）
  // 不算改过。基线在内容异步载入期间用 storage 事件不断追平（__pageReady 就绪时再追一次），
  // 一旦用户在画布上动了手就冻结基线，之后的改动才会被识别。
  let __boardBaseline = null;
  let __boardBaselineLocked = false;   // 由「返回上一画板」的还原流程锁住：别再用还原后的内容覆盖基线
  let __boardUserActed = false;
  const __boardSnapshot = () => {
    try {
      // 关卡游玩有普通 / 探索两套管理器，且当前活动的可能是探索那套：
      // 快照要把两套都算进去，否则在探索时判「改过没」只看到探索内容，基线比不一致
      if (typeof geometryManagerResult !== 'undefined' && typeof geometryManagerExplore !== 'undefined') {
        return JSON.stringify({ r: geometryManagerResult.toStorage(), e: geometryManagerExplore.toStorage() });
      }
      return JSON.stringify(geometryManager.toStorage());
    } catch (e) { return null; }
  };
  const __boardCapture = () => {
    if (__boardUserActed || __boardBaselineLocked) return;
    const s = __boardSnapshot();
    if (s !== null) __boardBaseline = s;
  };
  const __boardChanged = () => {
    if (__boardBaseline === null) return true;
    return __boardSnapshot() !== __boardBaseline;
  };
  // 供「返回上一画板」的还原流程复用：离开时把基线快照随备份带走，回来时再交回来，
  // 这样还原出来的已有内容（含用户作图）不会被当成初始内容，下次退出仍会提示。
  // 不参与「保存图形 / 步数 / 撤销历史」的还原 —— 只是把「刚进页面时的基线」原样延续。
  window.__boardGetBaselineSnapshot = () => __boardBaseline;
  window.__boardUseRestoredBaseline = (snapshot) => {
    if (typeof snapshot === 'string' && snapshot.length) {
      __boardBaseline = snapshot;
      __boardBaselineLocked = true;
    }
  };
  __boardCapture();
  window.addEventListener('load', __boardCapture);
  setTimeout(__boardCapture, 600);
  setTimeout(__boardCapture, 2500);
  window.addEventListener('storage', () => { if (!__boardUserActed) __boardCapture(); });
  if (window.__pageReady && typeof window.__pageReady.then === 'function') window.__pageReady.then(__boardCapture);
  ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => {
    window.addEventListener(ev, (e) => {
      if (e.target && e.target.closest && e.target.closest('button,a,input,select,textarea,.panel,.popup,[data-no-draw]')) return;
      __boardUserActed = true;
    }, { capture: true });
  });
  // 返回按钮排在更多栏所有按钮的最后，显示在最右侧
  // 试玩返回制题器要带 restore=1：不带的话进入制题器会清空 elements 等本地数据，制题器里的图形就没了
  // 返回目标：原样沿用既有跳转（from / restore / restorePlay / page / 入群题 等一概照旧），
  // 不前进式 push、也不 history.back()，保持进入画板前的地址与传参不变。
  const __boardBackTarget = () => {
    const isQuizPlay = window.quizMode && new URLSearchParams(location.search).get('q');
    const fromParam = backFrom ? '&from=' + encodeURIComponent(backFrom) : '';
    const pageParam = params.get('page') ? '&page=' + encodeURIComponent(params.get('page')) : '';
    return isQuizPlay ? './ruqunti.html'
      : (backFrom && mode !== 'maker-play') ? backFrom
      : mode === 'level' ? './pack.html?pack=' + encodeURIComponent(params.get('pack')) + pageParam
      : mode === 'maker-play' ? './board.html?mode=maker&restore=1' + fromParam
      : '../index.html';
  };
  // 应用内按钮触发的跳转（返回 / 切画板）都置「主动离开」标记让 beforeunload 放行：只动这个标记，
  // 不动跳转地址与参数
  const __boardLeaveTo = (url) => { window.__boardSuppressUnload = true; location.href = url; };
  add(backLabel, () => {
    // 只有「确实改过」才弹一次确认；没改过直接走。确认与直接走都走同一套原样跳转
    if (!__boardChanged()) { __boardLeaveTo(__boardBackTarget()); return; }
    boardConfirm(t('board.backConfirm'), '', () => __boardLeaveTo(__boardBackTarget()), () => { window.__boardSuppressUnload = false; });
  }, { templateId: 'back', actionKey: backActionKey });
  // 浏览器「后退 / 关闭 / 刷新 / 输入地址跳转」等离开：用 beforeunload 拦截；
  // 应用内按钮跳转已置 __boardSuppressUnload 放行，所以只有浏览器自身的后退在这里弹原生确认
  window.addEventListener('beforeunload', (e) => {
    if (window.__boardSuppressUnload) return;
    if (!__boardChanged()) return;
    e.preventDefault();
    e.returnValue = '';
  });
  if (mode === 'maker' || mode === 'solver') {
    // 收进底部上拉栏，画布上只留一个圆形按钮（见 addSideButton）
    // （面板里的各分组默认展开与否见 renderMarkPanel 的 foldOpened；上拉栏本身仍是收起的）
    addSideButton('mark', markSideIcon(), t('board.markedTitle'), wrapInSheet(markPanel, t('board.markedTitle')));
    refreshMarks();
  }
  // 求解器里「求解参数」按钮是先于「标记」按钮创建的，这里把顺序换过来：
  // 上边是标记、下边是求解参数（与制题器一致），最下面是关系雷达
  if (mode === 'solver') {
    const sideBox = document.getElementById('side-buttons');
    const solverSideButton = document.getElementById('side-button-solver-params');
    const radarSideButton = document.getElementById('side-button-radar');
    if (sideBox && solverSideButton) sideBox.appendChild(solverSideButton);
    // 关系雷达紧跟在求解参数下面（上拉栏是纵向排列，DOM 次序就是上下次序）
    if (sideBox && radarSideButton) sideBox.appendChild(radarSideButton);
  }
  // 关卡游玩：LE 计数器放在返回按钮下方（返回按钮此时已就位）
  if (typeof updateMovesCounterPosition === 'function') updateMovesCounterPosition();
  // 关卡游玩：缩略图与顶部更多栏的左右避让（返回按钮此时也已就位）
  if (typeof updateLevelThumbnailLayout === 'function') updateLevelThumbnailLayout();
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
  /**
   * 电脑端快捷键 过程函数
   * Ctrl/Cmd+Z 撤回、Ctrl/Cmd+Shift+Z 或 Ctrl/Cmd+Y 重做、Ctrl/Cmd+S 保存记录、
   * 移动工具下 Ctrl/Cmd+A 全选（多选用「按住 Ctrl 点」）、Delete / Backspace 删除选中的图形。
   * 正在输入框里打字（记录命名、坐标输入…）时一律让路，否则「撤回」会把输入内容吃掉
   */
  (() => {
    const isTyping = target => !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'
      || target.tagName === 'SELECT' || target.isContentEditable);
    const MOVE_KEYS = ['choice', 'choice2', 'choice3', 'choice4', 'choice5', 'choice6', 'choice7', 'choice8'];
    const selectedOfMove = () => {
      const dict = (typeof geometryManager !== 'undefined' && geometryManager.choice)
        ? geometryManager.choice['move'] : null;
      if (!dict) return [];
      return Object.values(dict)
        .filter(entry => entry && entry.type === 'quote')
        .map(entry => geometryManager.get(entry.quote))
        .filter(Boolean);
    };
    // 全选：画布上所有可见对象（网格不参与 —— 它是一整块背景，选中它没有意义）
    const selectAll = () => {
      if (typeof tool !== 'string' || tool !== 'move') return false;
      geometryManager.deleteTool('move');
      let index = 0;
      geometryManager.getAllByOrder().forEach(item => {
        if (!item.getValid() || !item.getVisible()) return;
        if (typeof isGridId === 'function' && isGridId(item.getId())) return;
        const key = MOVE_KEYS[index] || `choice${index + 1}`;
        geometryManager.addToolObject('move', key, 'quote', item.getId());
        index += 1;
      });
      return index > 0;
    };
    window.addEventListener('keydown', event => {
      if (isTyping(event.target)) return;
      const key = String(event.key || '').toLowerCase();
      // Delete / Backspace：删除选中的图形（多选一起删）。走「删除选中对象」按钮同一条路 ——
      // 关卡自带图形的保护、撤销历史、步数退回都在那边处理，这里不重复一套
      if (key === 'delete' || key === 'backspace') {
        if (event.altKey || event.ctrlKey || event.metaKey) return;
        // 只有移动工具的选中栏才算「选中了图形」：作图工具里的 choice 是「这一笔已经点到的点」，
        // 删它没有意义（半成品用撤销 / 取消）
        if (typeof tool !== 'string' || tool !== 'move') return;
        if (!selectedOfMove().length) return;
        // Backspace 在部分浏览器里是「返回上一页」，一定要拦下来
        event.preventDefault();
        if (typeof clickToolFloatingButton === 'function') clickToolFloatingButton('deleteObject');
        return;
      }
      const accel = event.ctrlKey || event.metaKey;
      if (!accel || event.altKey) return;
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        if (typeof restoreStorage === 'function') restoreStorage();
        return;
      }
      if (key === 'y' || (key === 'z' && event.shiftKey)) {
        event.preventDefault();
        if (typeof redoStorage === 'function') redoStorage();
        return;
      }
      if (key === 's') {
        // 别弹出浏览器的「保存网页」：这儿存的是记录面板里那一条
        event.preventDefault();
        const button = document.getElementById('record-button-add');
        if (button && !button.disabled) button.click();
        return;
      }
      if (key === 'a' && selectAll()) {
        event.preventDefault();
        drawContent();
        if (typeof refreshToolFloating === 'function') refreshToolFloating();
      }
    });
    // 供外部（探针 / 调试）查一下当前选中栏里都选了谁
    window.moveSelectedElements = () => selectedOfMove().map(item => item.getId());
  })();
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
      if (type === 'circle') {
        const baseType = element.getBase?.()?.type;
        if (baseType === 'semicircle') return t('board.objectSemicircle');
        if (baseType === 'arc' || baseType === 'arc3') return t('board.objectArc');
        return t('board.objectCircle');
      }
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
      // 与点击同一份口径（点优先，见 markTargetAt）：悬停提示显示的就是这一下会标中的对象
      const id = markTargetAt((x - transform.x) / transform.scale, (y - transform.y) / transform.scale);
      return id ? geometryManager.get(id) : null;
    };
    const refresh = (clientX, clientY) => {
      if (panning) {
        canvasElement.style.cursor = 'grabbing';
        tip.hidden = true;
        return;
      }
      const element = hoveredElement(clientX, clientY);
      // 移动工具与标记模式下浮出对象信息（marking 是制题器 / 求解器的标记状态）。
      // 游玩模式（关卡游玩 / 试玩）里移动工具不提示：那是作图时看对象用的，
      // 关卡里多一层浮层既挡图形又容易和题目说明打架（光标形状照旧变化，能看到"指到了什么"）
      const hoverTipAllowed = !(typeof isPlayMode === 'function' && isPlayMode());
      const moving = marking !== null
        || (hoverTipAllowed && typeof tool === 'string' && tool === 'move');
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
      // 游玩模式的隐藏刷：光标下没有对象时用普通三角形箭头，而不是四向箭头 ——
      // 隐藏刷不是在拖画布，四向箭头会让人误以为可以平移
      const playHideBrush = typeof window.playHideBrushMode === 'function' && window.playHideBrushMode();
      if (element) {
        canvasElement.style.cursor = 'pointer';
      }else if (playHideBrush) {
        canvasElement.style.cursor = '';
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
      // 半径内离这个位置最近的已有点（各处口径统一：near 的默认吸附半径 15px）
      const pointNear = (x, y) => {
        const id = geometryManager.near([x, y], ['point'], 1)[0];
        if (!id) return null;
        const coord = geometryManager.get(id).getCoordinate();
        return {x: coord[0], y: coord[1], distance: Math.hypot(coord[0] - x, coord[1] - y)};
      };
      /**
       * 在某个位置按下时**最终会落在哪个对象上** 过程函数
       * 与 board 的点击链完全同一套先后关系：snapCursorPosition（本函数）→
       * revealHiddenIntersectionAtClick → 工具取点，三处都用 15px 半径，
       * 所以这里也必须**从落点量**、按同样的先后折算：
       *   · 落点半径内已有别的点 → 工具引用它（钩子也不会在交点处造点）
       *   · 否则落点半径内有裸交点 → 钩子在交点处造点，工具随即引用它
       * 少了这一层，只按「光标」判一次的话，光标一偏（哪怕仍在交点四周 15px 内），
       * 预览吸在交点上、按下去却落到了交点的吸附半径里那个已有点（`A`）上
       */
      // 隐藏点（图形的定义点、预绘制的解）只有**点工具**会真的用上：它压在隐藏点上就把它显示出来
      // （见 geometryToolBag.js 的 revealHiddenPoint 与 PointTool.createPoint），其它工具取点时
      // 用的都是可见对象。游玩模式里连点工具都不翻隐藏点。这些场合都不该把预览吸到隐藏点上 ——
      // 吸过去而按下去却在旁边新造一个点，比不吸更糟
      const takesHiddenPoint = () => typeof tool === 'string' && tool === 'point'
          && !(typeof isPlayMode === 'function' && isPlayMode());
      const landingPickOf = (x, y) => {
        // 「附近的点」这一档，按距离取最近的：已有点、还没显示出来的隐藏点、相交的位置
        // （三者在同一档里比距离；点整体先于线 / 圆，见 geometry.js 的 near）
        const candidates = [];
        const point = pointNear(x, y);
        if (point) candidates.push({x: point.x, y: point.y, distance: point.distance, kind: 0});
        // 隐藏点：near 看不见它们（跳过不可见对象），点工具点上去会把它显示出来，
        // 预览也得能吸过去，否则「预览吸在这儿、按下去却是旁边另一个对象」
        if (takesHiddenPoint() && typeof nearestHiddenPoint === 'function') {
          const hidden = nearestHiddenPoint(x, y);
          const coord = hidden?.getCoordinate?.();
          if (coord) {
            candidates.push({
              x: coord[0], y: coord[1],
              distance: Math.hypot(coord[0] - x, coord[1] - y), kind: 1,
            });
          }
        }
        const intersection = geometryManager.nearestIntersection(x, y);
        if (intersection) {
          // 「交点的吸附半径里已经有点」只在触屏上算（见 geometryToolBag.js 的 revealHiddenIntersection）：
          // 鼠标下交点照用，触屏下则取那个点 —— 两边条件必须一模一样，否则预览与落点又会错开
          const shadow = typeof pointerIsTouch === 'function' && pointerIsTouch()
              ? pointNear(intersection.x, intersection.y) : null;
          const target = shadow
              ? {x: shadow.x, y: shadow.y, distance: shadow.distance, kind: 0}
              : {x: intersection.x, y: intersection.y, distance: intersection.distance, kind: 2};
          candidates.push(target);
        }
        if (!candidates.length) return null;
        // 造点场合：光标处已有点时**直接用那个点**，即使极近处还有个相交位置也忽略 ——
        // 否则交点只比已有点近一点点，就会在已有点的位置上再造一个几乎重合的交点。
        // 所以两者距离差在这个容差内（差不多重合）时取更「实」的那个：已有点 → 隐藏点 → 交点位置。
        // 容差不能大到反客为主：明显更远的已有点仍要输给更近的交点，否则想标交点时会被远处的点挡住。
        const tie = 3 / transform.scale;
        candidates.sort((one, two) => Math.abs(one.distance - two.distance) < tie
            ? one.kind - two.kind
            : one.distance - two.distance);
        return candidates[0];
      };
      let best = landingPickOf(logicalX, logicalY);
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
          // 投影处也按「按下会落在哪」折算一遍：那儿若已有别的点、或钩子会顺手造出交点，
          // 落点就不是投影位置本身了 —— 预览直接显示最终落点，免得按下时又偏出几像素
          if (on) best = landingPickOf(on.x, on.y)
              || {x: on.x, y: on.y, distance: Math.hypot(on.x - logicalX, on.y - logicalY)};
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
      // 游玩模式的「隐藏刷」挂在移动工具上：它也是「点一下就把它藏起来」，
      // 坐标同样该吸附到附近的图形上（与非游玩模式的隐藏刷手感一致），所以这时不排除 move
      const hideBrush = typeof window.playHideBrushMode === 'function' && window.playHideBrushMode();
      if (typeof tool === 'undefined' || tool === 'eraser' || (tool === 'move' && !hideBrush)) return [x, y];
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
          // 切线：还没选图形时下一步是「选一个图形」；先选了点时下一步还是「选圆」（不落点）——
          // 两种情况都不该画点预览。只有先选了**圆**，下一步才是「在光标处落一个点」，这时才画
          // （与平行线 / 垂线的口径一致；图形预览见 canvas.js 的 previewShapes.tangent）
          || ((tool === 'tangent' || subTool === 'tangent') && !geometryManager.getToolKey(tool, 'circle'))
          || subTool === 'twoLineAngleBisector'
          || (subTool === 'compassCopy' && !geometryManager.getToolKey(tool, 'circle'))
          // 极点极线：一开始都不显示光标点。极线像切线 —— 只有先选中了**圆**
          // （下一步才是「光标处补一个点」）才显示点预览；先选点则只等圆。
          // 极点两步都是选图形，光标点预览始终不显示（它的预览是计算出来的极点，见 canvas.js）
          || (tool === 'polePolar'
              && (subTool !== 'polarLine' || !geometryManager.getToolKey(tool, 'circle')))
          // Arc 的第三点由 canvas.js 单独画在圆周投影 / 交点位置；
          // 这里的通用光标预览点仍在原始光标下，会与它重叠成两个点。
          || (subTool === 'arc'
              && geometryManager.getToolKey(tool, 'point1')
              && geometryManager.getToolKey(tool, 'point2')
              && (
                !geometryManager.getToolKey(tool, 'point3')
                || geometryManager.getToolKey(tool, tool)
              ))
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
      // 尺寸与像素比都跟主画布**同一份**（canvasWidth/canvasHeight、canvasRatio）：
      // 各自读一次（clientWidth / devicePixelRatio）时，两者一旦不一致预览点就会偏离光标
      const width = typeof canvasWidth === 'number' ? canvasWidth : canvasElement.clientWidth;
      const height = typeof canvasHeight === 'number' ? canvasHeight : canvasElement.clientHeight;
      const dpr = typeof canvasRatio === 'number' ? canvasRatio : (window.devicePixelRatio || 1);
      if (previewCanvas.style.width !== `${width}px`) {
        previewCanvas.style.width = `${width}px`;
        previewCanvas.style.height = `${height}px`;
        previewCanvas.width = Math.round(width * dpr);
        previewCanvas.height = Math.round(height * dpr);
      }
      // 画布可能被页面滚动挪过位置（不触发 resize）：每帧都按当前位置对齐，代价只有两次属性写入
      previewCanvas.style.left = `${canvasElement.offsetLeft}px`;
      previewCanvas.style.top = `${canvasElement.offsetTop}px`;
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
      // 样式与点图形一致（外径 = POINT_RADIUS_BASE × **当前点档位** + 一半大的白芯），但整体半透明：
      // 它只是「将要落在哪里」的预览，还没有真正落下。
      // 这块画布用的是屏幕像素（只按 dpr 缩放，没乘 transform.scale），所以半径不用再除 scale
      const previewRadius = POINT_RADIUS_BASE * previewWidthOf('point');
      context.globalAlpha = 0.5;
      context.beginPath();
      context.arc(previewPoint.x, previewPoint.y, previewRadius, 0, Math.PI * 2);
      context.fillStyle = 'rgb(25, 25, 25)';
      context.fill();
      context.beginPath();
      context.arc(previewPoint.x, previewPoint.y, previewRadius / 2, 0, Math.PI * 2);
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
          context.arc(px, py, previewRadius, 0, Math.PI * 2);
          context.fillStyle = 'rgb(25, 25, 25)';
          context.fill();
          context.beginPath();
          context.arc(px, py, previewRadius / 2, 0, Math.PI * 2);
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