/* stylePanel.js */
/**
 * 样式面板：颜色 / 粗细（点的大小） / 标签显示
 * 画板（board.html 用 tool.js）与关卡游玩（level.html 用 toolPlayPage.js）共用，
 * 因此这里只依赖两边都有的全局量：
 * tool、geometryManager、geometryStyle、drawStyle()、refreshToolFloating()、drawContent()
 */

// 粗细档位：点的大小（小中大）与线、圆的粗细（细中粗），默认值 1 为「中」
const styleWidths = [
    {value: 0.5, name: '细', pointName: '小'},
    {value: 1, name: '中', pointName: '中'},
    {value: 1.5, name: '粗', pointName: '大'},
];

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
    colorInput.click();
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
 * 颜色 / 粗细（点的大小） / 标签显示，既可用于后续绘制的图形，也可用于已选中的对象
 * @param {Object} options
 *   - anchor 弹层的定位按钮
 *   - key 弹层标识，同一按钮再次点击时收起
 *   - isPoint 点样式（“大小”而非“粗细”）
 *   - get() 读取当前样式 {color, width, showName}
 *   - apply(patch) 应用样式变更
 */
function openStylePopup(options) {
    const {anchor, key, isPoint, get, apply} = options;
    const opened = document.querySelector('.style-popup.open');
    closeStylePopups();
    if (opened && opened.dataset.key === key) return;

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
        const colorRow = addRow('颜色');
        const colorButton = document.createElement('button');
        colorButton.type = 'button';
        colorButton.className = 'style-popup-color';
        colorButton.style.backgroundColor = style.color;
        colorButton.setAttribute('aria-label', '选择颜色');
        colorButton.addEventListener('click', () => {
            let picked = style.color;
            const applyColor = live => { apply({color: picked, colorChoice: 'color'}, live); draw(); };
            pickStyleColor(style.color, color => { picked = color; applyColor(true); }, () => applyColor(false));
        });
        colorRow.appendChild(colorButton);

        // 粗细 / 大小
        const widthRow = addRow(isPoint ? '大小' : '粗细');
        styleWidths.forEach(item => addOption(widthRow, isPoint ? item.pointName : item.name, Math.abs(width - item.value) < 0.01, () => { apply({width: item.value}); draw(); }));

        // 标签：一个开关（开 = 显示标签，关 = 不显示）
        const labelRow = addRow('标签');
        const switchButton = document.createElement('button');
        switchButton.type = 'button';
        switchButton.className = 'style-popup-switch';
        switchButton.setAttribute('role', 'switch');
        switchButton.setAttribute('aria-checked', String(!!style.showName));
        switchButton.setAttribute('aria-label', '显示标签');
        switchButton.title = style.showName ? '显示标签' : '不显示标签';
        if (style.showName) switchButton.classList.add('active');
        const knob = document.createElement('span');
        knob.className = 'style-popup-switch-knob';
        switchButton.appendChild(knob);
        switchButton.addEventListener('click', () => { apply({showName: !style.showName}); draw(); });
        labelRow.appendChild(switchButton);

        // 隐藏对象（只有「调整已选中对象的样式」这个弹层有）：点一下就把当前对象藏起来
        if (options.showHide) {
            const hideRow = addRow('隐藏');
            const hidden = style.visible === false;
            const hideSwitch = document.createElement('button');
            hideSwitch.type = 'button';
            hideSwitch.className = 'style-popup-switch';
            hideSwitch.setAttribute('role', 'switch');
            hideSwitch.setAttribute('aria-checked', String(hidden));
            hideSwitch.setAttribute('aria-label', '隐藏对象');
            hideSwitch.title = hidden ? '已隐藏，点一下恢复显示' : '点一下隐藏这个对象';
            if (hidden) hideSwitch.classList.add('active');
            const knob2 = document.createElement('span');
            knob2.className = 'style-popup-switch-knob';
            hideSwitch.appendChild(knob2);
            hideSwitch.addEventListener('click', () => { apply({visible: hidden ? true : false}); draw(); });
            hideRow.appendChild(hideSwitch);
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
        get: () => geometryStyle[type],
        apply: patch => {
            Object.assign(geometryStyle[type], patch);
            drawStyle(type);
            drawContent();
        },
    });
}

/**
 * 调整已选中对象的样式 过程函数
 * @param {Object} [anchor] 弹层定位按钮
 */
function openObjectStylePopup(anchor) {
    const button = anchor || document.getElementById(`button-${tool}-objectStyle`);
    const element = getSelectedElement();
    if (!button || !element) return;
    openStylePopup({
        anchor: button,
        key: 'object',
        isPoint: element.getType() === 'point',
        // 这个弹层多一个「隐藏」开关（非游玩模式才能隐藏对象）
        showHide: true,
        get: () => ({color: element.getColor(), width: element.getWidth(), showName: element.getShowName(), visible: element.getVisible()}),
        apply: (patch, live) => {
            if (patch.color) element.modifyColor(patch.color);
            if (patch.width) element.modifyWidth(patch.width);
            if (patch.showName !== undefined) element.modifyShowName(patch.showName);
            if (patch.visible !== undefined) setElementVisible(element, patch.visible);
            refreshToolFloating();
            drawContent();
            // 记入撤销/重做历史（取色拖动中的中间状态不记）
            if (!live) notifyStorageChange('style');
        },
    });
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
    const done = () => { if (typeof onChange === 'function') onChange(); };
    // 撤销 / 重做会把图形整批重建（重新解析 gmt 文本），详情面板手里那个旧对象就脱离了画板，
    // 再调它的样式自然看不出变化 —— 所以一律按 id 现取当前对象，不缓存引用
    const targetId = typeof element.getId === 'function' ? element.getId() : null;
    const current = () => (targetId && typeof geometryManager !== 'undefined' && geometryManager.get(targetId)) || element;
    // 控件只在自己这一层里重画：直接清空容器会把同一列里别的行（例如「有效性」）一起清掉
    const holder = document.createElement('div');
    holder.className = 'style-inline-holder';
    container.appendChild(holder);
    const draw = () => {
        const target = current();
        holder.innerHTML = '';
        const isPoint = target.getType() === 'point';
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
            const roColorRow = addRow('颜色');
            const swatch = document.createElement('span');
            swatch.className = 'style-popup-color';
            swatch.style.backgroundColor = target.getColor();
            roColorRow.appendChild(swatch);

            const roWidthRow = addRow(isPoint ? '大小' : '粗细');
            const widthText = document.createElement('span');
            widthText.className = 'style-inline-value';
            widthText.textContent = String(target.getWidth() || 1);
            roWidthRow.appendChild(widthText);

            const roLabelRow = addRow('标签');
            const labelText = document.createElement('span');
            labelText.className = 'style-inline-value';
            labelText.textContent = target.getShowName() ? '显示' : '不显示';
            roLabelRow.appendChild(labelText);

            const roHideRow = addRow('隐藏');
            const hideText = document.createElement('span');
            hideText.className = 'style-inline-value';
            hideText.textContent = target.getVisible() ? '否' : '是';
            roHideRow.appendChild(hideText);
            return;
        }

        // 颜色
        const colorRow = addRow('颜色');
        const colorButton = document.createElement('button');
        colorButton.type = 'button';
        colorButton.className = 'style-popup-color';
        colorButton.style.backgroundColor = target.getColor();
        colorButton.setAttribute('aria-label', '选择颜色');
        colorButton.addEventListener('click', () => {
            let picked = current().getColor();
            const applyColor = live => {
                current().modifyColor(picked);
                // 拖动取色时也要立刻反映：预览色块跟着变，画布立即重绘（与弹层那套一致）
                colorButton.style.backgroundColor = picked;
                if (typeof drawContent === 'function') drawContent();
                if (!live) done();
            };
            pickStyleColor(picked, color => { picked = color; applyColor(true); }, () => applyColor(false));
        });
        colorRow.appendChild(colorButton);

        // 粗细 / 大小
        const widthRow = addRow(isPoint ? '大小' : '粗细');
        const width = target.getWidth() || 1;
        styleWidths.forEach(item => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'style-popup-option';
            button.textContent = isPoint ? item.pointName : item.name;
            if (Math.abs(width - item.value) < 0.01) button.classList.add('active');
            button.addEventListener('click', () => { current().modifyWidth(item.value); draw(); done(); });
            widthRow.appendChild(button);
        });

        // 标签开关
        const labelRow = addRow('标签');
        const labelSwitch = document.createElement('button');
        labelSwitch.type = 'button';
        labelSwitch.className = 'style-popup-switch';
        labelSwitch.setAttribute('role', 'switch');
        labelSwitch.setAttribute('aria-checked', String(!!target.getShowName()));
        labelSwitch.setAttribute('aria-label', '显示标签');
        labelSwitch.title = target.getShowName() ? '显示标签' : '不显示标签';
        if (target.getShowName()) labelSwitch.classList.add('active');
        const knob = document.createElement('span');
        knob.className = 'style-popup-switch-knob';
        labelSwitch.appendChild(knob);
        labelSwitch.addEventListener('click', () => { const item = current(); item.modifyShowName(!item.getShowName()); draw(); done(); });
        labelRow.appendChild(labelSwitch);

        // 隐藏对象
        const hideRow = addRow('隐藏');
        const hidden = !target.getVisible();
        const hideSwitch = document.createElement('button');
        hideSwitch.type = 'button';
        hideSwitch.className = 'style-popup-switch';
        hideSwitch.setAttribute('role', 'switch');
        hideSwitch.setAttribute('aria-checked', String(hidden));
        hideSwitch.setAttribute('aria-label', '隐藏对象');
        hideSwitch.title = hidden ? '已隐藏，点一下恢复显示' : '点一下隐藏这个对象';
        if (hidden) hideSwitch.classList.add('active');
        const knob2 = document.createElement('span');
        knob2.className = 'style-popup-switch-knob';
        hideSwitch.appendChild(knob2);
        hideSwitch.addEventListener('click', () => { const item = current(); setElementVisible(item, !item.getVisible()); draw(); done(); });
        hideRow.appendChild(hideSwitch);
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
    }else{
        buttonDE.classList.add('disable');
        svg.classList.add('disable');
        // 选中没了，已经展开的「调整对象样式」弹层也要收起来（撤销清掉选中时就是这条路径）
        if (typeof closeObjectStylePopup === 'function') closeObjectStylePopup();
    }
}

/**
 * 样式样例图形 过程函数
 * 用于样式按钮的预览：颜色、粗细（点的大小）、是否带标签
 * @param {string} type 'point' | 'line' | 'circle'
 * @param {Object} style {color, width, showName}
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
