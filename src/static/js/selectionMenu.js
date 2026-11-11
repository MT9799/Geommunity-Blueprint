/* selectionMenu.js */
/**
 * 移动工具选中图形后的上下文菜单 过程模块
 *
 * 桌面：右键图形 → 图形右下角弹圆角竖排菜单（颜色 / 大小 / 开关 / 删除 / 属性）；
 * 手机：点一下图形（不是拖动）→ 图形上方弹两端半圆的横排图标条，
 *       颜色与大小合进「样式」一项，少占横向空间。
 *
 * 位置会避开顶部更多栏、底部浮动栏与手机侧边按钮；出现 / 消失带淡入缩放过渡。
 * 颜色 / 五档大小 / 标签 / 隐藏 / 虚线 / 记号 / 删除 / 属性全部复用 stylePanel.js
 * 与 tool.js 的既有逻辑，不另写一套样式处理。
 */
(function () {
    'use strict';
    const canvas = document.querySelector('canvas');
    if (!canvas) return;

    const ICONS = {
        color: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/></svg>',
        size: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16" stroke="currentColor" stroke-width="1.2"/><path d="M4 12h16" stroke="currentColor" stroke-width="2.6"/><path d="M4 18h16" stroke="currentColor" stroke-width="4"/></svg>',
        switches: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="8" width="18" height="8" rx="4" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="16" cy="12" r="2.8" fill="currentColor"/></svg>',
        style: '<svg viewBox="0 0 24 24" aria-hidden="true"><line x1="3.6" y1="7.8" x2="5.8" y2="7.8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="9" cy="7.8" r="2.6" fill="none" stroke="currentColor" stroke-width="1.8"/><line x1="12.2" y1="7.8" x2="20.4" y2="7.8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><line x1="3.6" y1="16.2" x2="11.8" y2="16.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="15" cy="16.2" r="2.6" fill="none" stroke="currentColor" stroke-width="1.8"/><line x1="18.2" y1="16.2" x2="20.4" y2="16.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
        delete: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        properties: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 9h8M8 13h8M8 17h5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
        back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    };
    const SWATCHES = ['#ff0000', '#191919', '#808080', '#277f96', '#ffd200', '#8e44ad'];
    const DESKTOP_ITEMS = [
        {key: 'color', icon: 'color', label: 'board.styleColor', sub: 'color'},
        {key: 'size', icon: 'size', label: 'board.styleSize', sub: 'size'},
        {key: 'switches', icon: 'switches', label: 'board.contextSwitches', sub: 'switches'},
        {key: 'delete', icon: 'delete', label: 'board.contextDelete', action: 'delete'},
        {key: 'properties', icon: 'properties', label: 'board.contextProperties', action: 'properties'},
    ];
    // 手机上把颜色 / 大小并进「样式」，一级只剩三项，图标条更短
    const MOBILE_ITEMS = [
        {key: 'style', icon: 'style', label: 'board.contextStyle', sub: 'style'},
        {key: 'delete', icon: 'delete', label: 'board.contextDelete', action: 'delete'},
        {key: 'properties', icon: 'properties', label: 'board.contextProperties', action: 'properties'},
    ];
    // 被避让的浮层：顶部更多栏、浮动栏左右两段、手机侧边按钮
    const OVERLAY_SELECTORS = ['#container_more', '#floating-bar-buttons',
        '#floating-bar-elements', '#floating-bar-right', '#side-buttons'];
    const text = (key, fallback) => (typeof t === 'function' ? t(key) : fallback);

    let menu = null;
    let currentId = null;
    let anchor = {x: 0, y: 0};
    let mode = 'desktop';

    const isMobileLayout = () => (typeof widthTypeEquipment !== 'undefined' && widthTypeEquipment === 'mobile')
        || window.innerWidth <= 960 || window.innerHeight <= 500;

    const close = immediate => {
        if (!menu) return;
        const element = menu;
        menu = null;
        if (immediate) {
            element.remove();
            return;
        }
        element.classList.add('closing');
        setTimeout(() => element.remove(), 170);
    };

    /** 这批选中对象（每次现取：撤销 / 重做会重建对象） */
    const targetsOf = () => {
        const selected = (typeof tools !== 'undefined' && tools.move
            && typeof tools.move.selectedElements === 'function') ? tools.move.selectedElements() : [];
        const list = selected.map(item => geometryManager.get(item.getId())).filter(Boolean);
        if (list.length) return list;
        const only = currentId && geometryManager.get(currentId);
        return only ? [only] : [];
    };

    /** 线段（记号只属于线段：直线 / 射线 / 圆 / 点都没有） */
    const isSegment = item => item.getType?.() === 'line'
        && item.getDrawType?.() === 'lineSegment';

    /**
     * 某个样式项能不能作用到这个对象 过程函数
     * 菜单按「选中里存在适用对象就显示」（最大化覆盖），应用时只改适用的那些对象：
     * 点没有虚线，记号只属于线段；颜色 / 粗细 / 标签 / 隐藏对所有对象都适用
     * @param {Object} item
     * @param {string} key color | width | showName | visible | dashed | mark
     * @returns {boolean}
     */
    const supportsStyle = (item, key) => {
        if (key === 'dashed') return item.getType?.() !== 'point';
        if (key === 'mark') return isSegment(item);
        return true;
    };

    /**
     * 当前样式 过程函数
     * 默认读右键 / 点开的那个对象；传 onlyIf 时优先读「该样式实际能作用到的」第一个选中对象，
     * 这样混选时虚线 / 记号开关显示的是会被改动的那些对象的状态，而不是右键那个点的
     * 被标记的对象要读它自己的样式色 / 标签状态，而不是标记显示色
     * @param {Function} [onlyIf] 筛选适用对象
     */
    const styleOf = onlyIf => {
        const list = targetsOf();
        const element = (typeof onlyIf === 'function' ? list.find(onlyIf) : null)
            || (currentId && geometryManager.get(currentId))
            || list[0];
        if (!element) return null;
        const own = typeof ownStyleOfElement === 'function' ? ownStyleOfElement(element) : null;
        return {
            color: own ? own.color : element.getColor(),
            width: element.getWidth(),
            showName: own ? own.showName : element.getShowName(),
            visible: element.getVisible(),
            dashed: element.getDashed(),
            mark: typeof element.getMark === 'function' ? element.getMark() : 0,
        };
    };

    /** 改样式：多选一起改，与「调整对象样式」弹层同一套收尾 */
    const apply = (patch, live) => {
        targetsOf().forEach(item => {
            if (patch.color && supportsStyle(item, 'color')) item.modifyColor(patch.color);
            if (patch.width && supportsStyle(item, 'width')) item.modifyWidth(patch.width);
            if (patch.showName !== undefined && supportsStyle(item, 'showName')) item.modifyShowName(patch.showName);
            if (patch.visible !== undefined && supportsStyle(item, 'visible')
                && typeof setElementVisible === 'function') setElementVisible(item, patch.visible);
            // 虚线 / 记号只对支持的对象生效：菜单是「最大化覆盖」，混选时这两项也会出现
            if (patch.dashed !== undefined && supportsStyle(item, 'dashed')) item.modifyDashed(patch.dashed);
            if (patch.mark !== undefined && supportsStyle(item, 'mark')
                && typeof item.modifyMark === 'function') item.modifyMark(patch.mark);
        });
        if (typeof refreshToolFloating === 'function') refreshToolFloating();
        if (typeof drawContent === 'function') drawContent();
        // 这里只改选中的对象，绝不回写 geometryStyle：点 / 线 / 圆样式按钮是「配置后续绘制样式」
        // 的入口，画的就是预设。以前为了让按钮预览跟着选中对象变而「追平预设」，结果把
        // 对象样式灌进了类型预设，之后画的同类图形也跟着变（且预设弹层显示被污染）。
        // 预设的唯一写入点是 stylePanel 的 openStyleConfigPopup.apply。
        if (typeof window.refreshElementListColors === 'function') window.refreshElementListColors();
        if (typeof refreshOpenedGeometryItem === 'function') refreshOpenedGeometryItem();
        // 「调整对象样式」弹层若正开着，内容还是打开时的快照，一并重画
        if (typeof window.refreshOpenObjectStylePopup === 'function') window.refreshOpenObjectStylePopup();
        if (!live && typeof notifyStorageChange === 'function') notifyStorageChange('style');
    };

    const overlayRects = () => OVERLAY_SELECTORS
        .map(selector => document.querySelector(selector))
        .filter(element => element && element.getClientRects().length)
        .map(element => element.getBoundingClientRect())
        .filter(rect => rect.width > 1 && rect.height > 1);

    const overlapArea = (rect, others) => others.reduce((sum, other) => {
        const width = Math.min(rect.right, other.right) - Math.max(rect.left, other.left);
        const height = Math.min(rect.bottom, other.bottom) - Math.max(rect.top, other.top);
        return width > 0 && height > 0 ? sum + width * height : sum;
    }, 0);

    /**
     * 定位 过程函数
     * 按优先级试几个候选位置（手机先试图形上方，桌面先试右下），取「不出屏、不压浮层」的那个；
     * 都不完美时取重叠面积最小的。用 offsetWidth/Height 测量，出现动画的 scale 不会带偏
     */
    const layout = () => {
        if (!menu) return;
        const width = menu.offsetWidth;
        const height = menu.offsetHeight;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const margin = 8;
        const gap = 10;
        const overlays = overlayRects();
        const candidates = mode === 'mobile'
            ? [
                {left: anchor.x - width / 2, top: anchor.y - height - gap, origin: 'center bottom'},
                {left: anchor.x - width / 2, top: anchor.y + gap, origin: 'center top'},
                {left: anchor.x + gap, top: anchor.y - height / 2, origin: 'left center'},
                {left: anchor.x - width - gap, top: anchor.y - height / 2, origin: 'right center'},
            ]
            : [
                {left: anchor.x + gap, top: anchor.y + gap, origin: 'left top'},
                {left: anchor.x - width - gap, top: anchor.y + gap, origin: 'right top'},
                {left: anchor.x + gap, top: anchor.y - height - gap, origin: 'left bottom'},
                {left: anchor.x - width - gap, top: anchor.y - height - gap, origin: 'right bottom'},
            ];
        // 与浮层水平相交时，把垂直位置推到它上方或下方（就近）：菜单高过浮动栏时，
        // 光靠换方向仍会压出一条缝，这里直接让开
        const avoidVertically = candidate => {
            let top = candidate.top;
            for (let pass = 0; pass < 2; pass++) {
                overlays.forEach(overlay => {
                    const horizontal = Math.min(candidate.left + width, overlay.right)
                        - Math.max(candidate.left, overlay.left);
                    if (horizontal <= 0) return;
                    const vertical = Math.min(top + height, overlay.bottom) - Math.max(top, overlay.top);
                    if (vertical <= 0) return;
                    const above = overlay.top - height - gap;
                    const below = overlay.bottom + gap;
                    top = Math.abs(above - top) <= Math.abs(below - top) ? above : below;
                });
            }
            return top;
        };
        // 锚点本身（被右键 / 点开的那个图形）也要留出来：避让浮层时容易把它推到图形上，
        // 点这么小，一盖就看不见了。评分里给它更高权重，宁可压一点浮层也不压图形
        const anchorBox = {left: anchor.x - 8, top: anchor.y - 8, right: anchor.x + 8, bottom: anchor.y + 8};
        let best = null;
        candidates.forEach(candidate => {
            const left = Math.max(margin, Math.min(candidate.left, vw - width - margin));
            const top = Math.max(margin, Math.min(avoidVertically(candidate), vh - height - margin));
            const rect = {left, top, right: left + width, bottom: top + height};
            const overlap = overlapArea(rect, overlays);
            const coverAnchor = overlapArea(rect, [anchorBox]);
            const score = overlap + coverAnchor * 100;
            if (!best || score < best.score) best = {left, top, origin: candidate.origin, score};
        });
        menu.style.left = `${best.left}px`;
        menu.style.top = `${best.top}px`;
        menu.style.transformOrigin = best.origin;
    };

    const addItem = (icon, label, onClick, extraClass) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `selection-context-item${extraClass ? ' ' + extraClass : ''}`;
        button.title = label;
        button.setAttribute('aria-label', label);
        button.innerHTML = `<span class="selection-context-icon">${icon}</span>`;
        const caption = document.createElement('span');
        caption.className = 'selection-context-label';
        caption.textContent = label;
        button.appendChild(caption);
        button.addEventListener('click', onClick);
        menu.appendChild(button);
        return button;
    };

    /** 一级菜单项：游玩模式只留删除与属性（样式有单独的入口与权限口径，不在这里改） */
    const itemsOf = () => {
        const base = mode === 'mobile' ? MOBILE_ITEMS : DESKTOP_ITEMS;
        if (typeof isPlayMode === 'function' && isPlayMode()) {
            return base.filter(item => item.action === 'delete' || item.action === 'properties');
        }
        return base;
    };

    const renderPrimary = () => {
        menu.classList.remove('has-sub');
        menu.innerHTML = '';
        itemsOf().forEach(item => {
            addItem(ICONS[item.icon], text(item.label, item.key), () => {
                if (item.sub) renderSub(item.sub);
                else runAction(item.action);
            }, `selection-context-${item.key}`);
        });
        layout();
    };

    const renderSub = kind => {
        const backLabel = text('board.contextBack', '返回');
        menu.classList.add('has-sub');
        menu.innerHTML = '';
        addItem(ICONS.back, backLabel, renderPrimary, 'selection-context-back');
        const body = document.createElement('div');
        body.className = 'selection-context-sub';
        menu.appendChild(body);
        if (kind === 'color') buildColor(body);
        else if (kind === 'size') buildSize(body, 'size');
        else if (kind === 'style') buildStyle(body);
        else buildSwitches(body, 'switches');
        layout();
    };

    const buildColor = body => {
        const block = document.createElement('div');
        block.className = 'selection-context-color-block';
        const row = document.createElement('div');
        row.className = 'selection-context-swatches';
        const style = styleOf();
        SWATCHES.forEach(color => {
            const swatch = document.createElement('button');
            swatch.type = 'button';
            swatch.className = 'selection-context-swatch';
            swatch.style.backgroundColor = color;
            swatch.title = color;
            if (style && String(style.color).toLowerCase() === color) swatch.classList.add('active');
            swatch.addEventListener('click', () => { apply({color}); close(); });
            row.appendChild(swatch);
        });
        block.appendChild(row);
        const custom = document.createElement('button');
        custom.type = 'button';
        custom.className = 'selection-context-wide';
        custom.textContent = text('board.contextCustomColor', '自定义颜色…');
        custom.addEventListener('click', () => {
            const style = styleOf();
            let picked = style && style.color ? style.color : '#191919';
            if (typeof pickStyleColor !== 'function') return;
            pickStyleColor(picked,
                value => { picked = value; apply({color: value}, true); },
                () => { apply({color: picked}); close(); });
        });
        block.appendChild(custom);
        body.appendChild(block);
    };

    const buildSize = (body, kind) => {
        const style = styleOf();
        const isPoint = targetsOf().every(item => item.getType?.() === 'point');
        const row = document.createElement('div');
        row.className = 'selection-context-width-row';
        if (typeof addWidthBar === 'function') {
            addWidthBar(row, style ? style.width : 1, isPoint, value => {
                apply({width: value});
                renderSub(kind);
            });
        }
        body.appendChild(row);
    };

    const buildSwitches = (body, kind) => {
        const style = styleOf();
        const list = targetsOf();
        // 「最大化覆盖」：只要选中里存在能用这项的对象就显示，不要求全部都能用。
        // 状态则读「实际会被改动」的那些对象（styleOf 的 onlyIf），否则右键一个点、
        // 选中有虚线段时，开关会显示点的状态，点一下反而是错的
        const dashedOf = () => styleOf(item => supportsStyle(item, 'dashed'));
        const markOf = () => styleOf(item => supportsStyle(item, 'mark'));
        const hasDashed = list.some(item => supportsStyle(item, 'dashed'));
        const hasSegments = list.some(item => supportsStyle(item, 'mark'));
        const addSwitch = (labelKey, active, onToggle) => {
            const row = document.createElement('div');
            row.className = 'selection-context-switch-row';
            const label = document.createElement('span');
            label.className = 'selection-context-switch-label';
            label.textContent = text(labelKey, labelKey);
            row.appendChild(label);
            row.appendChild(createStyleSwitch(active, label.textContent, '', onToggle));
            body.appendChild(row);
        };
        addSwitch('board.styleLabel', !!(style && style.showName),
            () => { apply({showName: !(style && style.showName)}); renderSub(kind); });
        if (hasDashed) {
            const dashedStyle = dashedOf();
            addSwitch('board.styleDashed', !!(dashedStyle && dashedStyle.dashed),
                () => { apply({dashed: !(dashedStyle && dashedStyle.dashed)}); renderSub(kind); });
        }
        addSwitch('board.styleHide', !!(style && !style.visible),
            // 开关的「开」表示已隐藏：点一下要把 visible 取反，写成当前值等于没改
            () => { apply({visible: !(style && style.visible)}); close(); });
        if (hasSegments && typeof createMarkSelect === 'function') {
            const markStyle = markOf();
            const row = document.createElement('div');
            row.className = 'selection-context-switch-row';
            const label = document.createElement('span');
            label.className = 'selection-context-switch-label';
            label.textContent = text('board.styleMark', '记号');
            row.appendChild(label);
            row.appendChild(createMarkSelect(markStyle ? markStyle.mark : 0, value => {
                apply({mark: value});
                renderSub(kind);
            }));
            body.appendChild(row);
        }
    };

    /** 手机合并面板：颜色 + 大小 + 开关 */
    const buildStyle = body => {
        const color = document.createElement('div');
        color.className = 'selection-context-color-block';
        buildColor(color);
        body.appendChild(color);
        const size = document.createElement('div');
        size.className = 'selection-context-size-block';
        buildSize(size, 'style');
        body.appendChild(size);
        const switches = document.createElement('div');
        switches.className = 'selection-context-switch-block';
        buildSwitches(switches, 'style');
        body.appendChild(switches);
    };

    const runAction = action => {
        const id = currentId;
        const previousTool = typeof tool === 'string' ? tool : null;
        const previousSub = typeof subTool === 'string' ? subTool : null;
        close();
        if (action === 'delete') {
            // 删除走浮动栏那一套（含游玩模式的保护对象 / 步数退还），它按当前工具取选中：
            // 右键时可能还在作图工具上，临时切到移动工具，删完切回
            if (previousTool && previousTool !== 'move') {
                tool = 'move';
                subTool = 'move';
            }
            try {
                if (typeof clickToolFloatingButton === 'function') clickToolFloatingButton('deleteObject');
            } finally {
                if (previousTool && previousTool !== 'move') {
                    tool = previousTool;
                    subTool = previousSub || previousTool;
                    if (typeof drawContent === 'function') drawContent();
                    if (typeof refreshToolFloating === 'function') refreshToolFloating();
                }
            }
        } else if (action === 'properties') {
            if (typeof switchPanel === 'function') switchPanel('overviewPanel');
            // switchPanel 会清掉工具选中，详情按 id 打开，故延后一拍
            setTimeout(() => {
                if (typeof window.showGeometryItemDetail === 'function') window.showGeometryItemDetail(id);
            }, 0);
        }
    };

    const open = (clientX, clientY, id) => {
        close(true);
        currentId = id;
        anchor = {x: clientX, y: clientY};
        mode = isMobileLayout() ? 'mobile' : 'desktop';
        menu = document.createElement('div');
        menu.className = 'selection-context-menu entering';
        menu.dataset.mode = mode;
        menu.setAttribute('role', 'menu');
        // 菜单内的点击不能冒泡到 document 的「点别处收起」
        menu.addEventListener('click', event => event.stopPropagation());
        menu.addEventListener('contextmenu', event => event.preventDefault());
        document.body.appendChild(menu);
        renderPrimary();
        // 下一帧去掉 entering：opacity / scale 过渡到正常态
        requestAnimationFrame(() => requestAnimationFrame(() => {
            if (menu) menu.classList.remove('entering');
        }));
    };

    /** 坐标 → 画布逻辑坐标 → 最近的图形 id */
    const pickAt = (clientX, clientY) => {
        const rect = canvas.getBoundingClientRect();
        const x = (clientX - rect.left - transform.x) / transform.scale;
        const y = (clientY - rect.top - transform.y) / transform.scale;
        return geometryManager.near([x, y], ['point', 'line', 'circle'])[0] || null;
    };

    const selectOnly = id => {
        geometryManager.deleteTool('move');
        geometryManager.addToolObject('move', 'choice', 'quote', id);
        if (typeof refreshToolFloating === 'function') refreshToolFloating();
        if (typeof drawContent === 'function') drawContent();
    };

    /** 当前移动工具选中栏里的全部 id（不掺入 currentId 兜底） */
    const selectedIdsOf = () => {
        const list = (typeof tools !== 'undefined' && tools.move
            && typeof tools.move.selectedElements === 'function') ? tools.move.selectedElements() : [];
        return list.map(item => item.getId?.()).filter(Boolean);
    };

    // 桌面 / 作图工具：右键图形。右键的 mousedown 已在 index.js / playPage.js 里被忽略，
    // 这里自己按光标选中（写入移动工具的选中栏），样式 / 删除 / 属性都按它取目标
    canvas.addEventListener('contextmenu', event => {
        const id = pickAt(event.clientX, event.clientY);
        if (!id) { close(); return; }
        event.preventDefault();
        // 右键已经选中的图形：保留整批多选。selectOnly 会清掉整个选中栏再只加这一个，
        // 于是「多选里随便右键一个」就退化成单选，之后改样式 / 删除只作用在它身上
        const keepSelection = typeof tool === 'string' && tool === 'move'
            && selectedIdsOf().includes(id);
        if (!keepSelection) selectOnly(id);
        open(event.clientX, event.clientY, id);
    });

    // 手机：移动模式下「点一下」（不是拖动）也弹菜单。
    // 延后到 click 之后打开，避免被同一次点击的「点别处收起」逻辑立刻关掉
    let press = null;
    canvas.addEventListener('pointerdown', event => {
        press = {x: event.clientX, y: event.clientY, button: event.button};
    });
    canvas.addEventListener('pointerup', event => {
        const start = press;
        press = null;
        if (!start || start.button !== 0 || event.button !== 0) return;
        if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) return;
        if (typeof tool !== 'string' || tool !== 'move' || !isMobileLayout()) return;
        const selected = geometryManager.getToolKey?.('move', 'choice');
        if (!selected?.getId?.()) return;
        // 点空白处不该把刚收起的菜单又弹回来：以光标下确实有图形为准。
        // 菜单作用于整批选中，但当前值读「点到的那个」，多选时也一致
        const hitId = pickAt(event.clientX, event.clientY);
        if (!hitId) return;
        const at = {x: event.clientX, y: event.clientY};
        setTimeout(() => {
            if (typeof tool === 'string' && tool === 'move' && geometryManager.get(hitId)) open(at.x, at.y, hitId);
        }, 0);
    });

    // 手机上的 touchend 会 preventDefault()，浏览器不再合成 click —— 只听 click 的话
    // 「点空白处」永远关不掉菜单。pointerdown 在触摸 / 鼠标两条路径上都会派发，
    // 用它在冒泡到 document 时收起菜单；菜单内部的按下由 contains 排除。
    // 打开菜单的那一次 pointerdown 时菜单还是 null，不会自关
    document.addEventListener('pointerdown', event => {
        if (!menu || menu.contains(event.target)) return;
        close();
    });
    document.addEventListener('click', event => {
        if (!menu || menu.contains(event.target)) return;
        close();
    });
    document.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
    canvas.addEventListener('wheel', () => close(), {passive: true});
})();
