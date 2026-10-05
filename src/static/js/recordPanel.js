/* recordPanel.js */
/**
 * 历史记录面板 模块（画板 / 制题器 / 求解器 / 关卡游玩共用）
 *
 * 记录的数据怎么存见 recordStore.js（gmt + undolist（一串对象行序号）+ styles + info）。
 * 这一层只管界面与「与当前作图之间的动作」：
 *   · 只显示**当前上下文**的记录：哪个模式、哪一关就只看哪里的（统一分类浏览在首页「清除缓存」）
 *   · 手动保存（左上角加号）——作了图形、且记录里没有一致的构造时才可按
 *   · 游玩模式作出所求时自动保存（recordPanelAutoSave，由 playPage 的 success 调用）——
 *     一次「作出所求」只存一条，之后再画图不再存（所求消失时由 unsuccess 调 recordPanelAutoReset 放开）
 *   · 点一条记录＝载入它（作图 + 样式表 + 按名单重建的撤销历史与步数历史）
 *   · 每条记录：序号 / 名称（保存时间，可重命名）/ 步数（达标才标金）/ 重命名 / 导出 / 删除
 *   · 左上角：加号、导入（游玩模式没有）；右上角：多选（再点变成退出多选）、关闭面板
 *   · 多选：每条前面出复选框，加号变全选，导出所选与删除所选出现
 */
(function (global) {
    const store = global.recordStore;
    const params = new URLSearchParams(location.search);
    // 与 board-tools.js 口径一致：带 pack 的是关卡游玩，否则看 mode
    const mode = params.get('pack') ? 'level' : (params.get('mode') || 'normal');
    const levelId = params.get('id');
    const isPlay = mode === 'level' || mode === 'maker-play';

    // 没有现成模板的那两个图标（加号与多选）；其余一律用页面里已有的 svg-* 模板
    const FALLBACK_ICON = {
        add: '<svg class="svg-icon" viewBox="0 0 200 200">'
            + '<line x1="30" y1="100" x2="170" y2="100" stroke-width="10" fill="transparent" stroke-linecap="round"/>'
            + '<line x1="100" y1="30" x2="100" y2="170" stroke-width="10" fill="transparent" stroke-linecap="round"/></svg>',
        check: '<svg class="svg-icon" viewBox="0 0 200 200">'
            + '<rect x="35" y="35" width="130" height="130" rx="20" fill="transparent" stroke-width="10"/>'
            + '<polyline points="65 102, 92 130, 140 70" fill="transparent" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        // 全选：三行，每行一个「√」加一短横 —— 整个列表都被勾上了
        selectAll: '<svg class="svg-icon" viewBox="0 0 200 200">'
            + '<polyline points="18 40, 38 60, 76 22" fill="transparent" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>'
            + '<line x1="94" y1="42" x2="180" y2="42" stroke-width="10" fill="transparent" stroke-linecap="round"/>'
            + '<polyline points="18 98, 38 118, 76 80" fill="transparent" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>'
            + '<line x1="94" y1="100" x2="180" y2="100" stroke-width="10" fill="transparent" stroke-linecap="round"/>'
            + '<polyline points="18 156, 38 176, 76 138" fill="transparent" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>'
            + '<line x1="94" y1="158" x2="180" y2="158" stroke-width="10" fill="transparent" stroke-linecap="round"/></svg>',
        // 退出多选：勾选框加一道斜杠，与「多选」的框 + 勾区分开
        exit: '<svg class="svg-icon" viewBox="0 0 200 200">'
            + '<rect x="35" y="35" width="130" height="130" rx="20" fill="transparent" stroke-width="10"/>'
            + '<polyline points="60 100, 88 128, 138 70" fill="transparent" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>'
            + '<line x1="42" y1="158" x2="158" y2="42" stroke-width="10" stroke-linecap="round"/></svg>',
    };

    // 多选状态
    let multi = false;
    const selected = new Set();
    // 关卡载入那一刻有哪些对象：游玩模式下「只摆了初始条件」不算作了图形（由 level-loader 调 markBaseline）
    let baseline = null;

    const panelOf = () => document.getElementById('recordPanel');
    const listOf = () => document.getElementById('storage-item-list');
    const buttonOf = id => document.getElementById(id);

    /**
     * 页面里已有的 svg 模板 过程函数
     * @param {string} name 模板名（不含 svg- 前缀）
     * @returns {string}
     */
    function iconOf(name) {
        const template = document.getElementById(`svg-${name}`);
        return template ? template.innerHTML : '';
    }

    /**
     * 当前上下文的记录范围 过程函数
     * 哪一关就只看哪一关的记录；画板 / 制题器 / 求解器各看各自模式的
     * @returns {{mode: string, levelId?: string}}
     */
    function context() {
        if (mode === 'level') return {mode: mode, levelId: levelId || ''};
        return {mode: mode};
    }

    /**
     * 画布：当前作图文本 过程函数
     * @returns {string}
     */
    function canvasGmt() {
        // 「隐藏」只记在 styles（`a@`），gmt 的 hidden= 行留空（现在导出那边也是这个口径，
        // hidden= 只作读取用）：那张样式表本来就会写 visible=false，载回来一样是隐藏的
        return global.boardGmt && typeof global.boardGmt.text === 'function' ? global.boardGmt.text() : '';
    }

    /**
     * 画布：关卡带来的对象（给定 / 隐藏 / 可移动点 / 带标签）过程函数
     * 手动保存要求「自己作了图形」，这些不算
     * @returns {Set<string>}
     */
    function givenIds() {
        const ids = new Set();
        ['initial', 'hidden', 'movepoints', 'name'].forEach(key => {
            const list = typeof geometryElementLists !== 'undefined' ? geometryElementLists[key] : null;
            if (list) list.forEach(id => ids.add(id));
        });
        return ids;
    }

    /**
     * 记下关卡载入时的对象集合 过程函数
     * 由 level-loader.js 在关卡图形铺好之后调用：游玩模式下画布上只有这些对象时不算「作了图形」
     * （关卡的预绘制解并不都登记在 initial / hidden 这些标记表里，只看标记会误判成作了图形）
     */
    function markBaseline() {
        if (typeof geometryManager === 'undefined') return;
        baseline = new Set(geometryManager.getAllByOrder().map(item => item.getId()));
    }

    /**
     * 关卡自带的那些对象 过程函数
     * 优先用关卡载入时记下的集合；还没记下时退回关卡数据里的对象 id（level-loader 存在 sessionStorage 里），
     * 这样即使 markBaseline 晚了一步，也不会把关卡的初始图形当成玩家作的图
     * @returns {Set<string>|null}
     */
    function levelObjectIds() {
        if (baseline) return baseline;
        if (!isPlay) return null;
        try {
            const raw = sessionStorage.getItem('elements');
            if (!raw) return null;
            const list = JSON.parse(raw);
            if (!Array.isArray(list)) return null;
            return new Set(list.map(item => item && item.id).filter(Boolean));
        } catch (error) {
            return null;
        }
    }

    /**
     * 画布：是否作了图形 过程函数
     * @returns {boolean}
     */
    function hasFigures() {
        if (typeof geometryManager === 'undefined') return false;
        const all = geometryManager.getAllByOrder();
        const known = levelObjectIds();
        if (known) return all.some(item => !known.has(item.getId()));
        const given = givenIds();
        return all.some(item => !given.has(item.getId()));
    }

    /**
     * 画布：当前步数 / 目标步数 / 是否作出所求 过程函数
     */
    function currentSteps() {
        if (!isPlay || typeof movesCounter === 'undefined') return null;
        return {l: movesCounter.l || 0, e: movesCounter.e || 0};
    }

    function currentTarget() {
        if (!isPlay || typeof targetStepsOfPage !== 'function') return null;
        return targetStepsOfPage();
    }

    function reachedGoal() {
        if (!isPlay) return false;
        return typeof satisfiedResultGroups !== 'undefined' && satisfiedResultGroups.length > 0;
    }

    /**
     * 画布：可撤回的图形 过程函数
     * 记的是 **gmt 里对象行的序号**（1 起数，只数对象行，与 geometryManager.getAllByOrder() 一一对应）：
     * 游玩模式只列玩家自己画的（关卡载入时就在的那些不算），其它模式列全部
     * @returns {number[]}
     */
    function undolistOf() {
        if (typeof geometryManager === 'undefined') return [];
        let known = mode === 'level' ? levelObjectIds() : null;
        // 还没记下关卡对象时退回标记表兜底：至少别把关卡的给定图形算成玩家画的
        if (mode === 'level' && !known) known = givenIds();
        const list = [];
        geometryManager.getAllByOrder().forEach((item, index) => {
            if (known && known.has(item.getId())) return;
            list.push(index + 1);
        });
        return list;
    }

    /**
     * 画布：各图形的样式表 过程函数
     * 只记与默认（黑 #191919、宽 1、点默认显示标签 / 线圆默认不显示、实线、可见）不同的项。
     * 另两条例外（见 recordStore.js 的格式说明）：
     *   · 自由模式导出时，点默认就显示标签也要写 `$`（导入到别的模式也保持一样的外观）
     *   · 游玩模式与制题器导出时，所有非给定对象都写出 `@` / `!`（显式记下显隐）
     * 隐藏的对象一定写 `@`（任何模式）：记录里 gmt 的 hidden= 行是空的，隐藏只有这一处记
     * **标记中的对象存它自己的样式**（见 boardGmt.ownStyleOf）：给定 / 所求在画布上是黑 / 金，
     * 那是标记的显示色，载入时标记会重新读出来上色，记录里不该把它当成图形的样式存下来
     * @param {number[]} [listed] 可撤回的图形（游玩模式用它认出哪些是玩家自己画的）
     * @returns {Object}
     */
    function stylesOfCanvas(listed) {
        const styles = {};
        if (typeof geometryManager === 'undefined') return styles;
        const all = geometryManager.getAllByOrder();
        // 游玩模式：名单里的就是玩家自己画的（非给定）；制题器的非给定走标记表
        const listedIds = new Set((listed || []).map(index => all[index - 1]).filter(Boolean).map(item => item.getId()));
        const given = mode === 'maker' ? givenIds() : null;
        const writesVisibility = id => {
            if (mode === 'level') return listedIds.has(id);
            if (mode === 'maker') return !given.has(id);
            return false;
        };
        // 点默认显示标签的场景（画板 / 游玩页），线 / 圆默认不显示
        const labelShownByDefault = typeof geometryStyle !== 'undefined' && geometryStyle.point && geometryStyle.point.showName !== false;
        // 标成「带标签给定」的对象，它的显示名由 gmt 的 named= 行带（named=ID.标签名），
        // 不要再记一份进 styles：那两套规则会打架（读了 named 就被当成给定）
        const namedMark = typeof geometryElementLists !== 'undefined' && geometryElementLists.named ? geometryElementLists.named : null;
        all.forEach(item => {
            const entry = {};
            const id = item.getId();
            // 网格当作一整块：它的样式只走 gmt 里的 #gridstyle= 一行，不再逐条写进记录 styles
            // （辅助对象本来就被隐藏，逐条写会写出一堆 visible=false）
            if (typeof window.isGridObjectId === 'function' && window.isGridObjectId(id)) return;
            const own = global.boardGmt?.ownStyleOf?.(id) || null;
            // 显示名与 id 不同就记下来：改名归样式，不归 named 标记
            if (!(namedMark && namedMark.has(id)) && typeof item.getName === 'function') {
                const name = item.getName();
                if (name && name !== id) entry.name = name;
            }
            const color = own ? own.color : (typeof item.getColor === 'function' ? item.getColor() : null);
            if (color && String(color).toLowerCase() !== '#191919') entry.color = color;
            // 与默认比：默认不再是 1，而是当前模式的档位 2「较小」（见 geometry.js 的 defaultElementWidth）
            const width = typeof item.getWidth === 'function' ? item.getWidth() : null;
            const defaultWidth = typeof defaultElementWidth === 'function'
                ? defaultElementWidth(typeof item.getType === 'function' ? item.getType() : 'line') : 1;
            if (typeof width === 'number' && Math.abs(width - defaultWidth) > 1e-6) entry.width = width;
            const showName = !!own ? own.showName : (typeof item.getShowName === 'function' && item.getShowName());
            const shownByDefault = typeof item.getType === 'function' && item.getType() === 'point' && labelShownByDefault;
            if (!!showName !== !!shownByDefault) entry.showName = !!showName;
            else if (showName && mode === 'normal') entry.showName = true;
            // 虚线默认关闭：只记开着的那些（标记期间也不改它，标记色与虚线互不相干）
            if (typeof item.getDashed === 'function' && item.getDashed()) entry.dashed = true;
            if (typeof item.getVisible === 'function' && !item.getVisible()) entry.visible = false;
            else if (writesVisibility(id)) entry.visible = true;
            if (Object.keys(entry).length) styles[id] = entry;
        });
        return styles;
    }

    /**
     * 关卡信息 过程函数
     * @returns {{pack: string|null, levelId: string|null, levelName: string|null}}
     */
    function levelInfo() {
        return {
            pack: params.get('pack'),
            levelId: levelId,
            levelName: (document.getElementById('title_inf')?.textContent || '').trim() || null,
        };
    }

    /**
     * 关卡缩略图那几段文本与图片 过程函数
     * @returns {Object|null}
     */
    function thumbnailOf() {
        if (!isPlay) return null;
        const textOf = id => {
            const value = document.getElementById(id)?.textContent;
            return value ? value : null;
        };
        return {
            title_input: textOf('title_inf'),
            body_input: textOf('body_inf'),
            bottom_input: textOf('bottom_inf'),
            thumbnailSrc: document.getElementById('thumbnail-picture')?.src || null,
        };
    }

    /**
     * 组装一条新记录 过程函数
     * @param {{saved: string, name?: string, gmt?: string, undolist?: Object, styles?: Object, info?: Object}} options
     * @returns {Object}
     */
    function buildRecord(options) {
        const now = store.now();
        // 关卡名与目标步数都按 levelId 反查，不再另存（见 recordStore.js 的格式说明）
        const info = Object.assign({
            mode: mode,
            pack: null,
            levelId: null,
            levelName: null,
            reached: reachedGoal(),
            steps: currentSteps(),
            target: null,
        }, isPlay ? levelInfo() : {}, options.info || {});
        const undolist = options.undolist !== undefined ? options.undolist : undolistOf();
        return {
            id: store.nextRecordId(),
            name: options.name || now.name,
            time: options.time || now.time,
            info: info,
            gmt: options.gmt !== undefined ? options.gmt : canvasGmt(),
            undolist: undolist,
            // 样式表要看「哪些是玩家画的」才能决定要不要写显隐，所以把名单一起给它
            styles: options.styles !== undefined ? options.styles : stylesOfCanvas(Array.isArray(undolist) ? undolist : null),
            thumbnail: isPlay ? thumbnailOf() : null,
        };
    }

    /**
     * 保存当前作图 过程函数
     * @param {'auto'|'manual'} saved
     * @param {boolean} [silent] 自动保存时不弹提示
     * @returns {Object|null} 保存下来的记录
     */
    function saveCurrent(saved, silent) {
        const gmt = canvasGmt();
        if (!gmt || !hasFigures()) {
            if (!silent) global.boardToast?.(t('board.recordNothing'));
            return null;
        }
        if (store.findSameRecord(gmt, context())) {
            if (!silent) global.boardToast?.(t('board.recordExists'));
            return null;
        }
        const dict = buildRecord({saved: saved});
        dict.saved = saved;
        if (!store.putRecord(dict)) {
            if (!silent) global.boardToast?.(t('board.recordFailed'));
            return null;
        }
        refresh();
        if (!silent) global.boardToast?.(t('board.recordSaved'));
        return dict;
    }

    /**
     * 按记录里的隐藏标记收起对象 过程函数
     * gmt 载入时所有对象都会显示（作图时要看得见），这里再按 hidden 表收回去 ——
     * 关卡里预绘制的解就靠它保持隐藏
     */
    function applyHiddenList() {
        if (typeof geometryManager === 'undefined') return;
        const hidden = typeof geometryElementLists !== 'undefined' ? geometryElementLists.hidden : null;
        geometryManager.getAllByOrder().forEach(item => {
            const base = typeof item.getBase === 'function' ? item.getBase() : null;
            if (base && base.type === 'edgePoint') {
                item.modifyVisible(false);
                return;
            }
            // 网格当作一整块：显隐由 #grid= 决定（辅助对象藏、格线显示），hidden 名单管不着
            if (typeof window.isGridObjectId === 'function' && window.isGridObjectId(item.getId())) return;
            item.modifyVisible(!(hidden && hidden.has(item.getId())));
        });
    }

    /**
     * 按记录里的样式表上色 / 调粗细 / 开关标签与隐藏 / 开关虚线 过程函数
     * @param {Object} styles
     */
    function applyStyles(styles) {
        if (!styles || typeof geometryManager === 'undefined') return;
        // 标记行里的 `named=`（带标签给定）优先于样式：有 named 就按 named 显示标签，
        // 没有才看样式里的 $ / ^（见 recordStore.js 的格式说明）
        const named = typeof geometryElementLists !== 'undefined' && geometryElementLists.named ? geometryElementLists.named : null;
        Object.keys(styles).forEach(id => {
            // 网格当作一整块：它的显隐与样式只认 gmt 里的 #grid= / #gridstyle= 两行，
            // 样式表里的 gO0 / gx0… 是旧记录存下来的（那些辅助对象当时被写成「可见」），
            // 照着它改会把作网格的过程图形全点亮
            if (typeof window.isGridObjectId === 'function' && window.isGridObjectId(id)) return;
            const item = geometryManager.get(id);
            if (!item) return;
            const entry = styles[id] || {};
            if (entry.name && typeof item.modifyName === 'function') item.modifyName(entry.name);
            if (entry.color && typeof item.modifyColor === 'function') item.modifyColor(entry.color);
            if (typeof entry.width === 'number' && typeof item.modifyWidth === 'function') item.modifyWidth(entry.width);
            if (entry.showName !== undefined && !(named && named.has(id)) && typeof item.modifyShowName === 'function') {
                item.modifyShowName(!!entry.showName);
            }
            if (entry.visible !== undefined && typeof item.modifyVisible === 'function') {
                item.modifyVisible(!!entry.visible);
                // 记录里的显隐只走样式表：顺手把「隐藏」集合也同步好，
                // 制题器 / 求解器里的标记色那几处才跟画布一致（导出的 hidden= 行恒为空，
                // 隐藏不再进关卡语义，见 board-tools.js 的 gmtText）
                const hidden = typeof geometryElementLists !== 'undefined' ? geometryElementLists.hidden : null;
                if (hidden) {
                    if (entry.visible) hidden.delete(id);
                    else hidden.add(id);
                }
            }
            if (entry.dashed !== undefined && typeof item.modifyDashed === 'function') item.modifyDashed(!!entry.dashed);
        });
    }

    /**
     * 还原关卡缩略图（题目文本与图片） 过程函数
     * @param {Object} dict
     */
    function restoreThumbnail(dict) {
        const thumbnail = dict.thumbnail;
        if (!thumbnail) return;
        const put = (id, value) => {
            const element = document.getElementById(id);
            if (element && value !== null && value !== undefined) element.textContent = value;
        };
        put('title_inf', thumbnail.title_input);
        put('body_inf', thumbnail.body_input);
        put('bottom_inf', thumbnail.bottom_input);
        if (typeof refreshPageTitle === 'function') refreshPageTitle(thumbnail.title_input);
        const oldPicture = document.getElementById('thumbnail-picture');
        if (oldPicture) oldPicture.remove();
        if (thumbnail.thumbnailSrc) {
            const picture = document.createElement('img');
            picture.id = 'thumbnail-picture';
            picture.src = thumbnail.thumbnailSrc;
            picture.alt = '此处放置缩略图';
            (document.getElementById('thumbnail-middle') || document.body).appendChild(picture);
        }
    }

    /**
     * 还回「打开记录面板之前用的工具」 过程函数
     * 打开记录面板会把工具切成「移动」（面板开着时不该顺手作图），载入记录与关掉面板时都要换回来，
     * 于是工具在整个来回里保持不动。工具栏里没有那个工具时（关卡限定单尺 / 单规）就不切
     * @returns {boolean} 是否切了
     */
    function restoreTool() {
        if (typeof choiceTool !== 'function') return false;
        const previous = global.toolBeforeRecordPanel;
        if (typeof previous !== 'string' || !previous) return false;
        if (!document.getElementById(`button-${previous}-tool`)) return false;
        choiceTool(previous);
        return true;
    }

    /**
     * 把一条记录的作图放回画布 过程函数
     * @param {Object} dict
     * @returns {boolean}
     */
    function loadRecord(dict) {
        if (!dict) return false;
        if (dict.gmt && global.boardGmt && typeof global.boardGmt.load === 'function') {
            if (!global.boardGmt.load(dict.gmt)) return false;
        }else if (dict.geometryElement) {
            // v1.1.2 以前的记录：直接还原快照，然后就地转成新格式（下次就不用走这条路）
            if (typeof global.loadStorageSnapshot !== 'function') return false;
            global.loadStorageSnapshot({elements: dict.geometryElement, lists: dict.geometryElementLists || {}});
        }else{
            return false;
        }
        applyHiddenList();
        // 样式表要压在隐藏标记与标记着色之后：记录里的颜色 / 粗细就是保存那一刻的样子
        applyStyles(dict.styles);
        // 网格再按 #grid= 收一次尾：辅助对象必须藏起来、格线按 #gridstyle= 上样式（幂等）
        if (global.boardGmt && typeof global.boardGmt.setGridFromGmt === 'function') {
            const grid = typeof global.boardGmt.grid === 'function' ? global.boardGmt.grid() : null;
            if (grid) global.boardGmt.setGridFromGmt(grid);
        }
        // 样式表存的是图形**自己**的颜色，标记的显示色要按记录里的标记重上一次
        // （给定黑 / 所求金），否则带标记的记录载回来会看到给定 / 所求是它本来的红 / 灰
        window.refreshElementListColors?.();
        // 视图适配：有网格的记录由 boardGmt.load 内部适配到网格范围；没有网格时按图形本身适配
        // （记录里的图形可能是任意尺寸、任意位置，不适配就会落在画布外或小得看不清）。
        // 放在隐藏名单与样式之后：刚被藏起来的对象不该参与范围
        if (global.boardGmt && typeof global.boardGmt.grid === 'function'
            && typeof global.boardGmt.fitView === 'function' && !global.boardGmt.grid()) {
            global.boardGmt.fitView();
            global.drawContent?.();
        }
        // 记下来：只有**老格式**的撤销清单才要它 —— 那是瘦身过的快照栈（见 recordStore 的
        // slimUndolist），样式字段不全，撤回 / 重做重建对象之后要按记录的样式表补一次
        // （见 recordPanelAfterRestore）。
        // 新格式（undolist 是一串对象行序号）不记：它的每一格就是**完整**快照，
        // 颜色 / 粗细 / 标签 / 虚线都会随快照回来（loadStorageSnapshot 按快照逐项还原）。
        // 而样式表是按**对象名**存的，撤掉的对象名会被新画的图形复用（E / F / s1 …），
        // 再补一次就会把新图形改成旧对象的颜色 / 显隐（现象：撤回后新画的点变灰、线不见了）
        loadedStyles = null;
        const undolist = dict.undolist || (dict.storage ? {construct: dict.storage.construct, moves: dict.storage.moves} : null);
        if (Array.isArray(undolist)) {
            // 新格式：名单就是「可撤回的图形」那一串对象行序号。
            // 游玩模式按名单铺撤销历史（只能逐一撤回名单里的图形）；其它模式忽略名单 ——
            // 把游玩模式导出的记录导入画板，依然可以逐一撤回所有图形
            const listed = mode === 'level' ? undolist : null;
            if (typeof global.buildStorageHistoryFromList === 'function') global.buildStorageHistoryFromList(listed);
            if (isPlay && typeof global.rebuildMovesHistoryForRecord === 'function') {
                global.rebuildMovesHistoryForRecord(listed, store.infoOf(dict).steps);
            }
        }else{
            // 老格式才需要「撤回后按样式表补一次」
            loadedStyles = dict.styles || null;
            // 老格式（v1.1.3 及以前）：撤销清单是紧凑的快照栈，先展开成存储类认的 JSON 字符串；
            // 清单读不出来（空 / 坏掉的旧记录）就保持导入时的历史，别把撤销功能弄坏
            const lists = store.expandUndolist(undolist);
            const restoreList = (manager, json) => {
                if (!json) return false;
                try {
                    const parsed = JSON.parse(json);
                    if (!parsed || !Array.isArray(parsed.repository) || !parsed.repository.length) return false;
                    manager.deserialization(json);
                    return true;
                } catch (error) {
                    return false;
                }
            };
            if (restoreList(storageManager, lists.construct)) {
                if (typeof refreshStorageButton === 'function') refreshStorageButton();
            }
            if (isPlay && typeof movesStorageManager !== 'undefined' && restoreList(movesStorageManager, lists.moves)) {
                if (typeof refreshMovesCounter === 'function') refreshMovesCounter();
            }
        }
        if (isPlay) restoreThumbnail(dict);
        if (typeof drawContent === 'function') drawContent();
        // 老记录（v1.1.2 的整份快照 / v1.1.3 的快照栈）顺手转成新格式：
        // 作图与样式一样，只是把那份撤销清单换成「一串对象行序号」，省掉大块 JSON；
        // 下次载入就走新路径（那份快照栈里的移动 / 样式步骤本来也不再保留）
        if (canvasGmt() && (!dict.gmt || !Array.isArray(dict.undolist))) {
            dict.gmt = canvasGmt();
            dict.undolist = undolistOf();
            dict.styles = stylesOfCanvas(dict.undolist);
            if (!dict.info) dict.info = store.infoOf(dict);
            delete dict.geometryElement;
            delete dict.geometryElementLists;
            delete dict.storage;
            store.putRecord(dict);
        }
        if (isPlay && typeof resultVerify === 'function') resultVerify();
        // 载入完把工具换回打开记录面板之前那个（打开面板时会切成「移动」）。
        // 面板本身不跟着切：记录列表继续摆在那儿，方便接着看 / 载入别的记录
        restoreTool();
        refresh();
        return true;
    }

    /**
     * 选择框 过程函数
     * 内部样式的小弹层，给「导出 / 导入」这类有两条路的操作用
     * @param {string} title
     * @param {{label: string, action: Function}[]} items
     */
    function chooseDialog(title, items) {
        const mask = document.createElement('div');
        mask.className = 'board-dialog-mask';
        mask.innerHTML = '<div class="board-dialog board-dialog-confirm"><strong></strong><div class="board-dialog-actions"></div></div>';
        mask.querySelector('strong').textContent = title;
        const actions = mask.querySelector('.board-dialog-actions');
        items.forEach(item => {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = item.label;
            button.addEventListener('click', () => { mask.remove(); item.action(); });
            actions.appendChild(button);
        });
        const cancelButton = document.createElement('button');
        cancelButton.type = 'button';
        cancelButton.textContent = t('common.cancel');
        cancelButton.addEventListener('click', () => mask.remove());
        actions.appendChild(cancelButton);
        mask.addEventListener('click', event => { if (event.target === mask) mask.remove(); });
        document.body.appendChild(mask);
        return mask;
    }

    /**
     * 导出若干条记录 过程函数
     * @param {Object[]} records
     */
    function exportRecords(records) {
        if (!records.length) return;
        const many = records.length > 1;
        // 多条合并成一份（每条前用名称分隔，文件名用 .gmts）；只有一条时就导出那条的 gmt
        const textOf = () => (many ? store.mergedExportText(records) : store.exportTextOf(records[0]));
        chooseDialog(t(many ? 'board.recordExportSelected' : 'board.recordExport'), [
            {
                label: t('board.recordViewCode'),
                action: () => {
                    if (global.boardGmt && typeof global.boardGmt.codeDialog === 'function') global.boardGmt.codeDialog(t('board.recordGmtCode'), textOf());
                },
            },
            {
                label: t('board.recordSaveFile'),
                action: () => {
                    const name = many ? 'records.gmts' : `${(records[0].name || records[0].id).replace(/[:\s]/g, '-')}.gmt`;
                    if (global.boardGmt && typeof global.boardGmt.download === 'function') global.boardGmt.download(name, textOf());
                },
            },
        ]);
    }

    /**
     * 导入记录文本 过程函数
     * 一份文本里可以有多条（批量导出的那份按 `# ===== 记录 N：名称 =====` 拆开），逐条收进当前上下文
     * @param {string} text
     */
    function importRecordText(text) {
        // 返回值＝这次导入成没成：gmt 代码框的确认按钮按它决定关框还是留着报错
        // （不返回就是 undefined，会被当成失败 —— 明明收进去了还提示「未能识别 gmt 内容」）
        if (typeof parseGmt !== 'function') return false;
        const blocks = store.parseImportText(text).filter(block => parseGmt(block.gmt).elements.length);
        if (!blocks.length) {
            global.boardToast?.(t('board.recordImportFailed'));
            return false;
        }
        blocks.forEach(block => {
            const info = Object.assign({
                reached: false,
                steps: null,
                target: null,
            }, block.info || {}, isPlay ? levelInfo() : {pack: null, levelId: null, levelName: null}, {mode: mode});
            const dict = buildRecord({
                name: block.name || null,
                time: block.time || null,
                gmt: block.gmt,
                undolist: block.undolist || null,
                styles: block.styles || null,
                info: info,
            });
            dict.saved = 'import';
            store.putRecord(dict);
        });
        refresh();
        global.boardToast?.(t('board.recordImported'));
        return true;
    }

    /**
     * 导入记录 过程函数
     */
    function importRecord() {
        chooseDialog(t('board.recordImport'), [
            {
                label: t('board.recordImportCode'),
                action: () => {
                    if (global.boardGmt && typeof global.boardGmt.codeDialog === 'function') {
                        global.boardGmt.codeDialog(t('board.recordImport'), '', importRecordText);
                    }
                },
            },
            {
                label: t('board.recordImportFile'),
                action: () => {
                    if (global.boardGmt && typeof global.boardGmt.pickFile === 'function') global.boardGmt.pickFile(text => importRecordText(text));
                },
            },
        ]);
    }

    /**
     * 重命名记录 过程函数
     * @param {Object} dict
     */
    function renameRecord(dict) {
        boardInput(t('board.recordRename'), '', dict.name || '', name => {
            if (!name) return;
            const saved = store.getRecord(dict.id);
            if (!saved) return;
            saved.name = name;
            store.putRecord(saved);
            refresh();
        });
    }

    /**
     * 删除若干条记录 过程函数
     * @param {string[]} ids
     */
    function deleteRecords(ids) {
        if (!ids.length) return;
        boardConfirm(t(ids.length > 1 ? 'board.recordDeleteSelectedAsk' : 'board.recordDeleteAsk'), '', () => {
            store.removeRecords(ids);
            ids.forEach(id => selected.delete(id));
            refresh();
        });
    }

    /**
     * 一条记录 过程函数
     * @param {Object} dict
     * @param {number} index
     * @returns {HTMLElement}
     */
    function recordItem(dict, index) {
        const item = document.createElement('div');
        item.className = 'record-item' + (selected.has(dict.id) ? ' select' : '');
        item.dataset.action = 'choice';
        item.dataset.id = dict.id;

        const text = document.createElement('div');
        text.className = 'record-item-text';
        const indexText = document.createElement('span');
        indexText.className = 'record-item-index';
        indexText.textContent = `${index + 1}`;
        const nameText = document.createElement('span');
        nameText.className = 'record-item-name';
        nameText.textContent = dict.name || dict.id;
        nameText.title = nameText.textContent;
        text.appendChild(indexText);
        text.appendChild(nameText);
        // 本关目标步数不在记录里（按 levelId 反查），列表标金要现取
        const summary = store.stepsSummary(dict, currentTarget());
        if (summary) {
            const steps = document.createElement('span');
            // 没作出所求：灰；作出所求：黑；其中达标的那个 L / E 由 .goal-part.active 标金
            steps.className = 'record-item-steps' + (summary.reached ? ' reached' : '');
            summary.parts.forEach(part => {
                const goal = document.createElement('span');
                goal.className = 'goal-part' + (part.gold ? ' active' : '');
                goal.textContent = part.text;
                steps.appendChild(goal);
            });
            text.appendChild(steps);
        }
        item.appendChild(text);

        const actions = document.createElement('div');
        actions.className = 'record-item-actions';
        [
            {action: 'rename-record', icon: iconOf('edit'), title: t('board.recordRename')},
            {action: 'export-record', icon: iconOf('exportGmt'), title: t('board.recordExport')},
            {action: 'delete-record', icon: iconOf('deleteObject'), title: t('board.recordDelete')},
        ].forEach(config => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'record-button';
            button.dataset.action = config.action;
            button.dataset.id = dict.id;
            button.title = config.title;
            button.innerHTML = config.icon;
            actions.appendChild(button);
        });
        item.appendChild(actions);

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'record-checkbox';
        checkbox.checked = selected.has(dict.id);
        checkbox.tabIndex = -1;
        item.appendChild(checkbox);
        return item;
    }

    /**
     * 顶栏按钮状态 过程函数
     * @param {Object[]} records
     */
    function syncHead(records) {
        const setButton = (id, config) => {
            const button = buttonOf(id);
            if (!button) return;
            if (config.action) button.dataset.action = config.action;
            if (config.icon !== undefined) button.innerHTML = config.icon;
            if (config.title) button.title = config.title;
            button.hidden = !!config.hidden;
            button.disabled = !!config.disabled;
        };
        // 加号：多选时变成全选
        setButton('record-button-add', multi ? {
            action: 'select-all',
            icon: FALLBACK_ICON.selectAll,
            title: t('board.recordSelectAll'),
            disabled: !records.length,
        } : {
            action: 'add-record',
            icon: FALLBACK_ICON.add,
            title: t('board.recordSave'),
            disabled: !canSave(),
        });
        // 导入：游玩模式没有（记录该是玩出来的），多选里也收起来
        setButton('record-button-import', {
            action: 'import-record',
            icon: iconOf('importGmt'),
            title: t('board.recordImport'),
            hidden: isPlay || multi,
        });
        // 多选 / 退出多选
        setButton('record-button-multi', {
            action: multi ? 'multi-cancel' : 'multi-select',
            icon: multi ? FALLBACK_ICON.exit : FALLBACK_ICON.check,
            title: multi ? t('board.recordExitMultiSelect') : t('board.recordMultiSelect'),
            disabled: !records.length && !multi,
        });
        // 导出所选 / 删除所选：只在多选模式下出现
        setButton('record-button-batch-export', {
            action: 'batch-export',
            icon: iconOf('exportGmt'),
            title: t('board.recordExportSelected'),
            hidden: !multi,
            disabled: !selected.size,
        });
        setButton('record-button-batch-delete', {
            action: 'batch-delete',
            icon: iconOf('deleteObject'),
            title: t('board.recordDeleteSelected'),
            hidden: !multi,
            disabled: !selected.size,
        });
        // 关闭：跳回构造面板
        setButton('record-button-close', {
            action: 'close-panel',
            icon: iconOf('menuClose'),
            title: t('board.recordClosePanel'),
        });
    }

    /**
     * 现在能不能保存 过程函数
     * 作了图形、且当前上下文里没有一致的构造（游玩模式作出所求会自动存，这里不用再按）
     * @returns {boolean}
     */
    function canSave() {
        const gmt = canvasGmt();
        return !!gmt && hasFigures() && !store.findSameRecord(gmt, context());
    }

    /**
     * 重画记录列表 过程函数
     */
    function refresh() {
        const list = listOf();
        if (!list) return;
        const records = store.listRecords(context());
        list.innerHTML = '';
        records.forEach((dict, index) => list.appendChild(recordItem(dict, index)));
        if (!records.length) {
            const empty = document.createElement('p');
            empty.className = 'record-empty';
            empty.textContent = t('board.recordEmpty');
            list.appendChild(empty);
        }
        // 记录没了就把多选收掉（否则会停在「全选 0 条」的状态），已删除的也不再留在选中集里
        if (multi && !records.length) multi = false;
        const alive = new Set(records.map(dict => dict.id));
        [...selected].forEach(id => { if (!alive.has(id)) selected.delete(id); });
        panelOf()?.classList.toggle('multi', multi);
        syncHead(records);
    }

    /**
     * 面板点击 过程函数
     * @param {Event} event
     */
    function onPanelClick(event) {
        const target = event.target.closest('[data-action]');
        if (!target || !panelOf()?.contains(target)) return;
        const action = target.dataset.action;
        const id = target.dataset.id;

        if (action === 'choice') {
            const dict = store.getRecord(id);
            if (!dict) return;
            if (multi) {
                if (selected.has(id)) selected.delete(id);
                else selected.add(id);
                refresh();
                return;
            }
            loadRecord(dict);
        }else if (action === 'add-record') {
            saveCurrent('manual');
        }else if (action === 'select-all') {
            const records = store.listRecords(context());
            const all = records.length > 0 && records.every(dict => selected.has(dict.id));
            selected.clear();
            if (!all) records.forEach(dict => selected.add(dict.id));
            refresh();
        }else if (action === 'multi-select') {
            multi = true;
            selected.clear();
            refresh();
        }else if (action === 'multi-cancel') {
            multi = false;
            selected.clear();
            refresh();
        }else if (action === 'close-panel') {
            // 关掉面板顺带退出多选：下次打开是干干净净的列表
            multi = false;
            selected.clear();
            if (typeof switchPanel === 'function') switchPanel('toolbarPanel');
            // 非游玩模式与元素一览面板一致：回到工具面板后工具就停在「移动」上（切面板本来就会
            // 重置成该档的默认工具，制题器 / 求解器 / 画板的通用档默认正是移动），不还原；
            // 游玩模式则还回打开面板之前那个工具 —— 玩家通常接着往下画
            if (isPlay) restoreTool();
        }else if (action === 'export-record') {
            const dict = store.getRecord(id);
            if (dict) exportRecords([dict]);
        }else if (action === 'batch-export') {
            exportRecords(store.listRecords(context()).filter(dict => selected.has(dict.id)));
        }else if (action === 'batch-delete') {
            deleteRecords([...selected]);
        }else if (action === 'delete-record') {
            deleteRecords([id]);
        }else if (action === 'rename-record') {
            const dict = store.getRecord(id);
            if (dict) renameRecord(dict);
        }else if (action === 'import-record') {
            if (!isPlay) importRecord();
        }
    }

    // 面板点击（事件委托）：面板是按需重建列表的，绑定一次就够
    const panel = panelOf();
    if (panel) panel.addEventListener('click', onPanelClick);
    // 旧版记录在第一次打开面板时补成新格式
    store.mergeLegacyManifest();

    global.recordPanelRefresh = refresh;
    global.recordPanelMarkBaseline = markBaseline;
    // 本次「作出所求」是否已经自动存过：作出所求之后再往上面画图不再自动存
    // （所求从画布上消失时由 playPage 的 unsuccess 事件调 recordPanelAutoReset 放开）
    let autoSaved = false;
    // 最近一次载入的记录带的样式表：撤回 / 重做重建对象后按它补色（见 recordPanelAfterRestore）
    let loadedStyles = null;
    /**
     * 作出所求时自动保存 过程函数
     * 游玩模式专用（试玩不进菜单、也不自动存）：**一次「作出所求」只存一条** ——
     * 作出所求之后接着画（多作的辅助线、别的解法…）不再自动存，想留就自己按加号。
     * 当前上下文里已经有一致的构造时也算这一次存过了（不再反复尝试）
     */
    global.recordPanelAutoSave = () => {
        if (mode !== 'level') return;
        if (autoSaved) return;
        if (!reachedGoal()) return;
        const gmt = canvasGmt();
        if (!gmt) return;
        autoSaved = true;
        if (store.findSameRecord(gmt, context())) return;
        saveCurrent('auto', true);
        refresh();
    };
    /**
     * 所求不在画布上了 过程函数
     * 撤掉 / 清空 / 重画之后再作出所求时，重新允许自动保存（新一轮「作出所求」）
     */
    global.recordPanelAutoReset = () => {
        autoSaved = false;
    };
    /**
     * 撤回 / 重做之后补一次载入记录的样式 过程函数
     * 撤销清单只留「有哪些对象 + 自由点坐标 + 标记」这些必要信息（slimUndolist），
     * 颜色 / 粗细 / 标签 / 隐藏都在记录的样式表里；而撤回会按清单重建对象，样式随之丢掉
     * （现象：载入记录后按一次撤回，画布上的图形全变黑）。所以撤销 / 重做之后由页面调它补回来
     */
    global.recordPanelAfterRestore = () => {
        if (!loadedStyles) return;
        applyStyles(loadedStyles);
        // 样式表里存的是图形自己的颜色，标记的显示色（给定黑 / 所求金）得按标记重新上一次 ——
        // 否则撤回后给定图形会停在红 / 灰上
        window.refreshElementListColors?.();
    };
})(window);
