(function () {
  const params = new URLSearchParams(location.search);
  const pack = params.get('pack');
  const id = params.get('id');
  if (!pack || !id) return;
  const titleSuffix = ' | Geommunity Blueprint';
  // 兜底标题（按当前语言），关卡数据回来后立刻换成「关卡标题 · 包名」
  document.title = (typeof t === 'function' ? t('level.pageTitle') : '关卡游玩') + titleSuffix;
  let levelInfo;
  let packInfo;
  loadLevelsData().then(({ packs, levels }) => {
    packInfo = packs.find(item => item.id === pack);
    levelInfo = levels.find(item => item.id === id && item.pack === pack);
    if (!levelInfo) throw new Error(`Level not found: ${pack}/${id}`);
    // 标题随关卡走：先用 levels.json 的标题，不必等 gmt 下载完
    document.title = `${levelInfo.title || id}${packInfo ? ' · ' + packInfo.name : ''}${titleSuffix}`;
    return fetch(`../data/${levelInfo.file}`).then(response => response.text());
  }).then(text => {
    // gmt -> 画板几何对象（解析器与画板的「导入 gmt」共用，见 board-tools.js 的 parseGmt）
    const { elements, lists, resultGroups } = parseGmt(text);
    // result 的分组：判定对象 + 判定成功后要显示的图形（试玩/关卡共用）
    window.gmtResultGroups = resultGroups || [];
    sessionStorage.setItem('elements', JSON.stringify(elements));
    sessionStorage.setItem('geometryElementLists', JSON.stringify(lists));
    // 缩略图与页面标题的文案全部来自 levels.json（可用 levels.meta.json 覆盖）
    sessionStorage.setItem('thumbnail', JSON.stringify({ title_input: levelInfo?.title || id, body_input: levelInfo?.subtitle || 'GMT 已加载', bottom_input: levelInfo?.targetSteps || '', pictureData: levelInfo?.diagram ? `../data/${levelInfo.diagram}` : null }));

    // 关卡限定工具（levels.json 的 tools 字段）：straightedge = 单尺、compass = 单规
    window.levelTools = levelInfo.tools || null;
    if (typeof geometryManagerResult !== 'undefined') {
      Object.entries(lists).forEach(([key, value]) => { geometryElementLists[key] = new Set(value); });
      // 缩略图（点开卡片后可见）：标题 / 说明 / 本关目标 L/E 与示意图
      // 文案来自 levels.json，可用 levels.meta.json 覆盖
      // （带 pack 参数时 playStartDataLoad 会提前返回，所以这里必须自己填）
      const titleInf = document.getElementById('title_inf');
      if (titleInf && levelInfo) titleInf.textContent = levelInfo.title || id;
      const bodyInf = document.getElementById('body_inf');
      if (bodyInf && levelInfo?.subtitle) bodyInf.textContent = levelInfo.subtitle;
      const bottomInf = document.getElementById('bottom_inf');
      // 「5L / 6E」里的斜杠换成空格（缩略图那行更紧凑，也不会看着像分数）。
      // 打个标记：这行是「目标步数」，达成情况由 refreshLevelStatus 按 L / E 分别上色
      if (bottomInf && levelInfo?.targetSteps) {
        bottomInf.dataset.goalSteps = '1';
        bottomInf.textContent = levelInfo.targetSteps.replace(/\s*\/\s*/g, ' ');
      }
      loadGeometryElementsStorage();
      if (typeof fitInitialView === 'function') fitInitialView();
      drawContent();
      const image = document.getElementById('thumbnail-picture');
      if (levelInfo?.diagram && !image) {
        const picture = document.createElement('img');
        picture.id = 'thumbnail-picture';
        picture.src = `../data/${levelInfo.diagram}`;
        picture.alt = id;
        document.getElementById('thumbnail-middle').appendChild(picture);
      }
      // 从制题器 / 求解器返回：这份存档是要接着玩的，已经挣到的步数与达成记录都得留着
      const restoredPlay = typeof playBackupRestored !== 'undefined' && playBackupRestored;
      // 撤销 / 重做历史随备份一起回来了（里面本来就有关卡初始图形那一格）：别再清成「当前状态」一格，
      // 否则玩家去求解器 / 制题器之前作的图形全撤不回来
      const restoredHistory = restoredPlay && typeof playBackupHistoryRestored !== 'undefined' && playBackupHistoryRestored;
      // 关卡初始图形成为撤销/重做的新起点，避免撤销把 initial 撤掉（返回时步数不清零）
      if (!restoredHistory && typeof resetStorageHistory === 'function') resetStorageHistory(restoredPlay);
      // 缩略图下方的目标与达成情况（初始全灰；换关卡时清掉上一关的达成记录，
      // 缩略图的钩是「点亮过就不熄灭」的，所以也要在这里复位）
      if (!restoredPlay) {
        if (typeof resetLevelProgress === 'function') resetLevelProgress();
        if (typeof resetThumbnailTicks === 'function') resetThumbnailTicks();
      }
      if (typeof refreshLevelStatus === 'function') refreshLevelStatus();
      // 工具栏按本关的工具限制重建（探索模式不受限）
      if (typeof refreshToolLimit === 'function') refreshToolLimit();
    }
  }).catch(error => console.error('GMT load failed', error));
})();