/**
 * bs-report.js —— 可读解法报告（移植自 bs_v8.cpp 的 readable_report 命名空间）
 *
 * 搜索结束之后才跑：把解重新解释一遍 —— 每个交点是哪两个元素的交点、每条直线/圆
 * 用的是哪两个已知点 —— 然后写成中文步骤。报告只读图，不改任何搜索状态；
 * 万一某一步反推不出来，也只是报告缺一句，不影响已经找到的解。
 */

/* global EPS, TYPE_CIRCLE, TYPE_LINE, TYPE_RAY, TYPE_SEGMENT, NO_BOUND */

const REPORT_NONE = -1;

/** 两个数是否位模式完全相同 过程函数（报告里判定「同一元素」用，比容差更严） */
const REPORT_BITS = new DataView(new ArrayBuffer(8));
function exactNumber(a, b) {
    REPORT_BITS.setFloat64(0, a);
    const first = REPORT_BITS.getBigUint64(0);
    REPORT_BITS.setFloat64(0, b);
    return first === REPORT_BITS.getBigUint64(0);
}

function exactPoint(a, b) {
    return exactNumber(a.x, b.x) && exactNumber(a.y, b.y);
}

function exactElement(a, b) {
    return a.type === b.type && a.bound === b.bound &&
        exactNumber(a.a, b.a) && exactNumber(a.b, b.b) && exactNumber(a.c, b.c);
}

const rZero = v => Math.abs(v) < EPS;
const rClean = v => (rZero(v) ? 0 : v);
const rSamePoint = (p, q) => rZero(p.x - q.x) && rZero(p.y - q.y);
/** 求交算出来的点是否就是目标点 过程函数 */
const rRootMatches = (p, goal) => rZero(p.x - goal.x) && rZero(p.y - goal.y);

function rSameElement(a, b) {
    return a.type === b.type && rZero(a.a - b.a) && rZero(a.b - b.b) && rZero(a.c - b.c);
}

/** 报告私有的直线规范化 过程函数（与图里那份同规则，但只碰副本） */
function rNormalize(element) {
    if (!rZero(element.b)) {
        element.a /= element.b;
        element.c /= element.b;
        element.b = 1;
    } else if (!rZero(element.a)) {
        element.c /= element.a;
        element.a = 1;
        element.b = 0;
    }
    element.a = rClean(element.a);
    element.b = rClean(element.b);
    element.c = rClean(element.c);
    return element;
}

/** 由两个点造元素（只用于比对） 过程函数 */
function rMake(p, q, type) {
    const element = {a: 0, b: 0, c: 0, type};
    if (type === TYPE_CIRCLE) {
        element.a = p.x;
        element.b = p.y;
        element.c = (p.x - q.x) * (p.x - q.x) + (p.y - q.y) * (p.y - q.y);
    } else {
        element.a = q.y - p.y;
        element.b = p.x - q.x;
        element.c = p.x * q.y - p.y * q.x;
        rNormalize(element);
    }
    element.a = rClean(element.a);
    element.b = rClean(element.b);
    element.c = rClean(element.c);
    return element;
}

/** 点是否落在这个元素的（含范围的）有效部分上 过程函数 */
function rInRange(graph, elementIndex, p) {
    if (!graph.pointAllowed(p)) return false;
    const element = graph.elements[elementIndex];
    if (element.type === TYPE_LINE) return true;
    if (element.type !== TYPE_RAY && element.type !== TYPE_SEGMENT) return false;
    if (element.bound === NO_BOUND || element.bound >= graph.bounds.length) return false;
    const bound = graph.bounds[element.bound];
    if (element.type === TYPE_RAY) {
        return (bound.p1.x - p.x) * (bound.p1.x - bound.p2.x) +
               (bound.p1.y - p.y) * (bound.p1.y - bound.p2.y) > -EPS;
    }
    return (bound.p1.x - p.x) * (bound.p2.x - p.x) +
           (bound.p1.y - p.y) * (bound.p2.y - p.y) < EPS;
}

/** 直线与圆的交点里是否有点等于目标 过程函数（lineIndex 为 NONE 表示两圆的根轴） */
function rLineCircleContains(graph, lineIndex, line, circle, goal) {
    const denom = line.a * line.a + line.b * line.b;
    if (rZero(denom)) return false;
    const dist = line.a * circle.a + line.b * circle.b - line.c;
    const delta = denom * circle.c - dist * dist;
    const matches = p => graph.pointAllowed(p) &&
        (lineIndex === REPORT_NONE || rInRange(graph, lineIndex, p)) && rRootMatches(p, goal);
    if (rZero(delta)) {
        return matches({x: circle.a - line.a * dist / denom, y: circle.b - line.b * dist / denom});
    }
    if (delta > EPS) {
        const root = Math.sqrt(delta);
        return matches({x: circle.a - (line.a * dist + line.b * root) / denom,
                        y: circle.b - (line.b * dist - line.a * root) / denom}) ||
               matches({x: circle.a - (line.a * dist - line.b * root) / denom,
                        y: circle.b - (line.b * dist + line.a * root) / denom});
    }
    return false;
}

/** 两个元素的交点里是否有点等于目标 过程函数 */
function rIntersectionContains(graph, first, second, goal) {
    const x = graph.elements[first];
    const y = graph.elements[second];
    const a = {a: x.a, b: x.b, c: x.c, type: x.type};
    const b = {a: y.a, b: y.b, c: y.c, type: y.type};
    if (a.type === TYPE_CIRCLE) {
        if (b.type === TYPE_CIRCLE) {
            const aa = 2 * (a.a - b.a);
            const bb = 2 * (a.b - b.b);
            if (rZero(aa) && rZero(bb)) return false;
            const cc = a.a * a.a - b.a * b.a + a.b * a.b - b.b * b.b - a.c + b.c;
            return rLineCircleContains(graph, REPORT_NONE, rNormalize({a: aa, b: bb, c: cc, type: TYPE_LINE}), a, goal);
        }
        return rLineCircleContains(graph, second, b, a, goal);
    }
    if (b.type === TYPE_CIRCLE) return rLineCircleContains(graph, first, a, b, goal);
    const det = a.a * b.b - a.b * b.a;
    if (rZero(det)) return false;
    const p = {x: (a.c * b.b - a.b * b.c) / det, y: (a.a * b.c - a.c * b.a) / det};
    return rInRange(graph, first, p) && rInRange(graph, second, p) && rRootMatches(p, goal);
}

/** 找一个「用已知点就能画出该元素」的点对 过程函数（找不到返回 {first: -1, second: -1}） */
function findDefinition(graph, known, element) {
    if (element.type === TYPE_CIRCLE) {
        for (let i = 0; i < known; i++) {
            if (!rSamePoint(graph.points[i], {x: element.a, y: element.b})) continue;
            for (let j = 0; j < known; j++) {
                if (i !== j && rSameElement(rMake(graph.points[i], graph.points[j], TYPE_CIRCLE), element)) {
                    return {first: i, second: j};
                }
            }
        }
    } else if (element.type === TYPE_LINE) {
        for (let i = 0; i < known; i++) {
            for (let j = i + 1; j < known; j++) {
                if (rSameElement(rMake(graph.points[i], graph.points[j], TYPE_LINE), element)) {
                    return {first: i, second: j};
                }
            }
        }
    }
    return {first: REPORT_NONE, second: REPORT_NONE};
}

/**
 * 反推出一条可读的解法轨迹 过程函数
 * @param {Graph} graph 搜索成功时的图
 * @param {number} givenPointCount 给定点的个数
 * @returns {{origins: Array, definitions: Array, pointGoals: number[], elementGoals: number[],
 *            pointNumbers: number[], elementNames: string[]}}
 */
function reconstruct(graph, givenPointCount) {
    if (givenPointCount > graph.points.length ||
        graph.initialElementCount > graph.elements.length ||
        graph.pointBirth.length !== graph.points.length) {
        throw new Error('给定数量不合法，无法生成步骤报告');
    }

    const trace = {
        origins: new Array(graph.points.length).fill(null),
        definitions: new Array(graph.elements.length).fill(null),
        pointGoals: [],
        elementGoals: [],
        pointNumbers: new Array(graph.points.length).fill(0),
        elementNames: [],
    };

    const counts = [0, 0, 0, 0];
    const prefixes = ['C', 'L', 'R', 'S'];
    graph.elements.forEach(element => {
        counts[element.type]++;
        trace.elementNames.push(prefixes[element.type] + counts[element.type]);
    });

    // 点的出生步数搜索时已经存好了，这里只要还原「它是哪两个元素的交点」
    for (let pi = 0; pi < graph.points.length; pi++) {
        if (pi && graph.pointBirth[pi] < graph.pointBirth[pi - 1]) throw new Error('点的出生顺序不合法');
        if (pi < givenPointCount) {
            if (graph.pointBirth[pi] !== 0) throw new Error('给定点的出生步数不合法');
            continue;
        }
        const birth = graph.pointBirth[pi];
        const begin = birth ? graph.initialElementCount + birth - 1 : 0;
        const end = birth ? begin + 1 : graph.initialElementCount;
        if (end > graph.elements.length) throw new Error('点的出生步数越界');
        let found = false;
        for (let ei = begin; ei < end && !found; ei++) {
            for (let old = 0; old < ei; old++) {
                if (rIntersectionContains(graph, ei, old, graph.points[pi])) {
                    trace.origins[pi] = {element: ei, other: old};
                    found = true;
                    break;
                }
            }
        }
        if (!found) {
            // 兜底：把当时已经存在的元素两两都试一遍
            const available = birth
                ? Math.min(graph.elements.length, graph.initialElementCount + birth)
                : graph.initialElementCount;
            for (let a = 0; a < available && !found; a++) {
                for (let b = 0; b < a; b++) {
                    if (rIntersectionContains(graph, a, b, graph.points[pi])) {
                        trace.origins[pi] = {element: a, other: b};
                        found = true;
                        break;
                    }
                }
            }
        }
    }

    let known = 0;
    for (let ei = graph.initialElementCount; ei < graph.elements.length; ei++) {
        const step = ei - graph.initialElementCount + 1;
        while (known < graph.points.length && graph.pointBirth[known] < step) known++;
        trace.definitions[ei] = findDefinition(graph, known, graph.elements[ei]);
    }

    // 报告中只给「真正用到的点」编号：给定的点、作每一步用到的点、以及目标点
    const needed = new Array(graph.points.length).fill(false);
    for (let i = 0; i < givenPointCount; i++) needed[i] = true;
    for (let ei = graph.initialElementCount; ei < trace.definitions.length; ei++) {
        const definition = trace.definitions[ei];
        if (definition && definition.first !== REPORT_NONE) needed[definition.first] = true;
        if (definition && definition.second !== REPORT_NONE) needed[definition.second] = true;
    }
    graph.goalPoints.forEach(goal => {
        let pi = 0;
        while (pi < graph.points.length && !rSamePoint(graph.points[pi], goal)) pi++;
        if (pi === graph.points.length) throw new Error('报告里找不到目标点');
        needed[pi] = true;
        trace.pointGoals.push(pi);
    });
    graph.goalElements.forEach(goal => {
        let ei = 0;
        while (ei < graph.elements.length && !(graph.elements[ei].type === goal.type &&
                rZero(graph.elements[ei].a - goal.a) && rZero(graph.elements[ei].b - goal.b) &&
                rZero(graph.elements[ei].c - goal.c))) ei++;
        if (ei === graph.elements.length) throw new Error('报告里找不到目标元素');
        trace.elementGoals.push(ei);
    });
    let number = 0;
    for (let pi = 0; pi < needed.length; pi++) {
        if (needed[pi]) trace.pointNumbers[pi] = ++number;
    }
    return trace;
}

/** 数字写成短而完整的形式 过程函数（等价于 C++ 的 defaultfloat + 17 位有效数字） */
function formatNumber(value) {
    return String(rClean(value));
}

function formatPoint(p) {
    return '(' + formatNumber(p.x) + ',' + formatNumber(p.y) + ')';
}

function formatLineEquation(element) {
    return '(' + formatNumber(element.a) + ')x+(' + formatNumber(element.b) + ')y=' + formatNumber(element.c);
}

function formatCircleEquation(element) {
    return '(x-(' + formatNumber(element.a) + '))^2+(y-(' + formatNumber(element.b) + '))^2=' + formatNumber(element.c);
}

/**
 * 把轨迹写成中文步骤 过程函数
 * @param {Graph} graph 搜索成功时的图
 * @param {number} givenPointCount 给定点个数
 * @param {Object} trace reconstruct() 的结果
 * @returns {string}
 */
function formatReport(graph, givenPointCount, trace) {
    const lines = [];
    const pointRef = pi => 'P' + trace.pointNumbers[pi] + '=' + formatPoint(graph.points[pi]);
    const equationOf = ei => {
        const element = graph.elements[ei];
        return element.type === TYPE_CIRCLE ? formatCircleEquation(element) : formatLineEquation(element);
    };
    // 一个交点是哪两个元素交出来的
    const emitIntersection = pi => {
        const origin = trace.origins[pi];
        if (!origin || origin.element < 0 || origin.other < 0) {
            lines.push('  得到' + pointRef(pi) + '。');
            return;
        }
        const first = Math.min(origin.element, origin.other);
        const second = Math.max(origin.element, origin.other);
        lines.push('  取' + trace.elementNames[first] + ',' + trace.elementNames[second] + '交点' + pointRef(pi) + '。');
    };

    lines.push('Solution found!');
    lines.push('作图步骤（' + (graph.elements.length - graph.initialElementCount) + 'E）：');
    lines.push('已知对象：');
    for (let pi = 0; pi < givenPointCount; pi++) lines.push('  ' + pointRef(pi) + '。');
    for (let ei = 0; ei < graph.initialElementCount; ei++) {
        const element = graph.elements[ei];
        let text = '  已知';
        if (element.type === TYPE_CIRCLE) {
            text += '圆' + trace.elementNames[ei] + '；方程：' + formatCircleEquation(element);
        } else if (element.type === TYPE_LINE) {
            text += '直线' + trace.elementNames[ei] + '；方程：' + formatLineEquation(element);
        } else {
            const bound = graph.bounds[element.bound];
            text += (element.type === TYPE_RAY ? '射线' : '线段') + trace.elementNames[ei] + '：';
            text += element.type === TYPE_RAY ? '起点' : '端点';
            text += formatPoint(bound.p1);
            text += element.type === TYPE_RAY ? '，经过' : '和';
            text += formatPoint(bound.p2);
            text += '；所在直线方程：' + formatLineEquation(element);
        }
        lines.push(text + '。');
    }

    let initialHeading = false;
    for (let pi = givenPointCount; pi < graph.points.length; pi++) {
        if (!trace.pointNumbers[pi]) continue;
        const origin = trace.origins[pi];
        if (!origin || origin.element < 0 || origin.element >= graph.initialElementCount) continue;
        if (!initialHeading) {
            lines.push('已知元素的交点：');
            initialHeading = true;
        }
        emitIntersection(pi);
    }
    lines.push('');

    for (let ei = graph.initialElementCount; ei < graph.elements.length; ei++) {
        const definition = trace.definitions[ei];
        const element = graph.elements[ei];
        let text = '第' + (ei - graph.initialElementCount + 1) + '步：';
        if (definition && definition.first !== REPORT_NONE && definition.second !== REPORT_NONE) {
            if (element.type === TYPE_CIRCLE) {
                text += '以' + pointRef(definition.first) + '为圆心，' + pointRef(definition.second) +
                    '为圆周点作圆' + trace.elementNames[ei];
            } else {
                text += '过' + pointRef(definition.first) + '，' + pointRef(definition.second) +
                    '作直线' + trace.elementNames[ei];
            }
        } else {
            text += (element.type === TYPE_CIRCLE ? '作圆' : '作直线') + trace.elementNames[ei];
        }
        text += '；方程：' + equationOf(ei) + '。';
        lines.push(text);

        // 这一步新出现的交点跟在它后面
        const currentStep = ei - graph.initialElementCount + 1;
        for (let pi = givenPointCount; pi < graph.points.length; pi++) {
            if (!trace.pointNumbers[pi]) continue;
            if (graph.pointBirth[pi] === currentStep) emitIntersection(pi);
        }
    }

    if (graph.gridMode) {
        lines.push('');
        lines.push('网格校验：全部 ' + graph.points.length + ' 个已知点均限制在 [0,' + graph.gridM +
            ']×[0,' + graph.gridN + '] 内（含边界）');
    }
    lines.push('');
    lines.push('目标对应：');
    let lineGoal = 0;
    let circleGoal = 0;
    graph.goalElements.forEach((goal, gi) => {
        const isCircle = goal.type === TYPE_CIRCLE;
        const ei = trace.elementGoals[gi];
        const label = isCircle ? '目标圆GC' + (++circleGoal) : '目标直线GL' + (++lineGoal);
        lines.push('  ' + label + '=' + trace.elementNames[ei] + '；方程：' + equationOf(ei) + '。');
    });
    trace.pointGoals.forEach((pi, gi) => {
        lines.push('  目标点GP' + (gi + 1) + '=' + pointRef(pi) + '。');
    });
    if (graph.elements.length === graph.initialElementCount) {
        lines.push('目标已由给定对象满足，无须新增作图元素。');
    }
    return lines.join('\n');
}

/** 反推失败时的兜底报告 过程函数：直接把点与元素列出来 */
function fallbackReport(graph) {
    const lines = [];
    graph.points.forEach((p, pi) => lines.push('  P' + (pi + 1) + '=' + formatPoint(p) + '。'));
    graph.elements.forEach((element, ei) => {
        const name = element.type === TYPE_CIRCLE ? '圆C' : element.type === TYPE_LINE ? '直线L'
            : element.type === TYPE_RAY ? '射线R' : '线段S';
        const equation = element.type === TYPE_CIRCLE
            ? '方程：' + formatCircleEquation(element)
            : '所在直线方程：' + formatLineEquation(element);
        lines.push('  ' + name + (ei + 1) + '；' + equation + '。');
    });
    return lines.join('\n');
}

/**
 * 生成一个解的「中文步骤报告」与「构造计划」 过程函数
 * 报告只是讲解，出问题也不该影响已经找到的解；
 * 计划用于页面拖动图形时重算解法（每个交点由哪两个元素交出、每个元素由哪两个已知点作出），
 * 反推不出来时给 null，页面就按记录的坐标静态画。
 * @returns {{report: string, plan: {origins: Array, definitions: Array}|null}}
 */
function buildSolutionReportAndPlan(graph, givenPointCount) {
    let trace = null;
    let failure = '';
    try {
        trace = reconstruct(graph, givenPointCount);
    } catch (error) {
        failure = error && error.message ? error.message : String(error);
    }

    const report = trace
        ? formatReport(graph, givenPointCount, trace)
        : '（步骤说明生成失败：' + (failure || '反推失败') + '，下面直接列出图中的点与元素）\n' + fallbackReport(graph);

    const plan = trace ? {
        // origins[i]：第 i 个点是哪两个元素的交点（下标对齐解里的点表）
        origins: trace.origins.map(origin => (origin && origin.element >= 0 && origin.other >= 0)
            ? [origin.element, origin.other] : null),
        // definitions[e]：第 e 个元素由哪两个已知点作出（圆：前一个是圆心）
        definitions: trace.definitions.map(definition =>
            (definition && definition.first !== REPORT_NONE && definition.second !== REPORT_NONE)
                ? [definition.first, definition.second] : null),
    } : null;

    return {report, plan};
}
