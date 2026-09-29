/* playPage.js */

// 浏览器视口变化
const EQUIPMENT_WIDTH = {
    MOBILE: 768,
    TABLET: 1024,
    DESKTOP: 1200,
}
let widthTypeEquipment;
function updateLayout() {
    const width = window.innerWidth;
    if (width < EQUIPMENT_WIDTH.MOBILE) {
        widthTypeEquipment = 'mobile';
    }else{
        widthTypeEquipment = 'tablet';
    }
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
    scale: initialScale, // 初始视野，见 canvas.js（与画板一致）
};

// 存储样式变量
// width：点的大小 / 线圆的粗细（1 为默认）；showName：是否显示标签（未设置时沿用自动配色模式的默认标签策略）
let geometryStyle = {
    point: {colorChoice: "autoPlayMode", color: "#191919", width: 1}, 
    line: {colorChoice: "autoPlayMode", color: "#191919", width: 1}, 
    circle: {colorChoice: "autoPlayMode", color: "#191919", width: 1}
};

// 几何对象管理器
const geometryManagerResult = new GeometryElementManager();
const geometryManagerExplore = new GeometryElementManager();
let geometryManager = geometryManagerResult;
geometryManagerResult.transform = transform;
geometryManagerResult.geometryStyle = geometryStyle;
geometryManagerExplore.transform = transform;
geometryManagerExplore.geometryStyle = geometryStyle;
const storageManagerResult = new StorageManager();
const movesStorageManagerResult = new MovesStorageManager();
const storageManagerExplore = new StorageManager();
const movesStorageManagerExplore = new MovesStorageManager();
let storageManager = storageManagerResult;
let movesStorageManager = movesStorageManagerResult;
const geometryElementLists = {
    hidden: new Set(),
    initial: new Set(),
    named: new Set(),
    name: new Set(),
    movepoints: new Set(),
    result: new Set(),
    // resultShown：所求判定成功后要显示出来的图形（gmt 里 result= 冒号后的部分）
    resultShown: new Set(),
    explore: new Set(),
};
geometryManagerResult.geometryElementLists = geometryElementLists;
geometryManagerExplore.geometryElementLists = geometryElementLists;

// 工具
const tools = {
    move: new MoveTool(),
    eraser: new EraserTool(),
    point: new PointTool(),
    line: new LineTool(),
    ray: new RayTool(),
    lineSegment: new LineSegmentTool(),
    circle: new CircleTool(),
    intersection: new IntersectionTool(),
    parallelLine: new ParallelConstructTool(),
    perpendicularLine: new PerpendicularConstructTool(),
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

// 面板状态
let panelState;

const movesCounter = {
    e: 0,
    l: 0,
};

const movesCounterDE = document.getElementById("moves");
movesCounterDE.innerText = '0L 0E';

/**
 * 一个图形当初记了多少步数与消耗 过程函数
 * 与 refreshMovesCounterByTool 的加权表一致（那边按工具记，这里反查图形）：
 * 认不出来的图形一律算 0，保证只退当初真正记过的那部分
 * @param {Object} item 几何对象
 * @returns {{e: number, l: number}}
 */
function constructionCostOfElement(item) {
    const type = item?.getType?.();
    const baseType = item?.getBase?.()?.type;
    if (type === 'point') {
        if (baseType === 'middlePoint') return {e: 4, l: 1};
        if (baseType === 'center') return {e: 5, l: 1};
        return {e: 0, l: 0};
    }
    if (type === 'circle') {
        if (baseType === 'threePointCircle') return {e: 7, l: 1};
        if (baseType === 'compass') return {e: 5, l: 1};
        if (baseType === 'twoPoints') return {e: 1, l: 1};
        return {e: 0, l: 0};
    }
    if (type === 'line') {
        if (baseType === 'twoPoints') return {e: 1, l: 1};
        if (baseType === 'perpendicular' || baseType === 'perpendicularBisector') return {e: 3, l: 1};
        if (baseType === 'parallel') return {e: 4, l: 1};
        if (baseType === 'threePointAngleBisector' || baseType === 'twoLineAngleBisector') return {e: 4, l: 1};
        return {e: 0, l: 0};
    }
    return {e: 0, l: 0};
}

/**
 * 删除一个图形并给出该退回的步数与消耗 过程函数
 * 删除会连带删掉由它作出来的子对象，所以要在删之前把仓库里的对象记下来，删完比对差异：
 * 被删掉的那些各自该退多少，累加起来就是这一删要退的总量
 * @param {string} id 要删除的对象 id
 * @returns {{e: number, l: number, count: number}}
 */
function constructionRefundOfDelete(id) {
    const before = Object.keys(geometryManager.repository || {})
        .map(key => geometryManager.get(key))
        .filter(item => item);
    geometryManager.deleteObject(id);
    const refund = {e: 0, l: 0, count: 0};
    before.forEach(item => {
        if (geometryManager.repository[item.getId()]) return;
        const cost = constructionCostOfElement(item);
        refund.e += cost.e;
        refund.l += cost.l;
        refund.count++;
    });
    return refund;
}

/* 刷新步数 */
function refreshMovesCounterByTool(event) {
    const type = event.detail.type;
    const moves = movesStorageManager.get();
    let movesE = moves.e;
    let movesL = moves.l;

    if (type === "middlePoint") {
        movesE += 4;
        movesL++;
    }else if (type === "center") {
        movesE += 5;
        movesL++;
    }else if (type === "line") {
        movesE += 1;
        movesL++;
    }else if (type === "circle") {
        movesE += 1;
        movesL++;
    }else if (type === "parallelLine") {
        movesE += 4;
        movesL++;
    }else if (type === "perpendicularLine") {
        movesE += 3;
        movesL++;
    }else if (type === "perpendicularBisector") {
        movesE += 3;
        movesL++;
    }else if (type === "angleBisector") {
        movesE += 4;
        movesL++;
    }else if (type === "compass") {
        movesE += 5;
        movesL++;
    }else if (type === "threePointCircle") {
        movesE += 7;
        movesL++;
    }else if (type === "delete") {
        // 删除图形：把这一笔当初记的步数与消耗退回来，计数器才会跟着更新
        // （退回量由 constructionRefundOfDelete 按下面的加权表反着算）
        const refund = (event.detail && event.detail.refund) || {e: 0, l: 0};
        movesE = Math.max(0, movesE - (refund.e || 0));
        movesL = Math.max(0, movesL - (refund.l || 0));
    }
    
    movesCounter.e = movesE;
    movesCounter.l = movesL;
    movesCounterDE.innerText = `${movesL}L ${movesE}E`;
    movesStorageManager.append(movesCounter);
}

/* 刷新步数 */
function refreshMovesCounterByRestore(moves) {
    // 撤销 / 重做后指针已经停在那份快照上，moves 就是回到的那一步的总步数，
    if (!moves) return;
    movesCounter.e = moves.e || 0;
    movesCounter.l = moves.l || 0;
    movesCounterDE.innerText = `${movesCounter.l}L ${movesCounter.e}E`;
    // 步数变了，L / E 勾也要跟着重算
    if (typeof refreshLevelStatus === 'function') refreshLevelStatus();
}

/* 刷新步数 */
function refreshMovesCounter() {
    // 切换普通 / 探索模式后，当前管理器指针上的步数才是真实步数，直接同步过来
    const moves = movesStorageManager.get() || {};
    // 备份还原可能早于「步数历史开闸」（DOMContentLoaded 里才 setStatus(true)）：这一步读到的还是空历史，
    // 照旧写 0 会把刚还原的 L / E 抹掉 —— 空历史就保持当前值不动，等开闸时 append 用的也正是这个值
    if (moves.l !== undefined || moves.e !== undefined) {
        movesCounter.e = moves.e || 0;
        movesCounter.l = moves.l || 0;
        movesCounterDE.innerText = `${movesCounter.l}L ${movesCounter.e}E`;
    }
    // 步数变了，L / E 勾也要跟着重算
    if (typeof refreshLevelStatus === 'function') refreshLevelStatus();
}






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
            // 先记「先不画预览，等指针移动」再让工具处理这次点击：点击里会重绘一次，
            // 顺序反了的话那一帧仍按旧状态画出半成品预览，画完又不再重绘，
            // 那一帧的预览就留在屏幕上（看着像「点击的瞬间冒出垂线预览」）
            if (typeof previewWaitForMove === 'function') previewWaitForMove(endX, endY);
            operateEventFunction("click", endX, endY);
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
            // 先记「先不画预览，等指针移动」再让工具处理这次点击：点击里会重绘一次，
            // 顺序反了的话那一帧仍按旧状态画出半成品预览，画完又不再重绘，
            // 那一帧的预览就留在屏幕上（看着像「点击的瞬间冒出垂线预览」）
            if (typeof previewWaitForMove === 'function') previewWaitForMove(endX, endY);
            operateEventFunction("click", snapEnd[0], snapEnd[1]);
            // 点完这一下先不画预览，等指针移动过再画（见 canvas.js previewWaitForMove）
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
 * 载入关卡时的图形快照 过程函数
 * 撤销/重做历史的第 0 格是关卡载入完成时的图形（见 board-tools.js 的 resetStorageHistory），
 * 玩家之后的拖动不会改动它，正好当「初始位置」用
 * @returns {any[]|null}
 */
function initialStorageElements() {
    const manager = typeof storageManager !== 'undefined' && storageManager ? storageManager : null;
    const snapshot = manager && manager.repository ? manager.repository[0] : null;
    if (!snapshot) return null;
    return Array.isArray(snapshot) ? snapshot : (snapshot.elements || null);
}

/**
 * 把给定图形里可拖动的点放回初始位置 过程函数
 * 给定图形（含可移动点）里的自由点（base.type === 'none'）和落在对象上的点（base.type === 'online'）
 * 都能被玩家拖走 —— 「还原画布变化量」时连同视图一起复位
 */
function resetGivenPointPositions() {
    const elements = initialStorageElements();
    if (!elements) return;
    const byId = new Map(elements.map(item => [item.id, item]));
    const ids = [...givenFreePointIds(), ...(geometryElementLists.movepoints || [])];
    const points = ids.map(id => geometryManager.get(id)).filter(item => item && item.getType() === 'point');
    // 先自由点、后线上点：线上点的位置是从基底推算的，基底（可能是自由点）先回到初始位置才落得准
    points.sort((a, b) => (a.getBase()?.type === 'online' ? 1 : 0) - (b.getBase()?.type === 'online' ? 1 : 0));
    points.forEach(point => {
        const initial = byId.get(point.getId());
        if (!initial) return;
        const base = initial.base || {};
        if (point.getBase()?.type === 'online') {
            // 线上点存的参数与线型有关（垂线是比例 + 1 …），用回初始参数最准，不受基底当前位置影响
            const element = geometryManager.get((base.basesId || [])[0]);
            if (!element || base.value === undefined) return;
            point.modifyBase('online', [element], base.value);
            if (typeof point.updateCoordinate === 'function') point.updateCoordinate();
        }else{
            geometryManager.modifyPointCoordinate(point.getId(), initial.x, initial.y);
        }
    });
}

/**
 * 关卡载入时适配出来的初始视图（逻辑中心 + 比例） 过程函数（见上面 loadLevelView 里赋值处）
 */
let levelInitialView = null;

/**
 * 变换量还原 过程函数
 * 视图变换复位的同时，把关卡给定图形里被玩家拖走的点也放回初始位置
 */
function resetTransform() {
    // 原地改，不要换成新对象：管理器持有的是同一个 transform 引用，
    // 换成新对象之后 near() 里的 15px 吸附阈值会一直用旧的 scale（缩放后命中范围全错）
    if (levelInitialView) {
        // 回到关卡载入时那个适配视图（小图形会被放大到 2 倍），不是通用初始值
        transform.scale = levelInitialView.scale;
        transform.x = canvasWidth / 2 - levelInitialView.centerX * levelInitialView.scale;
        transform.y = canvasHeight / 2 - levelInitialView.centerY * levelInitialView.scale;
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
    resetGivenPointPositions();
    drawContent();
}



/**
 * 位置同步：L/E 计数器水平居中显示，必要时避让打开的菜单弹层
 */
function updateMovesCounterPosition() {
    const movesLayout = document.querySelector('.moves-layout');
    const menu = document.querySelector('.board-popup.open');
    if (!movesLayout) return;
    movesLayout.style.position = 'fixed';
    // 关卡游玩 / 试玩界面：计数器放在右上角返回按钮的正下方
    const backButton = document.querySelector('#container_more [data-action^="return-to"]');
    if (backButton) {
        const rect = backButton.getBoundingClientRect();
        movesLayout.style.left = 'auto';
        movesLayout.style.right = `${Math.max(window.innerWidth - rect.right, 0)}px`;
        movesLayout.style.transform = 'none';
        movesLayout.style.top = `${rect.bottom + 8}px`;
        return;
    }
    // 计数器水平居中显示
    movesLayout.style.left = '50%';
    movesLayout.style.right = 'auto';
    movesLayout.style.transform = 'translateX(-50%)';
    movesLayout.style.top = '12px';
    // 仅当菜单与计数器实际发生重叠时，才下移避让
    if (menu) {
        const menuRect = menu.getBoundingClientRect();
        const movesRect = movesLayout.getBoundingClientRect();
        const overlaps =
            menuRect.left < movesRect.right &&
            menuRect.right > movesRect.left &&
            menuRect.top < movesRect.bottom &&
            menuRect.bottom > movesRect.top;
        if (overlaps) {
            movesLayout.style.top = `${menuRect.bottom + 8}px`;
        }
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
        
        // 记下打开记录面板之前用的工具：载入记录后要还回去，
        // 否则「非移动工具下打开记录 → 载入一条」会莫名其妙停在「移动」上（见 recordPanel.js 的 loadRecord）
        if (tool !== "move") window.toolBeforeRecordPanel = tool;
        tool = "move";
        drawContent();
        // 打开记录面板时重建列表（recordPanel.js）
        window.recordPanelRefresh?.();
    }else if (panel === "overviewPanel") {
        Object.values(tools).forEach((item) => item.clear?.());
        refreshToolFloating();
        
        tool = "move";
        drawContent();
        loadGeometryElements();
        if (exploreFlag) exploreMode();
    }else if (panel === "toolbarPanel") {
        choiceToolMenu("standard");
        refreshToolFloating();
    }
}

/**
 * 工具栏点击
 * @param {Object} e 事件
 */
function toolbarChoice(e) {
    const action = e.target.dataset.action;
    choiceTool(action);
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
        // 探索视图里撤销 / 重做：快照里的可见性可能来自普通视图（探索集合是隐藏的），
        // 按探索视图再刷一次，否则撤销后探索图形会消失
        if (exploreFlag) setExploreVisibility(true);
        drawContent();
        resultVerify();
    }else if (action === "redo") {
        redoStorage();
        if (exploreFlag) setExploreVisibility(true);
        drawContent();
        resultVerify();
    }
}

/**
 * 菜单弹层点击（按钮与弹层由 board-tools.js 统一构建）
 * @param {string} action 菜单项的 data-action
 */
function menuChoice(action) {
    if (action === "clear-canvas") {
        boardConfirm(t('level.restartAsk'), '', () => {
            // 结果 / 探索两个管理器里的图形都要清掉，否则重新载入关卡图形时 ID 冲突会被改名
            if (typeof clearAllCanvases === 'function') clearAllCanvases(); else clearCanvas();
            // 画到一半的工具状态也丢掉，否则之后作图会点击错位
            if (typeof resetToolState === 'function') resetToolState();
            loadGeometryElementsStorage();
            drawContent();
            // 重开后以初始图形为新的历史起点（步数历史也回到 0）
            resetStorageHistory();
            // 步数归零并同步到界面，否则残留的步数会让 L / E 判定出错
            refreshMovesCounter();
            // L / E 的达成记录与通关提示记录也清零（缩略图的勾不清，点亮过就一直亮着）
            resetLevelProgress();
            refreshLevelStatus();
            refreshStorageButton();
            // 重新判定：清空后所求已经不在画布上，金色图形与通关界面要跟着复位
            // （缩略图的勾是「点亮过就不熄灭」的，清空画布也不会灭）
            resultVerify();
        });
    }else if (action === "switch-construct") {
        switchPanel("toolbarPanel");
    }else if (action === "switch-overview") {
        switchPanel("overviewPanel");
    }else if (action === "design-mode") {
        designMode();
    }else if (action === "switch-record") {
        switchPanel("recordPanel");
    }else if (action === "explore-mode") {
        exploreMode();
    }
}

let exploreFlag = false;
let exploreShowIds = [];
// 进探索视图时被临时藏起来的图形（两套管理器共用同一批对象，退出时要原样放回来）
let exploreRestoreIds = [];
// 载入题目时探索管理器里已有的对象：之后多出来的都是玩家自己在探索画布上画的
let exploreBaseIds = new Set();
// 本次载入是否来自「从制题器 / 求解器返回」的备份：是的话按备份原样还原
let playBackupRestored = false;
// 撤销 / 重做历史是否也随备份还原了：是的话别再拿当前状态当新起点（否则玩家的作图全撤不回来）
let playBackupHistoryRestored = false;
// levels.json 里写的工具限制：straightedge = 单尺（只用直尺），compass = 单规（只用圆规）
const limitedToolSets = {
    straightedge: ['move', 'point', 'line', 'intersection'],
    compass: ['move', 'point', 'circle', 'intersection'],
};
/**
 * 本关允许的工具 过程函数
 * 探索模式要给全工具（探索视图本身不受限），关卡文件没写限制时也不限
 * @returns {string[]|null} null 表示不限制
 */
function allowedPlayTools() {
    if (exploreFlag) return null;
    const limit = typeof levelTools === 'string' ? levelTools : null;
    return limit ? (limitedToolSets[limit] || null) : null;
}
/**
 * 按当前工具限制重建工具栏 过程函数
 * 载入关卡数据、进 / 出探索模式时调用，尽量保留当前选中的工具
 */
function refreshToolLimit() {
    if (typeof generateTool !== 'function') return;
    const keep = typeof tool !== 'undefined' && tool ? tool : null;
    const allowed = allowedPlayTools();
    generateTool('standard');
    if (keep && (!allowed || allowed.includes(keep))) choiceTool(keep);
}

/**
 * 探索视图显示 initial（黑色）与 explore（金色）的几何对象
 * 只切换 explore 集合的可见性；result 集合由 success / unsuccess 控制（判定与非探索模式的显示），两者互不干扰
 * @param {boolean} explore 是否处于探索视图
 */
function setExploreVisibility(explore) {
    if (explore) {
        // 进探索视图前先记下当时可见的图形：探索视图会把它们临时藏起来
        // （两套管理器共用同一批对象，藏了就是全局藏），退出时按这份名单放回来。
        // 本来就处于隐藏状态的（预绘制解法等）不记，免得退出后反而冒出来
        exploreRestoreIds = geometryManagerExplore.getAllByOrder()
            .filter((item) => item.getVisible() && !isGivenObject(item.getId()))
            .map((item) => item.getId());
        // 给定图形（initial 与带标签的 named）在探索视图里也要显示
        showInitialOnly();
        // 探索模式里自己画的图形（载入题目时不存在、之后才画上的对象）保留显示：
        // 探索画布上的图形一直留在探索管理器里，退出再进来不该消失
        geometryManagerExplore.getAllByOrder().forEach((item) => {
            if (!exploreBaseIds.has(item.getId())) item.modifyVisible(true);
        });
        exploreShowIds = [...geometryElementLists.explore].filter((id) => !isGivenObject(id));
        exploreShowIds.forEach((id) => geometryManagerExplore.get(id)?.modifyVisible(true));
    }else{
        exploreShowIds.forEach((id) => geometryManagerExplore.get(id)?.modifyVisible(false));
        exploreShowIds = [];
        // 退出：把进探索视图时临时藏起来的图形放回来（普通模式画的图形不该被探索视图带走）
        exploreRestoreIds.forEach((id) => geometryManagerResult.get(id)?.modifyVisible(true));
        exploreRestoreIds = [];
    }
}

/**
 * 探索模式按钮变色
 */
function refreshExploreButton() {
    document.querySelectorAll('#container_more [data-action="explore"]').forEach((button) => {
        button.classList.toggle('active', exploreFlag);
    });
}

/**
 * 探索模式
 */
function exploreMode() {
    if (exploreFlag) {
        exploreFlag = false;
        // 切换几何对象管理器
        geometryManager = geometryManagerResult;
        storageManager = storageManagerResult;
        movesStorageManager = movesStorageManagerResult;
        // 按钮变色
        refreshExploreButton();
        // 几何对象隐藏
        setExploreVisibility(false);
        // 可移动点的可见性按**当前工具**再定一次：进探索视图时它们被临时藏起了，
        // 退出时会被 setExploreVisibility 一并放回来 —— 若期间已经切到别的工具
        // （移动工具 → 探索 → 切其它工具 → 退出），那些蓝点不该跟着冒出来
        if (typeof showMovePoints === 'function') showMovePoints(tool === "move" && subTool === "choiceDraw");
        // 退出探索模式：工具栏恢复本关的工具限制
        if (typeof refreshToolLimit === 'function') refreshToolLimit();
        drawContent();
        refreshStorageButton();
        refreshMovesCounter();
        // 回到普通模式后重新判定：通关界面与 L / E 勾随之刷新
        resultVerify();
    }else{
        exploreFlag = true;
        // 切换几何对象管理器
        geometryManager = geometryManagerExplore;
        storageManager = storageManagerExplore;
        movesStorageManager = movesStorageManagerExplore;
        // 按钮变色
        refreshExploreButton();
        // 几何对象显示
        setExploreVisibility(true);
        // 探索模式不限制工具：工具栏给全
        if (typeof refreshToolLimit === 'function') refreshToolLimit();
        drawContent();
        refreshStorageButton();
        refreshMovesCounter();
    }
}

/**
 * 记下「返回游玩页」的备份与地址 过程函数
 * 去制题器 / 求解器之前调用：那边点「返回」会回到这里，并把图形、标记与步数一起还原
 * @returns {string} 带 restorePlay=1 的返回地址
 */
function savePlayBackup() {
    const lists = {};
    Object.entries(geometryElementLists).forEach(([key, value]) => { lists[key] = [...value]; });
    const backup = {
        elements: geometryManager.toStorage(),
        lists: lists,
        moves: {l: movesCounter.l, e: movesCounter.e},
        // 已达成的 L / E 勾也一起带走：返回是一次整页重载，这些标记只活在内存里，
        // 不带的话回来就全灰了（步数对得上也显示不出来）
        progress: {reachedTarget: reachedTarget, thumbnailTicks: thumbnailTicks},
        // 撤销 / 重做历史也一起带走：历史每一格都只活在内存里，不带的话回来只剩
        // 「当前状态」一格，玩家去求解器 / 制题器之前作的图形就再也撤不回来了。
        // 结果 / 探索两套各存各的：都塞同一份的话，在探索视图里撤销会回到普通模式的快照
        history: storageManager.serialization(),
        historyResult: storageManagerResult.serialization(),
        historyExplore: storageManagerExplore.serialization(),
        movesHistory: movesStorageManager.serialization(),
        movesHistoryResult: movesStorageManagerResult.serialization(),
        movesHistoryExplore: movesStorageManagerExplore.serialization(),
        // 探索视图里玩家自己画的图形（只在探索管理器、且不是结果管理器里的同一个对象）
        // 另存一份：回来时才知道哪些该只放回探索视图、哪些（普通模式画的）该被隐藏。
        // 按对象身份判断，不能按 id —— 两套管理器各自命名，常会同名
        exploreElements: typeof geometryManagerExplore !== 'undefined' && typeof geometryManagerResult !== 'undefined'
            ? (() => {
                const resultObjects = new Set(geometryManagerResult.getAllByOrder());
                return geometryManagerExplore.getAllByOrder()
                    .filter(item => !resultObjects.has(item))
                    .map(item => item.getDict());
            })()
            : [],
    };
    try {
        sessionStorage.setItem('playBackup', JSON.stringify(backup));
    }catch (error) {
        // 作图很多时历史可能撑爆 sessionStorage 配额：退一步只带图形与标记，
        // 至少「返回后图形还在、L / E 与勾还在」，代价是撤销历史从头开始
        ['history', 'historyResult', 'historyExplore', 'movesHistory', 'movesHistoryResult', 'movesHistoryExplore'].forEach(key => { delete backup[key]; });
        sessionStorage.setItem('playBackup', JSON.stringify(backup));
    }
    // 归一化地址并打上 restorePlay 标记（本来就有的话不重复加，免得 URL 越来越长）
    const params = new URLSearchParams(location.search);
    params.set('restorePlay', '1');
    return location.pathname + '?' + params.toString();
}

/**
 * 设计模式
 */
/**
 * 当前画布上的全部对象 过程函数
 * 游玩页有「结果 / 探索」两套管理器，只在其中一套里画的图形另一套没有；
 * 交给制题器 / 求解器时要把两边合起来（同一 id 以当前管理器为准），
 * 否则用户后来画的那部分会被漏掉
 * @returns {any[]}
 */
function allCanvasElements() {
    const active = geometryManager.toStorage();
    if (typeof geometryManagerResult === 'undefined' || typeof geometryManagerExplore === 'undefined') return active;
    const ids = new Set(active.map(item => item.id));
    const extra = [];
    [geometryManagerResult, geometryManagerExplore].forEach(manager => {
        if (manager === geometryManager) return;
        manager.toStorage().forEach(item => { if (!ids.has(item.id)) extra.push(item); });
    });
    return active.concat(extra);
}

function designMode() {
    // 先把回来时要还原的备份与地址记下来（下面会改写 sessionStorage，备份要赶在改写之前）
    const backUrl = savePlayBackup();
    // 带进制题器的是**关卡文件（gmt）本身**：玩家游玩时画的图形、移动过的点、探索画布上的
    // 图形、游玩过程中改动的标记都不带过去 —— 要改的是题目，不是这一次的游玩过程。
    // 关卡页载入时把 gmt 原样存进了 sessionStorage（level-loader 写的），直接用那份；
    // 读不到（试玩等）才退回当前画布
    let rawElements = null;
    let rawLists = null;
    try {
        rawElements = JSON.parse(sessionStorage.getItem('elements') || 'null');
        rawLists = JSON.parse(sessionStorage.getItem('geometryElementLists') || 'null');
    }catch (error) {
        rawElements = null;
        rawLists = null;
    }
    const elements = (rawElements && rawElements.length) ? rawElements : geometryManager.toStorage();
    const lists = (rawLists && Object.keys(rawLists).length) ? rawLists : {};
    // 制题器里所有对象都要显示（含关卡预绘制的解法），这一步只写进带过去的这份数据里：
    // 不改动当前画布，否则跳转前会先在游玩界面闪一下解法
    elements.forEach(item => { item.visible = true; });
    // 给定 = 关卡里初始显示的对象（initial 与带标签的 named），所求保证有集合，隐藏档清空
    lists.initial = [...new Set([...(lists.initial || []), ...(lists.named || [])])];
    lists.result = [...(lists.result || [])];
    lists.hidden = [];
    sessionStorage.setItem('elements', JSON.stringify(elements));
    sessionStorage.setItem('geometryElementLists', JSON.stringify(lists));
    sessionStorage.setItem('makerBackup', JSON.stringify({
        elements: sessionStorage.getItem('elements'),
        geometryElementLists: sessionStorage.getItem('geometryElementLists'),
        thumbnail: sessionStorage.getItem('thumbnail'),
        // 不作图记录：游玩页自己没有历史，sessionStorage 里的 constructRecord 只可能是
        // 上一次制题器留下的（对不上的图形）。带过去会让制题器套用别人的历史，
        // 一动再撤回就把图形退回那张陌生快照，所以这里一律不带。
        constructRecord: '',
    }));
    // from：制题器的「返回」据此回到本页并还原图形（见 takePlayBackup）
    window.location.href = "./board.html?mode=maker&restore=1&from=" + encodeURIComponent(backUrl);
}

document.getElementById("thumbnail").addEventListener("click", thumbnailOpen);
/**
 * 打开缩略图
 */
function thumbnailOpen() {
    const thumbnail = document.getElementById("thumbnail");
    thumbnail.classList.add("open");
    const masks = document.getElementById("masks");
    masks.style.display = "block";
    const hiddenList = document.getElementsByClassName("hidden_inf");
    for (const item of hiddenList) item.style.display = 'flex';
}

document.getElementById("thumbnail-middle").addEventListener("click", thumbnailPictureZoom);
/**
 * 放大查看缩略图里的示意图 过程函数
 * 卡片没展开时先按原逻辑展开卡片，展开状态下再点图片才全屏放大
 * @param {Object} event
 */
function thumbnailPictureZoom(event) {
    const image = event.target;
    if (image.id !== "thumbnail-picture") return;
    const thumbnail = document.getElementById("thumbnail");
    if (!thumbnail.classList.contains("open")) return;
    if (document.getElementById("thumbnail-zoom")) return;
    event.stopPropagation();
    
    const mask = document.createElement("div");
    mask.id = "thumbnail-zoom";
    mask.className = "thumbnail-zoom";
    const zoomImage = document.createElement("img");
    zoomImage.src = image.src;
    zoomImage.alt = image.alt || "示意图";
    mask.appendChild(zoomImage);
    mask.addEventListener("click", () => mask.remove());
    document.body.appendChild(mask);
}

document.getElementById("masks").addEventListener("click", thumbnailClose);
// 修改关闭按钮的事件监听器，阻止事件冒泡
document.getElementById("thumbnail-title-button").addEventListener("click", function(event) {
    event.stopPropagation(); // 阻止事件冒泡
    thumbnailClose();
});
/**
 * 关闭缩略图
 */
function thumbnailClose() {
    const thumbnail = document.getElementById("thumbnail");
    thumbnail.classList.remove("open");
    const masks = document.getElementById("masks");
    masks.style.display = "none";
    const hiddenList = document.getElementsByClassName("hidden_inf");
    for (const item of hiddenList) item.style.display = 'none';
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
 * 是否画到一半 过程函数
 * 工具已经选中了对象但还没画完（例如直线只点了一个点、三点圆点了两个点）
 * @returns {boolean}
 */
function hasPendingToolDraw() {
    if (typeof tools === 'undefined' || !tools[tool]) return false;
    // 移动工具的缓存里放的是「选定栏」（选中的那个对象），不是画到一半的作图：
    // 撤销 / 重做时不该把它当成半成品清掉，否则选中一个图形后按撤销只会取消选中
    if (tool === 'move') return false;
    return !!tools[tool].cacheFlag || geometryManager.ifToolInCache(tool);
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
 * 撤回 / 重做之后补回可动点的临时蓝色
 * 快照里存的是载入时的颜色（黑），移动工具下的蓝色是 showMovePoints 临时染上去的，
 * 而撤回会按快照重建对象，蓝色随之丢掉（表现为「蓝点变黑」），所以在移动工具下补染一次
 */
function refreshMovePointColors() {
    if (typeof showMovePoints === 'function' && tool === 'move') showMovePoints(true);
}

/**
 * 撤回 / 重做之后的收尾 过程函数
 * 两件事：按最近载入的那条记录的样式表补一次色（撤销清单不带样式，见 recordPanel.js 的
 * recordPanelAfterRestore）；刷新记录面板（画布变了，加号该不该亮要重算）
 */
function afterHistoryMove() {
    if (typeof window.recordPanelAfterRestore === 'function') window.recordPanelAfterRestore();
    window.recordPanelRefresh?.();
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
    // 顺序：先按记录的样式表补色、再补可动点的临时蓝（反了蓝色会被样式表盖掉）
    afterHistoryMove();
    drawContent();
    refreshMovePointColors();
    const moves = movesStorageManager.restore();
    refreshMovesCounterByRestore(moves, 'restore');
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
    refreshMovePointColors();
    const moves = movesStorageManager.redo();
    refreshMovesCounterByRestore(moves, 'redo');
}

window.addEventListener("storage", (event) => {
    // 这次作图因为「图形画布上已经有了」而作废：不加步数（L/E）、不记撤销，只把半成品擦掉
    if (geometryManager.takeDuplicatedFlag()) {
        drawContent();
        return;
    }
    storage();
    refreshMovesCounterByTool(event);
    resultVerify();
});
function storage() {
    // 存储：几何对象 + 选定栏（标记等改动也能撤销）
    storageManager.append(collectStorageSnapshot());
    refreshStorageButton();
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
    "design-mode": {title: "设计模式", context: "切换到几何设计模式"},
    "explore-mode": {title: "探索模式", context: "显示所求几何对象，方便研究"},
    "explore": {title: "探索", context: "切换到探索视图，查看目标对象"},
    "mark-initial": {title: "标记给定", context: "点击对象标记为给定的条件（黑色）"},
    "mark-named": {title: "带标签给定", context: "点击对象标记为带标签的给定（黑色 + 标签），会弹出命名框"},
    "mark-movepoints": {title: "可移动点", context: "点击对象标记为可移动点（蓝色），拖动它时图形随之变化"},
    "mark-result": {title: "标记所求", context: "点击对象标记为所求（金色）"},
    "mark-result-shown": {title: "所求显示", context: "点击对象标记为判定成功后要显示出来的图形（金色）"},
    "mark-explore": {title: "探索显示", context: "点击对象标记为探索模式里要显示的内容（金色）"},
    "return-to-pack": {title: "返回关卡包", context: "返回当前关卡包列表"},
    "return-to-maker": {title: "返回制作环境", context: "返回自制关卡编辑页"},
    "return-to-home": {title: "返回首页", context: "返回站点首页"},
    "return-to-previous": {title: "返回上一界面", context: "回到跳转过来的界面，画好的图形会保留"},
    "switch-to-play": {title: "切换到游玩模式", context: "进入关卡演示和探索模式"},
    "solver-run": {title: "开始求解", context: "用当前图形执行求解搜索"},
    "open-solver": {title: "打开求解器", context: "打开求解器面板并开始搜索"},
    "export-gmt": {title: "导出 GMT", context: "导出当前图形为 GMT 文本"},
    "export-issue": {title: "导出 Issue", context: "生成用于提交问题的模板链接"},
    "general-bar": {title: "通用工具栏", context: ""},
    "point-bar": {title: "点工具栏", context: ""},
    "line-bar": {title: "直线工具栏", context: ""},
    "circle-bar": {title: "圆工具栏", context: ""},
    "construct-bar": {title: "构造工具栏", context: ""},
    "move": {title: "移动工具", context: "可以拖动点、画布"},
    "point": {title: "点工具", context: "点击以创建一个点，可以拖动点以放置到几何对象上"},
    "eraser": {title: "橡皮擦工具", context: ""},
    "line": {title: "直线工具", context: ""},
    "circle": {title: "圆工具", context: ""},
    "intersection": {title: "交点工具", context: ""},
    "ray": {title: "射线工具", context: ""},
    "lineSegment": {title: "线段工具", context: ""},
    "parallelLine": {title: "平行线工具", context: ""},
    "perpendicularLine": {title: "垂线工具", context: ""},
    "perpendicularBisector": {title: "垂直平分线工具", context: ""},
    // 游玩 / 试玩里这两个工具只有一种用法（没有小项切换），说明就写具体的那一个
    "angleBisector": {title: "角平分线工具", context: "三点角平分线：第二点为角的顶点"},
    "compass": {title: "圆规工具", context: "三点圆规：两点距离为半径，第三点为圆心作圆"},
    "middlePoint": {title: "中点工具", context: "构造两个点的中点，或构造圆心"},
    "threePointCircle": {title: "三点圆工具", context: "构造过三个点的圆"},
    "fixedAngle": {title: "定值角工具", context: "构造角一边上的点、角的顶点，逆时针另一边为指定角度的射线"},
    "choiceDraw": {title: "选中拖拽模式", context: "可以选择几何对象，只能拖拽点"},
    "moveView": {title: "移动视图模式", context: "防误触几何对象"},
    "restoreTransform": {title: "还原画布变化量", context: "将画布的视图变换还原至初始值"},
    "clear": {title: "清空选择", context: "清空当前工具的选中栏"},
    "pointStyle": {title: "配置点样式", context: "设置后续绘制的点的颜色、大小与标签显示"},
    "objectStyle": {title: "调整对象样式", context: "用移动工具选中对象后，可修改它的颜色、粗细与标签显示"},
    "deleteObject": {title: "删除选中对象", context: "删除移动工具选中的对象，连同由它作出来的所有子对象"},
    "any": {title: "任意对象", context: "可选中任意几何对象"},
    "choicePoint": {title: "点对象", context: "仅选中点对象"},
    "style": {title: "样式刷", context: "拖拽以配置直线的样式为当前线工具样式"},
    "lineStyle": {title: "配置直线样式", context: "设置后续绘制的直线的颜色、粗细与标签显示"},
    "circleStyle": {title: "配置圆样式", context: "设置后续绘制的圆的颜色、粗细与标签显示"},
    "threePointAngleBisector": {title: "三点角平分线", context: "第二点为角的顶点"},
    "twoLineAngleBisector": {title: "角平分线", context: "构造两条直线的两条角平分线。⚠ 制题器慎用：gmt 无法导出"},
    "threePointCompass": {title: "三点圆规", context: "两点距离为半径，第三点为圆心作圆"},
    "compassCopy": {title: "复制圆规", context: "复制一个圆。⚠ 制题器慎用：gmt 无法导出"},
    "twoPointsMiddlePoint": {title: "中点", context: "构造两个点的中点"},
    "circleCenter": {title: "圆心", context: "构造一个圆的圆心"},
};
/**
 * 游玩 / 试玩专属的英文说明
 * TIP_EN 是三块画板共用的，里面角平分线 / 圆规写着「有两种模式」；本页固定单一用法，按页覆盖
 */
const TIP_EN_PLAY = {
    'angleBisector': ['Angle bisector tool', 'Three-point angle bisector: the second point is the vertex'],
    'compass': ['Compass tool', 'Three-point compass: radius from two points, center at the third'],
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
    
    // 说明文案按当前语言取（中文用 infDict，英文在 i18n.js 的 TIP_EN 里，本页另有 TIP_EN_PLAY 覆盖）
    const tip = tipOf(inf, infDict[inf], TIP_EN_PLAY);
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
    
    // 说明文案按当前语言取（中文用 infDict，英文在 i18n.js 的 TIP_EN 里，本页另有 TIP_EN_PLAY 覆盖）
    const tip = tipOf(inf, infDict[inf], TIP_EN_PLAY);
    infDE.innerHTML = `
        <p class="inf-title">${tip.title}</p>
        <p class="inf-context">${tip.context}</p>
    `;
}



/**
 * 只显示初始条件 过程函数
 * 关卡游玩与试玩保持一致：initial 与带标签的 named 之外的对象先隐藏，
 * 玩家自己作出来（或判定通过）之后再显示
 */
/**
 * 是否为给定图形 过程函数
 * 给定 = initial（只显示图形）+ named（带标签的给定），这些对象任何模式下都要显示，
 * 不会被「隐藏 result 冒号后的图形」或「离开探索视图」带走
 * @param {string} id
 * @returns {boolean}
 */
function isGivenObject(id) {
    return geometryElementLists.initial.has(id) || (geometryElementLists.named || new Set()).has(id);
}

/**
 * 是否为关卡自带的图形（给定 / 带标签给定 / 关卡里预绘制的对象） 过程函数
 * 这些是题目的一部分，游玩时不允许删除（橡皮擦、移动工具的删除按钮都问这里）；
 * 制题器 / 求解器不定义它，那边删自己的图形不受限制
 * @param {string} id 对象 ID
 * @returns {boolean}
 */
window.isProtectedElement = id => {
    if (typeof isGivenObject === 'function' && isGivenObject(id)) return true;
    if (geometryElementLists.level && geometryElementLists.level.has(id)) return true;
    // 所求判定 / 所求显示是关卡的展示内容，玩家不能删也不能改（橡皮擦、移动工具的删除都问这里）
    return typeof isResultObjectOfPage === 'function' ? isResultObjectOfPage(id) : false;
};

function showInitialOnly() {
    geometryManager.getAllByOrder().forEach(item => item.modifyVisible(isGivenObject(item.getId())));
}

/**
 * 刷新页面标题 过程函数
 * 标题随当前关卡走：有关卡标题就是「关卡标题 · 场景」，没有就只写场景
 * @param {string} [levelTitle] 关卡标题
 * @param {string} [sceneName] 场景名（关卡游玩 / 试玩），不传按当前语言取「关卡游玩」
 */
function refreshPageTitle(levelTitle, sceneName) {
    // 试玩页面（?mode=maker-play）不管是带入的图形还是载入的记录，场景名一律用「试玩」
    const testPlay = new URLSearchParams(location.search).get('mode') === 'maker-play';
    const fallback = testPlay ? '试玩' : '关卡游玩';
    const key = testPlay ? 'level.testPlayTitle' : 'level.pageTitle';
    const name = sceneName || (typeof t === 'function' ? t(key) : fallback);
    document.title = `${levelTitle ? levelTitle + ' · ' : ''}${name} | Geommunity Blueprint`;
}

/**
 * 数据加载
 */
function playStartDataLoad() {
    if (new URLSearchParams(location.search).has('pack')) return;
    // 缩略图
    const thumbnailJSON = sessionStorage.getItem('thumbnail');
    if (thumbnailJSON) {
        const thumbnail = JSON.parse(thumbnailJSON);
        document.getElementById("title_inf").textContent = thumbnail.title_input;
        document.getElementById("body_inf").textContent = thumbnail.body_input;
        document.getElementById("bottom_inf").textContent = thumbnail.bottom_input;
        // 试玩：页面标题跟着这次带入的关卡走（场景名由 refreshPageTitle 按页面模式决定）
        refreshPageTitle(thumbnail.title_input);

        if (thumbnail.pictureData) {
            const pictureDE = document.createElement('img');
            pictureDE.id = 'thumbnail-picture';
            pictureDE.src = thumbnail.pictureData;
            pictureDE.alt = "此处放置缩略图";
            const container = document.getElementById('thumbnail-middle');
            container.appendChild(pictureDE);
        }
    }
    
    // 选定栏
    const geometryElementListsJSON = sessionStorage.getItem('geometryElementLists');
    if (geometryElementListsJSON) {
        const geometryElementListsLoad = JSON.parse(geometryElementListsJSON);
        for (const [key, value] of Object.entries(geometryElementListsLoad)) {
            geometryElementLists[key] = new Set(value);
        }
    }

    // 几何对象
    loadGeometryElementsStorage();
    // 与关卡游玩一致：只显示初始条件，解法先藏起来等玩家自己作
    // （从制题器 / 求解器返回时按备份原样还原，自己画的图形不会被藏掉）
    if (!playBackupRestored) showInitialOnly();
    fitInitialView();
    // 代入的图形成为撤销/重做的新起点（从制题器 / 求解器返回时历史已随备份还原，别再清）
    if (!playBackupHistoryRestored && typeof resetStorageHistory === 'function') resetStorageHistory();
    drawContent();
}

/**
 * 让初始图形居中显示 过程函数
 * 画布坐标原点在左上角，而 gmt / 画板里的坐标以图形为中心，需要平移后才能在视野里
 */
function fitInitialView() {
    const visible = geometryManager.getAllByOrder().filter(item => item.getVisible());
    if (!visible.length) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const extend = (x, y) => {
        minX = Math.min(minX, x); minY = Math.min(minY, y);
        maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    };
    visible.forEach(item => {
        const coord = item.getCoordinate?.();
        if (!coord) return;
        if (item.getType() === 'point') {
            extend(coord[0], coord[1]);
        }else if (item.getType() === 'circle') {
            const [[centerX, centerY], [pointX, pointY]] = coord;
            const radius = Math.hypot(pointX - centerX, pointY - centerY);
            extend(centerX - radius, centerY - radius);
            extend(centerX + radius, centerY + radius);
        }else{
            coord.forEach(point => extend(point[0], point[1]));
        }
    });
    if (!Number.isFinite(minX)) return;
    const width = Math.max(maxX - minX, 1);
    const height = Math.max(maxY - minY, 1);
    const canvasDE = document.getElementById('canvas_id1');
    // 画布内部尺寸是物理像素，这里要的是逻辑（CSS）尺寸
    const canvasWidth = canvasDE?.clientWidth || 1280;
    const canvasHeight = canvasDE?.clientHeight || 720;
    // 留出边距，最多放大 2 倍，避免小图形被放得过大
    const scale = Math.min(canvasWidth / (width * 1.6), canvasHeight / (height * 1.6), 2);
    transform.scale = scale;
    transform.x = canvasWidth / 2 - ((minX + maxX) / 2) * scale;
    transform.y = canvasHeight / 2 - ((minY + maxY) / 2) * scale;
    // 记下关卡载入时的视图：这就是「初始视图」，还原画布变化量要回到它，
    // 而不是通用的 initialScale（那是 0.5，小图形会被适配放大，还原时会看着缩小一圈）。
    // 记的是逻辑中心 + 比例，还原时按当时的画布尺寸重算，窗口大小变了也不会偏
    levelInitialView = {centerX: (minX + maxX) / 2, centerY: (minY + maxY) / 2, scale: scale};
    drawContent();
}

/**
 * 取出「返回游玩页」的备份 过程函数
 * 只有地址带 restorePlay=1（由 savePlayBackup 生成的返回地址）时才认，认了就取走备份，
 * 并把地址里的标记去掉：之后刷新页面不会再还原一次
 * @returns {Object|null} 备份（elements / lists / moves），没有就返回 null
 */
function takePlayBackup() {
    const params = new URLSearchParams(location.search);
    if (params.get('restorePlay') !== '1') return null;
    params.delete('restorePlay');
    const search = params.toString();
    history.replaceState(null, '', location.pathname + (search ? '?' + search : ''));
    const raw = sessionStorage.getItem('playBackup');
    sessionStorage.removeItem('playBackup');
    if (!raw) return null;
    const backup = JSON.parse(raw);
    // 选定栏与步数一起还原：只还原图形的话步数会从 0 重新算，L / E 勾就白送了
    if (backup.lists) Object.entries(backup.lists).forEach(([key, value]) => { geometryElementLists[key] = new Set(value); });
    if (backup.moves) {
        movesCounter.l = backup.moves.l || 0;
        movesCounter.e = backup.moves.e || 0;
        movesCounterDE.innerText = `${movesCounter.l}L ${movesCounter.e}E`;
        // 步数历史随备份一起还原时不要再补一格：补了会和图形历史的格数错开，撤销时步数就错位
        if (!backup.movesHistory) movesStorageManager.append({l: movesCounter.l, e: movesCounter.e});
    }
    // 已达成的 L / E 勾（本关内点亮过就不熄灭）也还原回来
    if (backup.progress) {
        if (backup.progress.reachedTarget) reachedTarget = Object.assign({l: false, e: false}, backup.progress.reachedTarget);
        if (backup.progress.thumbnailTicks) thumbnailTicks = Object.assign({done: false, l: false, e: false, v: false}, backup.progress.thumbnailTicks);
    }
    // 撤销 / 重做历史：结果 / 探索各还原各的（反序列化顺带把 status 打开，
    // 之后玩家新画的图形照常进历史）
    const restoreHistory = (manager, data) => { if (manager && data) manager.deserialization(data); };
    restoreHistory(storageManagerResult, backup.historyResult);
    restoreHistory(storageManagerExplore, backup.historyExplore);
    restoreHistory(storageManager, backup.history);
    restoreHistory(movesStorageManagerResult, backup.movesHistoryResult);
    restoreHistory(movesStorageManagerExplore, backup.movesHistoryExplore);
    restoreHistory(movesStorageManager, backup.movesHistory);
    if (backup.history && backup.historyResult && backup.historyExplore) playBackupHistoryRestored = true;
    playBackupRestored = true;
    return backup;
}

/**
 * 加载几何对象
 */
function loadGeometryElementsStorage() {
    // 从制题器 / 求解器返回：这份备份就是要还原的图形
    const backup = takePlayBackup();
    const elementsJSON = backup ? JSON.stringify(backup.elements) : sessionStorage.getItem('elements');
    if (elementsJSON) {
        const elements = JSON.parse(elementsJSON);

        // 1.反序列化为元素
        // 备份里把探索视图独有的图形另存了一份（exploreElements）：它们只进探索管理器，
        // 玩家在探索画布上画的图形不该出现在普通模式的画板上。
        // 不能混进 elements 里按 id 判断 —— 两套管理器的对象各自独立命名，常会同名（如都有 L）
        const exploreOnly = (backup && backup.exploreElements) || [];
        const exploreOwnIds = new Set(exploreOnly.map(item => item.id));
        elements.forEach((item) => {
            const element = deserialization(item);
            geometryManagerResult.addObject(element);
            geometryManagerExplore.addObject(element);
            if (geometryElementLists.initial.has(item.id) || (geometryElementLists.named || new Set()).has(item.id)) {
                element.modifyColor("#191919");
            }else if (geometryElementLists.movepoints.has(item.id)) {
                element.modifyColor('#0099ff');
            }else if (isResultJudgedOfPage(item.id)) {
                // 「所求显示」不在这里上色：它们多数是隐藏的，作出解之后由 setResultGroupsVisible 点亮；
                // 「所求显示」不在这里上色：给定了的对象（如既在 named 又列在冒号后的点）保持黑色
                element.modifyColor('#ffd700');
            }else if (geometryElementLists.explore.has(item.id)) {
                element.modifyColor('#ffd700');
            }else{
                element.modifyColor(item.color);
            }
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

        // 2b.探索视图独有的图形：只加进探索管理器，并在那边单独接一次基底
        exploreOnly.forEach((item) => {
            geometryManagerExplore.addObject(deserialization(item));
        });
        exploreOnly.forEach((item) => {
            const bases = item.base;
            if (!bases || bases.type === 'none') return;
            const currentElement = geometryManagerExplore.get(item.id);
            if (!currentElement) return;
            const objectList = (bases.basesId || []).map(id => geometryManagerExplore.get(id)).filter(Boolean);
            if (item.type === 'point') {
                currentElement.modifyBase(bases.type, objectList, bases.value, bases.excludeId ? geometryManagerExplore.get(bases.excludeId) : null);
                objectList.forEach((base) => base.addSuperstructure(currentElement));
            }else{
                currentElement.modifyDefine(bases.type, objectList, bases.value);
            }
        });

        // 关卡自带的几何对象 ID：按选定栏着色时只认这些对象，
        // 避免玩家新画的图形恰好与关卡文件里未载入的对象（如所求对象）同名而被误判
        // 从备份还原时沿用备份里的 level：备份的图形里含玩家自己画的图形，
        // 重新算的话会把玩家的作图也算成关卡自带，判定就永远不通过
        geometryElementLists.level = backup ? new Set(backup.lists?.level || []) : new Set(elements.map(item => item.id));
        // 记下这次载入的图形：之后探索管理器里多出来的都是玩家自己在探索画布上画的。
        // 从备份还原时「载入的图形」= 除备份里那些探索视图专属图形之外的全部：
        // 只把 level 当基线的话，玩家在普通模式画的图形会被当成探索视图的图形，
        // 切到探索视图后它们仍然显示（探索视图本该只剩题目与探索图形）
        exploreBaseIds = new Set(elements.map(item => item.id).filter(id => !exploreOwnIds.has(id)));

        drawContent();

        // 从制题器 / 求解器返回：按还原后的画布重新算一次步数与判定（勾、通关界面随之复位）
        if (backup) {
            refreshMovesCounter();
            refreshLevelStatus();
            resultVerify();
            // 撤销 / 重做的可用性按还原后的历史重判：DOMContentLoaded 里判过一次，
            // 那时历史还是空的，不重判的话返回后撤销按钮是灰的（历史其实是好的）
            if (typeof refreshStorageButton === 'function') refreshStorageButton();
        }
    }
    
    function deserialization(elementDict) {
        const type = elementDict.type;
        const id = elementDict.id;
        const name = elementDict.name;
        const valid = elementDict.valid;
        const color = elementDict.color;
        
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

        // 显示规则由 gmt 解析给出（initial、named 显示，hidden 与预绘制出的解隐藏），
        // 可移动点由 showMovePoints 在移动工具下临时显示
        const isVisible = elementDict.visible !== false && !geometryElementLists.hidden.has(id);
        element.modifyVisible(isVisible);
        element.modifyShowName(geometryElementLists.name.has(id));
        element.modifyWidth(elementDict.width || 1);
        element.modifyName(name);
        element.modifyValid(valid);
        element.modifyColor(color);
        return element;
    }
}

/**
 * 单个所求对象是否已被玩家作出
 * 关卡文件里预绘制的对象不算玩家的作图，判定对象自身也不算
 * @param {string} id 所求对象 ID
 * @returns {boolean}
 */
function isResultProduced(id) {
    const resultElement = geometryManager.get(id);
    if (!resultElement) return false;
    const type = resultElement.getType();
    const equative = type === 'point' ? ToolsFunction.pointEquative
        : type === 'line' ? ToolsFunction.lineEquative
        : type === 'circle' ? ToolsFunction.circleEquative : null;
    if (!equative) return false;
    for (const element of geometryManager.getAllByOrder()) {
        if (element.getType() !== type) continue;
        const id2 = element.getId();
        if (id2 === id) continue;
        // 关卡文件里预绘制的对象不算玩家的作图结果
        if (geometryElementLists.level?.has(id2)) continue;
        if (equative(resultElement, element)) {
            // 线段还要两个端点都真的作出来了：只比「所在直线」的话，画出所在直线就会被误判成作出（见 segmentEndpointsProduced）
            if (!segmentEndpointsProduced(resultElement)) continue;
            return true;
        }
    }
    return false;
}

/**
 * 线段的两个端点是否都已经作出来了 过程函数
 * 判定对象是线段时，光有「所在直线」不算：两个端点都得真的在画布上。
 * 看得见的点（给定、可移动点、玩家自己作的点）都算；
 * 只存在于关卡预绘制里、平时还藏着的点不算 —— 例如 l-doubleseg 的 D 就是答案里的点，
 * 不排除的话随手画一条过 A、B 的直线就会被判成作出了「倍长线段」。
 * 注意不要求玩家自己也画出线段：单尺关卡里只有直线工具，画出所在直线即等价
 * @param {Object} resultElement 所求判定里的线段
 * @returns {boolean}
 */
function segmentEndpointsProduced(resultElement) {
    if (resultElement.getDrawType?.() !== 'lineSegment') return true;
    const figures = resultElement.getBase()?.figure || [];
    if (figures.length < 2) return false;
    const drawnPoint = end => {
        if ((end.getVisible && end.getVisible()) && !(end.getValid && !end.getValid())) return true;
        const coordinate = end.getCoordinate?.();
        if (!coordinate) return false;
        const [ex, ey] = coordinate;
        // 端点也可能是玩家另作的一个同位置的点
        return geometryManager.getAllByOrder().some(element => {
            if (element.getType() !== 'point') return false;
            // 隐藏 / 失效的点不算（关卡预绘制的端点基本都是藏着的）
            if (element.getVisible && !element.getVisible()) return false;
            if (element.getValid && !element.getValid()) return false;
            const other = element.getCoordinate?.();
            if (!other) return false;
            return Math.hypot(other[0] - ex, other[1] - ey) < 1e-6;
        });
    };
    return figures.every(drawnPoint);
}

/**
 * 本页解的多解组数 过程函数
 * 关卡是 result / result2…、resultShown / resultShown2…，取最大的那个下标
 * @returns {number}
 */
function resultGroupCountOfPage() {
    if (typeof resultGroupCount === 'function') return Math.max(1, resultGroupCount());
    return 20;
}

/**
 * 某个对象是不是本页「所求」里的对象 过程函数
 * 判定（result / result2…）与所求显示（resultShown / resultShown2…）都算：
 * 只认第 1 组的话，多解关卡第 2 组起标不出金色
 * @param {string} id
 * @returns {boolean}
 */
function isResultObjectOfPage(id) {
    const max = resultGroupCountOfPage();
    for (let index = 1; index <= max; index++) {
        const judgedKey = index === 1 ? 'result' : `result${index}`;
        const shownKey = index === 1 ? 'resultShown' : `resultShown${index}`;
        if (geometryElementLists[judgedKey]?.has(id)) return true;
        if (geometryElementLists[shownKey]?.has(id)) return true;
    }
    return false;
}

/**
 * 某个对象是不是本页的「所求判定」对象 过程函数
 * 只认判定（result / result2…），不含「所求显示」——显示对象多半是隐藏的，
 * 作出解之后才由 setResultGroupsVisible 点亮，不能载入时就染金
 * @param {string} id
 * @returns {boolean}
 */
function isResultJudgedOfPage(id) {
    const max = resultGroupCountOfPage();
    for (let index = 1; index <= max; index++) {
        const judgedKey = index === 1 ? 'result' : `result${index}`;
        if (geometryElementLists[judgedKey]?.has(id)) return true;
    }
    return false;
}

/**
 * 本页的 result 分组
 * 关卡来自 gmt 解析（window.gmtResultGroups）；画板试玩没有分组信息
 * （window.gmtResultGroups 只由 level-loader 在关卡页赋值），退回按选定栏自己拼：
 * result / result2… 与 resultShown / resultShown2…，别把「所求显示」与多解整组丢掉
 * @returns {{judged: string[], shown: string[]}[]}
 */
function resultGroupsOfPage() {
    const groups = (window.gmtResultGroups || []).filter(group => group.judged.length || group.shown.length);
    if (groups.length) return groups;
    const out = [];
    const max = resultGroupCountOfPage();
    for (let index = 1; index <= max; index++) {
        const judged = [...(geometryElementLists[index === 1 ? 'result' : `result${index}`] || [])];
        const shown = [...(geometryElementLists[index === 1 ? 'resultShown' : `resultShown${index}`] || [])];
        if (judged.length || shown.length) out.push({judged: judged, shown: shown.length ? shown : judged});
    }
    return out;
}

/**
 * 几何对象同一判定
 * result 可以有多条（多解）：只要任意一条的判定对象都作出了，这一关就算作出，
 * 返回所有已作出的分组（用于显示各自冒号后的图形）
 * @returns {Promise} 已作出的 result 分组
 */
function resultVerifyFunction() {
    return new Promise((resolve) => {
        const groups = resultGroupsOfPage();
        if (!groups.length) {
            resolve([]);
            return;
        }
        // 只有「判定」非空且都作出的组才算作出（纯「所求显示」的组没有判定，不该直接算过）
        resolve(groups.filter(group => group.judged.length && group.judged.every(id => isResultProduced(id))));
    });
}

// 最近一次判定中已作出的 result 分组，供 success 显示对应的图形
let satisfiedResultGroups = [];

/**
 * 显示 / 隐藏 result 冒号后的图形（判定成功时显示并按金色标出）
 * @param {Array} groups result 分组
 * @param {boolean} visible
 */
function setResultGroupsVisible(groups, visible) {
    const ids = new Set();
    (groups || []).forEach(group => {
        // 没写冒号（shown 为空）时把判定对象本身显示出来，
        // 否则作出所求后画布上什么都不会亮，也没法看出它跟着图形一起动
        const list = group.shown && group.shown.length ? group.shown : (group.judged || []);
        list.forEach(id => ids.add(id));
    });
    ids.forEach(id => {
        const element = geometryManager.get(id);
        if (!element) return;
        if (visible) {
            // 给定对象保持自己的黑色：所求显示里可能混着给定（如 ewp14 的 X 既是带标签给定，
            // 又列在所求显示的冒号后），一并染金会让题目条件变成金色
            if (!isGivenObject(id)) GeometryElement.prototype.modifyColor.call(element, '#ffd700');
            element.modifyVisible(true);
        }else if (!isGivenObject(id)) {
            element.modifyVisible(false);
        }
    });
    // 给定图形（initial 与带标签的 named）必须一直显示，不能被 result 的隐藏逻辑带走
    if (!visible) refreshElementListColors();
}

// 通关界面自动收起的计时器
let completeLayoutTimer = null;

/**
 * 本关目标步数 过程函数
 * 文案来自关卡数据（如 "5L / 6E"）；试玩等没有目标时返回 null
 * @returns {{l: number|null, e: number|null}}
 */
function targetStepsOfPage() {
    let text = '';
    try {
        text = JSON.parse(sessionStorage.getItem('thumbnail') || '{}').bottom_input || '';
    }catch (error) {
        text = '';
    }
    const pick = pattern => {
        const match = String(text).match(pattern);
        return match ? Number(match[1]) : null;
    };
    return {l: pick(/(\d+)\s*L/i), e: pick(/(\d+)\s*E/i)};
}

// 达到过 L / E 目标：一旦亮起就保持金色（重开本关才清零）
let reachedTarget = {l: false, e: false};
// 上一次判定时已作出的 result 组数：只有真正多作出了一条解才再弹通关界面
let lastSatisfiedCount = 0;
// 上一次弹通关界面时 L / E 是否已达标：刚达标时也要重新弹一次，勾才能当场被看到
let lastShownTarget = {l: false, e: false};
// 缩略图里的勾：本关内只要点亮过就不再熄灭（所求被撤销、画布被清空都不熄灭）
let thumbnailTicks = {done: false, l: false, e: false, v: false};

/**
 * 清空本关进度记录 过程函数
 * 重开本关、载入新关卡以及撤销掉所求时用（L / E 达成记录与「已弹过通关界面」都清零）
 * 缩略图的勾不在这里清（点亮过就不再熄灭），复位见 resetThumbnailTicks
 */
function resetLevelProgress() {
    reachedTarget = {l: false, e: false};
    lastSatisfiedCount = 0;
    lastShownTarget = {l: false, e: false};
}

/**
 * 清空缩略图的勾 过程函数
 * 只在载入新关卡时调用：游玩过程中的撤销 / 清空画布都不会让它熄灭
 */
function resetThumbnailTicks() {
    thumbnailTicks = {done: false, l: false, e: false, v: false};
}

/**
 * 记录本关进度 过程函数
 * 每次判定（resultVerify）后调用：只要判定到「做出了所求」，就顺带判定 L / E 是否达标，
 * 把结果分别记进「通关界面可达标」与「缩略图永久点亮」两份记录
 */
function recordProgress() {
    const groups = resultGroupsOfPage();
    const target = targetStepsOfPage();
    const done = satisfiedResultGroups.length > 0;
    if (done) {
        thumbnailTicks.done = true;
        // L / E 要先把题做出来才算达成（没作出 result 之前步数再少也不算）
        if (target.l !== null && movesCounter.l <= target.l) {
            reachedTarget.l = true;
            thumbnailTicks.l = true;
        }
        if (target.e !== null && movesCounter.e <= target.e) {
            reachedTarget.e = true;
            thumbnailTicks.e = true;
        }
    }
    // V 勾不在这里写：它表示「这一刻画板上所有 result 都在」，
    // 由 levelProgress() 按当前判定现算（先作出所有解、之后移动图形把某条解弄没了，V 就该跟着灭）
    void groups;
}

/**
 * 本关进度 过程函数
 * 完成：作出了任意一个 result；L / E：步数不超过关卡目标；V：多条 result（多解）全部作出
 * 只读不写：达成记录由 recordProgress 在判定时写入
 * @returns {{target: Object, done: boolean, l: boolean, e: boolean, v: boolean, showL: boolean, showE: boolean, showV: boolean}}
 */
function levelProgress() {
    const groups = resultGroupsOfPage();
    const target = targetStepsOfPage();
    return {
        target: target,
        done: satisfiedResultGroups.length > 0,
        l: reachedTarget.l,
        e: reachedTarget.e,
        v: groups.length > 0 && satisfiedResultGroups.length >= groups.length,
        showL: target.l !== null,
        showE: target.e !== null,
        showV: groups.length > 1,
    };
}

/**
 * 缩略图下方的目标与达成情况 过程函数
 * 目标 L / E 步数 + 完成 / L / E / V 四个勾（未达成的勾是灰的）
 */
function refreshLevelStatus() {
    const box = document.getElementById('level-status');
    if (!box) return;
    const progress = levelProgress();
    const bottomInf = document.getElementById('bottom_inf');
    if (bottomInf && !bottomInf.textContent.trim()) bottomInf.textContent = t('level.noTarget');
    const toggle = (name, active, visible = true) => {
        const item = box.querySelector(`[data-tick="${name}"]`);
        if (!item) return;
        item.hidden = !visible;
        item.classList.toggle('active', !!(active && visible));
    };
    // 完成 / L / E 的勾是「进度」：点亮过就一直亮着，撤销所求、清空画布都不会熄灭
    toggle('done', thumbnailTicks.done);
    toggle('l', thumbnailTicks.l, progress.showL);
    toggle('e', thumbnailTicks.e, progress.showE);
    // V 勾不同：要求画板上**同时**画出全部 result 才亮，所以按当前判定结果现算，
    // 解被弄没了就跟着灭（progress.v = 当前满足的组数 >= 总组数，见 levelProgress）
    toggle('v', progress.v, progress.showV);

    // 目标步数（未达成的黑、已达成的金）：收起时做成图片左上角的小窗，展开后写在正文那行的「目标：」后面
    const goalParts = [];
    if (progress.showL) goalParts.push(`<span class="goal-part${thumbnailTicks.l ? ' active' : ''}">${progress.target.l}L</span>`);
    if (progress.showE) goalParts.push(`<span class="goal-part${thumbnailTicks.e ? ' active' : ''}">${progress.target.e}E</span>`);
    const badge = document.getElementById('level-goal-badge');
    if (badge) {
        badge.innerHTML = goalParts.join('');
        badge.hidden = !goalParts.length;
    }
    // 正文那行的步数只认 goalSteps 标记（试玩带进来的记录文本不能动）
    if (bottomInf && bottomInf.dataset.goalSteps && goalParts.length) {
        bottomInf.innerHTML = goalParts.join(' ');
    }
}

/**
 * 通关界面 过程函数
 * 四条勾与缩略图下方的状态一致
 */
function showCompleteLayout() {
    const pop = document.getElementById('complete-layout');
    if (!pop) return;
    // 竖直位置现算：滑入框的底部刚好停在浮动栏顶部再往上一点（浮动栏高度 / 位置随设备变）。
    // 只在收起状态（没有 .trans）时算：滑入过程中改 bottom 会先竖直跳一下再横着滑
    if (!pop.classList.contains('trans')) {
        const bar = document.getElementById('floating-bar-buttons') || document.getElementById('container_toolbar');
        if (bar) {
            const barTop = bar.getBoundingClientRect().top;
            pop.style.bottom = `${Math.max(8, Math.round(window.innerHeight - barTop) + 10)}px`;
        }
    }
    const progress = levelProgress();
    // 重新弹出的时机：多作出了一条解，或者刚好达成了 L / E 目标。
    // 后者很关键：弹层自动收回后步数才降到目标内时，L / E 的勾要当场弹出来给玩家看到，
    // 否则只会静静地亮在收起的弹层里，玩家以为没达成。
    // 移动图形、添加形状、撤销等操作只要所求还在，就安静地刷新勾与步数，不再打扰
    const isNewSolution = satisfiedResultGroups.length > lastSatisfiedCount;
    const isNewTarget = (progress.l && !lastShownTarget.l) || (progress.e && !lastShownTarget.e);
    lastSatisfiedCount = satisfiedResultGroups.length;
    lastShownTarget = {l: progress.l, e: progress.e};
    const toggle = (name, active, visible = true) => {
        const item = pop.querySelector(`[data-complete="${name}"]`);
        if (!item) return;
        item.hidden = !visible;
        item.classList.toggle('active', !!(active && visible));
    };
    toggle('done', progress.done);
    toggle('l', progress.l, progress.showL);
    toggle('e', progress.e, progress.showE);
    toggle('v', progress.v, progress.showV);
    // 步数与目标的对比：作出所求时就能看出有没有达到 L / E 数
    const steps = document.getElementById('complete-steps');
    if (steps) {
        const label = (current, target, reached) => {
            if (!reached) return `${current} / ${target}`;
            // 达成过就一直留着勾，步数后来又超了则注明「曾达标」
            return `${current} / ${target} ${current <= target ? '✓' : `(${t('level.reachedBefore')})`}`;
        };
        const parts = [];
        if (progress.showL) parts.push(`L ${label(movesCounter.l, progress.target.l, progress.l)}`);
        if (progress.showE) parts.push(`E ${label(movesCounter.e, progress.target.e, progress.e)}`);
        steps.textContent = parts.join('　');
    }
    // 缩略图下方的状态跟着一起刷新
    refreshLevelStatus();

    if (!isNewSolution && !isNewTarget) return;

    // 重新播放滑入动画：连续作出 result 时也要能再弹一次
    pop.classList.remove('trans');
    void pop.offsetWidth;
    pop.classList.add('trans');
    clearTimeout(completeLayoutTimer);
    completeLayoutTimer = setTimeout(() => pop.classList.remove('trans'), 5000);
}

/**
 * 收起通关界面 过程函数
 */
function hideCompleteLayout() {
    const pop = document.getElementById('complete-layout');
    if (!pop) return;
    clearTimeout(completeLayoutTimer);
    pop.classList.remove('trans');
    pop.querySelectorAll('.complete-item').forEach(item => item.classList.remove('active'));
    // 回到未完成状态：下次再作出所求（或再达标）时允许重新弹出提示
    lastSatisfiedCount = 0;
    lastShownTarget = {l: false, e: false};
    refreshLevelStatus();
}

/**
 * 所求验证
 */
async function resultVerify() {
    if (exploreFlag) return;
    satisfiedResultGroups = await resultVerifyFunction();
    // 判定完先记录：做出所求时顺带判定 L / E，并把缩略图的勾永久点亮
    recordProgress();
    if (satisfiedResultGroups.length) {
        // 触发成功事件
        const event = new CustomEvent("success");
        window.dispatchEvent(event);
    }else{
        // 触发未成功事件
        const event = new CustomEvent("unsuccess");
        window.dispatchEvent(event);
    }
}

window.addEventListener("success", success);
/**
 * 完成几何构造
 */
function success() {
    // 步数字体变化
    const moves = document.getElementById('moves');
    moves.style.color = '#ffd700';
    moves.style.setProperty('font-weight', 'bold');

    // 显示已作出的 result 对应的图形（result 冒号后的内容），并标成金色
    setResultGroupsVisible(satisfiedResultGroups, true);

    // 通关界面：完成 / L / E / V 勾
    showCompleteLayout();

    // 作出所求：历史记录里还没有一致的构造时自动存一条（recordPanel.js，试玩模式不存）
    window.recordPanelAutoSave?.();

    // 重绘
    drawContent();
}

window.addEventListener("unsuccess", unsuccess);
/**
 * 未完成几何构造
 */
function unsuccess() {
    // 步数字体变化
    const moves = document.getElementById('moves');
    moves.style.color = '#000000';
    moves.style.setProperty('font-weight', 'normal');

    // 未完成时 L / E 的达成记录也清零：通关界面的勾要跟着「所求还在不在画布上」走，
    // 撤销掉所求后不该还亮着（再作出所求时会重新评定）
    // 缩略图的勾不在此列，它点亮过就一直亮着，见 recordProgress / resetThumbnailTicks
    resetLevelProgress();

    // 所求已经不在画布上（撤掉 / 清空 / 重新画）：下一轮作出所求时重新允许自动保存
    // （recordPanel.js：一次「作出所求」只自动存一条，之后接着画图不再存）
    window.recordPanelAutoReset?.();

    // 隐藏所有 result 冒号后的图形
    setResultGroupsVisible(resultGroupsOfPage(), false);

    // 收起通关界面
    hideCompleteLayout();

    // 重绘
    drawContent();
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
    choiceToolMenu('standard');
    document.getElementById("container_toolbar").addEventListener("click", toolbarChoice);
    document.getElementById("floating-bar-buttons").addEventListener("click", toolSwitchChoice);
    document.getElementById("container_more").addEventListener("click", morebarChoice);
    document.getElementById("container_overview").addEventListener("click", selectElementByOverview);
    document.getElementById("geometry-item").addEventListener("click", geometryItemClick);
    // 详情面板里的名称 / 坐标 / 基底值输入框（与制题器同一套处理）
    document.getElementById("geometry-item").addEventListener("change", geometryItemChange);
    // 记录面板的点击由 recordPanel.js 自己按事件委托绑定
    // 初始化
    updateLayout();
    resizeCanvas();
    drawContent();
    switchPanel("toolbarPanel");
    // 存储管理器先就绪，playStartDataLoad 末尾的 resetStorageHistory 才会生效
    storageManagerResult.setStatus(true);
    storageManagerExplore.setStatus(true);
    movesStorageManagerResult.setStatus(true);
    movesStorageManagerExplore.setStatus(true);
    // 从制题器 / 求解器返回：三套历史都随备份还原好了，这里再补一格会让撤销要多按一次才动
    if (!playBackupHistoryRestored) {
        storageManagerResult.append(geometryManager.toStorage());
        storageManagerExplore.append(geometryManager.toStorage());
        movesStorageManagerResult.append(movesCounter);
        movesStorageManagerExplore.append(movesCounter);
    }
    refreshStorageButton();
    playStartDataLoad();
    // 关卡游玩的那一份在 level-loader 里调（要等关卡图形与缩略图都就位再标，见那边的 applyRecordTargets）：
    // 这里先跑的话会被随后的 resetThumbnailTicks 清掉
}

/**
 * 打开关卡时读历史记录 过程函数
 * 本关有「作出过所求、且步数达到目标」的记录时，缩略图的目标步数也标成金色
 * 试玩模式没有记录功能（关卡 id 为空时直接跳过）
 */
function applyRecordTargets() {
    if (typeof recordStore === 'undefined') return;
    const levelId = new URLSearchParams(location.search).get('id');
    if (!levelId) return;
    // 记录里这一关有没有达标过（作出过所求 + 步数不超过目标，见 recordStore.reachedTargetOf）
    const reached = recordStore.reachedTargetOf(levelId, targetStepsOfPage());
    if (!reached.done) return;
    // 完成过就一直亮（与 recordProgress 点亮的勾同一套口径）
    thumbnailTicks.done = true;
    if (reached.l) thumbnailTicks.l = true;
    if (reached.e) thumbnailTicks.e = true;
    refreshLevelStatus();
}