/* canvas.js */
/**
 * 绘制函数 过程函数
 */
 // 画布
const canvas = document.getElementById("canvas_id1");
const rect = canvas.getBoundingClientRect();
let canvasTop = rect.top;
let canvasLeft = rect.left;
let canvasWidth = rect.width;
let canvasHeight = rect.height;
let viewportInitialized = false;
const ct = canvas.getContext("2d");
let minMoveX = -500 - canvasWidth,
    minMoveY = -500 - canvasWidth;
const maxMoveX = 500, // max是负的
    maxMoveY = 500,
    // 缩放范围给足：0.1 ~ 10 太小，滚几下一会儿就顶到头（表现为「卡住不能继续放大/缩小」）
    minScale = 1e-4,
    maxScale = 1e4,
    // 初始 / 「还原视角」的缩放倍数。
    // 放在这里而不是各页脚本里：画板（index.js）与关卡游玩（playPage.js）共用一个值。
    initialScale = (Math.random() - 0.5) * 0.01 + 0.5;
// 图形尺寸基准（宽度倍率为 1 时的像素值）：点的外径半径与线的粗细。
// 预览（半成品草稿图、光标下的点预览）与选中圈都跟着这两个值走，改这里就一起变
const POINT_RADIUS_BASE = 6;
const LINE_WIDTH_BASE = 3;
// 点完一下之后先不画预览，等指针真的移动过再画：
// 点完一条线时光标还停在那条线上，这时立刻画出「过该点的平行线 / 垂线」会让人以为点已经取好了
// 记的是**未吸附的原始指针坐标**：用吸附后的坐标比较时，吸附候选会随亚像素抖动在两个图形之间跳，
// 坐标一下差出十几像素，判定就失效了（鼠标没动也会冒出预览）
let previewWaitPointer = null;
/**
 * 让预览等指针移动 过程函数
 * 点击落点后调用：记下这一刻指针的原始画布坐标，指针真的动开之前不再画预览（见 toolPreviewState）
 * @param {number} [x] 原始指针 x（未吸附）
 * @param {number} [y] 原始指针 y（未吸附）
 */
function previewWaitForMove(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    previewWaitPointer = {x: x, y: y};
}

/**
 * 指针移动了 过程函数
 * 每个真实的指针移动事件都要调用它：动开 2px 以上才解除「先不画预览」的限制
 * @param {number} x 原始指针 x（未吸附）
 * @param {number} y 原始指针 y（未吸附）
 */
function previewPointerMoved(x, y) {
    if (!previewWaitPointer) return;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (Math.hypot(x - previewWaitPointer.x, y - previewWaitPointer.y) > 2) previewWaitPointer = null;
}

/**
 * 还在等指针移动吗 过程函数
 * @returns {boolean}
 */
function previewWaiting() {
    return !!previewWaitPointer;
}
const hex = '0123456789abcdef';

// 当窗口大小改变时调整画布
window.addEventListener('resize', resizeCanvas);

/**
 * 设备像素比 过程函数
 * 高分屏（手机 / Retina）按 dpr 放大画布的物理像素，绘制时再缩回 CSS 像素坐标，
 * 这样线条不会因为 1 逻辑像素 = 1 物理像素而发糊
 * @returns {number}
 */
function canvasPixelRatio() {
    return window.devicePixelRatio || 1;
}

/**
 * 调整画布 过程函数
 */
function resizeCanvas() {
    const previousWidth = canvasWidth;
    const previousHeight = canvasHeight;
    const ratio = canvasPixelRatio();
    // 画布内部尺寸（物理像素）按设备像素比放大
    canvas.width = Math.round(window.innerWidth * ratio);
    canvas.height = Math.round(window.innerHeight * ratio);
    // CSS 尺寸保持逻辑像素，避免画布被放大显示
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    const currentRect = canvas.getBoundingClientRect();
    canvasTop = currentRect.top;
    canvasLeft = currentRect.left;
    // 这里的宽高一律按 CSS 像素（逻辑坐标），绘制时由 drawContent 统一放大到物理像素
    canvasWidth = currentRect.width || window.innerWidth;
    canvasHeight = currentRect.height || window.innerHeight;
    minMoveX = -500 - canvasWidth;
    minMoveY = -500 - canvasWidth;
    if (!viewportInitialized) {
        transform.x = canvasWidth / 2;
        transform.y = canvasHeight / 2;
        viewportInitialized = true;
    }else if (previousWidth && previousHeight) {
        transform.x += (canvasWidth - previousWidth) / 2;
        transform.y += (canvasHeight - previousHeight) / 2;
    }
    drawContent()
}

/**
 * 求解器解法覆盖层 状态
 * 由求解器面板写入（{points: [{x,y}], lines: [{x1,y1,x2,y2}], circles: [{x,y,r}]}，世界坐标），
 * 这里只负责把它画出来 —— 解法是「看」的，不是画布上的真对象，所以不参与选取与导出
 */
let solverSolutionOverlay = null;
/** 解法覆盖层的颜色（品红），与求解器面板用的一致 */
const SOLVER_SOLUTION_COLOR = '#ff00ff';
/**
 * 求解器的「可动构造计划」 状态
 * 面板选中某个解时写入 {solution, result, dag, step, pointIds, elementIds}；
 * 与快照的区别：它存的是「怎么作出来的」，每次重绘都按**当前**画布重算一遍，
 * 于是拖动手柄点时品红解法跟着变形。为空时才用上面的快照。
 */
let solverSolutionPlan = null;

/** 由两个点造直线方程 过程函数（不求规范化，够求交用） */
function solverPlanLine(first, second) {
    return {
        a: second.y - first.y,
        b: first.x - second.x,
        c: first.x * second.y - first.y * second.x,
        type: 1,
    };
}

/** 由圆心与圆周点造圆方程 过程函数（c 存半径平方） */
function solverPlanCircle(center, through) {
    return {
        a: center.x,
        b: center.y,
        c: (center.x - through.x) * (center.x - through.x) + (center.y - through.y) * (center.y - through.y),
        type: 0,
    };
}

/** 方程 → 直线上两点 过程函数（覆盖层画无限直线用） */
function solverLineFromEquation(element) {
    if (Math.abs(element.b) > 1e-12) {
        return {x1: 0, y1: element.c / element.b, x2: 1, y2: (element.c - element.a) / element.b};
    }
    return {x1: element.c / element.a, y1: 0, x2: element.c / element.a, y2: 1};
}

/** 两个元素的所有交点 过程函数（最多两个；两圆先求根轴） */
function solverPlanIntersections(first, second) {
    const out = [];
    if (!first || !second) return out;
    const push = p => {
        if (isFinite(p.x) && isFinite(p.y)) out.push(p);
    };
    const lineCircle = (line, circle) => {
        const denom = line.a * line.a + line.b * line.b;
        if (Math.abs(denom) < 1e-12) return;
        const dist = line.a * circle.a + line.b * circle.b - line.c;
        const delta = denom * circle.c - dist * dist;
        if (delta < -1e-9) return;
        if (delta <= 1e-9) {
            push({x: circle.a - line.a * dist / denom, y: circle.b - line.b * dist / denom});
            return;
        }
        const root = Math.sqrt(delta);
        push({x: circle.a - (line.a * dist + line.b * root) / denom,
              y: circle.b - (line.b * dist - line.a * root) / denom});
        push({x: circle.a - (line.a * dist - line.b * root) / denom,
              y: circle.b - (line.b * dist + line.a * root) / denom});
    };
    if (first.type === 0 && second.type === 0) {
        const a = 2 * (first.a - second.a);
        const b = 2 * (first.b - second.b);
        if (Math.abs(a) < 1e-12 && Math.abs(b) < 1e-12) return out;
        const c = first.a * first.a - second.a * second.a + first.b * first.b - second.b * second.b
            - first.c + second.c;
        lineCircle({a: a, b: b, c: c, type: 1}, first);
        return out;
    }
    if (first.type === 0) lineCircle(second, first);
    else if (second.type === 0) lineCircle(first, second);
    else {
        const det = first.a * second.b - first.b * second.a;
        if (Math.abs(det) < 1e-12) return out;
        push({x: (first.c * second.b - first.b * second.c) / det,
              y: (first.a * second.c - first.c * second.a) / det});
    }
    return out;
}

/** 画布对象当前的方程 过程函数（点返回 null） */
function solverPlanEquationOf(item) {
    const coordinate = item && item.getCoordinate ? item.getCoordinate() : null;
    if (!coordinate) return null;
    if (item.getType() === 'line') {
        return solverPlanLine({x: coordinate[0][0], y: coordinate[0][1]},
                              {x: coordinate[1][0], y: coordinate[1][1]});
    }
    if (item.getType() === 'circle') {
        return solverPlanCircle({x: coordinate[0][0], y: coordinate[0][1]},
                                {x: coordinate[1][0], y: coordinate[1][1]});
    }
    return null;
}

/**
 * 按计划算出「当前画布上的解法」 过程函数
 * 给定点 / 给定元素读画布对象的实时位置，新元素与新交点按计划重算；
 * 计划里没记到的（或对象已被删）就沿用记录值 —— 于是解法永远贴着图形
 * @param {Object} job {solution, result, dag, step, pointIds, elementIds}
 * @returns {{points: Array, lines: Array, circles: Array}}
 */
function evaluateSolverSolutionPlan(job) {
    const {solution, result, dag, step, pointIds, elementIds} = job;
    const shown = Math.max(0, Math.min(solution.newElementCount, step));
    const initialPointCount = result.initialPointCount;
    const initialElementCount = result.initialElementCount;
    const pointCount = solution.points.length;
    const elementCount = solution.elements.length;

    const points = new Array(pointCount);
    const pointValid = new Array(pointCount).fill(true);
    for (let i = 0; i < pointCount; i++) points[i] = {x: solution.points[i].x, y: solution.points[i].y};
    const elements = new Array(elementCount);
    const elementValid = new Array(elementCount).fill(true);
    for (let i = 0; i < elementCount; i++) {
        const element = solution.elements[i];
        elements[i] = {a: element.a, b: element.b, c: element.c, type: element.type};
    }

    // 给定点跟着画布对象走（拖动手柄点时位置会变）；对象被删就标无效
    for (let i = 0; i < initialPointCount && i < pointIds.length; i++) {
        const item = geometryManager.get(pointIds[i]);
        if (!item || item.getType() !== 'point') {
            pointValid[i] = false;
            continue;
        }
        points[i] = {x: item.x, y: item.y};
    }
    // 给定元素用对象当前的方程（于是给定直线会跟着它的端点转）
    for (let i = 0; i < initialElementCount && i < elementIds.length; i++) {
        const equation = solverPlanEquationOf(geometryManager.get(elementIds[i]));
        if (!equation) {
            elementValid[i] = false;
            continue;
        }
        elements[i] = equation;
    }

    const overlay = {points: [], lines: [], circles: []};
    for (let s = 1; s <= shown; s++) {
        const elementIndex = initialElementCount + s - 1;
        if (elementIndex >= elementCount) break;
        const definition = dag && dag.definitions ? dag.definitions[elementIndex] : null;
        // 反推不出定义（或定义点已失效）就无法跟着图形重算 —— 标为无效，宁可不画，
        // 也不能拿旧坐标硬画：那样图形一变形，它就会停在原地「悬空卡住」
        if (!definition) {
            elementValid[elementIndex] = false;
        } else if (pointValid[definition[0]] && pointValid[definition[1]] &&
                   points[definition[0]] && points[definition[1]]) {
            elements[elementIndex] = solution.elements[elementIndex].type === 0
                ? solverPlanCircle(points[definition[0]], points[definition[1]])
                : solverPlanLine(points[definition[0]], points[definition[1]]);
        } else {
            elementValid[elementIndex] = false;
        }

        // 这一步新出现的交点：来源无效、或两个元素已经不相交时，这个点同样无效
        for (let pi = initialPointCount; pi < pointCount; pi++) {
            if (solution.pointBirth[pi] !== s) continue;
            const origin = dag && dag.origins ? dag.origins[pi] : null;
            if (!origin || !elementValid[origin[0]] || !elementValid[origin[1]] ||
                !elements[origin[0]] || !elements[origin[1]]) {
                pointValid[pi] = false;
                continue;
            }
            const candidates = solverPlanIntersections(elements[origin[0]], elements[origin[1]]);
            if (!candidates.length) {
                pointValid[pi] = false;
                continue;
            }
            // 两个分支时取离记录位置最近的那个
            const recorded = solution.points[pi];
            let best = candidates[0];
            let bestDistance = Infinity;
            candidates.forEach(candidate => {
                const distance = (candidate.x - recorded.x) * (candidate.x - recorded.x)
                    + (candidate.y - recorded.y) * (candidate.y - recorded.y);
                if (distance < bestDistance) {
                    bestDistance = distance;
                    best = candidate;
                }
            });
            points[pi] = best;
        }

        if (!elementValid[elementIndex]) continue;
        const element = elements[elementIndex];
        if (element.type === 0) {
            overlay.circles.push({x: element.a, y: element.b, r: Math.sqrt(Math.max(0, element.c))});
        } else if (definition) {
            overlay.lines.push({x1: points[definition[0]].x, y1: points[definition[0]].y,
                                x2: points[definition[1]].x, y2: points[definition[1]].y});
        } else {
            overlay.lines.push(solverLineFromEquation(element));
        }
        for (let pi = initialPointCount; pi < pointCount; pi++) {
            if (solution.pointBirth[pi] === s && pointValid[pi]) overlay.points.push(points[pi]);
        }
    }
    return overlay;
}

/**
 * 绘制求解器给出的解法 过程函数
 * 有可动计划就按计划现算（拖动图形时跟着变形），否则画面板给的快照；
 * 圆 → 弧，直线 → 裁到可视范围，点 → 实心圆
 */
function drawSolverSolutionOverlay() {
    const overlay = solverSolutionPlan ? evaluateSolverSolutionPlan(solverSolutionPlan) : solverSolutionOverlay;
    if (!overlay) return;
    ct.save();
    ct.strokeStyle = SOLVER_SOLUTION_COLOR;
    ct.fillStyle = SOLVER_SOLUTION_COLOR;
    ct.lineWidth = 3 / transform.scale;
    ct.lineCap = 'round';
    overlay.circles.forEach(circle => {
        ct.beginPath();
        ct.arc(circle.x, circle.y, circle.r, 0, Math.PI * 2);
        ct.stroke();
    });
    overlay.lines.forEach(line => {
        const bounds = ToolsFunction.getLineBounds(
            [line.x1, line.y1, line.x2, line.y2, canvasWidth, canvasHeight], transform);
        ct.beginPath();
        ct.moveTo(bounds.p1.x, bounds.p1.y);
        ct.lineTo(bounds.p2.x, bounds.p2.y);
        ct.stroke();
    });
    overlay.points.forEach(point => {
        ct.beginPath();
        ct.arc(point.x, point.y, 4 / transform.scale, 0, Math.PI * 2);
        ct.fill();
    });
    ct.restore();
}

function drawContent() {
    // 重置变换，按物理像素清屏
    ct.setTransform(1, 0, 0, 1, 0, 0);
    ct.clearRect(0, 0, canvas.width, canvas.height);

    // 保存当前状态
    ct.save();

    // 绘制背景颜色
    drawColor();

    // 物理像素 → CSS 像素：之后都是逻辑坐标绘制
    const ratio = canvasPixelRatio();
    ct.scale(ratio, ratio);

    // 应用变换
    ct.translate(transform.x, transform.y);
    ct.scale(transform.scale, transform.scale);

    // 绘制图形
    drawShapes();

    // 绘制求解器解法（品红覆盖层，画在图形之上）
    drawSolverSolutionOverlay();

    // 绘制绘制中的半透明预览
    drawToolPreview();

    // 绘制光标
    drawPointer();

    // 恢复状态
    ct.restore();
}

/**
 * 绘制背景颜色 过程函数
 */
function drawColor() {
    ct.fillStyle = "rgb(255, 255, 255)";
    ct.fillRect(0, 0, canvas.width, canvas.height);
}

/**
 * 预览形状对应表 常量
 * 键是工具名，值是预览时要画的图形；一次点击就能完成的工具不需要预览
 */
const previewShapes = {
    line: 'line',
    ray: 'ray',
    lineSegment: 'lineSegment',
    circle: 'circle',
    threePointCircle: 'circle3',
    perpendicularBisector: 'perpendicularBisector',
    middlePoint: 'middlePoint',
    // 切换项里的工具：键名用 subTool
    threePointCompass: 'compassCircle',
    threePointAngleBisector: 'bisector',
    // 没有小项切换的页面（关卡游玩的角平分线 / 圆规）里 subTool 就是工具名本身，也要能找到形状
    compass: 'compassCircle',
    angleBisector: 'bisector',
    // 圆心工具只用光标下那个点预览（落在圆的圆心上，见 board-tools.js 的 drawPreview），不在这里画
    // 复制圆规：先点一个圆，圆心跟着光标走（半径 = 那个圆的半径），图形还是圆
    compassCopy: 'circle',
    // 两直线角平分线：点了第一条线、光标靠近第二条线时才预览
    twoLineAngleBisector: 'twoLineBisector',
    // 点 + 线混合的工具：先点了线之后，光标处的点补上，预览过它的平行线 / 垂线
    parallelLine: 'parallelLine',
    perpendicularLine: 'perpendicularLine',
};

/**
 * 绘制预览配置 过程函数
 * 至少要点两次的工具才做预览；切换项里的工具按 subTool 找形状
 * @returns {{keys: string[], need: number, shape: string}|null}
 */
function toolPreviewConfig() {
    if (typeof tool !== 'string' || typeof subTool !== 'string') return null;
    const shape = previewShapes[subTool] || previewShapes[tool];
    if (!shape) return null;
    if (typeof toolItems === 'undefined') return null;
    const choiceDict = toolItems[tool]?.choice;
    if (!choiceDict) return null;
    // 与 loadChoice 一致：有 general 就用 general，否则用当前切换项
    const subChoiceDict = Object.keys(choiceDict).includes('general') ? choiceDict.general : choiceDict[subTool];
    if (!subChoiceDict) return null;
    const types = Object.values(subChoiceDict);
    if (types.length < 2) return null;
    return {keys: Object.keys(subChoiceDict), need: types.length, shape: shape};
}

/**
 * 预览用的光标位置 过程函数
 * 靠近已有点时吸到点上；否则吸到最近的线 / 圆上（点工具落在对象上也是这个行为）；都没有就用原始位置
 * @returns {number[]}
 */
function previewCursor() {
    const cursor = [
        (pointerPosition.x - transform.x) / transform.scale,
        (pointerPosition.y - transform.y) / transform.scale,
    ];
    // 与光标下那个预览点用同一套吸附逻辑（board-tools.js 的预览吸附）：
    // 之前这里少算了「相交的位置」这一档，于是点预览吸在正确的交点上、
    // 半透明图形预览却从邻近的另一个交点旁边擦过去（两个交点靠得近时特别明显）
    if (typeof window.previewSnapLogical === 'function') {
        const snap = window.previewSnapLogical(cursor[0], cursor[1]);
        return [snap.x, snap.y];
    }
    const [nearId] = geometryManager.near(cursor, ['point']);
    if (nearId) return geometryManager.get(nearId).getCoordinate();
    const [elementId] = geometryManager.near(cursor, ['line', 'circle']);
    const element = elementId ? geometryManager.get(elementId) : null;
    const coord = element?.getCoordinate?.();
    if (!coord) return cursor;
    const p1 = {x: coord[0][0], y: coord[0][1]};
    const p2 = {x: coord[1][0], y: coord[1][1]};
    const p3 = {x: cursor[0], y: cursor[1]};
    if (element.getType() === 'line') {
        // 不夹紧的投影：nearPointOnLine 会把比例夹到 [0,1]，落在渲染段外的点会被拽回端点
        const point = ToolsFunction.onlineCoordinateOf(p1, p2, p3);
        return [point.x, point.y];
    }
    const value = ToolsFunction.nearPointOnCircle(p1, p3);
    const point = ToolsFunction.radianToCoordinate(p1, p2, value);
    return [point.x, point.y];
}

/**
 * 预览状态 过程函数
 * 已经点过「需要的点数 - 1」个点时（还差最后一次点击），用鼠标位置补齐最后一点
 * @returns {{shape: string, coords: number[][]}|null}
 */
function toolPreviewState() {
    if (typeof isDragging === 'undefined' || isDragging) return null;
    // 刚点完一下、指针还没真的移动：先不画预览
    if (previewWaiting()) return null;
    // 没吸附过的原始光标位置：用来判断「光标靠近了哪个圆 / 哪条线」
    const rawCursor = [
        (pointerPosition.x - transform.x) / transform.scale,
        (pointerPosition.y - transform.y) / transform.scale,
    ];
    const config = toolPreviewConfig();
    if (!config) return null;
    const selected = config.keys.map(key => geometryManager.getToolKey(tool, key)).filter(item => item);
    if (selected.length !== config.need - 1) return null;
    const cursor = previewCursor();
    // 刚点完第一个点时，光标还压在那个点上：两点重合，方向不定（会被画成一条默认竖直的线），
    // 所以这时的预览先不画，等光标真的移开再给
    const sameAsSelected = selected.some(item => {
        const coord = item.getCoordinate?.();
        return Array.isArray(coord) && typeof coord[0] === 'number'
            && Math.abs(coord[0] - cursor[0]) < 1e-6 && Math.abs(coord[1] - cursor[1]) < 1e-6;
    });
    if (sameAsSelected) return null;
    // 复制圆规：先点了一个圆之后，光标处就是圆心，半径跟着那个圆（还没点圆时没有预览）
    if (subTool === 'compassCopy') {
        const circle = selected.find(item => item.getType() === 'circle');
        const coord = circle?.getCoordinate?.();
        if (!coord) return null;
        const radius = Math.hypot(coord[1][0] - coord[0][0], coord[1][1] - coord[0][1]);
        return {shape: 'circle', coords: [cursor, [cursor[0] + radius, cursor[1]]]};
    }
    // 两直线角平分线：点了第一条线之后，光标靠近第二条线时才预览（作出的就是两条，预览也画两条）
    if (subTool === 'twoLineAngleBisector') {
        const first = selected.find(item => item.getType() === 'line');
        if (!first) return null;
        const [secondId] = geometryManager.near(rawCursor, ['line'], 1, [first.getId()]);
        const second = secondId ? geometryManager.get(secondId) : null;
        const bisectors = second ? previewTwoLineBisectors(first, second) : null;
        return bisectors ? {shape: 'twoLineBisector', coords: bisectors} : null;
    }
    // 平行线 / 垂线：先点了线，光标处补一个点
    if (tool === 'parallelLine' || tool === 'perpendicularLine') {
        const line = selected.find(item => item.getType() === 'line');
        if (!line) return null;
        const lineCoord = line.getCoordinate();
        if (!lineCoord) return null;
        return {shape: config.shape, coords: [cursor, lineCoord[0], lineCoord[1]]};
    }
    // 三点圆规：前两点定半径，光标处是圆心（没有小项切换时 subTool 就是 'compass'）
    if (tool === 'compass' && subTool !== 'compassCopy') {
        return {shape: config.shape, coords: [cursor, selected[0].getCoordinate(), selected[1].getCoordinate()]};
    }
    return {shape: config.shape, coords: selected.map(item => item.getCoordinate()).concat([cursor])};
}

/**
 * 两条直线的两条角平分线（预览用）
 * @param {Object} line1 直线一
 * @param {Object} line2 直线二
 * @returns {number[][]|null} [交点, 第一条角平分线方向上的远点, 第二条角平分线方向上的远点]；平行时返回 null
 */
function previewTwoLineBisectors(line1, line2) {
    const coord1 = line1.getCoordinate?.();
    const coord2 = line2.getCoordinate?.();
    const cross = ToolsFunction.lineIntersectionByGeometryObject(line1, line2);
    if (!coord1 || !coord2 || !cross || !cross.flag) return null;
    const unit = (p, q) => {
        const norm = Math.hypot(q[0] - p[0], q[1] - p[1]);
        return norm ? [(q[0] - p[0]) / norm, (q[1] - p[1]) / norm] : null;
    };
    const dir1 = unit(coord1[0], coord1[1]);
    const dir2 = unit(coord2[0], coord2[1]);
    if (!dir1 || !dir2) return null;
    const apex = [cross.value.x, cross.value.y];
    const far = 10000;
    // 两个方向的角平分：单位方向相加与相减各得一条（相减那条在两线平行时退化，会被过滤掉）
    const points = [[dir1[0] + dir2[0], dir1[1] + dir2[1]], [dir1[0] - dir2[0], dir1[1] - dir2[1]]]
        .map(dir => {
            const norm = Math.hypot(dir[0], dir[1]);
            return norm > 1e-9 ? [apex[0] + dir[0] / norm * far, apex[1] + dir[1] / norm * far] : null;
        })
        .filter(item => item);
    if (!points.length) return null;
    return [apex].concat(points);
}

/**
 * 是否需要重绘预览 过程函数
 * 鼠标移动时用它判断要不要重绘
 * @returns {boolean}
 */
function hasToolPreview() {
    return !!toolPreviewState();
}

// 上一帧有没有画预览
let toolPreviewShown = false;

/**
 * 鼠标移动时要不要重绘 过程函数
 * 不能只看「这一帧有没有预览」：上一帧有、这一帧没有（圆心预览离开了圆、
 * 两直线角平分线离开了第二条线）时也得重绘一次，否则那份半透明预览会一直留在画布上
 * @returns {boolean}
 */
function needRedrawForPreview() {
    const shown = hasToolPreview();
    const changed = shown !== toolPreviewShown;
    toolPreviewShown = shown;
    return shown || changed;
}

/**
 * 外围圆心 工具函数
 * @param {number[]} a 点 A
 * @param {number[]} b 点 B
 * @param {number[]} c 点 C
 * @returns {number[]|null} 三点共线时返回 null
 */
function previewCircumcenter(a, b, c) {
    const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
    if (!d) return null;
    const a2 = a[0] * a[0] + a[1] * a[1];
    const b2 = b[0] * b[0] + b[1] * b[1];
    const c2 = c[0] * c[0] + c[1] * c[1];
    return [
        (a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d,
        (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d,
    ];
}

/**
 * 绘制点的预览 过程函数
 * 与真实点一致：外径 POINT_RADIUS_BASE、白芯是它的一半，且是屏幕上的固定大小（除以 scale，跟 drawPoint 一样）；
 * 透明度也用光标下那个点预览的 0.5 —— 否则在 0.35 的半透明里会显得又小又淡
 * @param {number[]} coord 逻辑坐标
 */
function drawPreviewPoint(coord) {
    const [x, y] = coord;
    ct.globalAlpha = 0.5;
    ct.beginPath();
    ct.arc(x, y, POINT_RADIUS_BASE / transform.scale, 0, Math.PI * 2);
    ct.fillStyle = 'rgb(25, 25, 25)';
    ct.fill();
    ct.beginPath();
    ct.arc(x, y, POINT_RADIUS_BASE / 2 / transform.scale, 0, Math.PI * 2);
    ct.fillStyle = 'rgb(255, 255, 255)';
    ct.fill();
}

/**
 * 绘制工具预览 过程函数
 * 半透明地画出「再点一次就会作出的图形」
 */
function drawToolPreview() {
    const state = toolPreviewState();
    if (!state) return;
    const [first, second, third] = state.coords;
    ct.save();
    ct.globalAlpha = 0.35;
    ct.strokeStyle = 'rgb(25, 25, 25)';
    ct.fillStyle = 'rgb(25, 25, 25)';
    ct.lineWidth = LINE_WIDTH_BASE / transform.scale;

    if (state.shape === 'lineSegment') {
        ct.beginPath();
        ct.moveTo(first[0], first[1]);
        ct.lineTo(second[0], second[1]);
        ct.stroke();
    }else if (state.shape === 'line' || state.shape === 'ray') {
        const bounds = ToolsFunction.getLineBounds([first[0], first[1], second[0], second[1], canvasWidth, canvasHeight], transform);
        ct.beginPath();
        if (state.shape === 'line') {
            ct.moveTo(bounds.p1.x, bounds.p1.y);
            ct.lineTo(bounds.p2.x, bounds.p2.y);
        }else{
            ct.moveTo(first[0], first[1]);
            if (first[0] < second[0]) ct.lineTo(bounds.p2.x, bounds.p2.y);
            else ct.lineTo(bounds.p1.x, bounds.p1.y);
        }
        ct.stroke();
    }else if (state.shape === 'circle') {
        const distance = Math.hypot(second[0] - first[0], second[1] - first[1]);
        ct.beginPath();
        ct.arc(first[0], first[1], distance, 0, 2 * Math.PI);
        ct.stroke();
    }else if (state.shape === 'circle3') {
        const center = previewCircumcenter(first, second, third);
        if (center) {
            ct.beginPath();
            ct.arc(center[0], center[1], Math.hypot(first[0] - center[0], first[1] - center[1]), 0, 2 * Math.PI);
            ct.stroke();
        }
    }else if (state.shape === 'perpendicularBisector') {
        // 垂直平分线：过两点的中点，方向与两点连线垂直
        const middle = [(first[0] + second[0]) / 2, (first[1] + second[1]) / 2];
        const dx = -(second[1] - first[1]);
        const dy = second[0] - first[0];
        const norm = Math.hypot(dx, dy);
        if (norm) {
            const far = 10000;
            const bounds = ToolsFunction.getLineBounds([middle[0], middle[1], middle[0] + dx / norm * far, middle[1] + dy / norm * far, canvasWidth, canvasHeight], transform);
            ct.beginPath();
            ct.moveTo(bounds.p1.x, bounds.p1.y);
            ct.lineTo(bounds.p2.x, bounds.p2.y);
            ct.stroke();
        }
    }else if (state.shape === 'middlePoint') {
        drawPreviewPoint([(first[0] + second[0]) / 2, (first[1] + second[1]) / 2]);
    }else if (state.shape === 'parallelLine' || state.shape === 'perpendicularLine') {
        // coords: [光标补的点, 线的两个定义点]
        const base = state.coords[0];
        const lineP1 = state.coords[1];
        const lineP2 = state.coords[2];
        let dx = lineP2[0] - lineP1[0];
        let dy = lineP2[1] - lineP1[1];
        if (state.shape === 'perpendicularLine') {
            const swap = dx;
            dx = -dy;
            dy = swap;
        }
        const norm = Math.hypot(dx, dy);
        if (norm) {
            const far = 10000;
            const bounds = ToolsFunction.getLineBounds([base[0], base[1], base[0] + dx / norm * far, base[1] + dy / norm * far, canvasWidth, canvasHeight], transform);
            ct.beginPath();
            ct.moveTo(bounds.p1.x, bounds.p1.y);
            ct.lineTo(bounds.p2.x, bounds.p2.y);
            ct.stroke();
        }
    }else if (state.shape === 'compassCircle') {
        // coords: [圆心（光标）, 半径端点 1, 半径端点 2]
        const center = state.coords[0];
        const radius = Math.hypot(state.coords[2][0] - state.coords[1][0], state.coords[2][1] - state.coords[1][1]);
        ct.beginPath();
        ct.arc(center[0], center[1], radius, 0, 2 * Math.PI);
        ct.stroke();
    }else if (state.shape === 'bisector') {
        // coords: [边上的点, 顶点, 光标（另一条边上的点）]
        const vertex = state.coords[1];
        const flagValue = ToolsFunction.angleBisector(
            {x: state.coords[0][0], y: state.coords[0][1]},
            {x: vertex[0], y: vertex[1]},
            {x: state.coords[2][0], y: state.coords[2][1]});
        if (flagValue.flag) {
            const through = flagValue.value;
            const dx = through.x - vertex[0];
            const dy = through.y - vertex[1];
            const norm = Math.hypot(dx, dy);
            if (norm) {
                const far = 10000;
                const bounds = ToolsFunction.getLineBounds([vertex[0], vertex[1], vertex[0] + dx / norm * far, vertex[1] + dy / norm * far, canvasWidth, canvasHeight], transform);
                ct.beginPath();
                ct.moveTo(bounds.p1.x, bounds.p1.y);
                ct.lineTo(bounds.p2.x, bounds.p2.y);
                ct.stroke();
            }
        }
    }else if (state.shape === 'twoLineBisector') {
        // coords: [交点, 第一条角平分线方向上的远点, 第二条角平分线方向上的远点]
        const apex = state.coords[0];
        for (let i = 1; i < state.coords.length; i++) {
            const bounds = ToolsFunction.getLineBounds([apex[0], apex[1], state.coords[i][0], state.coords[i][1], canvasWidth, canvasHeight], transform);
            ct.beginPath();
            ct.moveTo(bounds.p1.x, bounds.p1.y);
            ct.lineTo(bounds.p2.x, bounds.p2.y);
            ct.stroke();
        }
    }
    ct.restore();
}

// 工具光标（橡皮擦 / 切换线类型 / 样式刷 / 隐藏刷的方块或圆环）是否该画：
// 触摸端手指抬起后指针就没有「当前位置」了，光标不该继续停在原地；
// 抬起后紧接着来的合成鼠标事件（Chrome 在 tap 后会补发）要忽略掉
let pointerCursorVisible = true;
let pointerCursorHiddenAt = 0;
/**
 * 允许画工具光标 过程函数（指针真的动了 / 鼠标按下时调用）
 * @param {boolean} [force] 触摸自己的动作要给 true：只有触摸抬手后紧跟着来的
 *        合成鼠标事件才需要被忽略（否掉它们，手机上的光标才会跟着手指抬起一起消失）
 */
function showPointerCursor(force) {
    if (!force && Date.now() - pointerCursorHiddenAt < 500) return;
    pointerCursorVisible = true;
}
/**
 * 收起工具光标 过程函数（手指抬起 / 触摸取消时调用）
 */
function hidePointerCursor() {
    pointerCursorVisible = false;
    pointerCursorHiddenAt = Date.now();
}

/**
 * 绘制光标 过程函数
 */
function drawPointer() {
    // 手指抬起后先不画（见 hidePointerCursor）
    if (!pointerCursorVisible) return;
    // 隐藏刷的光标与橡皮擦一致（方块）：都是「点一下就把它去掉」
    const hiddenBrush = tool === 'styleBrush' && typeof subTool !== 'undefined' && subTool === 'brushHidden';
    if (tool === "eraser" || hiddenBrush) {
        const width = 16 / transform.scale;
        const x = (pointerPosition.x - transform.x) / transform.scale - width / 2;
        const y = (pointerPosition.y - transform.y) / transform.scale - width / 2;

        ct.fillStyle = 'rgb(255, 255, 255)';
        ct.fillRect(x, y, width, width);

        ct.strokeStyle = 'rgb(25, 25, 25)';
        ct.lineWidth = 3 / transform.scale;
        ct.strokeRect(x, y, width, width);
    }else if (tool === 'lineType' || (tool === 'styleBrush' && !hiddenBrush)) {
        // 切换线类型 / 样式刷：光标画成一个圆环，提示「点这里就换类型 / 刷样式」
        const x = (pointerPosition.x - transform.x) / transform.scale;
        const y = (pointerPosition.y - transform.y) / transform.scale;

        ct.fillStyle = 'rgb(25, 25, 25)';
        ct.beginPath();
        ct.arc(x, y, 15 / transform.scale, 0, Math.PI * 2);
        ct.fill();

        ct.fillStyle = 'rgb(255, 255, 255)';
        ct.beginPath();
        ct.arc(x, y, 10 / transform.scale, 0, Math.PI * 2);
        ct.fill();
    }
}

/**
 * 文本描边
 * @param {Object} ctx
 * @param {string} text
 * @param {number} x
 * @param {number} y
 * @param {string} fillColor
 * @param {string} strokeColor
 * @param {number} lineWidth
 */
function drawStrokedText(ctx, text, x, y, fillColor, strokeColor, lineWidth) {
    // 保存初始状态
    ctx.save();
    
    // 设置描边样式
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = lineWidth;
    
    // 多次绘制描边以增强效果（模拟粗描边）
    for (let i = 0; i < 4; i++) {
        const angle = (i * Math.PI) / 2;
        ctx.strokeText(text, x + Math.cos(angle) * 0.5, y + Math.sin(angle) * 0.5);
    }
    
    // 绘制填充文本
    ctx.fillStyle = fillColor;
    ctx.fillText(text, x, y);
    
    // 恢复状态
    ctx.restore();
}

/**
 * 绘制几何图形 过程函数
 */
/**
 * 线类对象的显示层序 过程函数
 * 线段显示在射线上层、射线显示在直线上层，与作图先后无关；
 * 只在这些「线」之间换位置，圆与其它对象的位置保持不变
 * @param {Array} elements 对象列表
 * @returns {Array} 调整过层序的列表
 */
function sortLineLayers(elements) {
    const rankOf = element => {
        if (!element || element.getType() !== 'line') return null;
        const drawType = element.getDrawType();
        if (drawType === 'line') return 0;
        if (drawType === 'ray') return 1;
        if (drawType === 'lineSegment') return 2;
        return null;
    };
    // 线类对象占用的槽位：把排好序的线类对象写回这些槽位，
    // 中间的圆等对象位置不动，于是「线段在上」只影响线之间
    const slots = [];
    elements.forEach((element, index) => { if (rankOf(element) !== null) slots.push(index); });
    const sorted = elements.slice();
    const lineElements = slots.map(index => sorted[index]).sort((a, b) => rankOf(a) - rankOf(b));
    slots.forEach((index, order) => { sorted[index] = lineElements[order]; });
    return sorted;
}

function drawShapes() {
    const geometryElements = geometryManager.getAllByType(tool);
    const exceptPoints = geometryElements['exceptPoints'];
    const exceptPointsCache = geometryElements['exceptPointsCache'];
    const resultexceptPoints = geometryElements['resultexceptPoints'];
    const points = geometryElements['points'];
    const pointsCache = geometryElements['pointsCache'];
    const resultPoints = geometryElements['resultPoints'];
    const choice = geometryElements['choice'];
    
    // 除了点的几何对象（线段在射线之上、射线在直线之上）
    for (const element of sortLineLayers(exceptPoints)) {
        if (!element.getValid()) continue;
        if (!element.getVisible()) continue;
        
        if (element.getType() === 'line') drawInfiniteLine(element);
        if (element.getType() === 'circle') drawCircle(element);
        drawLabel(element);
    }
    // 除了点的目标几何对象
    for (const element of sortLineLayers(resultexceptPoints)) {
        if (!element.getValid()) continue;
        if (!element.getVisible()) continue;
        
        if (element.getType() === 'line') drawInfiniteLine(element);
        if (element.getType() === 'circle') drawCircle(element);
        drawLabel(element);
    }
    // 除了点的缓存几何对象
    for (const element of exceptPointsCache) {
        if (!element.getValid()) continue;
        if (!element.getVisible()) continue;
        
        if (element.getType() === 'line') {
            drawInfiniteLine(element);
            drawChoiceInfiniteLine(element);
        }
        if (element.getType() === 'circle') {
            drawCircle(element);
            drawChoiceCircle(element);
        }
    }
    // 点
    for (const point of points) {
        if (!point.getValid()) continue;
        if (!point.getVisible()) continue;
        drawPoint(point);
        drawLabel(point);
    }
    // 目标点
    for (const point of resultPoints) {
        if (!point.getValid()) continue;
        if (!point.getVisible()) continue;
        drawPoint(point);
        drawLabel(point);
    }
    // 缓存点
    for (const point of pointsCache) {
        if (!point.getValid()) continue;
        if (!point.getVisible()) continue;
        drawPoint(point);
        drawChoicePoint(point);
    }
    // 选中对象
    for (const element of choice) {
        if (!element.getValid()) continue;
        if (!element.getVisible()) continue;

        if (element.getType() === "point") drawChoicePoint(element);
        if (element.getType() === 'line') drawChoiceInfiniteLine(element);
        if (element.getType() === 'circle') drawChoiceCircle(element);
    }
}

/**
 * 绘制标签 过程函数
 * @param {Object} element 点、直线或圆对象
 */
function drawLabel(element) {
    if (!element.getShowName()) return;
    const coordinate = element.getCoordinate();
    if (!coordinate) return;
    // 点为 [x, y]，直线与圆为 [[x1, y1], [x2, y2]]，取第一个定义点作为标签位置
    const isPoint = typeof coordinate[0] === 'number';
    const [x, y] = isPoint ? coordinate : coordinate[0];
    const color = element.getColor();
    const backgroundColor = autoBackgroundColor(color);
    // 标签按**屏幕坐标**画、字号固定 20px（先退回 CSS 像素坐标系）：
    // 浏览器画不出字形、只剩描边轮廓 —— 于是标签看着消失了、点的四周还留着一圈白边
    const ratio = canvasPixelRatio();
    ct.save();
    ct.setTransform(ratio, 0, 0, ratio, 0, 0);
    ct.font = `20px serif`;
    drawStrokedText(
        ct, 
        element.getName(), 
        transform.x + x * transform.scale + (isPoint ? -20 : 14), 
        transform.y + y * transform.scale + (isPoint ? -15 : 6), 
        color, 
        backgroundColor, 
        3
    );
    ct.restore();
}

/**
 * 绘制点 过程函数
 * @param {Object} element 点对象
 */
function drawPoint(element) {
    const [x, y] = element.getCoordinate();
    const color = element.getColor();
    const backgroundColor = autoBackgroundColor(color);
    // 点的大小：默认 1，可在样式面板中调整（外径基准见 POINT_RADIUS_BASE，白芯是它的一半）
    const width = element.getWidth() || 1;
    const outRadius = POINT_RADIUS_BASE * width,
        inRadius = outRadius / 2;

    ct.fillStyle = color;
    ct.beginPath();
    ct.arc(x, y, outRadius / transform.scale, 0, Math.PI * 2);
    ct.fill();

    ct.fillStyle = backgroundColor;
    ct.beginPath();
    ct.arc(x, y, inRadius / transform.scale, 0, Math.PI * 2);
    ct.fill();
}

/**
 * 绘制选中点 过程函数
 * @param {Object} point
 */
function drawChoicePoint(point) {
    // 正好压在点的边缘上，看着就像没有选中效果
    const bigRadius = POINT_RADIUS_BASE * Math.max(point.getWidth() || 1, 1) + 4;
    const [x, y] = point.getCoordinate();
    const color = point.getColor();

    ct.strokeStyle = color;
    ct.beginPath();
    ct.arc(x, y, bigRadius / transform.scale, 0, Math.PI * 2);
    ct.lineWidth = 2 / transform.scale;
    ct.stroke();
}

/**
 * 标记集合的键名 常量
 * 给定（给定 / 带标签给定）与所求（每一组解的所求判定 / 所求显示 + 探索显示）
 */
const MARKED_LINE_KEY = /^(initial|named|result\d*|resultShown\d*|explore)$/;

/**
 * 这条直线 / 射线是否属于「给定」或「所求」 过程函数
 * 属于的话整条都画实色：那是题面条件与目标，延长段不该淡掉
 * @param {string} id 对象 id
 * @returns {boolean}
 */
function isMarkedLineElement(id) {
    if (typeof geometryElementLists === 'undefined' || !geometryElementLists) return false;
    for (const [key, value] of Object.entries(geometryElementLists)) {
        if (!MARKED_LINE_KEY.test(key)) continue;
        if (value instanceof Set ? value.has(id) : Array.isArray(value) && value.includes(id)) return true;
    }
    return false;
}

/**
 * 绘制直线 过程函数
 * @param {Object} element 直线对象
 */
function drawInfiniteLine(element) {
    const coordList = element.getCoordinate();
    if (!coordList) return;
    const color = element.getColor();
    const width = element.getWidth() || 1;

    const [startX, startY] = coordList[0];
    const [endX, endY] = coordList[1];
    // 坐标不是有限值或长得离谱的线不画：无穷远点（EdgePoint）派生出来的图形可能落到很远处，
    // 交给裁剪算法会算出乱七八糟的结果（画布上糊一大片灰的）
    if (![startX, startY, endX, endY].every(Number.isFinite)) return;
    if (Math.hypot(endX - startX, endY - startY) > 1e7) return;
    const bag = [startX, startY, endX, endY, canvasWidth, canvasHeight];
    const {
        p1,
        p2
    } = ToolsFunction.getLineBounds(bag, transform);

    const drawType = element.getDrawType();
    const lineWidth = (LINE_WIDTH_BASE * width) / transform.scale;
    // 画一段（alpha < 1 时半透明）
    const stroke = (x1, y1, x2, y2, alpha) => {
        ct.globalAlpha = alpha;
        ct.beginPath();
        ct.moveTo(x1, y1);
        ct.lineTo(x2, y2);
        ct.strokeStyle = color;
        ct.lineWidth = lineWidth;
        ct.stroke();
        ct.globalAlpha = 1;
    };
    // 屏幕上这两个裁剪点各自落在「第一个定义点 → 第二个定义点」连线上的位置：
    // 0 = 第一个定义点，1 = 第二个定义点，小于 0 / 大于 1 就是延长出去的那部分
    const square = (endX - startX) ** 2 + (endY - startY) ** 2;
    const positionOf = point => (((point.x - startX) * (endX - startX)) + ((point.y - startY) * (endY - startY))) / square;

    // 延长段的透明度：只对「两点定的直线 / 射线」半透明。
    // 垂线、平行线、中垂线、角平分线、定值角、切线这些构造出来的线，以及被标成
    // 给定 / 所求（各解的判定 / 显示 + 探索）的线，都整条画实色
    const plainTwoPoints = element.getBase?.()?.type === 'twoPoints';
    const extensionAlpha = plainTwoPoints && !isMarkedLineElement(element.getId()) ? 0.5 : 1;
    if (drawType === 'line') {
        // 两个定义点之间是实体
        stroke(startX, startY, endX, endY, 1);
        // 两头延长出去的部分半透明（屏幕里看不到的那一头不用画）
        const near = positionOf(p1) <= positionOf(p2) ? p1 : p2;
        const far = near === p1 ? p2 : p1;
        if (positionOf(near) < 0) stroke(near.x, near.y, startX, startY, extensionAlpha);
        if (positionOf(far) > 1) stroke(endX, endY, far.x, far.y, extensionAlpha);
    }else if (drawType === 'ray') {
        // 起点到第二个定义点是实体
        stroke(startX, startY, endX, endY, 1);
        // 第二个定义点往外的那一边半透明
        const far = positionOf(p1) >= positionOf(p2) ? p1 : p2;
        stroke(endX, endY, far.x, far.y, extensionAlpha);
    }else if (drawType === 'lineSegment') {
        stroke(startX, startY, endX, endY, 1);
    }
}

/**
 * 绘制选中直线 过程函数
 * @param {Object} element 直线对象
 */
function drawChoiceInfiniteLine(element) {
    const coordList = element.getCoordinate();
    if (!coordList) return;
    const color = element.getColor();

    const [startX, startY] = coordList[0];
    const [endX, endY] = coordList[1];
    const bag = [startX, startY, endX, endY, canvasWidth, canvasHeight];
    const {
        p1,
        p2,
        p3,
        p4,
        p5,
        p6,
        p7,
        p8,
    } = ToolsFunction.getChoiceLineBounds(bag, transform);

    const drawType = element.getDrawType();
    if (drawType === 'line') {
        ct.beginPath();
        ct.moveTo(p1.x, p1.y);
        ct.lineTo(p2.x, p2.y);
        ct.strokeStyle = color;
        ct.lineWidth = 2 / transform.scale;
        ct.stroke();
        
        ct.beginPath();
        ct.moveTo(p3.x, p3.y);
        ct.lineTo(p4.x, p4.y);
        ct.strokeStyle = color;
        ct.lineWidth = 2 / transform.scale;
        ct.stroke();
    }else if (drawType === 'ray') {
        ct.beginPath();
        if (startX < endX) {
            ct.moveTo(p5.x, p5.y);
        }else{
            ct.moveTo(p6.x, p6.y);
        }
        if (startX < endX) {
            ct.lineTo(p2.x, p2.y);
        }else{
            ct.lineTo(p1.x, p1.y);
        }
        ct.strokeStyle = color;
        ct.lineWidth = 2 / transform.scale;
        ct.stroke();
        
        ct.beginPath();
        if (startX < endX) {
            ct.moveTo(p6.x, p6.y);
        }else{
            ct.moveTo(p5.x, p5.y);
        }
        if (startX < endX) {
            ct.lineTo(p4.x, p4.y);
        }else{
            ct.lineTo(p3.x, p3.y);
        }
        ct.strokeStyle = color;
        ct.lineWidth = 2 / transform.scale;
        ct.stroke();
    }else if (drawType === 'lineSegment') {
        ct.beginPath();
        ct.moveTo(p5.x, p5.y);
        ct.lineTo(p7.x, p7.y);
        ct.strokeStyle = color;
        ct.lineWidth = 2 / transform.scale;
        ct.stroke();
        
        ct.beginPath();
        ct.moveTo(p6.x, p6.y);
        ct.lineTo(p8.x, p8.y);
        ct.strokeStyle = color;
        ct.lineWidth = 2 / transform.scale;
        ct.stroke();
    }
}

/**
 * 绘制圆 过程函数
 * @param {Object} element 圆对象
 */
function drawCircle(element) {
    const coordList = element.getCoordinate();
    if (!coordList) return;
    const color = element.getColor();
    const width = element.getWidth() || 1;

    const [x1, y1] = coordList[0];
    const [x2, y2] = coordList[1];
    const dx = x1 - x2;
    const dy = y1 - y2;
    const distance = Math.hypot(dx, dy);

    ct.beginPath();
    ct.strokeStyle = color;
    ct.arc(x1, y1, distance, 0, 2 * Math.PI)
    ct.lineWidth = (LINE_WIDTH_BASE * width) / transform.scale;
    ct.stroke();
}

/**
 * 绘制选中圆 过程函数
 * @param {Object} element 圆对象
 */
function drawChoiceCircle(element) {
    const coordList = element.getCoordinate();
    if (!coordList) return;
    const color = element.getColor();

    const [x1, y1] = coordList[0];
    const [x2, y2] = coordList[1];
    const dx = x1 - x2;
    const dy = y1 - y2;
    const distance = Math.hypot(dx, dy);
    const offset = 6;

    ct.beginPath();
    ct.strokeStyle = color;
    ct.arc(x1, y1, distance + offset / transform.scale, 0, 2 * Math.PI)
    ct.lineWidth = 2 / transform.scale;
    ct.stroke();
    
    if (distance - offset / transform.scale < 0) return;
    ct.beginPath();
    ct.strokeStyle = color;
    ct.arc(x1, y1, distance - offset / transform.scale, 0, 2 * Math.PI)
    ct.lineWidth = 2 / transform.scale;
    ct.stroke();
}

/**
 * 清空画布 过程函数
 * 清空几何对象管理器的内容
 */
function clearCanvas() {
    geometryManager.deleteAll();
    drawContent();
    lineToolStatus = 0;
    circleToolStatus = 0;
    intersectionToolStatus = 0;
    refreshToolFloating();
}

/**
 * 自调节对比颜色
 * @param {string} color 颜色字符串，格式为#123456
 * @returns {string} 对比色
 */
function autoBackgroundColor(color) {
    let count = 0;
    const opColor = color.slice(1);
    for (let i = 0; i < 6; i++) {
        if (i % 2 !== 0) continue;
        const index = hex.indexOf(opColor[i]);
        if (index > 12) count++;
    }
    if (count === 3) {
        return '#000000';
    }else{
        return '#ffffff';
    }
}
