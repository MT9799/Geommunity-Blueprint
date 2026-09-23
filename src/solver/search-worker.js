/**
 * search-worker.js —— 作图搜索 Worker
 *
 * 引擎是 C++ 版 bs_v8（作者 Ander 与 zzzzzz）的 JS 移植，分三层：
 *   bs-core.js    数值与图结构（元素、交点、回滚、网格）
 *   bs-sets.js    去重表 / 置换表 / 解收集器
 *   bs-solver.js  搜索主体与各条剪枝
 *
 * 消息协议与旧版保持一致，页面侧无需改动：
 *   收  {type: 'search', data: {...}, id}
 *   发  {type: 'result', id, success, data: {found, time, points, elements}}
 * 另有两处向后兼容的扩展（旧页面看不懂就忽略，不影响）：
 *   · 请求可带 toolType: 3 + gridM/gridN 走「网格直尺」模式
 *   · 请求可带 solutions / timeLimitSeconds / symmetry / goalFirst / lowMemory / eps，
 *     响应里会多带 solutions（全部解）、stats、timedOut 等诊断字段
 */

importScripts('bs-core.js', 'bs-sets.js', 'bs-solver.js', 'bs-report.js');

const WORKER_NOW = () => performance.now();

self.onmessage = function (event) {
    const {type, data, id} = event.data || {};
    if (type === 'search') {
        try {
            const result = runSearch(data || {});
            self.postMessage({type: 'result', id, success: true, data: result});
        } catch (error) {
            self.postMessage({
                type: 'result',
                id,
                success: false,
                error: (error && error.message) ? error.message : String(error),
            });
        }
    } else if (type === 'stop') {
        self.postMessage({type: 'stopped', id});
    }
};

/*
 * 页面侧有两种传参写法，下面几个读取函数都认：
 *   · 对象数组 —— 独立求解页用的，如 points: [{x, y}]
 *   · 扁平数字数组 —— 画板求解面板用的，如 points: [x0, y0, x1, y1]
 * 目标同理：goalType 0/1 是每 3 个一组，goalType 2 是每 2 个一组。
 */
function isObjectList(raw) {
    return !!(raw && raw.length && typeof raw[0] === 'object');
}

function readPoints(raw) {
    const out = [];
    if (!raw || !raw.length) return out;
    if (isObjectList(raw)) raw.forEach(p => out.push({x: p.x, y: p.y}));
    else for (let i = 0; i + 1 < raw.length; i += 2) out.push({x: raw[i], y: raw[i + 1]});
    return out;
}

function readLines(raw) {
    const out = [];
    if (!raw || !raw.length) return out;
    if (isObjectList(raw)) raw.forEach(line => out.push({a: line.a, b: line.b, c: line.c}));
    else for (let i = 0; i + 2 < raw.length; i += 3) out.push({a: raw[i], b: raw[i + 1], c: raw[i + 2]});
    return out;
}

function readBounded(raw) {
    const out = [];
    if (!raw || !raw.length) return out;
    if (isObjectList(raw)) raw.forEach(item => out.push({x1: item.x1, y1: item.y1, x2: item.x2, y2: item.y2}));
    else for (let i = 0; i + 3 < raw.length; i += 4) out.push({x1: raw[i], y1: raw[i + 1], x2: raw[i + 2], y2: raw[i + 3]});
    return out;
}

function readCircles(raw) {
    const out = [];
    if (!raw || !raw.length) return out;
    if (isObjectList(raw)) raw.forEach(circle => out.push({a: circle.a, b: circle.b, r: circle.r}));
    else for (let i = 0; i + 2 < raw.length; i += 3) out.push({a: raw[i], b: raw[i + 1], r: raw[i + 2]});
    return out;
}

/**
 * 按请求装配一张图 过程函数
 * 顺序与原版一致：给定点 → 网格线 → 直线 → 射线 → 线段 → 圆 → 目标
 */
function buildGraph(request) {
    const graph = new Graph();

    let toolType = typeof request.toolType === 'number' ? request.toolType : 2;
    if (toolType === 3) {
        // 模式 3：网格直尺。允许的点域是闭矩形 [0,m] × [0,n]，网格线与格点都不计 E
        toolType = 1;
        graph.gridMode = true;
        graph.gridFast = request.gridFast !== false;
        graph.gridM = Math.max(0, Math.trunc(request.gridM || 0));
        graph.gridN = Math.max(0, Math.trunc(request.gridN || 0));
    }

    readPoints(request.points).forEach(p => graph.addPoint({x: p.x, y: p.y}, 0));
    const givenPointCount = graph.points.length;
    if (graph.gridMode) graph.addAutomaticGridLines();

    readLines(request.lines).forEach(line => {
        graph.addInitial(makeElementFromCoefficients(line.a, line.b, line.c, TYPE_LINE));
    });

    readBounded(request.rays).forEach(ray => {
        graph.addInitialBounded({x: ray.x1, y: ray.y1}, {x: ray.x2, y: ray.y2}, TYPE_RAY);
    });

    readBounded(request.segments).forEach(segment => {
        graph.addInitialBounded({x: segment.x1, y: segment.y1},
                                {x: segment.x2, y: segment.y2}, TYPE_SEGMENT);
    });

    readCircles(request.circles).forEach(circle => {
        // 请求里的 r 是半径，元件里存的是半径平方
        graph.addInitial(makeElementFromCoefficients(circle.a, circle.b, SQ(circle.r), TYPE_CIRCLE));
    });

    graph.initialElementCount = graph.elements.length;

    // 目标：既支持旧协议的单类型（goalType 0 圆 / 1 直线 / 2 点），也支持直线 / 圆 / 点混合
    const mixedGoals = request.goalLines || request.goalCircles || request.goalPoints;
    if (mixedGoals) {
        readLines(request.goalLines).forEach(goal => {
            graph.goalElements.push(makeElementFromCoefficients(goal.a, goal.b, goal.c, TYPE_LINE));
        });
        readCircles(request.goalCircles).forEach(goal => {
            graph.goalElements.push(makeElementFromCoefficients(goal.a, goal.b, SQ(goal.r), TYPE_CIRCLE));
        });
        readPoints(request.goalPoints).forEach(goal => {
            graph.goalPoints.push({x: goal.x, y: goal.y});
        });
    } else if (request.goals && request.goals.length) {
        if (request.goalType === 0) {
            readCircles(request.goals).forEach(goal => graph.goalElements.push(
                makeElementFromCoefficients(goal.a, goal.b, SQ(goal.r), TYPE_CIRCLE)));
        } else if (request.goalType === 1) {
            readLines(request.goals).forEach(goal => graph.goalElements.push(
                makeElementFromCoefficients(goal.a, goal.b, goal.c, TYPE_LINE)));
        } else {
            readPoints(request.goals).forEach(goal => graph.goalPoints.push({x: goal.x, y: goal.y}));
        }
    }

    return {graph, toolType, givenPointCount};
}

/** 把图里的点转成页面侧的点表 过程函数 */
function dumpPoints(points) {
    return points.map(p => ({x: p.x, y: p.y}));
}

/** 把图里的元素转成页面侧的元素表 过程函数（type 与原版一致：0 圆 / 1 直线 / 2 射线 / 3 线段） */
function dumpElements(elements) {
    return elements.map(e => ({type: e.type, a: e.a, b: e.b, c: e.c}));
}

/** 跑一次搜索并组织返回值 过程函数 */
function runSearch(request) {
    if (typeof request.eps === 'number' && request.eps > 0) EPS = request.eps;

    const settings = {
        symmetry: request.symmetry !== false,
        goalFirst: request.goalFirst !== false,
        lowMemory: request.lowMemory !== false,
        streamDedupEntries: typeof request.streamDedup === 'number' ? request.streamDedup : 2048,
        ttBytes: (typeof request.ttMB === 'number' ? request.ttMB : 8) * 1024 * 1024,
        timeLimitSeconds: (typeof request.timeLimitSeconds === 'number' && request.timeLimitSeconds > 0)
            ? request.timeLimitSeconds : 30,
        requestedSolutions: Math.max(1, Math.trunc(request.solutions || 1)),
    };

    const limit = Math.max(0, Math.trunc(request.limit || 0));
    const {graph, toolType, givenPointCount} = buildGraph(request);
    if (!graph.goalPoints.length && !graph.goalElements.length) {
        throw new Error('没有给出任何目标（直线 / 圆 / 点）');
    }

    const stats = makeSearchStats();
    const collector = new SolutionCollector(settings.requestedSolutions);
    const solver = new Solver(
        toolType, settings.symmetry, settings.goalFirst, settings.lowMemory,
        settings.streamDedupEntries, settings.ttBytes, settings.timeLimitSeconds);
    solver.setSolutionCollector(collector);

    const startedAt = WORKER_NOW();
    solver.search(graph, limit, stats);
    const seconds = (WORKER_NOW() - startedAt) / 1000;

    const solutions = collector.entries.map(entry => {
        // 中文步骤报告 + 构造计划（计划让页面在拖动图形时重算品红解法，见 bs-report.js）
        const built = buildSolutionReportAndPlan(entry.graph, givenPointCount);
        return {
            points: dumpPoints(entry.graph.points),
            elements: dumpElements(entry.graph.elements),
            // 每个点是在第几步被作出来的（0 = 给定），页面据此按步逐步显示
            pointBirth: entry.graph.pointBirth.slice(),
            newElementCount: entry.graph.elements.length - entry.graph.initialElementCount,
            circles: entry.circles,
            report: built.report,
            plan: built.plan,
        };
    });

    // 旧协议：points / elements 是「给定 + 新作」的整表，页面自己跳过头几个
    const first = solutions.length ? solutions[0] : null;
    const result = {
        found: solutions.length > 0,
        time: seconds.toFixed(3),
        // 画板求解面板读的是 data.steps，这里补上（等于第一个解新作的元素个数）
        steps: first ? first.newElementCount : 0,
        points: first ? first.points : dumpPoints(graph.points),
        elements: first ? first.elements : dumpElements(graph.elements),
        // 扩展字段：页面不用也不影响
        solutions,
        solutionCount: solutions.length,
        requestedSolutions: settings.requestedSolutions,
        quotaReached: solutions.length >= settings.requestedSolutions,
        timedOut: solver.isTimedOut(),
        initialElementCount: graph.initialElementCount,
        initialPointCount: givenPointCount,
        newElementCount: first ? first.newElementCount : 0,
        stats,
        engine: 'bs v8 (JS)',
    };
    return result;
}
