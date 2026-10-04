/* index.js */
/*
数据交互

geometry.js
GeometryElementManager

toolsFunction.js
getLineBounds
myRound
*/

// 浏览器视口变化
// 手机那套布局（底部上拉栏）的判定：**窄屏或矮屏**都算 —— 手机横屏宽度过了 768，
// 可高度只有 390～430，这时用电脑版工具栏会吃掉半屏。阈值与 index.css 末尾的
// @media (max-width: 960px), (max-height: 500px) 保持一致
const EQUIPMENT_WIDTH = {
    MOBILE: 960,
    TABLET: 1024,
    DESKTOP: 1200,
}
const EQUIPMENT_HEIGHT = {
    MOBILE: 500,
}
let widthTypeEquipment;
function updateLayout() {
    const mobile = window.innerWidth <= EQUIPMENT_WIDTH.MOBILE
        || window.innerHeight <= EQUIPMENT_HEIGHT.MOBILE;
    widthTypeEquipment = mobile ? 'mobile' : 'tablet';
}
window.addEventListener('resize', updateLayout);

// 手势变量
// 按下之后要移够这么多像素才算「拖动」：手抖挪几像素不该被当成拖拽作图
// （见 mouseMoveEventFunction / mouseUpEventFunction，只用于左键作图；中键平移画布不受限制）
const dragThreshold = 15;
let startX, startY, startTime;
let isDragging = false;
// 鼠标是不是正按着：mousemove 里靠它区分「按住拖动」与「纯悬停」
// （松开之后的移动只是悬停，但 startX / startY 还停在上一次按下的位置）
let isPressing = false;
let touchDoubleFlag = false;
let touchType = 1;
let mouseType = 0;
let pointerPosition = {
    x: 0,
    y: 0,
}
let preX, preY, preDistance, preScaleCenterX, preScaleCenterY;

// 存储型变换变量
let transform = {
    x: 0,
    y: 0,
    scale: initialScale, // 初始视野，见 canvas.js
};

// 存储样式变量
// width：点的大小 / 线圆的粗细（1 为默认）；showName：是否显示标签
// 点默认显示标签（与 addObject 的默认策略一致），直线与圆默认不显示
let geometryStyle = {
    point: {colorChoice: "auto", color: "#191919", width: 1, showName: true}, 
    line: {colorChoice: "auto", color: "#191919", width: 1, showName: false, dashed: false}, 
    circle: {colorChoice: "auto", color: "#191919", width: 1, showName: false, dashed: false}
};

// 几何对象管理器
const geometryManager = new GeometryElementManager();
geometryManager.transform = transform;
geometryManager.geometryStyle = geometryStyle;
const storageManager = new StorageManager();
storageManager.setStatus(true);
storageManager.append(geometryManager.toStorage());

let geometryElementLists = {
    hidden: new Set(),
    initial: new Set(),
    named: new Set(),
    name: new Set(),
    movepoints: new Set(),
    result: new Set(),
    resultShown: new Set(),
    explore: new Set(),
};

// 工具
const tools = {
    move: new MoveTool(),
    eraser: new EraserTool(),
    styleBrush: new StyleBrushTool(),
    point: new PointTool(),
    line: new LineTool(),
    ray: new RayTool(),
    lineSegment: new LineSegmentTool(),
    lineType: new LineTypeTool(),
    circle: new CircleTool(),
    intersection: new IntersectionTool(),
    parallelLine: new ParallelConstructTool(),
    perpendicularLine: new PerpendicularConstructTool(),
    tangent: new TangentConstructTool(tangent),
    perpendicularBisector: new PerpendicularBisectorConstructTool(),
    middlePoint: new MiddlePointConstructTool(),
    threePointCircle: new ThreePointCircleConstructTool(),
    angleBisector: new AngleBisectorConstructTool(),
    compass: new CompassConstructTool(),
    fixedAngle: new FixedAngleConstructTool(),
};

/**
 * 获取起始坐标 接口函数
 * @return {[startX, startY]}
 */
function getStart() {
    return [startX, startY];
}

function clearLists() {
    geometryElementLists = {
        hidden: new Set(),
        initial: new Set(),
        named: new Set(),
        name: new Set(),
        movepoints: new Set(),
        result: new Set(),
        resultShown: new Set(),
        explore: new Set(),
    };
}

// 面板状态
let panelState;






/**
 * 触摸事件开始 过程函数
 * @param {Object} e 事件
 */
function touchstartEventFunction(e) {
    // 事件预处理
    e.preventDefault();
    const touches = e.touches;

    // 起始点记录
    startX = touches[0].clientX - canvasLeft;
    startY = touches[0].clientY - canvasTop;
    startTime = Date.now();

    pointerPosition.x = startX;
    pointerPosition.y = startY;
    preX = startX;
    preY = startY;
    // 坑点：touchstartEvent不能检测多指
    operateEventFunction("start", startX, startY);
}

/**
 * 触摸事件结束 过程函数
 * @param {Object} e 事件
 */
function touchendEventFunction(e) {
    // 事件预处理
    e.preventDefault();
    // 这一手势算不算拖动（在 touchmove 里移够距离才置位），要在复位之前取出来
    const dragged = isDragging;
    isDragging = false;
    // 手指抬起了：工具光标收掉（手机上没有「悬停」，不收就会卡在原地）
    if (typeof hidePointerCursor === 'function') hidePointerCursor();

    // 计算终点
    const endX = e.changedTouches[0].clientX - canvasLeft;
    const endY = e.changedTouches[0].clientY - canvasTop;

    // 坑点：注意touchendEvent时点数是少的，且每松开一个手指就触发一次
    // 状态触发
    if (touchType === 1) {
        if (dragged) {
            // 拖拽
            operateEventFunction("drawComplete", endX, endY);
        } else {
            // 点击（按住多久都算点击：手一直按着没挪地方，松手时不该按拖拽处理）
            operateEventFunction("click", endX, endY);
            if (typeof previewWaitForMove === 'function') previewWaitForMove(endX, endY);
        }
    }
    // 没有触点时还原
    if (e.touches.length === 0) {
        touchType = 1;
        touchDoubleFlag = false;
    }
}

/**
 * 触摸事件中断 过程函数
 * @param {Object} e 事件
 */
function touchcancelEventFunction(e) {
    // 还原
    isDragging = false;
    touchType = 1;
    touchDoubleFlag = false;
    // 触摸被系统取消了（来电 / 手势）：工具光标也收掉
    if (typeof hidePointerCursor === 'function') hidePointerCursor();
    drawContent();
    operateEventFunction("cancel", null, null);
}

/**
 * 触摸事件移动 过程函数
 * @param {Object} e 事件
 */
function touchmoveEventFunction(e) {
    // 预处理
    e.preventDefault();
    const touches = e.touches;
    refreshToolFloating();

    if (touches.length === 2) {
        // 双指
        if (!touchDoubleFlag) {
            // 起始坐标
            const x1 = touches[0].clientX - canvasLeft;
            const x2 = touches[1].clientX - canvasLeft;
            const y1 = touches[0].clientY - canvasTop;
            const y2 = touches[1].clientY - canvasTop;
            // 计算中心与距离
            const dx = x1 - x2;
            const dy = y1 - y2;
            preDistance = Math.sqrt(dx * dx + dy * dy);
            preScaleCenterX = (x1 + x2) / 2;
            preScaleCenterY = (y1 + y2) / 2;
            touchDoubleFlag = true;
        }
        // 目前坐标
        const x1 = touches[0].clientX - canvasLeft;
        const x2 = touches[1].clientX - canvasLeft;
        const y1 = touches[0].clientY - canvasTop;
        const y2 = touches[1].clientY - canvasTop;
        // 计算中心与距离
        const dx = x1 - x2;
        const dy = y1 - y2;
        const currentDistance = Math.sqrt(dx * dx + dy * dy);
        const currentScaleCenterX = (x1 + x2) / 2;
        const currentScaleCenterY = (y1 + y2) / 2;

        // 计算前后比例与移动
        const scale = currentDistance / preDistance;
        const currentScale = transform.scale * scale;
        // 计算旧逻辑坐标
        const oldLogicX = (preScaleCenterX - transform.x) / transform.scale;
        const oldLogicY = (preScaleCenterY - transform.y) / transform.scale;
        // 计算新偏移量，使逻辑点保持不变
        let offsetX, offsetY;
        if (currentScale <= maxScale && currentScale >= minScale) {
            offsetX = currentScaleCenterX - oldLogicX * currentScale;
            offsetY = currentScaleCenterY - oldLogicY * currentScale;
        } else {
            offsetX = currentScaleCenterX - oldLogicX * transform.scale;
            offsetY = currentScaleCenterY - oldLogicY * transform.scale;
        }

        // 变量存储
        limitLoad(offsetX, offsetY, currentScale);
        preX = offsetX;
        preY = offsetY;
        preDistance = currentDistance;
        preScaleCenterX = currentScaleCenterX;
        preScaleCenterY = currentScaleCenterY;
        touchType = 2;

    } else if (touches.length === 1 && touchType === 1) {
        // 单指
        const touch = touches[0];
        const x = touch.clientX - canvasLeft;
        const y = touch.clientY - canvasTop;
        const deltaX = x - startX;
        const deltaY = y - startY;

        pointerPosition.x = x;
        pointerPosition.y = y;
        // 手指真的动了：解除「点完一下先不画预览」（用未吸附的原始坐标判断，见 canvas.js）
        if (typeof previewPointerMoved === 'function') previewPointerMoved(x, y);
        // 手指还在移动：工具光标该显示（force = 触摸自己的动作，不受「刚抬手」的忽略窗口影响）
        if (typeof showPointerCursor === 'function') showPointerCursor(true);
        // 橡皮擦的方块光标、切换线类型 / 样式刷的圆环光标都跟着指针走，要重绘
        if (tool === 'eraser' || tool === 'lineType' || tool === 'styleBrush') drawContent();

        // 拖拽判定：移够距离才算拖动（手抖不算）
        if (Math.abs(deltaX) > dragThreshold || Math.abs(deltaY) > dragThreshold) {
            isDragging = true;
        }
        if (!isDragging) return;

        operateEventFunction("draw", x, y);
        touchType = 1;
    }
}

/**
 * 鼠标事件开始 过程函数
 * @param {Object} e 事件
 */
function mouseDownEventFunction(e) {
    e.preventDefault();
    const x = e.clientX - canvasLeft;
    const y = e.clientY - canvasTop;

    startX = x;
    startY = y;
    preX = startX;
    preY = startY;
    // 先当作「还没拖动」：移够距离才置位（见 mouseMoveEventFunction）。
    isDragging = false;
    isPressing = true;
    // 鼠标按下了：工具光标该显示
    if (typeof showPointerCursor === 'function') showPointerCursor();
    startTime = Date.now();
    mouseType = e.button;

    // 左键作图：起点也先吸附（点在隐交点上时，工具才拿得到那个位置的对象）
    const snapStart = e.button === 0 && typeof snapCursorPosition === 'function' ? snapCursorPosition(x, y) : [x, y];
    operateEventFunction("start", snapStart[0], snapStart[1]);
}

/**
 * 鼠标事件移动 过程函数
 * @param {Object} e 事件
 */
function mouseMoveEventFunction(e) {
    e.preventDefault();

    const x = e.clientX - canvasLeft;
    const y = e.clientY - canvasTop;
    // 作图工具：光标先吸附到附近的点 / 交点 / 线圆上，草稿图跟着吸附点走（中键拖画布不吸附）
    const snapDraw = mouseType === 1 || typeof snapCursorPosition !== 'function' ? [x, y] : snapCursorPosition(x, y);
    // 指针真的动了：解除「点完一下先不画预览」（用未吸附的原始坐标判断，见 canvas.js）
    if (typeof previewPointerMoved === 'function') previewPointerMoved(x, y);
    pointerPosition.x = snapDraw[0];
    pointerPosition.y = snapDraw[1];
    // 鼠标动了：工具光标该显示（刚触摸抬手时的合成鼠标事件会被 showPointerCursor 忽略）
    if (typeof showPointerCursor === 'function') showPointerCursor();
    // 预览消失的那一帧也要重绘（needRedrawForPreview 里管这件事）；
    // 橡皮擦的方块光标、切换线类型 / 样式刷的圆环光标都跟着指针走
    if (tool === 'eraser' || tool === 'lineType' || tool === 'styleBrush' || needRedrawForPreview()) drawContent();

    // 拖拽判定：没按着键时的移动只是悬停（startX / startY 还停在上一次按下的位置，
    // 不加这一层的话，点完一下再随手挪动就会被当成拖动）；按着左键还要移够距离才算
    // 「拖动作图」（手抖挪几像素不该画出图形），中键本来就只是平移画布、不受阈值限制
    if (!isPressing) {
        isDragging = false;
    }else if (mouseType === 1
        || Math.abs(x - startX) > dragThreshold || Math.abs(y - startY) > dragThreshold) {
        isDragging = true;
    }
    if (!isDragging) return;

    if (mouseType === 0) {
        // 左键
        operateEventFunction("draw", snapDraw[0], snapDraw[1]);
    } else if (mouseType === 1) {
        // 中键
        canvas.classList.add('move-cursor');
        // 拖拽画布
        const currentDeltaX = x - preX;
        const currentDeltaY = y - preY;
        // 坑点：缩放的本质：缩放会放大物理像素的视觉效果，
        // 因此画布移动 Δx 自动对应为逻辑移动 Δx / scale。
        const currentX = (transform.x + currentDeltaX);
        const currentY = (transform.y + currentDeltaY);
        const currentScale = transform.scale;
        limitLoad(currentX, currentY, currentScale);
        preX = x;
        preY = y;
        
        // 拖拽显示
        refreshToolFloating();
    }
}

/**
 * 鼠标事件结束 过程函数
 * @param {Object} e 事件
 */
function mouseUpEventFunction(e) {
    e.preventDefault();
    // 这次按压算不算拖动（移够距离才置位），要在复位之前取出来
    const dragged = isDragging;
    isDragging = false;

    const endX = e.clientX - canvasLeft;
    const endY = e.clientY - canvasTop;

    // 左键落点同样先吸附：最后一个点点在隐交点上也画得出图形
    const snapEnd = mouseType === 0 && typeof snapCursorPosition === 'function' ? snapCursorPosition(endX, endY) : [endX, endY];
    if (mouseType === 0) {
        // 左键：按下后没移够距离（手抖）就还是「点击」，只有真的拖动过才当作拖拽完成；
        // 按住多久都算点击，不再看时长
        if (dragged) {
            operateEventFunction("drawComplete", snapEnd[0], snapEnd[1]);
        } else {
            operateEventFunction("click", snapEnd[0], snapEnd[1]);
            // 点完这一下先不画预览，等指针移动过再画（见 canvas.js previewWaitForMove）
            if (typeof previewWaitForMove === 'function') previewWaitForMove(endX, endY);
        }
    }else if (mouseType === 1) {
        // 中键：结束平移（不管有没有真的移动过，都把抓手光标收掉）
        canvas.classList.remove('move-cursor');
    }
    mouseType = 0;
    isPressing = false;
}

/**
 * 鼠标事件中断 过程函数
 * @param {Object} e 事件
 */
// 鼠标事件中断
function mouseCancelEventFunction(e) {
    e.preventDefault();
    operateEventFunction("cancel", null, null);
    isDragging = false;
    isPressing = false;
    drawContent();
}

/**
 * 鼠标滚轮缩放 过程函数
 * @param {Object} e 事件
 */
function wheelEventFunction(e) {
    e.preventDefault();
    const zoomDelta = e.deltaY > 0 ? 0.9 : 1.1; // 缩小/放大
    const x = e.clientX - canvasLeft;
    const y = e.clientY - canvasTop;

    // 先把倍率钳进允许范围再算偏移：不钳的话，顶到缩放上限后 currentScale 仍在继续乘 1.1，
    // 而真正的 scale 已经不动了 —— 于是每滚一格都把画面往一边猛推一次（看着像「画布瞬移」）
    const currentScale = Math.min(Math.max(transform.scale * zoomDelta, minScale), maxScale);
    // 计算旧逻辑坐标（鼠标在缩放前的逻辑位置）
    const oldLogicX = (x - transform.x) / transform.scale;
    const oldLogicY = (y - transform.y) / transform.scale;
    // 计算新偏移量，使鼠标下的逻辑点保持不变
    const offsetX = x - oldLogicX * currentScale;
    const offsetY = y - oldLogicY * currentScale;

    limitLoad(offsetX, offsetY, currentScale);
    refreshToolFloating();
}

// 电脑端：滚轮水平滚动
document.getElementById('container_toolbar').addEventListener('wheel', (e) => {
    e.preventDefault(); // 阻止默认垂直滚动
    document.getElementById('container_toolbar').scrollLeft += e.deltaY * 1.5; // 使用垂直滚轮量控制水平滚动
});

document.getElementById('menu_toolbar').addEventListener('wheel', (e) => {
    e.preventDefault(); // 阻止默认垂直滚动
    document.getElementById('menu_toolbar').scrollLeft += e.deltaY * 1.5; // 使用垂直滚轮量控制水平滚动
});

document.getElementById('floating-bar-buttons').addEventListener('wheel', (e) => {
    e.preventDefault(); // 阻止默认垂直滚动
    document.getElementById('floating-bar-buttons').scrollLeft += e.deltaY * 1.5; // 使用垂直滚轮量控制水平滚动
});

document.getElementById('floating-bar-elements').addEventListener('wheel', (e) => {
    e.preventDefault(); // 阻止默认垂直滚动
    document.getElementById('floating-bar-elements').scrollLeft += e.deltaY * 1.5; // 使用垂直滚轮量控制水平滚动
});



/**
 * 限制存储 过程函数
 * 把变换量存进变换表前，限制范围进行筛选
 * @param {number} currentX 当前的x变换偏移
 * @param {number} currentY 当前的y变换偏移
 * @param {number} currentScale 当前的缩放变换偏移
 */
function limitLoad(currentX, currentY, currentScale) {
    // 平移不设边界，几何画布保持无限延展。
    transform.x = currentX;
    transform.y = currentY;

    // 比例限制
    const tempScale_1 = Math.max(currentScale, minScale);
    const tempScale_2 = Math.min(tempScale_1, maxScale);
    transform.scale = tempScale_2;

    drawContent();
}

/**
 * 变换量还原 过程函数
 */
function resetTransform() {
    // 原地改，不要换成新对象：geometryManager 持有的是同一个 transform 引用，
    // 换成新对象之后 near() 里的 15px 吸附阈值会一直用旧的 scale（缩放后命中范围全错）
    // 画板 / 制题器 / 求解器里适配过内容（生成网格 / 载入记录 / 导入 gmt / 从游玩返回）之后
    // 会记下一份「初始视图」：有网格就是网格范围、没有网格就是适配过的图形本身 ——
    // 复位回到它，算式与适配时完全一致（中心落在扣掉浮层之后那块空地的正中），
    // 而不是一律回到通用初始值（那样有网格的题目会缩成 initialScale ≈ 0.5，网格大小就不对了）
    const initial = typeof window.boardGmt?.initialView === 'function' ? window.boardGmt.initialView() : null;
    if (initial) {
        const insets = typeof window.gridFitInsets === 'function'
            ? window.gridFitInsets() : {top: 0, bottom: 0, left: 0, right: 0};
        const usableWidth = Math.max(120, canvasWidth - insets.left - insets.right);
        const usableHeight = Math.max(120, canvasHeight - insets.top - insets.bottom);
        transform.scale = initial.scale;
        transform.x = insets.left + usableWidth / 2 - initial.centerX * transform.scale;
        transform.y = insets.top + usableHeight / 2 - initial.centerY * transform.scale;
    }else{
        transform.x = canvasWidth / 2;
        transform.y = canvasHeight / 2;
        transform.scale = initialScale;
    }
    [typeof geometryManager !== 'undefined' ? geometryManager : null,
     typeof geometryManagerResult !== 'undefined' ? geometryManagerResult : null,
     typeof geometryManagerExplore !== 'undefined' ? geometryManagerExplore : null].forEach(manager => {
        if (manager) manager.transform = transform;
    });
    drawContent();
}



/**
 * 位置同步：L/E 计数器水平居中显示（仅关卡游玩页存在该元素）
 */
function updateMovesCounterPosition() {
    const movesLayout = document.querySelector('.moves-layout');
    const menu = document.querySelector('.board-popup.open');
    if (!movesLayout) return;
    // 计数器水平居中显示
    movesLayout.style.position = 'fixed';
    movesLayout.style.left = '50%';
    movesLayout.style.right = 'auto';
    movesLayout.style.transform = 'translateX(-50%)';
    movesLayout.style.top = '12px';
    // 仅当菜单与计数器实际发生重叠时，才下移避让
    if (menu) {
        const menuRect = menu.getBoundingClientRect();
        const movesRect = movesLayout.getBoundingClientRect();
        const overlaps = menuRect.left < movesRect.right &&
            menuRect.right > movesRect.left &&
            menuRect.top < movesRect.bottom &&
            menuRect.bottom > movesRect.top;
        if (overlaps) movesLayout.style.top = `${menuRect.bottom + 8}px`;
    }
}

window.addEventListener('resize', updateMovesCounterPosition);

/**
 * 切换面板
 * @param {string} panel
 */
function switchPanel(panel) {
    const panels = document.getElementsByClassName("panel");
    for (const panel of panels) {
        panel.style.display = "none";
    }
    panelState = panel;
    // 样式类型
    document.getElementById(panel).style.display = "flex";
    if (panel === "recordPanel") {
        Object.values(tools).forEach((item) => item.clear?.());
        refreshToolFloating();
        
        // 记下打开记录面板之前用的工具：载入记录 / 关掉面板时还回去（见 recordPanel.js 的 restoreTool）
        if (tool !== "move") window.toolBeforeRecordPanel = tool;
        tool = "move";
        drawContent();
        // 打开记录面板时重建列表（recordPanel.js）
        window.recordPanelRefresh?.();
    }else if (panel === "overviewPanel") {
        Object.values(tools).forEach((item) => item?.clear?.());
        refreshToolFloating();
        
        tool = "move";
        drawContent();
        loadGeometryElements();
    }else if (panel === "toolbarPanel") {
        choiceToolMenu("general-bar");
        refreshToolFloating();
    }
}

/**
 * 工具菜单栏点击
 * @param {Object} e 事件
 */
function menuToolbarChoice(e) {
    const action = e.target.closest('[data-action]')?.dataset.action;
    // 工具栏里还放了 initial / result 标记等非分类按钮，只处理分类切换
    if (!action?.endsWith('-bar')) return;
    choiceToolMenu(action);
}

/**
 * 工具栏点击
 * @param {Object} e 事件
 */
function toolbarChoice(e) {
    const action = e.target.closest('[data-action]')?.dataset.action;
    choiceTool(action);
    if (menuTool === 'construct') refreshMenuTool();
}

/**
 * 工具小项点击
 * @param {Object} e 事件
 */
function toolSwitchChoice(e) {
    const action = e.target?.dataset?.action;
    const type = e.target.getAttribute("class");
    if (type.includes("floating-svg-switch-button")) {
        choiceToolSwitch(action);
    }else if (type.includes("floating-svg-button") && !type.includes("disable")) {
        clickToolFloatingButton(action, e);
    }
}

/**
 * 更多栏点击
 * @param {Object} e 事件
 */
function morebarChoice(e) {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === "restore") {
        restoreStorage();
    }else if (action === "redo") {
        redoStorage();
    }
}

/**
 * 菜单弹层点击（按钮与弹层由 board-tools.js 统一构建）
 * @param {string} action 菜单项的 data-action
 */
function menuChoice(action) {
    if (action === "clear-canvas") {
        boardConfirm(t('board.clearCanvasAsk'), '', () => {
            if (typeof clearAllCanvases === 'function') clearAllCanvases(); else clearCanvas();
            // 画到一半的工具状态也丢掉，否则之后作图会点击错位
            if (typeof resetToolState === 'function') resetToolState();
            // 清空后以空画布为新的历史起点
            resetStorageHistory();
            clearLists();
            drawContent();
            refreshStorageButton();
        });
    }else if (action === "switch-construct") {
        switchPanel("toolbarPanel");
    }else if (action === "switch-overview") {
        switchPanel("overviewPanel");
    }else if (action === "switch-record") {
        switchPanel("recordPanel");
    }
}

/**
 * 数据传输
 */
function dataTransfer() {
    // 选定栏
    const geometryElementDict = {};
    for (const [key, value] of Object.entries(geometryElementLists)) {
        // 因为JSON不支持Set，所以需要先转换为列表
        geometryElementDict[key] = [...value];
    }
    sessionStorage.setItem('geometryElementLists', JSON.stringify(geometryElementDict));
    
    // 几何对象
    const elements = geometryManager.toStorage();
    sessionStorage.setItem('elements', JSON.stringify(elements));

    // 构造记录
    const constructRecordJSON = storageManager.serialization();
    sessionStorage.setItem('constructRecord', constructRecordJSON);
    // 网格（制题器里生成过才有）：试玩页按它把网格还原成一整块 ——
    // 不带上，网格辅助对象（格点、垂线那些）到试玩页会当成普通作图原样显示出来
    const gridMetaJSON = JSON.stringify(window.boardGmt?.grid?.() || null);
    sessionStorage.setItem('gridMeta', gridMetaJSON);
    sessionStorage.setItem('makerBackup', JSON.stringify({
        thumbnail: sessionStorage.getItem('thumbnail'),
        geometryElementLists: sessionStorage.getItem('geometryElementLists'),
        elements: sessionStorage.getItem('elements'),
        constructRecord: sessionStorage.getItem('constructRecord'),
        gridMeta: sessionStorage.getItem('gridMeta'),
    }));
}







/**
 * 刷新存储按钮
 */
function refreshStorageButton() {
    const [topStatus, bottomStatus] = storageManager.getPointerStatus();
    document.getElementById("redo-button").classList.remove("disable");
    document.getElementById("restore-button").classList.remove("disable");
    if (topStatus) document.getElementById("redo-button").classList.add("disable");
    // 画到一半（比如直线已经点了一个点）时撤销按钮也要亮，用来取消这次的半成品
    if (bottomStatus && !hasPendingToolDraw()) document.getElementById("restore-button").classList.add("disable");
}

/**
 * 取消画到一半的图形 过程函数
 * 工具缓存里还有未完成的对象（例如直线已经点了一个点）时，先把它清掉：
 * 这种情况下的「撤销」只该取消这次的半成品，不能再去动上一步的历史 ——
 * 否则工具还记着旧对象，之后的作图会错位（点一下没反应、画不出线、没有预览）
 * @returns {boolean} 是否确实取消了半成品
 */
function cancelPendingToolDraw() {
    if (!hasPendingToolDraw()) return false;
    if (typeof tools[tool].clear === 'function') tools[tool].clear();
    // 工具自己的 clear 不一定清掉管理器缓存，兜底再清一次
    if (geometryManager.ifToolInCache(tool)) geometryManager.deleteTool(tool);
    drawContent();
    if (typeof refreshToolFloating === 'function') refreshToolFloating();
    refreshStorageButton();
    return true;
}

/**
 * 是否画到一半 过程函数
 * 工具已经选中了对象但还没画完（例如直线只点了一个点）
 * @returns {boolean}
 */
function hasPendingToolDraw() {
    if (typeof tools === 'undefined' || !tools[tool]) return false;
    // 移动工具的缓存里放的是「选定栏」（选中的那个对象），样式刷的缓存里放的是刷子当前选中的图形，
    // 都不是画到一半的作图：撤销 / 重做时不该把它们当成半成品清掉 —— 否则按撤销只会取消选中，
    // 刷样式的那些步骤也撤不回去
    if (tool === 'move' || tool === 'styleBrush') return false;
    return !!tools[tool].cacheFlag || geometryManager.ifToolInCache(tool);
}

/**
 * 撤回 / 重做之后的收尾 过程函数
 * 两件事：按最近载入的那条记录的样式表补一次色（撤销清单不带样式，见 recordPanel.js 的
 * recordPanelAfterRestore）；刷新记录面板（画布变了，加号该不该亮要重算）
 */
function afterHistoryMove() {
    // 在 drawContent 之前调用：补回来的颜色这一次绘制就生效
    if (typeof window.recordPanelAfterRestore === 'function') window.recordPanelAfterRestore();
    window.recordPanelRefresh?.();
    // 元素一览也要跟着撤回 / 重做重建：不重建的话面板里还是撤回前的图形
    // （网格那一行、格线数目、隐藏档都停在旧状态，看起来就像面板卡住了）
    if (typeof loadGeometryElements === 'function') loadGeometryElements();
}

/**
 * 撤回
 */
function restoreStorage() {
    // 画到一半时按撤销：只取消这次的半成品，不撤销上一步
    if (cancelPendingToolDraw()) return;

    const [topStatus, bottomStatus] = storageManager.getPointerStatus();
    if (bottomStatus) return;

    const snapshot = storageManager.restore();
    if (snapshot) loadStorageSnapshot(snapshot);
    refreshStorageButton();
    afterHistoryMove();
    drawContent();
}

/**
 * 重做
 */
function redoStorage() {
    // 同理：半成品先取消，避免工具状态与历史不同步
    if (cancelPendingToolDraw()) return;

    const [topStatus, bottomStatus] = storageManager.getPointerStatus();
    if (topStatus) return;
    
    const snapshot = storageManager.redo();
    if (snapshot) loadStorageSnapshot(snapshot);
    refreshStorageButton();
    afterHistoryMove();
    drawContent();
}

window.addEventListener("storage", () => {
    // 这次作图因为「图形画布上已经有了」而作废：不记撤销历史，只把画布上的半成品擦掉
    if (geometryManager.takeDuplicatedFlag()) {
        drawContent();
        return;
    }
    storage();
});
function storage() {
    // 删掉的图形如果还挂着标记（给定 / 可动点 / 所求 / 探索 / 隐藏），先清掉再记快照 ——
    // 不然快照里会留着一个已经不在画布上的对象的标记（见 board-tools 的 pruneMarks）
    if (typeof window.pruneMarks === 'function') window.pruneMarks();
    // 存储：几何对象 + 选定栏（标记等改动也能撤销）
    storageManager.append(collectStorageSnapshot());
    refreshStorageButton();
    // 图形变了，已标记对象栏里的坐标 / 方程要跟着更新
    if (typeof refreshMarkEquations === 'function') refreshMarkEquations();
}



const infDict = {
    "restore": {title: "撤销", context: "撤回上一步"},
    "redo": {title: "重做", context: "还原下一步"},
    "open-menu": {title: "菜单", context: "里面的功能主要针对全局"},
    "switch-construct": {title: "构造面板", context: ""},
    "switch-overview": {title: "几何元素一览面板", context: "可以查看所有的元素，快速编辑"},
    "switch-record": {title: "记录", context: "查看与载入作图记录"},
    "clear-canvas": {title: "清空画布", context: ""},
    "help": {title: "帮助", context: "说明当前界面的用法"},
    "view-answer": {title: "查看答案", context: "查看本关收录的解法图"},
    "close-menu": {title: "关闭菜单", context: "收起这个菜单"},
    "explore-mode": {title: "探索模式", context: "显示所求几何对象，方便研究"},
    "design-mode": {title: "设计模式", context: "切换到几何设计模式"},
    "explore": {title: "探索", context: "切换到探索视图，查看目标对象"},
    "mark-initial": {title: "标记给定", context: "点击对象标记为给定的条件（黑色）"},
    "mark-named": {title: "带标签给定", context: "点击对象标记为带标签的给定（黑色 + 标签），会弹出命名框"},
    "mark-movepoints": {title: "可移动点", context: "点击对象标记为可移动点（蓝色），拖动它时图形随之变化"},
    "mark-result": {title: "标记所求", context: "点击对象标记为所求（金色）"},
    "mark-result-shown": {title: "所求显示", context: "点击对象标记为判定成功后要显示出来的图形（金色）"},
    "mark-explore": {title: "探索显示", context: "点击对象标记为探索模式里要显示的内容（金色）"},
    "clear-marks": {title: "清除标记", context: "清空给定与所求标记"},
    "goal-select": {title: "选择解", context: "切换当前标记的解：只有选中的解会点亮金色，标记也写进这一组"},
    "goal-add": {title: "增加一个解", context: "再加一组所求，用来标记多解"},
    "goal-remove": {title: "删除最后一个解", context: "删掉最后一组所求（连同它的标记）"},
    "return-to-pack": {title: "返回关卡包", context: "返回当前关卡包列表"},
    "return-to-maker": {title: "返回制作环境", context: "返回自制关卡编辑页"},
    "return-to-home": {title: "返回首页", context: "返回站点首页"},
    "return-to-previous": {title: "返回上一界面", context: "回到跳转过来的界面，画好的图形会保留"},
    "switch-to-play": {title: "试玩", context: "进入关卡试玩和探索模式"},
    "solver-run": {title: "开始求解", context: "用当前图形执行求解搜索"},
    "open-solver": {title: "打开求解器", context: "打开求解器面板并开始搜索"},
    "export-gmt": {title: "导出 gmt", context: "查看代码、导出文件或提交 Issue"},
    "import-gmt": {title: "导入 gmt", context: "从代码或文件载入图形"},
    "gmt-view": {title: "查看 gmt 代码", context: "查看当前图形的 gmt 文本"},
    "gmt-save": {title: "导出为 gmt 文件", context: "下载 custom-level.gmt 文件"},
    "gmt-issue": {title: "导出至 Issue", context: "在 GitHub 打开预填 gmt 的 Issue"},
    "gmt-paste": {title: "导入 gmt 代码", context: "粘贴 gmt 文本并载入图形"},
    "gmt-read": {title: "导入 gmt 文件", context: "选择本地 gmt 文件并载入图形"},
    "general-bar": {title: "通用工具栏", context: ""},
    "point-bar": {title: "点工具栏", context: ""},
    "line-bar": {title: "直线工具栏", context: ""},
    "circle-bar": {title: "圆工具栏", context: ""},
    "construct-bar": {title: "构造工具栏", context: ""},
    "move": {title: "移动工具", context: "可以拖动点、画布"},
    "point": {title: "点工具", context: "点击以创建一个点，可以拖动点以放置到几何对象上"},
    "eraser": {title: "橡皮擦工具", context: ""},
    "styleBrush": {title: "样式刷", context: "先点一个图形当样式来源，之后点到的图形会套用它的颜色、粗细与标签显示"},
    "brushStyle": {title: "样式刷模式", context: "先点一个图形当样式来源，之后点到的图形套用它的样式"},
    "brushHidden": {title: "隐藏刷模式", context: "点一下图形把它隐藏起来（撤销、或到元素一览的「隐藏」档里可以找回来）"},
    "line": {title: "直线工具", context: ""},
    "circle": {title: "圆工具", context: ""},
    "intersection": {title: "交点工具", context: ""},
    "ray": {title: "射线工具", context: ""},
    "lineSegment": {title: "线段工具", context: ""},
    "parallelLine": {title: "平行线工具", context: ""},
    "perpendicularLine": {title: "垂线工具", context: ""},
    "perpendicularBisector": {title: "垂直平分线工具", context: ""},
    "tangent": {title: "切线工具", context: "过圆外（或圆上）一点作圆的切线；点在圆外作出两条、圆上一条、圆内无解"},
    "tangentParallel": {title: "平行切线工具", context: "作与一条直线平行的两条切线，分别切在圆的两侧"},
    "angleBisector": {title: "角平分线工具", context: "有3点式和直线式两种构造模式"},
    "compass": {title: "圆规工具", context: "有3点式和复制式两种构造模式"},
    "middlePoint": {title: "中点工具", context: "构造两个点的中点，或构造圆心"},
    "threePointCircle": {title: "三点圆工具", context: "构造过三个点的圆"},
    "fixedAngle": {title: "定值角工具", context: "构造角的一边、角的顶点，顺时针另一边为指定角度的射线"},
    "choiceDraw": {title: "选中拖拽模式", context: "可以选择几何对象，只能拖拽点"},
    "moveView": {title: "移动视图模式", context: "防误触几何对象"},
    "restoreTransform": {title: "还原画布变化量", context: "将画布的视图变换还原至初始值"},
    "clear": {title: "清空选择", context: "清空当前工具的选中栏"},
    "make-grid": {title: "生成网格", context: "作一块 m×n 的网格，可指定单位长度"},
    "pointStyle": {title: "配置点样式", context: "设置后续绘制的点的颜色、大小与标签显示"},
    "objectStyle": {title: "调整对象样式", context: "用移动工具选中对象后，可修改它的颜色、粗细、标签显示，直线与圆还可切成虚线"},
    "deleteObject": {title: "删除选中对象", context: "删除移动工具选中的对象，连同由它作出来的所有子对象"},
    "any": {title: "任意对象", context: "可选中任意几何对象"},
    "choicePoint": {title: "点对象", context: "仅选中点对象"},
    "style": {title: "样式刷", context: "拖拽以配置直线的样式为当前线工具样式"},
    "lineType": {title: "切换线类型", context: "点一下直线 / 射线 / 线段，把它的类型换成下一种"},
    "lineStyle": {title: "配置直线样式", context: "设置后续绘制的直线的颜色、粗细、标签显示与是否虚线"},
    "circleStyle": {title: "配置圆样式", context: "设置后续绘制的圆的颜色、粗细、标签显示与是否虚线"},
    "threePointAngleBisector": {title: "三点角平分线", context: "第二点为角的顶点"},
    "twoLineAngleBisector": {title: "角平分线", context: "构造两条直线的两条角平分线。⚠ 制题器慎用：gmt 无法导出"},
    "threePointCompass": {title: "三点圆规", context: "两点距离为半径，第三点为圆心作圆"},
    "compassCopy": {title: "复制圆规", context: "复制一个圆。⚠ 制题器慎用：gmt 无法导出"},
    "twoPointsMiddlePoint": {title: "中点", context: "构造两个点的中点"},
    "circleCenter": {title: "圆心", context: "构造一个圆的圆心"},
};
window.addEventListener("click", showInformationMobile);
/**
 * 加载信息
 */
function showInformationMobile(event) {
    if (widthTypeEquipment !== "mobile") return;
    const inf = event.target?.dataset.action;
    if (!inf) return;
    if (!Object.keys(infDict).includes(inf)) return;
    
    const infDE = document.getElementById("mobile-information");
    infDE.classList.add("active");
    
    // 说明文案按当前语言取（中文用 infDict，英文在 i18n.js 的 TIP_EN 里）
    const tip = tipOf(inf, infDict[inf]);
    infDE.innerHTML = `
        <p class="inf-title">${tip.title}</p>
        <p class="inf-context">${tip.context}</p>
    `;
    setTimeout(() => {
        infDE.classList.remove("active");
    }, 3000);
}

window.addEventListener("mousemove", showInformationDesktop)
/**
 * 加载信息
 */
function showInformationDesktop(event) {
    if (widthTypeEquipment !== "tablet") return;
    const infDE = document.getElementById("mobile-information");
    const documentElement = document.elementFromPoint(event.x, event.y);
    const inf = documentElement?.closest?.('[data-action]')?.dataset.action || documentElement?.dataset.action;
    if (!inf) {
        infDE.classList.remove("active");
        return;
    }
    if (!Object.keys(infDict).includes(inf)) {
        infDE.classList.remove("active");
        return;
    }
    
    infDE.classList.add("active");
    
    // 说明文案按当前语言取（中文用 infDict，英文在 i18n.js 的 TIP_EN 里）
    const tip = tipOf(inf, infDict[inf]);
    infDE.innerHTML = `
        <p class="inf-title">${tip.title}</p>
        <p class="inf-context">${tip.context}</p>
    `;
}



/**
 * 数据加载
 */
function dataLoad() {
    // 选定栏
    const geometryElementListsJSON = sessionStorage.getItem('geometryElementLists');
    if (geometryElementListsJSON) {
        const geometryElementListsLoad = JSON.parse(geometryElementListsJSON);
        for (const [key, value] of Object.entries(geometryElementListsLoad)) {
            geometryElementLists[key] = new Set(value);
        }
    }
    
    // 几何对象
    const elementsJSON = sessionStorage.getItem('elements');
    if (elementsJSON) {
        const elements = JSON.parse(elementsJSON);

        // 1.反序列化为元素
        elements.forEach((item) => {
            const element = deserialization(item);
            geometryManager.addObject(element);
        });

        // 2.添加元素间连接
        for (const item of elements) {
            const bases = item.base;
            const basesType = bases.type;

            if (basesType === 'none') continue;
            const id = item.id;
            const currentElement = geometryManager.get(id);
            const currentElementType = item.type;
            const objectList = [];
            bases.basesId.forEach((id) => {
                objectList.push(geometryManager.get(id));
            });
            if (currentElementType === 'point') {
                // 第四个参数指定的「已知交点」也一并还原，编号时用它排掉重合的那个
                currentElement.modifyBase(basesType, objectList, bases.value, bases.excludeId ? geometryManager.get(bases.excludeId) : null);
                objectList.forEach((item) => {
                    item.addSuperstructure(currentElement);
                });
            }else if (currentElementType === 'line' || currentElementType === 'circle') {
                currentElement.modifyDefine(basesType, objectList, bases.value);
            }
        }

        drawContent();
    }

    // 构造记录
    const constructRecordJSON = sessionStorage.getItem('constructRecord');
    if (constructRecordJSON) storageManager.deserialization(constructRecordJSON);
    refreshStorageButton();
    // 按标记重上一次色（给定黑 / 所求金）：dataLoad 只按存档里的 color 画，
    // 存档没带标记色（例如带过来的求解器 / 制题器记录）时「所求」在画布上就不金
    if (typeof refreshElementListColors === 'function') refreshElementListColors();
    
    function deserialization(elementDict) {
        const type = elementDict.type;
        const id = elementDict.id;
        const name = elementDict.name;
        const visible = elementDict.visible;
        const valid = elementDict.valid;
        const color = elementDict.color;
        const showName = elementDict.showName;
        const width = elementDict.width;
        
        let element;
        if (type === 'point') {
            const x = elementDict.x;
            const y = elementDict.y;
            element = new Point(id, x, y);
        }else if (type === 'line') {
            element = new Line(id);
            element.modifyDrawType(elementDict.drawType);
        }else if (type === 'circle') {
            element = new Circle(id);
        }

        element.modifyName(name);
        element.modifyVisible(visible);
        element.modifyValid(valid);
        element.modifyShowName(showName);
        element.modifyColor(color);
        element.modifyWidth(width || 1);
        return element;
    }
}

/**
 * 元素一览详情里的输入框：名称 / 坐标 / 基底值 / 颜色
 * 具体改动交给 geometry.js 的 applyGeometryItemInput（两个页面共用）
 * （标记中的对象显示色由 board-tools 接管，这里改的只是样式色）
 * @param {Object} event
 */
function geometryItemChange(event) {
    // 置灰的输入框一律不处理（制题器里非自由点的坐标、只读的结果框）
    if (event.target?.disabled) return;
    const type = typeof applyGeometryItemInput === 'function' ? applyGeometryItemInput(event.target) : null;
    if (!type) return;
    loadGeometryElements();
    refreshOpenedGeometryItem();
    drawContent();
    notifyStorageChange(type);
}

// 加载完毕
document.addEventListener("DOMContentLoaded", DOMLoaded);

function DOMLoaded() {
    // 鼠标事件
    canvas.addEventListener("mousedown", mouseDownEventFunction);
    canvas.addEventListener("mousemove", mouseMoveEventFunction);
    canvas.addEventListener("mouseup", mouseUpEventFunction);
    document.addEventListener("mouseleave", mouseCancelEventFunction);
    canvas.addEventListener("wheel", wheelEventFunction);
    // 触摸事件
    canvas.addEventListener("touchstart", touchstartEventFunction);
    canvas.addEventListener("touchend", touchendEventFunction);
    canvas.addEventListener("touchmove", touchmoveEventFunction);
    canvas.addEventListener("touchcancel", touchcancelEventFunction);
    // 点击事件绑定
    document.getElementById("menu_toolbar").addEventListener("click", menuToolbarChoice);
    document.getElementById("container_toolbar").addEventListener("click", toolbarChoice);
    document.getElementById("floating-bar-buttons").addEventListener("click", toolSwitchChoice);
    document.getElementById("container_more").addEventListener("click", morebarChoice);
    document.getElementById("container_overview").addEventListener("click", selectElementByOverview);
    document.getElementById("geometry-item").addEventListener("click", geometryItemClick);
    document.getElementById("geometry-item").addEventListener("change", geometryItemChange);
    // 记录面板的点击由 recordPanel.js 自己按事件委托绑定
    // 初始化
    updateLayout();
    resizeCanvas();
    drawContent();
    switchPanel("toolbarPanel");
    refreshMenuTool();
    refreshStorageButton();
    dataLoad();
}
