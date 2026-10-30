/* stylePanel.js */
/**
 * 滑块开关 过程函数
 * 弹层与元素一览里的「标签 / 虚线 / 隐藏」三个开关都用这一份
 * @param {boolean} active 开（右侧圆点亮）
 * @param {string} ariaLabel 无障碍名字
 * @param {string} title 悬停提示
 * @param {Function} onClick 点一下
 * @returns {Object} 按钮元素
 */
function createStyleSwitch(active, ariaLabel, title, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'style-popup-switch';
    button.setAttribute('role', 'switch');
    button.setAttribute('aria-checked', String(!!active));
    button.setAttribute('aria-label', ariaLabel);
    if (title) button.title = title;
    if (active) button.classList.add('active');
    const knob = document.createElement('span');
    knob.className = 'style-popup-switch-knob';
    button.appendChild(knob);
    button.addEventListener('click', onClick);
    return button;
}

/**
 * 样式面板取词 过程函数
 * i18n.js 未载入时退回中文，保证单独引用本文件也不至于显示键名
 * @param {string} key i18n 键
 * @param {string} fallback 中文兜底
 * @returns {string}
 */
const styleText = (key, fallback) => (typeof t === 'function' ? t(key) : fallback);

/**
 * 开关行里再追加一个「标题 + 控件」 过程函数
 * 「标签」与「虚线」并排在一行时用：第二个标题与第一个同宽，两个控件各占剩下的
 * @param {Object} row 开关行
 * @param {string} title 标题文字
 * @param {Object} control 控件（开关 / 只读文字）
 */
function appendStyleControl(row, title, control) {
    const label = document.createElement('span');
    label.className = 'style-popup-title';
    label.textContent = title;
    row.appendChild(label);
    row.appendChild(control);
}

/** 记号的无障碍/悬停文字（示意图本身用 SVG 画，避免不同设备字体差异） */
const MARK_LABELS = ['——', '—|—', '—||—', '—|||—', '—>—', '—>>—', '—>>>—'];

/**
 * 记号的 SVG 示意图 过程函数
 * 一条水平线 + 中央竖线（1–3 道）或箭头（1–3 道）
 * @param {number} mark 0–6
 * @returns {Object} svg 元素
 */
function markSvgElement(mark) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 44 16');
    svg.setAttribute('width', '44');
    svg.setAttribute('height', '16');
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('style-mark-icon');
    const add = (tag, attrs) => {
        const node = document.createElementNS(NS, tag);
        Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
        node.setAttribute('stroke', 'currentColor');
        node.setAttribute('stroke-width', '1.5');
        node.setAttribute('stroke-linecap', 'round');
        svg.appendChild(node);
        return node;
    };
    add('line', {x1: '2', y1: '8', x2: '42', y2: '8'});
    if (mark >= 1 && mark <= 3) {
        for (let i = 0; i < mark; i++) {
            const x = 22 + (i - (mark - 1) / 2) * 5;
            add('line', {x1: x, y1: '3.5', x2: x, y2: '12.5'});
        }
    } else if (mark >= 4) {
        const count = mark - 3;
        for (let i = 0; i < count; i++) {
            const cx = 22 + (i - (count - 1) / 2) * 6;
            add('polyline', {points: `${cx - 3},4.5 ${cx + 2},8 ${cx - 3},11.5`, fill: 'none', 'stroke-linejoin': 'round'});
        }
    }
    return svg;
}

/**
 * 线段记号下拉选择栏 过程函数
 * 无记号（——）+ 6 种：—|— / —||— / —|||— / —>— / —>>— / —>>>—
 * 按钮与选项都用 SVG 示意图，避免不同设备字体渲染不一致
 * @param {number} current 当前记号 0–6
 * @param {Function} onChange 选中某一项
 * @returns {Object} 容器元素
 */
function createMarkSelect(current, onChange) {
    const box = document.createElement('div');
    box.className = 'style-mark-select';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'style-mark-button';
    button.setAttribute('aria-label', typeof t === 'function' ? t('board.styleMark') : '记号');
    const menu = document.createElement('div');
    menu.className = 'style-mark-menu';
    menu.hidden = true;
    const close = () => { menu.hidden = true; box.classList.remove('open'); };
    const setIcon = value => {
        button.innerHTML = '';
        button.appendChild(markSvgElement(value));
        button.title = MARK_LABELS[value] || MARK_LABELS[0];
    };
    for (let value = 0; value <= 6; value++) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'style-mark-item';
        item.title = MARK_LABELS[value];
        item.setAttribute('aria-label', MARK_LABELS[value]);
        if (Number(current) === value) item.classList.add('active');
        item.appendChild(markSvgElement(value));
        item.addEventListener('click', event => {
            event.stopPropagation();
            close();
            onChange(value);
        });
        menu.appendChild(item);
    }
    button.addEventListener('click', event => {
        event.stopPropagation();
        menu.hidden = !menu.hidden;
        box.classList.toggle('open', !menu.hidden);
    });
    box.appendChild(button);
    box.appendChild(menu);
    setIcon(Number(current) || 0);
    return box;
}

/**
 * 样式面板：颜色 / 粗细（点的大小） / 标签显示 / 虚线（线圆）
 * 画板（board.html 用 tool.js）与关卡游玩（level.html 用 toolPlayPage.js）共用，
 * 因此这里只依赖两边都有的全局量：
 * tool、geometryManager、geometryStyle、drawStyle()、refreshToolFloating()、drawContent()
 */

// 粗细档位：点的大小与线、圆的粗细，默认值 1 为「中」。
// 「大」与「中」之间、「中」与「小」之间各再加一挡（共 5 挡），用挡位条选（见 addWidthBar）
const styleWidths = [
    {value: 0.5, nameKey: 'board.widthThin', name: '细', pointKey: 'board.pointSizeSmall', pointName: '小'},
    {value: 0.75, nameKey: 'board.widthSlim', name: '较细', pointKey: 'board.pointSizeSmaller', pointName: '较小'},
    {value: 1, nameKey: 'board.widthMedium', name: '中', pointKey: 'board.pointSizeMedium', pointName: '中'},
    {value: 1.25, nameKey: 'board.widthBold', name: '较粗', pointKey: 'board.pointSizeLarger', pointName: '较大'},
    {value: 1.5, nameKey: 'board.widthThick', name: '粗', pointKey: 'board.pointSizeLarge', pointName: '大'},
];
/** 档位名 过程函数（按值找名字，找不到就用原值） */
const styleWidthNameOf = (value, isPoint) => {
    const hit = styleWidths.find(item => Math.abs(value - item.value) < 0.01);
    if (!hit) return String(value);
    return isPoint ? styleText(hit.pointKey, hit.pointName) : styleText(hit.nameKey, hit.name);
};

/**
 * 粗细 / 大小的挡位条 过程函数（画布样式弹层与「调整已选中对象的样式」两处共用）
 * 一排等宽挡位（小 → 大），当前档高亮；每一档上的圆点按该档的粗细画，一眼能看出选的是哪一档
 * @param {HTMLElement} row 所在行
 * @param {number} current 当前值
 * @param {boolean} isPoint true = 点（用「大小」那一套档名）
 * @param {Function} onPick 选中某档
 * @return {HTMLElement} 挡位条
 */
const addWidthBar = (row, current, isPoint, onPick) => {
    const bar = document.createElement('div');
    bar.className = 'style-width-bar';
    styleWidths.forEach(item => {
        const seg = document.createElement('button');
        seg.type = 'button';
        seg.className = 'style-width-seg';
        seg.style.setProperty('--seg-width', item.value);
        seg.title = styleWidthNameOf(item.value, isPoint);
        if (Math.abs(current - item.value) < 0.01) seg.classList.add('active');
        seg.addEventListener('click', () => onPick(item.value));
        bar.appendChild(seg);
    });
    row.appendChild(bar);
    return bar;
};

/**
 * 已选中的几何对象（移动工具的选中栏）
 * @returns {Object | null}
 */
function getSelectedElement() {
    return geometryManager.getToolKey('move', 'choice');
}

/**
 * 系统取色 过程函数
 * 每次都用一个新的 input[type=color]：浏览器对同一个取色 input 重复 click 往往不再弹出取色器；
 * 而取色过程中又不能把它从文档里移除（否则 change 事件会丢失），所以在取色结束（change / cancel）后才移除
 * @param {string} current 当前颜色
 * @param {Function} callback 拖动取色时的即时回调
 * @param {Function} [commit] 取色确定后的回调（用于记入撤销/重做历史）
 */
function pickStyleColor(current, callback, commit) {
    // 创建临时的input元素
    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.value = current;
    
    // 颜色变化
    const finish = () => colorInput.remove();
    colorInput.oninput = event => callback(event.target.value);
    colorInput.onchange = event => { callback(event.target.value); if (commit) commit(); finish(); };
    colorInput.oncancel = finish;
    
    // 触发颜色选择器
    colorInput.click();
    
    // 可选：用完立即移除
    setTimeout(() => {
        colorInput.remove();
    }, 100);

    /*
    document.querySelectorAll('.style-color-input').forEach(item => item.remove());
    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.className = 'style-color-input';
    colorInput.value = current;
    const finish = () => colorInput.remove();
    // input 让拖动取色时即时生效，change 兜底
    colorInput.oninput = event => callback(event.target.value);
    colorInput.onchange = event => { callback(event.target.value); if (commit) commit(); finish(); };
    colorInput.oncancel = finish;
    // 取色器在弹层之外，它自身的 click 不能冒泡，否则会被「点击别处收起弹层」的逻辑误判
    colorInput.onclick = event => event.stopPropagation();
    document.body.appendChild(colorInput);
    // 优先用原生取色器接口：移动端对「移出视口、透明」的元素，程序化 click() 往往不弹取色器，
    // 必须靠 showPicker()（仍要在这次用户手势的调用栈里），不支持时才退回 click()
    if (typeof colorInput.showPicker === 'function') {
        try {
            colorInput.showPicker();
        }catch (error) {
            colorInput.click();
        }
    }else{
        colorInput.click();
    }
        */
}

/**
 * 通知存储层记一步历史 过程函数
 * @param {string} type 操作类型（供步数统计等使用）
 */
function notifyStorageChange(type) {
    // 触发存储事件
    const event = new CustomEvent("storage", {
        detail: {
            type: type,
        },
    });
    window.dispatchEvent(event);
}

/**
 * 关闭样式弹层 过程函数
 */
function closeStylePopups() {
    document.querySelectorAll('.style-popup').forEach(item => { item.classList.remove('open'); item.remove(); });
}

/**
 * 收回「调整对象样式」弹层 过程函数
 * 选中被清掉时用：弹层里的闭包还指着刚才那个对象（撤销重建对象之后就指向废弃对象了）
 */
function closeObjectStylePopup() {
    document.querySelectorAll('.style-popup.open[data-key="object"]').forEach(item => { item.classList.remove('open'); item.remove(); });
}

/**
 * 样式弹层 过程函数
 * 颜色 / 粗细（点的大小） / 标签显示 / 虚线（线圆），既可用于后续绘制的图形，也可用于已选中的对象
 * @param {Object} options
 *   - anchor 弹层的定位按钮
 *   - key 弹层标识，同一按钮再次点击时收起
 *   - isPoint 点样式（“大小”而非“粗细”，没有「虚线」这一行）
 *   - get() 读取当前样式 {color, width, showName, dashed}
 *   - apply(patch) 应用样式变更
 */
function openStylePopup(options) {
    const {anchor, key, isPoint, get, apply} = options;
    const opened = document.querySelector('.style-popup.open');
    closeStylePopups();
    if (opened && opened.dataset.key === key) {
        // 同一个按钮再点一下就是收起
        return;
    }

    const popup = document.createElement('div');
    popup.className = 'board-popup style-popup';
    popup.dataset.key = key;
    // 弹层内部的点击不允许冒泡：选项点击会重建弹层内容（原按钮已脱离文档），
    // 否则全局「点击别处收起弹层」的逻辑会误判为外部点击而立即收起
    popup.addEventListener('click', event => event.stopPropagation());

    const addRow = title => {
        const row = document.createElement('div');
        row.className = 'style-popup-row';
        const label = document.createElement('span');
        label.className = 'style-popup-title';
        label.textContent = title;
        row.appendChild(label);
        popup.appendChild(row);
        return row;
    };
    const addOption = (row, name, active, action) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'style-popup-option';
        button.textContent = name;
        if (active) button.classList.add('active');
        button.addEventListener('click', action);
        row.appendChild(button);
    };


    // 按当前样式重绘弹层内容
    const draw = () => {
        const style = get();
        const width = style.width || 1;
        popup.innerHTML = '';

        // 颜色（拖动取色时即时生效但不记历史，取色确定后才记一步）
        const colorRow = addRow(styleText('board.styleColor', '颜色'));
        const colorButton = document.createElement('button');
        colorButton.type = 'button';
        colorButton.className = 'style-popup-color';
        colorButton.style.backgroundColor = style.color;
        colorButton.setAttribute('aria-label', styleText('board.stylePickColor', '选择颜色'));
        colorButton.addEventListener('click', () => {
            let picked = style.color;
            const applyColor = live => { apply({color: picked, colorChoice: 'color'}, live); draw(); };
            pickStyleColor(style.color, color => { picked = color; applyColor(true); }, () => applyColor(false));
        });
        colorRow.appendChild(colorButton);

        // 粗细 / 大小（挡位条）
        const widthRow = addRow(isPoint ? styleText('board.styleSize', '大小') : styleText('board.styleWidth', '粗细'));
        addWidthBar(widthRow, width, isPoint, value => { apply({width: value}); draw(); });

        // 标签：一个开关（开 = 显示标签，关 = 不显示）
        // 虚线与它并排在同一行（只有直线与圆有，点没有这个开关）：开 = 画成虚线，各模式默认关
        // 网格（格线）不给「标签」开关：那一行只剩虚线（行名也跟着换）
        const dashedTip = styleText('board.styleDashed', '虚线');
        const labelRow = addRow(options.hideLabel ? dashedTip : styleText('board.styleLabel', '标签'));
        labelRow.classList.add('style-popup-row-pair');
        if (!options.hideLabel) {
            labelRow.appendChild(createStyleSwitch(!!style.showName, styleText('board.styleShowLabel', '显示标签'),
                style.showName ? styleText('board.styleShowLabel', '显示标签') : styleText('board.styleHideLabel', '不显示标签'),
                () => { apply({showName: !style.showName}); draw(); }));
        }
        if (!isPoint) {
            const dashed = style.dashed === true;
            appendStyleControl(labelRow, dashedTip, createStyleSwitch(dashed, dashedTip,
                dashed ? styleText('board.styleDashedOnTip', '虚线，点一下变回实线') : styleText('board.styleDashedOffTip', '实线，点一下变虚线'),
                () => { apply({dashed: !dashed}); draw(); }));
        }

        // 隐藏对象（只有「调整已选中对象的样式」这个弹层有）：点一下就把当前对象藏起来
        if (options.showHide) {
            const hideRow = addRow(styleText('board.styleHide', '隐藏'));
            const hidden = style.visible === false;
            hideRow.appendChild(createStyleSwitch(hidden, styleText('board.styleHideObject', '隐藏对象'),
                hidden ? styleText('board.styleRestoreObjectTip', '已隐藏，点一下恢复显示') : styleText('board.styleHideThisObjectTip', '点一下隐藏这个对象'),
                () => { apply({visible: hidden ? true : false}); draw(); }));
            // 线段记号的下拉放在「隐藏」开关右边
            if (options.showMark) {
                appendStyleControl(hideRow, styleText('board.styleMark', '记号'), createMarkSelect(style.mark || 0,
                    value => { apply({mark: value}); draw(); }));
            }
        }else if (options.showMark) {
            // 没有隐藏开关时（线段工具的预设）单独一行放记号下拉
            const markRow = addRow(styleText('board.styleMark', '记号'));
            markRow.appendChild(createMarkSelect(style.mark || 0, value => { apply({mark: value}); draw(); }));
        }
    };
    draw();

    document.body.appendChild(popup);
    popup.style.visibility = 'hidden';
    popup.classList.add('open');
    const rect = anchor.getBoundingClientRect();
    const box = popup.getBoundingClientRect();
    popup.style.left = `${Math.max(8, Math.min(rect.left, Math.max(8, window.innerWidth - box.width - 8)))}px`;
    // 打开在按钮上方；上方放不下（按钮贴顶）才退回下方
    const above = rect.top - box.height - 8;
    popup.style.top = `${above >= 8 ? above : Math.min(rect.bottom + 8, Math.max(8, window.innerHeight - box.height - 8))}px`;
    popup.style.visibility = 'visible';
}

/**
 * 配置后续绘制的图形样式 过程函数
 * @param {string} type 'point' | 'line' | 'circle'
 * @param {Object} [anchor] 弹层定位按钮
 */
function openStyleConfigPopup(type, anchor) {
    const button = anchor || document.getElementById(`button-${tool}-${type}Style`);
    if (!button) return;
    openStylePopup({
        anchor: button,
        key: `config-${type}`,
        isPoint: type === 'point',
        // 只有线段工具才有「记号」（直线 / 射线没有中央记号）
        showMark: type === 'line' && tool === 'lineSegment',
        get: () => geometryStyle[type],
        apply: patch => {
            Object.assign(geometryStyle[type], patch);
            drawStyle(type);
            drawContent();
        },
    });
}

/** 「调整对象样式」弹层当前所对着的选中集合签名（换选对象时据此把弹层收起） */
let objectStyleSelectionKey = null;
/** 撤销 / 重做 / 清空画布等换了一批图形：把「调整对象样式」弹层收掉 */
window.resetObjectStylePopup = () => {
    closeObjectStylePopup();
};

/** 当前移动选中集合的签名 过程函数（多选按 id 排序拼起来） */
function currentSelectionKey() {
    const selected = typeof tools !== 'undefined' && tools.move && typeof tools.move.selectedElements === 'function'
        ? tools.move.selectedElements() : [];
    return selected.map(item => item.getId()).sort().join('|');
}

/**
 * 调整已选中对象的样式 过程函数
 * @param {Object} [anchor] 弹层定位按钮
 */
function openObjectStylePopup(anchor) {
    const button = anchor || document.getElementById(`button-${tool}-objectStyle`);
    const element = getSelectedElement();
    if (!button || !element) return;
    // 网格当作一整块：一次改动应用到所有格线；它不能隐藏、也不能改标签显示
    const isGrid = typeof window.isGridObjectId === 'function' && window.isGridObjectId(element.getId());
    // 目标集合＝**选中栏里的全部对象**（移动工具支持多选：choice、choice2…，见 MoveTool.selectedElements），
    // 一次调样式就一起改。原来非网格时只返回 [element]，多选后只有第一个跟着变。
    // 按 id 现取一遍：撤销 / 重做会把图形整批重建，手里那个旧对象已经脱离画板
    const targetsOf = () => {
        if (isGrid && typeof geometryElementLists !== 'undefined' && geometryElementLists.grid) {
            return [...geometryElementLists.grid].filter(id => /^gS[XY]\d+$/.test(id))
                .map(id => geometryManager.get(id)).filter(Boolean);
        }
        const selected = typeof tools !== 'undefined' && tools.move && typeof tools.move.selectedElements === 'function'
            ? tools.move.selectedElements() : [];
        const list = selected.map(item => geometryManager.get(item.getId())).filter(Boolean);
        return list.length ? list : [geometryManager.get(element.getId()) || element];
    };
    // 选中的全是线段时才给「记号」（直线 / 射线 / 圆没有中央记号）
    const allSegments = !isGrid && targetsOf().every(item => item.getType?.() === 'line'
        && item.getDrawType?.() === 'lineSegment');
    openStylePopup({
        anchor: button,
        key: 'object',
        // 全是点时才是「点」的界面（混选时按线 / 圆那套，能调虚线与标签）
        isPoint: targetsOf().every(item => item.getType() === 'point'),
        // 这个弹层多一个「隐藏」开关（非游玩模式才能隐藏对象）—— 网格不给
        showHide: !isGrid,
        // 选中线段时在「隐藏」右侧多一个「记号」下拉
        showMark: allSegments,
        hideLabel: isGrid,
        get: () => ({color: element.getColor(), width: element.getWidth(), showName: element.getShowName(), visible: element.getVisible(), dashed: element.getDashed(), mark: element.getMark ? element.getMark() : 0}),
        apply: (patch, live) => {
            targetsOf().forEach(item => {
                if (patch.color) item.modifyColor(patch.color);
                if (patch.width) item.modifyWidth(patch.width);
                if (patch.dashed !== undefined) item.modifyDashed(patch.dashed);
                if (!isGrid && patch.mark !== undefined) item.modifyMark(patch.mark);
                if (!isGrid && patch.showName !== undefined) item.modifyShowName(patch.showName);
                if (!isGrid && patch.visible !== undefined) setElementVisible(item, patch.visible);
            });
            // 网格样式只认 gmt 里的 #gridstyle= 那一行（记录里不写 styles）：改完追平它。
            // 改色时把选中的颜色直接传过去 —— 回头读对象的颜色会读成标记显示色（见 syncGridStyle）
            if (isGrid && !live && window.boardGmt?.syncGridStyle) window.boardGmt.syncGridStyle(patch.color);
            refreshToolFloating();
            drawContent();
            // 记入撤销/重做历史（取色拖动中的中间状态不记）
            if (!live) notifyStorageChange('style');
        },
    });
    // 记下这份弹层对着的是哪一组选中：换选对象时（见 setObjectStyleAble）据此把弹层收起来
    objectStyleSelectionKey = currentSelectionKey();
}

/**
 * 显示 / 隐藏一个对象 过程函数
 * 同时把「元素一览 → 隐藏」那个集合同步好：撤销、导出 gmt、存读档都认这个集合
 * @param {Object} element
 * @param {boolean} visible
 */
function setElementVisible(element, visible) {
    if (!element) return;
    element.modifyVisible(!!visible);
    if (typeof geometryElementLists !== 'undefined' && geometryElementLists.hidden) {
        if (visible) geometryElementLists.hidden.delete(element.getId());
        else geometryElementLists.hidden.add(element.getId());
    }
}

/**
 * 把「调整对象样式」控件直接铺在给定容器里 过程函数
 * 控件与 style-popup 完全同一套（颜色 / 粗细 / 标签 / 隐藏对象）
 * @param {Object} container 容器元素
 * @param {Object} element 目标几何对象
 * @param {Function} [onChange] 改动完成后的回调（记历史、重绘）；拖动取色的中间状态不回调
 * @param {boolean} [readOnly] 只读展示（游玩界面用）：只显示色块与文字，不能改
 * @returns {Function} 重画一次
 */
function renderInlineStyleControls(container, element, onChange, readOnly) {
    // 撤销 / 重做会把图形整批重建（重新解析 gmt 文本），详情面板手里那个旧对象就脱离了画板，
    // 再调它的样式自然看不出变化 —— 所以一律按 id 现取当前对象，不缓存引用
    const targetId = typeof element.getId === 'function' ? element.getId() : null;
    const current = () => (targetId && typeof geometryManager !== 'undefined' && geometryManager.get(targetId)) || element;
    // 网格当作一整块：详情面板里改样式要一次改到所有格线（与画布上的样式弹层同一口径）——
    // 只改「手上这一条」的话，看起来就是「只能调最底下那条格线」
    const isGrid = typeof window.isGridObjectId === 'function' && window.isGridObjectId(targetId);
    const targetsOf = () => (isGrid && typeof geometryElementLists !== 'undefined' && geometryElementLists.grid
        ? [...geometryElementLists.grid].filter(id => /^gS[XY]\d+$/.test(id)).map(id => geometryManager.get(id)).filter(Boolean)
        : [current()]);
    const each = fn => targetsOf().forEach(fn);
    const done = patch => {
        // 网格样式只认 gmt 里的 #gridstyle= 那一行（记录里不写 styles）：改完追平它。
        // 改色时把选中的颜色直接传过去 —— 回头读对象的颜色会读成标记显示色（见 syncGridStyle）
        if (isGrid && window.boardGmt?.syncGridStyle) window.boardGmt.syncGridStyle(patch && patch.color);
        if (typeof onChange === 'function') onChange();
    };
    // 控件只在自己这一层里重画：直接清空容器会把同一列里别的行（例如「有效性」）一起清掉
    const holder = document.createElement('div');
    holder.className = 'style-inline-holder';
    container.appendChild(holder);
    const draw = () => {
        const target = current();
        holder.innerHTML = '';
        const isPoint = target.getType() === 'point';
        // 线段才谈得上记号（直线 / 射线 / 圆没有中央记号）
        const isSegment = !isPoint && target.getType() === 'line' && target.getDrawType?.() === 'lineSegment';
        const addRow = title => {
            const row = document.createElement('div');
            row.className = 'style-popup-row';
            const label = document.createElement('span');
            label.className = 'style-popup-title';
            label.textContent = title;
            row.appendChild(label);
            holder.appendChild(row);
            return row;
        };

        // 只读展示（游玩界面不允许改样式）：色块 + 文字，控件不可点
        if (readOnly) {
            const roColorRow = addRow(styleText('board.styleColor', '颜色'));
            const swatch = document.createElement('span');
            swatch.className = 'style-popup-color';
            swatch.style.backgroundColor = target.getColor();
            roColorRow.appendChild(swatch);

            const roWidthRow = addRow(isPoint ? styleText('board.styleSize', '大小') : styleText('board.styleWidth', '粗细'));
            const widthText = document.createElement('span');
            widthText.className = 'style-inline-value';
            // 只读时直接写档位名（细 / 较细 / 中 / 较粗 / 粗），比裸数字好读
            widthText.textContent = styleWidthNameOf(target.getWidth() || 1, isPoint);
            roWidthRow.appendChild(widthText);

            // 标签与虚线并排一行（虚线只有直线与圆有）
            const roLabelRow = addRow(styleText('board.styleLabel', '标签'));
            roLabelRow.classList.add('style-popup-row-pair');
            const labelText = document.createElement('span');
            labelText.className = 'style-inline-value';
            labelText.textContent = target.getShowName() ? styleText('board.styleShown', '显示') : styleText('board.styleNotShown', '不显示');
            roLabelRow.appendChild(labelText);
            if (!isPoint) {
                const dashText = document.createElement('span');
                dashText.className = 'style-inline-value';
                dashText.textContent = target.getDashed() ? styleText('board.styleYes', '是') : styleText('board.styleNo', '否');
                appendStyleControl(roLabelRow, styleText('board.styleDashed', '虚线'), dashText);
            }

            // 隐藏：只读档位里这一项是**可用**的（游玩模式也能藏 / 显示自己画的图形）；
            // 题面对象（给定 / 关卡自带 / 所求）与「关卡自己藏起来的图形」不给动，开关置灰。
            // 判据：游玩页用 playHideAllowed、画板等用 boardHideAllowed；外加「现在看不见、
            // 又不在 hidden 集合里」＝关卡预绘制就藏着的，同样不给动
            const roHideRow = addRow(styleText('board.styleHide', '隐藏'));
            const allowHide = typeof playHideAllowed === 'function' ? playHideAllowed
                : (typeof window.boardHideAllowed === 'function' ? window.boardHideAllowed : null);
            const playerControlled = typeof geometryElementLists !== 'undefined' && geometryElementLists.hidden
                ? geometryElementLists.hidden.has(targetId) : false;
            const canHide = (allowHide ? allowHide(targetId) : true) && (target.getVisible() || playerControlled);
            const hideSwitch = createStyleSwitch(!target.getVisible(), styleText('board.styleHide', '隐藏'),
                target.getVisible() ? styleText('board.styleHideThisTip', '点一下隐藏这个图形') : styleText('board.styleShowThisTip', '已隐藏，点一下显示'),
                () => {
                    if (!canHide) return;
                    const item = current();
                    const next = !item.getVisible();
                    if (typeof setPlayElementVisible === 'function') setPlayElementVisible(item, next);
                    else setElementVisible(item, next);
                    draw();
                });
            if (!canHide) hideSwitch.classList.add('disable');
            roHideRow.appendChild(hideSwitch);
            return;
        }

        // 颜色
        const colorRow = addRow(styleText('board.styleColor', '颜色'));
        const colorButton = document.createElement('button');
        colorButton.type = 'button';
        colorButton.className = 'style-popup-color';
        colorButton.style.backgroundColor = target.getColor();
        colorButton.setAttribute('aria-label', styleText('board.stylePickColor', '选择颜色'));
        colorButton.addEventListener('click', () => {
            let picked = current().getColor();
            const applyColor = live => {
                each(item => item.modifyColor(picked));
                // 拖动取色时也要立刻反映：预览色块跟着变，画布立即重绘（与弹层那套一致）
                colorButton.style.backgroundColor = picked;
                if (typeof drawContent === 'function') drawContent();
                if (!live) done({color: picked});
            };
            pickStyleColor(picked, color => { picked = color; applyColor(true); }, () => applyColor(false));
        });
        colorRow.appendChild(colorButton);

        // 粗细 / 大小（挡位条）
        const widthRow = addRow(isPoint ? styleText('board.styleSize', '大小') : styleText('board.styleWidth', '粗细'));
        const width = target.getWidth() || 1;
        addWidthBar(widthRow, width, isPoint, value => {
            each(item => item.modifyWidth(value));
            draw();
            done();
        });

        // 标签开关，虚线与它并排在同一行（只有直线与圆有）：开 = 画成虚线，各模式默认关
        // 网格（格线）不给「标签」开关：那一行只剩虚线（与画布上的样式弹层同一口径）
        const dashedLabel = styleText('board.styleDashed', '虚线');
        const dashedOnTip = styleText('board.styleDashedOnTip', '虚线，点一下变回实线');
        const dashedOffTip = styleText('board.styleDashedOffTip', '实线，点一下变虚线');
        if (isGrid) {
            const gridDashed = target.getDashed();
            appendStyleControl(addRow(dashedLabel), dashedLabel, createStyleSwitch(gridDashed, dashedLabel, gridDashed ? dashedOnTip : dashedOffTip,
                () => { each(item => item.modifyDashed(!item.getDashed())); draw(); done(); }));
        } else {
            const labelRow = addRow(styleText('board.styleLabel', '标签'));
            labelRow.classList.add('style-popup-row-pair');
            labelRow.appendChild(createStyleSwitch(!!target.getShowName(), styleText('board.styleShowLabel', '显示标签'),
                target.getShowName() ? styleText('board.styleShowLabel', '显示标签') : styleText('board.styleHideLabel', '不显示标签'),
                () => { const item = current(); item.modifyShowName(!item.getShowName()); draw(); done(); }));
            if (!isPoint) {
                const dashed = target.getDashed();
                appendStyleControl(labelRow, dashedLabel, createStyleSwitch(dashed, dashedLabel, dashed ? dashedOnTip : dashedOffTip,
                    () => { const item = current(); item.modifyDashed(!item.getDashed()); draw(); done(); }));
            }

            // 隐藏对象（网格不给：它当作一整块，不能被隐藏）
            const hideRow = addRow(styleText('board.styleHide', '隐藏'));
            const hidden = !target.getVisible();
            hideRow.appendChild(createStyleSwitch(hidden, styleText('board.styleHideObject', '隐藏对象'),
                hidden ? styleText('board.styleRestoreObjectTip', '已隐藏，点一下恢复显示') : styleText('board.styleHideThisObjectTip', '点一下隐藏这个对象'),
                () => { const item = current(); setElementVisible(item, !item.getVisible()); draw(); done(); }));
            // 线段记号放在「隐藏」开关右侧（与画布上的样式弹层一致）
            if (isSegment) {
                appendStyleControl(hideRow, styleText('board.styleMark', '记号'),
                    createMarkSelect(target.getMark ? target.getMark() : 0, value => {
                        each(item => item.modifyMark(value));
                        draw();
                        done();
                    }));
            }
        }
    };
    draw();
    return draw;
}

/**
 * 调整对象样式按钮的可用状态 过程函数
 * 只在移动工具选中了对象时可用
 * @param {string} item 按钮标识
 */
function setObjectStyleAble(item) {
    const buttonDE = document.getElementById(`button-${tool}-${item}`);
    if (!buttonDE) return;
    const svg = buttonDE.querySelector('svg');
    if (!svg) return;
    if (getSelectedElement()) {
        buttonDE.classList.remove('disable');
        svg.classList.remove('disable');
        // 换选了别的对象：样式弹层直接收起（不跟着换内容、也不自动重开）。
        // 换选时选中栏会「先清空再选上」，中间那一下已经走到下面的清空分支把弹层收掉了；
        // 这里再按签名变化兜一次，保证「面板开着时改选」也一定收起来
        const opened = document.querySelector('.style-popup.open[data-key="object"]');
        if (opened && currentSelectionKey() !== objectStyleSelectionKey) closeObjectStylePopup();
    }else{
        buttonDE.classList.add('disable');
        svg.classList.add('disable');
        // 选中没了，已经展开的「调整对象样式」弹层也要收起来（撤销清掉选中时就是这条路径）
        closeObjectStylePopup();
    }
}

/**
 * 样式样例图形 过程函数
 * 用于样式按钮的预览：颜色、粗细（点的大小）、是否带标签、是否虚线
 * @param {string} type 'point' | 'line' | 'circle'
 * @param {Object} style {color, width, showName, dashed}
 * @returns {Object} SVG元素
 */
function createStyleSample(type, style) {
    const svgNS = "http://www.w3.org/2000/svg";
    const width = style.width || 1;
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", "0 0 100 100");
    svg.classList.add('svg-icon');

    if (type === 'point') {
        // 点的大小：半径按倍数放大，内部留白与画布上的点一致；点放在图标正中
        const radius = 16 * width;
        const outer = document.createElementNS(svgNS, "circle");
        outer.setAttribute("cx", 50);
        outer.setAttribute("cy", 50);
        outer.setAttribute("r", radius);
        outer.setAttribute("fill", style.color);
        outer.setAttribute("stroke", "none");
        svg.appendChild(outer);

        const inner = document.createElementNS(svgNS, "circle");
        inner.setAttribute("cx", 50);
        inner.setAttribute("cy", 50);
        inner.setAttribute("r", radius / 2);
        inner.setAttribute("fill", "#ffffff");
        inner.setAttribute("stroke", "none");
        svg.appendChild(inner);

        // 标签固定在图标右下角
        if (style.showName) svg.appendChild(createStyleSampleLabel('A', 64, 90, style.color));
    }else if (type === 'line') {
        // 45° 斜线，穿过图标中心；标签放在右下角
        const line = document.createElementNS(svgNS, "line");
        line.setAttribute("x1", 14);
        line.setAttribute("y1", 86);
        line.setAttribute("x2", 86);
        line.setAttribute("y2", 14);
        line.setAttribute("stroke", style.color);
        line.setAttribute("stroke-width", 6 * width);
        line.setAttribute("stroke-linecap", "round");
        // 虚线样例：段长也按「实线段 + 空白」那样断开，与画布上的虚线一致
        if (style.dashed) line.setAttribute("stroke-dasharray", `${18 * width} ${13 * width}`);
        svg.appendChild(line);
        if (style.showName) svg.appendChild(createStyleSampleLabel('a', 60, 80, style.color));
    }else if (type === 'circle') {
        const circle = document.createElementNS(svgNS, "circle");
        circle.setAttribute("cx", 50);
        circle.setAttribute("cy", 50);
        circle.setAttribute("r", 34);
        circle.setAttribute("stroke", style.color);
        circle.setAttribute("stroke-width", 6 * width);
        circle.setAttribute("fill", "transparent");
        if (style.dashed) circle.setAttribute("stroke-dasharray", `${18 * width} ${13 * width}`);
        svg.appendChild(circle);
        if (style.showName) svg.appendChild(createStyleSampleLabel('c', 52, 62, style.color));
    }
    return svg;
}

/**
 * 样式样例中的标签 过程函数
 * @param {string} text 标签文字
 * @param {number} x 
 * @param {number} y 
 * @param {string} color 
 * @returns {Object} SVG元素
 */
function createStyleSampleLabel(text, x, y, color) {
    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.setAttribute("x", x);
    label.setAttribute("y", y);
    label.setAttribute("font-size", "34");
    label.setAttribute("font-weight", "bold");
    label.setAttribute("fill", color);
    label.setAttribute("stroke", "none");
    label.textContent = text;
    return label;
}
