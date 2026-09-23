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
    };
    draw();

    document.body.appendChild(popup);
    popup.style.visibility = 'hidden';
    popup.classList.add('open');
    const rect = anchor.getBoundingClientRect();
    const box = popup.getBoundingClientRect();
    popup.style.left = `${Math.max(8, Math.min(rect.left, Math.max(8, window.innerWidth - box.width - 8)))}px`;
    popup.style.top = `${Math.min(rect.bottom + 8, Math.max(8, window.innerHeight - box.height - 8))}px`;
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
        get: () => ({color: element.getColor(), width: element.getWidth(), showName: element.getShowName()}),
        apply: (patch, live) => {
            if (patch.color) element.modifyColor(patch.color);
            if (patch.width) element.modifyWidth(patch.width);
            if (patch.showName !== undefined) element.modifyShowName(patch.showName);
            refreshToolFloating();
            drawContent();
            // 记入撤销/重做历史（取色拖动中的中间状态不记）
            if (!live) notifyStorageChange('style');
        },
    });
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
