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
 * 另有一条单向的中间消息（早于 result 发出，旧页面忽略即可）：
 *   {type: 'solution', id, taskIndex, solution, initialElementCount, initialPointCount}
 *   —— 内核一找到解就发一条，页面据此边搜边显示、并在收够解数时当场收工
 * 搜索期间还有只报进度的消息（单线程每 200ms 最多一条，旧页面忽略即可）：
 *   {type: 'progress', id, nodes, tasksDone, completedNodes, totalTasks}
 *   —— 已搜节点数 / 已搜完几个情况（+ 那两个数一共多少节点、这一层一共多少个情况），
 *      页面按「平均每个情况多大」外推总量，画「已搜情况数 / 预估总情况数」的进度条
 */

importScripts('bs-core.js', 'bs-sets.js', 'bs-solver.js', 'bs-report.js');

const WORKER_NOW = () => performance.now();

self.onmessage = function (event) {
    const {type, data, id} = event.data || {};
    if (type === 'search') {
        try {
            const result = runSearch(data || {}, id);
            self.postMessage({type: 'result', id, success: true, data: result});
        } catch (error) {
            self.postMessage({
                type: 'result',
                id,
                success: false,
                error: (error && error.message) ? error.message : String(error),
            });
        }
    } else if (type === 'frontier') {
        // 并行第一步：切前缀任务（对应 C++ 版 bs_v8 的 ProduceFrontierTasks）
        try {
            runFrontier(data || {}, id);
        } catch (error) {
            self.postMessage({type: 'error', id, error: (error && error.message) ? error.message : String(error)});
        }
    } else if (type === 'prefix') {
        // 并行第二步：搜一个独占前缀（对应 C++ 版 bs_v8 的 SearchPrefixTask）
        try {
            const payload = data || {};
            runPrefix(payload, id, payload.prefix, payload.taskIndex);
        } catch (error) {
            self.postMessage({type: 'error', id, error: (error && error.message) ? error.message : String(error)});
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
        // 请求里的 r 就是半径平方（页面侧用 dx²+dy² 算的，与搜索里的圆系数同一条算式）
        graph.addInitial(makeElementFromCoefficients(circle.a, circle.b, circle.r, TYPE_CIRCLE));
    });

    graph.initialElementCount = graph.elements.length;

    // 目标：既支持旧协议的单类型（goalType 0 圆 / 1 直线 / 2 点），也支持直线 / 圆 / 点混合
    const mixedGoals = request.goalLines || request.goalCircles || request.goalPoints;
    if (mixedGoals) {
        readLines(request.goalLines).forEach(goal => {
            graph.goalElements.push(makeElementFromCoefficients(goal.a, goal.b, goal.c, TYPE_LINE));
        });
        readCircles(request.goalCircles).forEach(goal => {
            // 同上：goal.r 是半径平方
            graph.goalElements.push(makeElementFromCoefficients(goal.a, goal.b, goal.r, TYPE_CIRCLE));
        });
        readPoints(request.goalPoints).forEach(goal => {
            graph.goalPoints.push({x: goal.x, y: goal.y});
        });
    } else if (request.goals && request.goals.length) {
        if (request.goalType === 0) {
            readCircles(request.goals).forEach(goal => graph.goalElements.push(
                makeElementFromCoefficients(goal.a, goal.b, goal.r, TYPE_CIRCLE)));
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

/**
 * 把图里的元素转成页面侧的元素表 过程函数（type 与原版一致：0 圆 / 1 直线 / 2 射线 / 3 线段）
 * 射线 / 线段还要带上 bound（范围索引）：页面据此把它们的交点限制在范围内，
 * 拖动图形重算解法时不会冒出「延长线上」的点（见 board-tools.js 的 buildSolverRequest）
 */
function dumpElements(elements) {
    return elements.map(e => ({type: e.type, a: e.a, b: e.b, c: e.c, bound: e.bound}));
}

/** 把图里的范围表转成页面侧的写法 过程函数（与请求里的 x1,y1,x2,y2 一致） */
function dumpBounds(bounds) {
    return (bounds || []).map(bound => ({
        x1: bound.p1.x, y1: bound.p1.y,
        x2: bound.p2.x, y2: bound.p2.y,
    }));
}

/** 请求 → 求解器设置 过程函数（各条路径共用；默认值＝内核默认） */
function makeSettings(request) {
    return {
        symmetry: request.symmetry !== false,
        goalFirst: request.goalFirst !== false,
        lowMemory: request.lowMemory !== false,
        streamDedupEntries: typeof request.streamDedup === 'number' ? request.streamDedup : 2048,
        ttBytes: (typeof request.ttMB === 'number' ? request.ttMB : 8) * 1024 * 1024,
        timeLimitSeconds: (typeof request.timeLimitSeconds === 'number' && request.timeLimitSeconds > 0)
            ? request.timeLimitSeconds : 30,
        requestedSolutions: Math.max(1, Math.trunc(request.solutions || 1)),
    };
}

/** 按请求装好图与求解器 过程函数（并行任务各自装一份，互不共享状态） */
function createSolver(request) {
    const settings = makeSettings(request);
    if (typeof request.eps === 'number' && request.eps > 0) EPS = request.eps;

    const limit = Math.max(0, Math.trunc(request.limit || 0));
    const {graph, toolType, givenPointCount} = buildGraph(request);
    if (!graph.goalPoints.length && !graph.goalElements.length) {
        throw new Error('没有给出任何目标（直线 / 圆 / 点）');
    }

    const collector = new SolutionCollector(settings.requestedSolutions);
    const solver = new Solver(
        toolType, settings.symmetry, settings.goalFirst, settings.lowMemory,
        settings.streamDedupEntries, settings.ttBytes, settings.timeLimitSeconds);
    solver.setSolutionCollector(collector);
    return {settings: settings, limit: limit, graph: graph, toolType: toolType,
        givenPointCount: givenPointCount, collector: collector, solver: solver};
}

/** 收集器里的一条解 → 页面侧的一条解 过程函数（流式上报与收尾共用） */
function entryToSolution(entry, givenPointCount) {
    // 中文步骤报告 + 构造计划（计划让页面在拖动图形时重算品红解法，见 bs-report.js）
    const built = buildSolutionReportAndPlan(entry.graph, givenPointCount);
    return {
        points: dumpPoints(entry.graph.points),
        elements: dumpElements(entry.graph.elements),
        // 射线 / 线段的端点表：elements 里的 bound 是它的下标
        bounds: dumpBounds(entry.graph.bounds),
        // 每个点是在第几步被作出来的（0 = 给定），页面据此按步逐步显示
        pointBirth: entry.graph.pointBirth.slice(),
        newElementCount: entry.graph.elements.length - entry.graph.initialElementCount,
        circles: entry.circles,
        report: built.report,
        plan: built.plan,
    };
}

/** 收集器里的解 → 页面侧的解表 过程函数（并行任务也用它） */
function collectSolutions(collector, givenPointCount) {
    return collector.entries.map(entry => entryToSolution(entry, givenPointCount));
}

/**
 * 让内核「一找到解就端上来」 过程函数
 * 收集器每收下一条新解就立刻 postMessage 回页面（对齐 C++ 版的边搜边交）：
 * 页面于是不必等整次搜索（并行时是一整个前缀任务）跑完才看到解，
 * 也能在收够解数的那一刻当场收工 —— 在飞的任务直接掐掉。
 * 每条消息都自带 initialElementCount / initialPointCount：页面在搜索途中就能按它显示。
 */
function attachSolutionStream(collector, id, graph, givenPointCount, taskIndex) {
    collector.onEntry = entry => {
        self.postMessage({
            type: 'solution',
            id: id,
            taskIndex: taskIndex,
            solution: entryToSolution(entry, givenPointCount),
            initialElementCount: graph.initialElementCount,
            initialPointCount: givenPointCount,
        });
    };
}

/**
 * 并行：把搜索树切成一串前缀任务流式发回页面 过程函数
 * 对应 C++ 版 bs_v8 的 ProduceFrontierTasks：走到 splitDepth 层，每到一个前缀就取走
 * 「initialElementCount 之后新作的那些元素」当成一个任务。这一趟不收集解。
 */
function runFrontier(request, id) {
    const limitOf = () => Math.max(1, Math.trunc(request.limit || 1));
    // 切分深度不能取到最后一层：`dfs` 在 remaining === 1 时会走「末段专用」分支
    // （searchForcedGoalTail / searchOneStepPointTail），那条路不再递归下去，
    // 于是 depth === limit 的节点根本不会出现 —— 按那一层切会一个任务都产不出来，
    // 页面就以为「已穷尽」，并行反而搜不到解
    const requested = Math.max(1, Math.min(Math.trunc(request.splitDepth || 3), Math.max(1, limitOf() - 1)));
    // 一次别切太多（页面侧还排着队）；超了就退到更浅一层重切
    const TASK_LIMIT = 4000;

    for (let depth = requested; depth >= 1; depth--) {
        const {limit, graph, givenPointCount, solver} = createSolver(request);
        solver.setSolutionCollector(null);
        // 与 C++ 版的 FrontierProbeMode 一致：这一趟只切任务，不提交解
        solver.frontierProbeMode = true;
        const stats = makeSearchStats();
        const initialElementCount = graph.initialElementCount;
        const tasks = [];
        solver.produceFrontierTasks(graph, limit, stats, current => {
            // 前缀里的元素要能跨线程传：只留几何字段（点由重放时重新求交得到）
            tasks.push(current.elements.slice(initialElementCount).map(element => ({
                a: element.a, b: element.b, c: element.c, type: element.type, bound: element.bound,
            })));
            return tasks.length < TASK_LIMIT;
        }, depth);
        // 两种情况下这一层不适用，退到更浅一层重切：
        //   · 撞上上限：这一层太细（网格题分支极大），只发半套前缀会漏掉整片搜索树；
        //   · 一个任务都没有：这一层太深（DFS 到不了，例如最后一两步走了「末段专用」分支），
        //     页面会把这当成「已穷尽」。—— 宁可任务粗一点，也必须让前缀覆盖整棵搜索树
        if ((tasks.length >= TASK_LIMIT || !tasks.length) && depth > 1) continue;
        for (let at = 0; at < tasks.length; at += 16) {
            self.postMessage({type: 'prefix-batch', id: id, tasks: tasks.slice(at, at + 16)});
        }
        self.postMessage({
            type: 'prefix-done',
            id: id,
            count: tasks.length,
            timedOut: solver.isTimedOut(),
            splitDepth: depth,
            initialElementCount: initialElementCount,
            initialPointCount: givenPointCount,
            stats: stats,
        });
        return;
    }
}

/**
 * 并行：搜一个前缀 过程函数
 * 对应 C++ 版 bs_v8 的 SearchPrefixTask：重放前缀（还原点的新生步数与上一步操作键）后再 DFS
 */
function runPrefix(request, id, prefix, taskIndex) {
    const {limit, graph, givenPointCount, collector, solver} = createSolver(request);
    // 这个前缀里搜到的解随到随发（页面按几何签名跨任务去重）
    attachSolutionStream(collector, id, graph, givenPointCount, taskIndex);
    const startedAt = WORKER_NOW();
    const stats = makeSearchStats();
    solver.searchPrefixTask(graph, limit, prefix || [], stats);
    self.postMessage({
        type: 'prefix-result',
        id: id,
        taskIndex: taskIndex,
        seconds: ((WORKER_NOW() - startedAt) / 1000).toFixed(3),
        // 这个前缀子树搜了多少个节点（页面按它累加，估总情况数用）
        nodes: stats.nodes,
        solutions: collectSolutions(collector, givenPointCount),
        timedOut: solver.isTimedOut(),
        initialElementCount: graph.initialElementCount,
        initialPointCount: givenPointCount,
    });
}

/** 进度条探测的上限：情况数、节点数（超了就退到浅一层重数，见 countFrontierTasks） */
const PROGRESS_TASK_LIMIT = 4096;
const PROGRESS_NODE_LIMIT = 400000;

/** 进度条的边界层深度 过程函数（越深情况越多、估得越细，探测也越贵） */
function progressDepthOf(request) {
    const limit = Math.max(1, Math.trunc(request.limit || 1));
    return Math.max(1, Math.min(3, limit - 1));
}

/**
 * 数一遍「搜索树在某一层有多少个情况」 过程函数
 * 这一趟只走不搜（与并行那条路的前缀探测是同一个函数，只是不落任务），
 * 页面拿它当进度条的分母；撞上上限就返回 0，调用方退到浅一层重数
 * @param {Object} request
 * @param {number} depth
 * @returns {number} 情况数（0 = 没数清）
 */
function countFrontierTasks(request, depth) {
    const {limit, graph, solver} = createSolver(request);
    solver.setSolutionCollector(null);
    solver.frontierProbeMode = true;
    const stats = makeSearchStats();
    let count = 0;
    let overflow = false;
    solver.produceFrontierTasks(graph, limit, stats, () => {
        count++;
        if (count >= PROGRESS_TASK_LIMIT || stats.nodes > PROGRESS_NODE_LIMIT) {
            overflow = true;
            return false;
        }
        return true;
    }, depth);
    return overflow ? 0 : count;
}

/** 跑一次搜索并组织返回值 过程函数 */
function runSearch(request, id) {
    const {limit, graph, givenPointCount, collector, solver} = createSolver(request);
    // 一找到解就往页面发一条，不必等这次搜索收尾
    attachSolutionStream(collector, id, graph, givenPointCount);
    // 进度条（页面侧见 board-tools.js 的 refreshSearchProgress）：
    //   ① 先数一遍「搜索树在边界层有多少个情况」当分母（这一趟只走不搜，几毫秒到几百毫秒）；
    //   ② 再让内核边搜边报「已搜多少个节点 / 已经搜完几个情况」，页面按平均规模外推总量
    const progressDepth = progressDepthOf(request);
    const totalTasks = countFrontierTasks(request, progressDepth) || countFrontierTasks(request, 1);
    if (totalTasks > 0) {
        solver.progressDepth = progressDepth;
        solver.progressTotalTasks = totalTasks;
        solver.onProgress = payload => self.postMessage(Object.assign({type: 'progress', id: id}, payload));
    }
    const stats = makeSearchStats();

    const startedAt = WORKER_NOW();
    solver.search(graph, limit, stats);
    const seconds = (WORKER_NOW() - startedAt) / 1000;

    const solutions = collectSolutions(collector, givenPointCount);
    const settings = makeSettings(request);

    // 旧协议：points / elements 是「给定 + 新作」的整表，页面自己跳过头几个
    const first = solutions.length ? solutions[0] : null;
    const result = {
        found: solutions.length > 0,
        time: seconds.toFixed(3),
        // 画板求解面板读的是 data.steps，这里补上（等于第一个解新作的元素个数）
        steps: first ? first.newElementCount : 0,
        points: first ? first.points : dumpPoints(graph.points),
        elements: first ? first.elements : dumpElements(graph.elements),
        bounds: first ? (first.bounds || []) : dumpBounds(graph.bounds),
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
