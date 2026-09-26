/* tool.js */
let tool, menuTool, subTool;
const toolMenus = {
    'standard': [
        'move', 'point', 'line', 'circle', 'intersection', 
        'parallelLine', 'perpendicularLine', 'perpendicularBisector', 'angleBisector',
        'compass', 'middlePoint', 'threePointCircle'
    ],
}
const toolMenuDefaultValue = {
    'standard': "line",
}
const toolItems = {
    'move': {
        'switch': ["choiceDraw", "moveView"],
        "button": ["restoreTransform", "objectStyle", "deleteObject", "clear"],
    },
    'point': {
        "button": ["pointStyle"],
    },
    'eraser': {
        "switch": ["any", "choicePoint"],
    },
    'line': {
        "switch": ["line", "style"],
        "button": ["clear", "lineStyle"],
        "choice": {"line": {"point1": 'point', "point2": 'point'}},
    },
    'ray': {
        "switch": ["ray", "style"],
        "button": ["clear", "lineStyle"],
        "choice": {"ray": {"point1": 'point', "point2": 'point'}},
    },
    'lineSegment': {
        "switch": ["lineSegment", "style"],
        "button": ["clear", "lineStyle"],
        "choice": {"lineSegment": {"point1": 'point', "point2": 'point'}},
    },
    'circle': {
        "button": ["clear", "circleStyle"],
        "choice": {"general": {"point1": 'point', "point2": 'point'}},
    },
    'intersection': {
        "button": ["clear", "pointStyle"],
        "choice": {"general": {"choice1": 'any', "choice2": 'any'}},
    },
    'parallelLine': {
        "button": ["clear", "lineStyle"], 
        "choice": {"general": {"point": 'point', "line": 'line'}},
    }, 
    'perpendicularLine': {
        "button": ["clear", "lineStyle"], 
        "choice": {"general": {"point": 'point', "line": 'line'}},
    }, 
    'perpendicularBisector': {
        "button": ["clear", "lineStyle"], 
        "choice": {"general": {"point1": 'point', "point2": 'point'}},
    }, 
    'angleBisector': {
        // 关卡游玩里角平分线只有三点一种用法：不给小项切换，浮层里也就不铺小项按钮
        "button": ["clear", "lineStyle"], 
        "choice": {"general": {"point1": 'point', "point2": 'point', "point3": 'point'}},
    }, 
    'compass': {
        // 同角平分线：关卡游玩的圆规固定为三点圆规
        "button": ["clear", "circleStyle"], 
        "choice": {"general": {"point1": 'point', "point2": 'point', "point3": 'point'}},
    }, 
    'middlePoint': {
        'switch': ["twoPointsMiddlePoint", "circleCenter"], 
        "button": ["clear", "pointStyle"], 
        "choice": {"twoPointsMiddlePoint": {"point1": 'point', "point2": 'point'}, 
            "circleCenter": {"circle": 'circle'}},
    }, 
    'threePointCircle': {
        "button": ["clear", "circleStyle"], 
        "choice": {"general": {"point1": 'point', "point2": 'point', "point3": 'point'}},
    }, 
}

// 游玩页（关卡模式与试玩）不提供任何样式调节入口：对象样式按钮、点/直线/圆样式配置与样式刷，
// 颜色交给关卡本身决定，保证游戏性
Object.values(toolItems).forEach(item => {
    if (item.button) item.button = item.button.filter(name => !name.endsWith('Style'));
    if (item.switch) {
        item.switch = item.switch.filter(name => name !== 'style');
        // 「样式刷」被移除后若只剩一个模式，切换按钮就没有意义了
        if (item.switch.length < 2) delete item.switch;
    }
});

/**
 * 生成工具项
 * @param {string} selectMenuTool 
 */
function generateTool(selectMenuTool) {
    // 清空工具栏
    const toolbar = document.getElementById('container_toolbar');
    toolbar.innerHTML= '';

    // 遍历添加文档元素（关卡限定工具时只生成允许的那几个，探索模式不限制）
    const allowed = typeof allowedPlayTools === 'function' ? allowedPlayTools() : null;
    const toolsList = (toolMenus[selectMenuTool] || []).filter(item => !allowed || allowed.includes(item));
    toolsList.forEach((item) => {
        const toolDocumentElement = document.createElement('button');
        toolDocumentElement.classList.add('tool-item');
        toolDocumentElement.classList.add('svg-button');
        toolDocumentElement.id = `button-${item}-tool`;
        toolDocumentElement.setAttribute('data-action', item);

        const template = document.getElementById(`svg-${item}`);
        if (template) {
            toolDocumentElement.innerHTML = template.innerHTML;
        }

        toolbar.appendChild(toolDocumentElement);
    })

    toolbar.style.display = 'none';
    toolbar.offsetHeight;
    toolbar.style.display = 'flex';
    // 默认工具被限制掉时退到第一个可用的（比如单规关卡没有直线）
    const defaultTool = toolMenuDefaultValue[selectMenuTool];
    const firstTool = toolsList.includes(defaultTool) ? defaultTool : toolsList[0];
    if (firstTool) choiceTool(firstTool); else drawContent();
}

/**
 * 加载工具小项
 */
function loadToolSwitchButton(tool) {
    const toolSwitchButton = document.getElementById("floating-bar-buttons");
    const toolSwitchs = toolItems[tool]?.switch;
    const toolButtons = toolItems[tool]?.button;
    toolSwitchButton.innerHTML = "";
    
    if (toolSwitchs) {
        toolSwitchs.forEach((element) => {
            const toolDocumentElement = document.createElement('button');
            toolDocumentElement.classList.add('tool-switch-item');
            toolDocumentElement.classList.add('floating-svg-switch-button');
            toolDocumentElement.id = `button-${tool}-${element}`;
            toolDocumentElement.setAttribute('data-action', element);
    
            const template = document.getElementById(`svg-${element}`);
            if (template) {
                toolDocumentElement.innerHTML = template.innerHTML;
            }
            
            // 添加
            toolSwitchButton.appendChild(toolDocumentElement);
        });
    }
    
    if (toolButtons) {
        toolButtons.forEach((element) => {
            const toolDocumentElement = document.createElement('button');
            toolDocumentElement.classList.add('floating-svg-button');
            toolDocumentElement.id = `button-${tool}-${element}`;
            toolDocumentElement.setAttribute('data-action', element);
    
            const template = document.getElementById(`svg-${element}`);
            if (template) {
                toolDocumentElement.innerHTML = template.innerHTML;
            }
            
            // 添加
            toolSwitchButton.appendChild(toolDocumentElement);
        });
    }

    refreshToolFloating();
    toolSwitchButton.style.display = 'none';
    toolSwitchButton.offsetHeight;
    toolSwitchButton.style.display = 'flex';
}

/**
 * 加载工具选中项
 */
function loadChoice(tool) {
    const toolChoiceDocumentElement = document.getElementById("floating-bar-elements");
    toolChoiceDocumentElement.innerHTML = "";
    createToolChoiceItems();
    
    function createToolChoiceItems() {
        // 刷新工具的选中表
        const choiceDict = toolItems[tool]?.choice;
        if (!choiceDict) return;
        // 对应工具的切换表
        let subChoiceDict;
        if (Object.keys(choiceDict).includes('general')) {
            subChoiceDict = choiceDict.general;
        }else{
            subChoiceDict = choiceDict[subTool];
        }
        if (!subChoiceDict) return;
        // 遍历项填图
        let count = 0;
        for (const value of Object.values(subChoiceDict)) {
            count++;
            const toolDocumentElement = createToolChoice(tool, value, count)
            toolChoiceDocumentElement.appendChild(toolDocumentElement);
        }
    }
    
    function createToolChoice(tool, element, count) {
        const toolDocumentElement = document.createElement('div');
        toolDocumentElement.classList.add('floating-svg-choice');
        toolDocumentElement.id = `choice-${tool}-${element}${count}`;

        const template = document.getElementById(`svg-${element}`);
        if (template) {
            toolDocumentElement.innerHTML = template.innerHTML;
        }

        return toolDocumentElement;
    }
    
    toolChoiceDocumentElement.style.display = 'none';
    toolChoiceDocumentElement.offsetHeight;
    toolChoiceDocumentElement.style.display = 'flex';
}

// 移动工具下临时染蓝的给定自由点：记下它们本来的颜色，退出移动工具时还原
const givenFreePointColors = new Map();

/**
 * 给定里的自由点 过程函数
 * initial / named 中基准类型为 none（坐标定义的点）或 online（线上点）的点：
 * 移动工具下它们和可移动点一样可以拖动，所以也要临时显示成蓝色
 * @returns {string[]} 对象 ID 列表
 */
function givenFreePointIds() {
    const ids = [...(geometryElementLists.initial || []), ...(geometryElementLists.named || [])];
    return ids.filter((id) => {
        const element = geometryManager.get(id);
        if (!element || element.getType() !== 'point') return false;
        const baseType = element.getBase()?.type;
        return baseType === 'none' || baseType === 'online';
    });
}

/**
 * 显示隐藏移动点
 * 移动工具下：可移动点显示出来、给定里的自由点临时变蓝；退出时把颜色还原
 * @param {boolean} bool 
 */
function showMovePoints(bool) {
    const idList = [...geometryElementLists.movepoints];
    idList.forEach((item) => {
        const element = geometryManager.get(item);
        if (element) element.modifyVisible(bool);
    });
    if (bool) {
        givenFreePointIds().forEach((id) => {
            const element = geometryManager.get(id);
            if (!element) return;
            if (!givenFreePointColors.has(id)) givenFreePointColors.set(id, element.getColor());
            element.modifyColor('#0099ff');
        });
    }else{
        givenFreePointColors.forEach((color, id) => geometryManager.get(id)?.modifyColor(color));
        givenFreePointColors.clear();
    }
}

/**
 * 选中工具栏 过程函数
 * @param {string} selectTool
 */
function choiceToolMenu(selectTool) {
    menuTool = selectTool;
    generateTool(selectTool);
    drawContent();
}

/**
 * 清掉某个工具「画到一半」的选中
 * 切工具时不清的话，切回那个工具会发现上一次选的图形还挂着
 * @param {string} previousTool
 */
function clearPendingToolChoice(previousTool) {
    if (!previousTool || typeof tools === 'undefined' || !tools[previousTool]) return;
    if (typeof tools[previousTool].clear === 'function') tools[previousTool].clear();
    // 工具自己的 clear 只清当前管理器，关卡页有两套（正式 / 探索），都清一次
    [typeof geometryManager === 'undefined' ? null : geometryManager,
        typeof geometryManagerResult === 'undefined' ? null : geometryManagerResult,
        typeof geometryManagerExplore === 'undefined' ? null : geometryManagerExplore]
        .forEach(manager => {
            if (manager && manager.ifToolInCache(previousTool)) manager.deleteTool(previousTool);
        });
}

/**
 * 选中工具 过程函数
 * @param {string} selectTool
 */
function choiceTool(selectTool) {
    // 切工具时先把上一个工具已经选中的图形清掉：画到一半的状态不该跨工具留着
    const previousTool = typeof tool === 'undefined' ? null : tool;
    if (previousTool && previousTool !== selectTool) clearPendingToolChoice(previousTool);
    
    if (selectTool) {
        const buttons = document.querySelectorAll('.tool-item');
        // 移除所有按钮的选中状态
        buttons.forEach(btn => {
            btn.classList.remove('active');
        });
    }
    
    if (selectTool) {
        if (tool === 'move') showMovePoints(false);
        tool = selectTool;
        subTool = null;
        document.getElementById(`button-${selectTool}-tool`).classList.add('active');
        subTool = selectTool;
        loadChoice(selectTool);
        loadToolSwitchButton(selectTool);
        const switchList = toolItems[tool]?.switch;
        if (switchList) choiceToolSwitch(switchList[0]);
        // 只在真的换了工具时才把光标位置归零：重选当前工具也归零的话，
        // 预览（草稿图）会按 (0,0) 算，看上去就是「预览跳到画布左上角」
        if (previousTool !== selectTool) pointerPosition.x = 0, pointerPosition.y = 0;
        if (menuTool === 'construct') {
            toolMenuDefaultValue.construct = selectTool;
        }
    }
    refreshConstructMenuCorner();
    drawContent();
}

/**
 * 选中工具小项 过程函数
 * @param {string} tool
 */
function choiceToolSwitch(selectTool) {
    const buttons = document.querySelectorAll('.tool-switch-item');
    // 移除所有按钮的选中状态
    buttons.forEach(btn => {
        btn.classList.remove('active');
    });

    if (subTool === 'choiceDraw') showMovePoints(false);
    subTool = selectTool;
    document.getElementById(`button-${tool}-${selectTool}`).classList.add('active');
    if (subTool === 'choiceDraw') showMovePoints(true);
    drawContent();
    loadChoice(tool);
    refreshToolFloating();
}

/**
 * 刷新构造档右下角的「当前高级工具」角标 过程函数
 * 与 tool.js 一致（角标持续显示最近选过的那个高级工具）；游玩页没有分类按钮时直接跳过
 */
// 角标上显示的高级工具（跨档保留）
let constructMenuCornerTool = null;

function refreshConstructMenuCorner() {
    const corner = document.getElementById('construct-menu-corner');
    if (!corner) return;
    const constructTools = typeof toolMenus === 'undefined' ? [] : (toolMenus.construct || []);
    // 只有从构造档里选中的工具才算数（游玩页没有分类按钮，这里一直不会命中）
    if (menuTool === 'construct' && constructTools.includes(tool)) constructMenuCornerTool = tool;
    // 还没选过任何高级工具时，用构造档的默认工具兜底
    if (!constructMenuCornerTool && constructTools.length) {
        constructMenuCornerTool = (typeof toolMenuDefaultValue !== 'undefined' && toolMenuDefaultValue.construct) || constructTools[0];
    }
    const template = constructMenuCornerTool ? document.getElementById(`svg-${constructMenuCornerTool}`) : null;
    corner.innerHTML = template ? template.innerHTML : '';
    corner.classList.toggle('show', !!template);
}

/**
 * 刷新工具菜单栏
 */
function refreshMenuTool() {
    // 分类按钮保持各自的图标（同 tool.js：不再把构造档的图标换成当前工具的图标）
    
    const menuToolbar = document.getElementById("menu_toolbar");
    // 读一次布局属性就够强制回流了：不要做 display:none → flex 的往返 ——
    // 那会把正在播放的宽度过渡打断（手机端点构造档工具时，分类按钮正在从 70px 缩回 45px），
    // 表现就是「其他按钮有变窄动画、构造档按钮却直接突变窄」（见 index.js 的 toolbarChoice）
    void menuToolbar.offsetHeight;
}

/**
 * 刷新工具浮动栏
 */
function refreshToolFloating() {
    if (panelState !== "toolbarPanel") return;
    // 刷新按钮
    const buttons = toolItems[tool]?.button;
    if (buttons) {
        buttons.forEach((item) => {
            if (item === 'restoreTransform') {
                setRestoreTransformAble(item);
            }else if (item === 'clear'){
                setClearChoiceAble(item);
            }else if (item === 'pointStyle'){
                drawStyle("point");
            }else if (item === 'lineStyle'){
                drawStyle("line");
            }else if (item === 'circleStyle'){
                drawStyle("circle");
            }else if (item === 'objectStyle'){
                setObjectStyleAble(item);
            }else if (item === 'deleteObject'){
                setDeleteObjectAble(item);
            }
        })
    }

    // 刷新工具的选中表
    const choiceDict = toolItems[tool]?.choice;
    if (!choiceDict) return;
    // 对应工具的切换表
    let subChoiceDict;
    if (Object.keys(choiceDict).includes('general')) {
        subChoiceDict = choiceDict.general;
    }else{
        subChoiceDict = choiceDict[subTool];
    }
    if (!subChoiceDict) return;
    // 遍历项填图
    let count = 0;
    for (const [key, value] of Object.entries(subChoiceDict)) {
        count++;
        const item = geometryManager.getToolKey(tool, key);
        // 标记等操作会切换内部工具但不重建浮动栏，此时选中项按钮可能不存在
        const buttonDE = document.getElementById(`choice-${tool}-${value}${count}`);
        if (!buttonDE) continue;
        if (item) {
            buttonDE.classList.remove('disable');
            buttonDE.innerHTML = "";
            const type = item.getType();
            const svg = createThumbnailSVG(item, type);
            buttonDE.appendChild(svg);
        }else{
            buttonDE.classList.add('disable');
            const template = document.getElementById(`svg-${value}`);
            if (template) {
                buttonDE.innerHTML = template.innerHTML;
            }
            const svg = buttonDE.querySelector('svg');
            if (svg) svg.classList.add('disable');
        }
    }

    function setRestoreTransformAble(item) {
        const buttonDE = document.getElementById(`button-${tool}-${item}`);
        // 标记等操作会切换内部工具但不重建浮动栏，此时按钮可能不存在
        if (!buttonDE) return;
        const svg = buttonDE.querySelector('svg');
        if (!svg) return;
        if (transform.x !== 0 || transform.y !== 0 || transform.scale !== 1) {
            buttonDE.classList.remove('disable');
            svg.classList.remove('disable');
        }else{
            buttonDE.classList.add('disable');
            svg.classList.add('disable');
        }
    }
    // 删除选中对象：只有移动工具选中了「可以删的对象」时才亮（关卡自带的图形不给删）
    function setDeleteObjectAble(item) {
        const buttonDE = document.getElementById(`button-${tool}-${item}`);
        if (!buttonDE) return;
        const svg = buttonDE.querySelector('svg');
        const choice = geometryManager.getToolKey(tool, 'choice');
        const protectedElement = choice && typeof isProtectedElement === 'function' && isProtectedElement(choice.getId());
        const able = !!choice && !protectedElement;
        buttonDE.classList.toggle('disable', !able);
        if (svg) svg.classList.toggle('disable', !able);
    }
    function setClearChoiceAble(item) {
        const buttonDE = document.getElementById(`button-${tool}-${item}`);
        // 标记等操作会切换内部工具但不重建浮动栏，此时按钮可能不存在
        if (!buttonDE) return;
        const svg = buttonDE.querySelector('svg');
        if (!svg) return;
        if (geometryManager.ifToolInCache(tool)) {
            buttonDE.classList.remove('disable');
            svg.classList.remove('disable');
        }else{
            buttonDE.classList.add('disable');
            svg.classList.add('disable');
        }
    }
    function createThumbnailSVG(element, type) {
        const svgNS = "http://www.w3.org/2000/svg";
        const size = 200;
        const svg = document.createElementNS(svgNS, "svg");
        svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
        
        if (type === "point") {
            // 中心圆点
            const centerX = size / 2;
            const centerY = size / 2;
            const color = element.getColor();
            
            const centerCircle = document.createElementNS(svgNS, "circle");
            centerCircle.setAttribute("cx", centerX);
            centerCircle.setAttribute("cy", centerY);
            centerCircle.setAttribute("r", "15");
            centerCircle.setAttribute("stroke", color);
            centerCircle.setAttribute("stroke-width", '10');
            centerCircle.setAttribute("fill", 'white');
            svg.appendChild(centerCircle);
        }else if (type === "line") {
            // 直线
            const color = element.getColor();
            const coordList = element.getCoordinate();
            const [x1, y1] = coordList[0];
            const [x2, y2] = coordList[1];
            const dx = x1 - x2;
            const dy = y1 - y2;
            const angle = Math.atan2(dy, dx);
            
            const lineLength = size * 0.4; // 线长为方块的40%
            const radian = angle;
            const centerX = size / 2;
            const centerY = size / 2;
            
            const startX = centerX - lineLength * Math.cos(radian);
            const startY = centerY - lineLength * Math.sin(radian);
            const endX = centerX + lineLength * Math.cos(radian);
            const endY = centerY + lineLength * Math.sin(radian);
            
            const directionLine = document.createElementNS(svgNS, "line");
            directionLine.setAttribute("x1", startX);
            directionLine.setAttribute("y1", startY);
            directionLine.setAttribute("x2", endX);
            directionLine.setAttribute("y2", endY);
            directionLine.setAttribute("stroke", color);
            directionLine.setAttribute("stroke-width", "10");
            directionLine.setAttribute("stroke-linecap", "round");
            svg.appendChild(directionLine);

            // 端点
            const point1 = document.createElementNS(svgNS, "circle");
            point1.setAttribute("cx", startX);
            point1.setAttribute("cy", startY);
            point1.setAttribute("r", "15");
            point1.setAttribute("stroke", color);
            point1.setAttribute("stroke-width", '10');
            point1.setAttribute("fill", 'white');
            svg.appendChild(point1);

            const point2 = document.createElementNS(svgNS, "circle");
            point2.setAttribute("cx", endX);
            point2.setAttribute("cy", endY);
            point2.setAttribute("r", "15");
            point2.setAttribute("stroke", color);
            point2.setAttribute("stroke-width", '10');
            point2.setAttribute("fill", 'white');
            svg.appendChild(point2);
        }else if (type === "circle") {
            // 圆圈
            const centerX = size / 2;
            const centerY = size / 2;
            const color = element.getColor();
            const coordList = element.getCoordinate();
            const [x1, y1] = coordList[0];
            const [x2, y2] = coordList[1];
            const dx = x1 - x2;
            const dy = y1 - y2;
            const angle = Math.atan2(dy, dx);
            
            const radius = size * 0.4;
            const radian = angle;
            const endX = centerX - radius * Math.cos(radian);
            const endY = centerY - radius * Math.sin(radian);
            
            const centerCircle = document.createElementNS(svgNS, "circle");
            centerCircle.setAttribute("cx", centerX);
            centerCircle.setAttribute("cy", centerY);
            centerCircle.setAttribute("r", radius);
            centerCircle.setAttribute("stroke", color);
            centerCircle.setAttribute("stroke-width", '10');
            centerCircle.setAttribute("fill", 'transparent');
            svg.appendChild(centerCircle);

            // 点点
            const point1 = document.createElementNS(svgNS, "circle");
            point1.setAttribute("cx", centerX);
            point1.setAttribute("cy", centerY);
            point1.setAttribute("r", "15");
            point1.setAttribute("stroke", color);
            point1.setAttribute("stroke-width", '10');
            point1.setAttribute("fill", 'white');
            svg.appendChild(point1);

            const point2 = document.createElementNS(svgNS, "circle");
            point2.setAttribute("cx", endX);
            point2.setAttribute("cy", endY);
            point2.setAttribute("r", "15");
            point2.setAttribute("stroke", color);
            point2.setAttribute("stroke-width", '10');
            point2.setAttribute("fill", 'white');
            svg.appendChild(point2);
        }
        // 名称
        const text = document.createElementNS(svgNS, "text");
        text.setAttribute("x", size * 0.1);
        text.setAttribute("y", size * 0.9);
        text.setAttribute("fill", "rgba(25, 25, 25, 1)");
        text.setAttribute("stroke", "rgba(200, 200, 200, 1)");
        text.setAttribute("stroke-width", "3");
        text.setAttribute("font-size", "60");
        text.setAttribute("font-weight", "bold");
        text.textContent = element.getName();
        svg.appendChild(text);
        
        return svg;
    }
}

/**
 * 绘制样式按钮 过程函数
 * 样式按钮本身就是当前样式的预览：颜色、粗细（点的大小）、是否带标签
 * @param {string} type 'point' | 'line' | 'circle'
 */
function drawStyle(type) {
    const buttonDE = document.getElementById(`button-${tool}-${type}Style`);
    if (!buttonDE) return;
    buttonDE.innerHTML = "";
    buttonDE.appendChild(createStyleSample(type, geometryStyle[type]));
}

/**
 * 工具浮动按钮点击
 * @param {string} action
 * @param {Object} [event] 触发事件（样式弹层需要阻止冒泡，避免被全局收起逻辑立即关闭）
 */
function clickToolFloatingButton(action, event) {
    if (action === 'restoreTransform') {
        resetTransform();
    }else if (action === 'clear') {
        tools[tool].clear();
    }else if (action === 'pointStyle' || action === 'lineStyle' || action === 'circleStyle') {
        // 配置后续绘制的图形样式：颜色 / 粗细 / 标签
        event?.stopPropagation();
        openStyleConfigPopup(action.slice(0, -'Style'.length));
    }else if (action === 'objectStyle') {
        // 调整已选中对象的样式
        event?.stopPropagation();
        openObjectStylePopup();
    }else if (action === 'deleteObject') {
        // 删除移动工具选中的对象：连同它的所有子对象（依赖它作出来的图形）一起删，可撤销。
        // 关卡自带的图形（给定 / 关卡预绘制）是题目的一部分，不允许删掉
        const choice = geometryManager.getToolKey(tool, 'choice');
        if (choice && typeof isProtectedElement === 'function' && isProtectedElement(choice.getId())) {
            if (typeof boardToast === 'function') boardToast('这是关卡给定的图形，不能删除');
        }else if (choice) {
            geometryManager.deleteObject(choice.getId());
            geometryManager.deleteTool(tool);
            window.dispatchEvent(new CustomEvent('storage', {detail: {type: 'delete'}}));
        }
    }
    drawContent();
    refreshToolFloating();
}

/**
 * 事件处理 过程函数
 * @param {string} type
 * @param {number} x
 * @param {number} y
 */
function operateEventFunction(type, x, y) {
    tools[tool].toolEvent(type, x, y);
    drawContent();
    refreshToolFloating();
    // 画到一半时也要让撤销按钮亮起来（用来取消这次的半成品）
    refreshStorageButton();
}
