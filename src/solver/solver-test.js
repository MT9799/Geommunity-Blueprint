/**
 * 内核回归测试台（Node 下直接跑，不需要浏览器）
 *
 * 用法（在仓库根目录，或在别的目录下写绝对 / 相对路径都行）：
 *     node src/solver/solver-test.js
 *
 * 做的事：把本目录的几个内核文件按 `search-worker.js` 里 `importScripts` 的顺序拼成一个脚本，
 * 在 `vm` 里求值（这样 `let EPS` 等顶层绑定与真实 Worker 一样共享同一层词法作用域），
 * 然后直接给 worker 发 `{type:'search'}` 消息、收它 `postMessage` 的结果。
 *
 * 覆盖：v9 / v12 内核对齐（目标直线逐对复验、1E 必经点、去掉标量剪枝、鲁棒求交）、
 * 启发式（beam / 家族池 / 探针族 / 会合 / 收尾 / 地标）以及若干隔离用例；
 * 另含「旧内核（HEAD）vs 当前工作区」的 A/B，用来确认修复确实生效。
 * 最后会把所有结果 JSON 打到 stdout。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {execFileSync} = require('child_process');

// 本文件就在内核目录里，直接加载同目录的源码
const SOLVER_DIR = __dirname;
const FILES = ['bs-core.js', 'bs-sets.js', 'bs-solver.js', 'bs-heuristic.js', 'bs-report.js', 'search-worker.js'];

/** 取某个文件的「某个 git 版本」内容（缺省取工作区当前内容；该版本里没有这个文件就退回工作区） */
function sourceOf(file, gitRev) {
    if (!gitRev) return fs.readFileSync(path.join(SOLVER_DIR, file), 'utf8');
    try {
        // stderr 收进管道：新文件还没进 git 时 `git show` 会往终端喷一行 fatal，看着像测试挂了
        return execFileSync('git', ['show', `${gitRev}:src/solver/${file}`],
            {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
    } catch (error) {
        return fs.readFileSync(path.join(SOLVER_DIR, file), 'utf8');
    }
}

function createHarness(gitRev) {
    const messages = [];
    const sandbox = {
        console,
        performance: {now: () => Date.now()},
        Date, Math, JSON,
        setTimeout, clearTimeout,
        importScripts: () => {},
        self: {},
    };
    sandbox.globalThis = sandbox;
    const context = vm.createContext(sandbox);
    sandbox.self.postMessage = message => messages.push(message);
    // 与 Worker 里 importScripts 的语义一致：所有文件在同一层词法作用域里依次求值
    const source = FILES.map(file => sourceOf(file, gitRev)).join('\n;\n')
        + '\n;globalThis.__kernel = {Graph, Solver, HeuristicSolver, SolutionCollector, makeElementFromCoefficients,'
    + ' TYPE_LINE, TYPE_CIRCLE, TYPE_RAY, TYPE_SEGMENT, EPS};';
    vm.runInContext(source, context, {filename: 'solver-bundle.js'});
    return {context: context, messages: messages, kernel: sandbox.__kernel};
}

function search(harness, request) {
    const before = harness.messages.length;
    harness.context.self.onmessage({data: {type: 'search', id: 1, data: request}});
    const fresh = harness.messages.slice(before);
    const result = fresh.find(message => message.type === 'result');
    const solutions = fresh.filter(message => message.type === 'solution').map(message => message.solution);
    if (result && !result.success) console.error('worker error:', result.error);
    return {result: result, solutions: solutions};
}

// v9-1 的用例：P1=(0,0) 精确在目标线 y=0 上；P2=(10,5e-12) 只是 EPS 近似在线（诱饵）；
// P3=(20,0) 精确在线。limit=1 → 只有正确的点对作得出目标线。
const DECOY_LINE_CASE = {
    points: [0, 0, 10, 5e-12, 20, 0],
    goalType: 1,
    goals: [0, -1, 0],
    toolType: 2,
    limit: 1,
    solutions: 1,
    timeLimitSeconds: 5,
    symmetry: false,
    goalFirst: false,
};
const TRIANGLE_CASE = {
    points: [0, 0, 1, 0], goalType: 2, goals: [0.5, Math.sqrt(3) / 2],
    toolType: 0, limit: 2, solutions: 1, timeLimitSeconds: 20,
};
const BISECTOR_CASE = {
    points: [0, 0, 2, 0], goalType: 1, goals: [1, 0, 1],
    toolType: 2, limit: 3, solutions: 1, timeLimitSeconds: 20,
};

const out = {};

// ① A/B：诱饵点对那条用例 —— 旧内核应当找不到解，新内核找得到
const cases = {旧内核: 'HEAD', 新内核: null};
Object.keys(cases).forEach(label => {
    const harness = createHarness(cases[label]);
    const decoy = search(harness, DECOY_LINE_CASE);
    const triangle = search(harness, TRIANGLE_CASE);
    const bisector = search(harness, BISECTOR_CASE);
    out[`① ${label}`] = {
        诱饵线对_找到解: !!(decoy.result?.data?.found),
        诱饵线对_新元素数: decoy.solutions.length ? decoy.solutions[0].newElementCount : null,
        正三角形_找到解: !!(triangle.result?.data?.found),
        正三角形_新元素数: triangle.solutions.length ? triangle.solutions[0].newElementCount : null,
        中垂线_找到解: !!(bisector.result?.data?.found),
        中垂线_新元素数: bisector.solutions.length ? bisector.solutions[0].newElementCount : null,
    };
});

// ② v9-2：只剩 1E 时，支撑数被算成 2（同一条载线的射线 + 直线）的点也必须是必经点
{
    const harness = createHarness(null);
    const k = harness.kernel;
    const graph = new k.Graph();
    graph.addPoint({x: 0, y: 0}, 0);
    graph.addPoint({x: 10, y: 0}, 0);
    graph.addInitialBounded({x: 0, y: 0}, {x: 10, y: 0}, k.TYPE_RAY);
    graph.addInitial(k.makeElementFromCoefficients(0, -1, 0, k.TYPE_LINE));
    graph.goalPoints.push({x: 5, y: 0});
    const forced1 = [];
    graph.collectForcedTailPointIndices(1, forced1);
    const forced2 = [];
    graph.collectForcedTailPointIndices(2, forced2);
    out['② v9-2 只剩 1E 的必经点'] = {
        支撑数: graph.existingSupportCount({x: 5, y: 0}),
        remaining1_必经点个数: forced1.length,
        remaining2_必经点个数: forced2.length,
    };
}

// ③ 鲁棒求交：数一数各种配置产出几个交点（A/B：HEAD 旧内核 vs 现在）
function countIntersections(harness, first, second) {
    const k = harness.kernel;
    const graph = new k.Graph();
    const e1 = k.makeElementFromCoefficients(first[0], first[1], first[2], first[3]);
    const e2 = k.makeElementFromCoefficients(second[0], second[1], second[2], second[3]);
    const found = [];
    graph.visitUnclippedIntersections(e1, e2, p => { found.push(p); return false; });
    return found.map(p => `${p.x.toFixed(6)},${p.y.toFixed(6)}`);
}
{
    const BIG = 1e8;
    const cases = {
        '圆圆_正常相交两个点': [[0, 0, 1, 0], [1, 0, 1, 0]],
        '圆圆_精确外切一个点': [[0, 0, 1, 0], [2, 0, 1, 0]],
        '线圆_正常相交两个点': [[0, -1, 0, 1], [0, 0, 1, 0]],
        '线圆_精确相切一个点': [[0, 1, 1, 1], [0, 0, 1, 0]],
        // 圆心相距 1e8、精确外切（半径差 1）：判别式在浮点里算出很大的正值，
        // 旧内核判 delta > EPS 就当「两个交点」，那是舍入造出来的假点
        '圆圆_大偏移近切（假点场景）': [[0, 0, 1, 0], [BIG, 0, (BIG - 1) * (BIG - 1), 0]],
    };
    const result = {};
    ['旧内核', '新内核'].forEach(label => {
        const harness = createHarness(label === '旧内核' ? 'HEAD' : null);
        const bag = {};
        Object.keys(cases).forEach(name => { bag[name] = countIntersections(harness, cases[name][0], cases[name][1]); });
        result[label] = bag;
    });
    out['③ 求交点个数（旧 / 新）'] = result;

    // 不确定接触的另一条出路：**画布上已经有见证点时复用它**（不新造点）
    const harness = createHarness(null);
    const k = harness.kernel;
    const witness = new k.Graph();
    witness.addPoint({x: 1, y: 0}, 0);
    const c1 = k.makeElementFromCoefficients(0, 0, 1, k.TYPE_CIRCLE);
    const c2 = k.makeElementFromCoefficients(BIG, 0, (BIG - 1) * (BIG - 1), k.TYPE_CIRCLE);
    const reused = [];
    witness.visitUnclippedIntersections(c1, c2, p => { reused.push(`${p.x.toFixed(6)},${p.y.toFixed(6)}`); return false; });
    out['④ 不确定接触时复用已有见证点'] = reused;
}

// ⑤ 启发式模式（高级选项「启发式搜索（测试）」）：经典题照找，大 limit 下也能很快交解
{
    const cases = {
        '正三角形（limit 2）': Object.assign({}, TRIANGLE_CASE, {heuristic: true, timeLimitSeconds: 10}),
        '中垂线（limit 3）': Object.assign({}, BISECTOR_CASE, {heuristic: true, timeLimitSeconds: 10}),
        // 同一目标放到 limit 8：DFS 会把 3~8 步的组合全翻一遍，启发式只找一条就走
        '正三角形（limit 8，DFS 会很久）': Object.assign({}, TRIANGLE_CASE, {limit: 8, heuristic: true, timeLimitSeconds: 10}),
        // 两个目标点（对称的两个顶点）：3E —— 两圆 + 两圆交点
        '两个目标点（limit 3）': {
            points: [0, 0, 1, 0],
            goalType: 2,
            goals: [0.5, Math.sqrt(3) / 2, 0.5, -Math.sqrt(3) / 2],
            toolType: 0, limit: 3, solutions: 1, timeLimitSeconds: 10, heuristic: true,
        },
        // 带干扰点、step 上限给到 5：必须靠 beam 一层层往下走（尾助搜救不了）
        '带干扰点（limit 5）': {
            points: [0, 0, 1, 0, 3, 1, -2, 2, 4, -3],
            goalType: 2,
            goals: [0.5, Math.sqrt(3) / 2],
            toolType: 0, limit: 5, solutions: 1, timeLimitSeconds: 10, heuristic: true,
        },
    };
    const bag = {};
    Object.keys(cases).forEach(name => {
        const harness = createHarness(null);
        const started = Date.now();
        const {result, solutions} = search(harness, cases[name]);
        bag[name] = {
            找到解: !!(result && result.data && result.data.found),
            新元素数: solutions.length ? solutions[0].newElementCount : null,
            引擎: result && result.data ? result.data.engine : null,
            用时毫秒: Date.now() - started,
            重启数: result && result.data && result.data.heuristic ? result.data.heuristic.restarts : null,
            beam峰值: result && result.data && result.data.heuristic ? result.data.heuristic.peakBeam : null,
            尾助搜解数: result && result.data && result.data.heuristic ? result.data.heuristic.helperSolutions : null,
        };
    });
    out['⑤ 启发式模式'] = bag;
}

// ⑥ 启发式当加速器：找不到（这里用「limit 1 作不出两圆的交点」这种确实无解的情形）
// 就该**回退 DFS**，而且 DFS 跑完（没超时）说明真的搜穷了 —— 不能报「启发式已停止」
{
    const harness = createHarness(null);
    const {result} = search(harness, Object.assign({}, TRIANGLE_CASE, {
        limit: 1, heuristic: true, timeLimitSeconds: 10,
    }));
    out['⑥ 启发式找不到 → 回退 DFS（确实无解）'] = {
        找到解: !!(result && result.data && result.data.found),
        引擎: result && result.data ? result.data.engine : null,
        只用过启发式: result && result.data ? result.data.heuristicOnly : null,
        超时: result && result.data ? result.data.timedOut : null,
    };
}

// ⑦ 家族池 / 新颖度池：多跑几轮重启，把 4 种风格都过一遍（目标含直线才会进自适应风格）
{
    const harness = createHarness(null);
    const {result, solutions} = search(harness, Object.assign({}, BISECTOR_CASE, {
        heuristic: true,
        timeLimitSeconds: 10,
        heuristicOptions: {restarts: 4},
    }));
    out['⑦ 家族池 / 新颖度池（4 轮重启）'] = {
        找到解: !!(result && result.data && result.data.found),
        新元素数: solutions.length ? solutions[0].newElementCount : null,
        引擎: result && result.data ? result.data.engine : null,
        重启数: result && result.data && result.data.heuristic ? result.data.heuristic.restarts : null,
        家族合并数: result && result.data && result.data.heuristic ? result.data.heuristic.familyMerged : null,
        beam丢弃数: result && result.data && result.data.heuristic ? result.data.heuristic.beamDiscarded : null,
    };
}

// ⑧ 把 beam 撑爆：10 个已知点 + 点/线混合目标 + limit 4，逼出池子的丢弃与家族合并
{
    const harness = createHarness(null);
    const {result, solutions} = search(harness, {
        points: [0, 0, 1, 0, 3, 1, -2, 2, 4, -3, 2, 5, -1, -4, 5, 2, -3, 1, 0, 3],
        goalLines: [0, -1, 0],
        goalPoints: [0.5, Math.sqrt(3) / 2],
        // 目标是「一条直线 + 一个点」：必须尺规都能用（toolType 0 只有圆规，目标直线作不出来）
        toolType: 2, limit: 4, solutions: 1, timeLimitSeconds: 15, heuristic: true,
    });
    out['⑧ beam 撑爆（10 点 / 混合目标 / limit 4）'] = {
        找到解: !!(result && result.data && result.data.found),
        新元素数: solutions.length ? solutions[0].newElementCount : null,
        引擎: result && result.data ? result.data.engine : null,
        诊断: result && result.data && result.data.heuristic ? {
            重启数: result.data.heuristic.restarts,
            层数: result.data.heuristic.layers,
            展开: result.data.heuristic.expanded,
            生成候选: result.data.heuristic.generated,
            评估: result.data.heuristic.evaluated,
            家族合并数: result.data.heuristic.familyMerged,
            beam丢弃数: result.data.heuristic.beamDiscarded,
            beam峰值: result.data.heuristic.peakBeam,
            会合调用: result.data.heuristic.rendezvousCalls,
            会合提案: result.data.heuristic.rendezvousProposals,
            会合重放: result.data.heuristic.rendezvousReplays,
            会合解: result.data.heuristic.rendezvousSolutions,
        } : null,
    };
}

// ⑮ 会合：中垂线目标（两条独立直线的会合结构），limit 4
{
    const harness = createHarness(null);
    const {result, solutions} = search(harness, Object.assign({}, BISECTOR_CASE, {
        limit: 4, heuristic: true, timeLimitSeconds: 15,
    }));
    out['⑮ 会合（中垂线 limit 4）'] = {
        找到解: !!(result && result.data && result.data.found),
        新元素数: solutions.length ? solutions[0].newElementCount : null,
        引擎: result && result.data ? result.data.engine : null,
        诊断: result && result.data && result.data.heuristic ? {
            会合调用: result.data.heuristic.rendezvousCalls,
            会合提案: result.data.heuristic.rendezvousProposals,
            会合重放: result.data.heuristic.rendezvousReplays,
            会合解: result.data.heuristic.rendezvousSolutions,
            重启数: result.data.heuristic.restarts,
            探针作图数: result.data.heuristic.probeApplied,
        } : null,
    };
}

// ⑨ 切线探针：给定一个圆 + 圆外一点，目标 = 过该点的切线
//（目标直线正好与给定的圆相切、圆外点又落在目标直线上 —— 正是探针的触发条件）
{
    const harness = createHarness(null);
    const slope = 1 / (2 * Math.sqrt(2));
    const tangentCase = {
        // 圆心必须是**已知点**，探针才找得到它（只给圆、不给圆心的话探针直接跳过）
        points: [0, 0, 3, 0],
        circles: [0, 0, 1],
        goalType: 1,
        goals: [slope, -1, 3 * slope],
        // 泰勒斯路线要:两圆 → 中垂线 → 中点 → 直径圆 → 切线（约 5 步）
        toolType: 2, limit: 6, solutions: 1, timeLimitSeconds: 15, heuristic: true,
    };
    const {result, solutions} = search(harness, tangentCase);
    out['⑨ 切线探针：过圆外一点作切线'] = {
        找到解: !!(result && result.data && result.data.found),
        新元素数: solutions.length ? solutions[0].newElementCount : null,
        引擎: result && result.data ? result.data.engine : null,
        诊断: result && result.data && result.data.heuristic ? {
            探针调用: result.data.heuristic.prerequisiteCalls,
            探针作图数: result.data.heuristic.probeApplied,
            探针收尾数: result.data.heuristic.prerequisiteCompletions,
            尾助搜解: result.data.heuristic.helperSolutions,
            beam解: result.data.heuristic.beamSolutions,
        } : null,
    };
    // 对照组：同一题交给纯 DFS（不带开关），确认题面本身是可解的
    const dfsHarness = createHarness(null);
    const dfsOnly = search(dfsHarness, Object.assign({}, tangentCase, {heuristic: false}));
    out['⑨-对照 纯 DFS'] = {
        找到解: !!(dfsOnly.result && dfsOnly.result.data && dfsOnly.result.data.found),
        新元素数: dfsOnly.solutions.length ? dfsOnly.solutions[0].newElementCount : null,
        引擎: dfsOnly.result && dfsOnly.result.data ? dfsOnly.result.data.engine : null,
    };
}

// ⑩ 直接调用切线探针（隔离验证，不走 worker）：目标直线一被作出来就应停
{
    const harness = createHarness(null);
    const k = harness.kernel;
    const slope = 1 / (2 * Math.sqrt(2));
    const graph = new k.Graph();
    graph.addPoint({x: 0, y: 0}, 0);
    graph.addPoint({x: 3, y: 0}, 0);
    graph.addInitial(k.makeElementFromCoefficients(0, 0, 1, k.TYPE_CIRCLE));
    graph.initialElementCount = graph.elements.length;
    graph.goalElements.push(k.makeElementFromCoefficients(slope, -1, 3 * slope, k.TYPE_LINE));
    const collector = new k.SolutionCollector(1);
    const control = {stop: false, found: false, timedOut: false, deadline: Date.now() + 5000};
    const probeSolver = new k.HeuristicSolver(graph, 6, 2,
        {tailCandidates: 0, tailSeconds: 0}, collector, control);
    const outcomes = [];
    const found = probeSolver.tangentProbe(graph, 6, Date.now() + 3000, (g, left) => {
        outcomes.push({剩余步数: left, 作了几条: g.elements.length - graph.initialElementCount});
        return g.goalsMet();
    });
    out['⑩ 直接调用探针（隔离）'] = {
        探针返回: found,
        回调次数: outcomes.length,
        每次: outcomes.slice(0, 6),
        探针作图数: probeSolver.metrics.probeApplied,
    };
}

// ⑪ 直径探针（隔离）：给定 A=(0,0)、B=(2,0)，目标 = 以 AB 为直径的圆
{
    const harness = createHarness(null);
    const k = harness.kernel;
    const graph = new k.Graph();
    graph.addPoint({x: 0, y: 0}, 0);
    graph.addPoint({x: 2, y: 0}, 0);
    graph.initialElementCount = graph.elements.length;
    graph.goalElements.push(k.makeElementFromCoefficients(1, 0, 1, k.TYPE_CIRCLE));
    const collector = new k.SolutionCollector(1);
    const control = {stop: false, found: false, timedOut: false, deadline: Date.now() + 5000};
    // 直径构造要 5 步：圆AB → 圆BA → 中垂线 → 轴线AB（交出中点）→ 以中点为心过 A 的圆
    const probeSolver = new k.HeuristicSolver(graph, 5, 2,
        {tailCandidates: 0, tailSeconds: 0}, collector, control);
    const outcomes = [];
    const found = probeSolver.diameterProbe(graph, 5, Date.now() + 3000, (g, left) => {
        outcomes.push({剩余步数: left, 作了几条: g.elements.length - graph.initialElementCount});
        return g.goalsMet();
    });
    out['⑪ 直径探针（隔离）'] = {
        探针返回: found,
        回调次数: outcomes.length,
        每次: outcomes.slice(0, 4),
        探针作图数: probeSolver.metrics.probeApplied,
    };
}

// ⑪b 手工重放直径探针的那几刀，看卡在哪一步
{
    const harness = createHarness(null);
    const k = harness.kernel;
    const g = new k.Graph();
    g.addPoint({x: 0, y: 0}, 0);
    g.addPoint({x: 2, y: 0}, 0);
    const trace = [];
    const show = () => g.points.map(p => `${p.x.toFixed(3)},${p.y.toFixed(3)}`);
    trace.push({步: '初始', 点: show()});
    g.apply(g.makeCandidate({i: 0, j: 1, tool: 0}), 1);
    trace.push({步: '圆AB', 点: show(), 元素: g.elements.length});
    g.apply(g.makeCandidate({i: 1, j: 0, tool: 0}), 2);
    trace.push({步: '圆BA', 点: show(), 元素: g.elements.length});
    const cross = [];
    g.visitIntersections(g.makeCandidate({i: 0, j: 1, tool: 0}), g.makeCandidate({i: 1, j: 0, tool: 0}),
        p => { cross.push(`${p.x.toFixed(6)},${p.y.toFixed(6)}`); return false; });
    trace.push({步: '两圆交点', 交点: cross});
    const upper = g.points.findIndex(p => p.y > 0);
    const lower = g.points.findIndex(p => p.y < 0);
    trace.push({步: '交点下标', upper: upper, lower: lower,
        中点判定: g.points.some(p => Math.abs(p.x - 1) < 1e-11 && Math.abs(p.y) < 1e-11)});
    const bisector = g.makeCandidate({i: Math.min(upper, lower), j: Math.max(upper, lower), tool: 2});
    const appliedBisector = g.apply(bisector, 3);
    trace.push({步: '中垂线', 应用: appliedBisector, 系数: [bisector.a, bisector.b, bisector.c],
        点: show(), 元素: g.elements.length});
    // 再补轴线 AB
    const axis = g.makeCandidate({i: 0, j: 1, tool: 2});
    const appliedAxis = g.apply(axis, 4);
    trace.push({步: '轴线AB', 应用: appliedAxis, 系数: [axis.a, axis.b, axis.c],
        点: show(), 元素: g.elements.length,
        中点判定: g.points.some(p => Math.abs(p.x - 1) < 1e-11 && Math.abs(p.y) < 1e-11)});
    out['⑪b 直径探针手工重放'] = trace;
}

// ⑫ 镜像探针（隔离）：轴 y 轴上有两个点，求 P=(2,1) 关于轴的镜像 (-2,1)
{
    const harness = createHarness(null);
    const k = harness.kernel;
    const graph = new k.Graph();
    graph.addPoint({x: 0, y: -1}, 0);
    graph.addPoint({x: 0, y: 1}, 0);
    graph.addPoint({x: 2, y: 1}, 0);
    graph.addInitial(k.makeElementFromCoefficients(1, 0, 0, k.TYPE_LINE)); // x = 0
    graph.initialElementCount = graph.elements.length;
    graph.goalPoints.push({x: -2, y: 1});
    const collector = new k.SolutionCollector(1);
    const control = {stop: false, found: false, timedOut: false, deadline: Date.now() + 5000};
    const probeSolver = new k.HeuristicSolver(graph, 3, 0,
        {tailCandidates: 0, tailSeconds: 0}, collector, control);
    const outcomes = [];
    const found = probeSolver.mirrorProbe(graph, 3, Date.now() + 3000, (g, left) => {
        outcomes.push({剩余步数: left, 作了几条: g.elements.length - graph.initialElementCount});
        return g.goalsMet();
    });
    out['⑫ 镜像探针（隔离）'] = {
        探针返回: found,
        回调次数: outcomes.length,
        每次: outcomes.slice(0, 4),
        探针作图数: probeSolver.metrics.probeApplied,
    };
}

// ⑬ 走 worker：直径题（尺规），看三个探针里的哪一个出了力
{
    const harness = createHarness(null);
    const {result, solutions} = search(harness, {
        points: [0, 0, 2, 0],
        goalCircles: [1, 0, 1],
        toolType: 2, limit: 5, solutions: 1, timeLimitSeconds: 15, heuristic: true,
    });
    out['⑬ 直径题（走 worker）'] = {
        找到解: !!(result && result.data && result.data.found),
        新元素数: solutions.length ? solutions[0].newElementCount : null,
        引擎: result && result.data ? result.data.engine : null,
        诊断: result && result.data && result.data.heuristic ? {
            探针调用: result.data.heuristic.prerequisiteCalls,
            探针作图数: result.data.heuristic.probeApplied,
            探针收尾数: result.data.heuristic.prerequisiteCompletions,
            尾助搜解: result.data.heuristic.helperSolutions,
            beam解: result.data.heuristic.beamSolutions,
        } : null,
    };
}

// ⑭ 等半径探针（隔离）：根点 P1=(0,0)、P2=(1,0)、P3=(0,1) + 给定直线 x=0
// 半径链：圆(P1,P2) ∩ x=0 → 新生点 R=(0,-1) → 圆(R,P1) → 载线 P1P2 → 新生点 S=(0,-2)
//        → 圆(S,R) → 供货；把目标点就设成 S，链一造出它就该交解
{
    const harness = createHarness(null);
    const k = harness.kernel;
    const graph = new k.Graph();
    graph.addPoint({x: 0, y: 0}, 0);
    graph.addPoint({x: 1, y: 0}, 0);
    graph.addPoint({x: 0, y: 1}, 0);
    graph.addInitial(k.makeElementFromCoefficients(1, 0, 0, k.TYPE_LINE)); // x = 0
    graph.initialElementCount = graph.elements.length;
    graph.goalPoints.push({x: 0, y: -2});
    const collector = new k.SolutionCollector(1);
    const control = {stop: false, found: false, timedOut: false, deadline: Date.now() + 5000};
    const probeSolver = new k.HeuristicSolver(graph, 8, 2,
        {tailCandidates: 0, tailSeconds: 0}, collector, control);
    const outcomes = [];
    const found = probeSolver.equalRadiusProbe(graph, 8, Date.now() + 3000, (g, left) => {
        outcomes.push({剩余步数: left, 作了几条: g.elements.length - graph.initialElementCount,
            有点: g.hasPoint({x: 0, y: -2})});
        return g.goalsMet();
    });
    out['⑭ 等半径探针（隔离）'] = {
        探针返回: found,
        回调次数: outcomes.length,
        每次: outcomes.slice(0, 4),
        探针作图数: probeSolver.metrics.probeApplied,
        首圆数: probeSolver.metrics.radiusProbePrefixes > 0 ? '有前缀' : '无前缀',
    };
}

// ⑯ 会合：题面里要有「能交出可达点的元素」（给一个圆），否则会合没有提案可用
{
    const harness = createHarness(null);
    const {result, solutions} = search(harness, {
        points: [0, 0, 2, 0, 1, 2],
        circles: [0, 0, 1],
        goalType: 1,
        goals: [1, 0, 1],      // 目标直线 x = 1
        toolType: 2, limit: 5, solutions: 1, timeLimitSeconds: 15, heuristic: true,
        // 关掉结构探针链，把舞台留给会合（否则探针先交解、control.stop 一置，会合就没机会了）
        heuristicOptions: {structural: false},
    });
    const d = result && result.data && result.data.heuristic;
    out['⑯ 会合（带圆的题面，探针关）'] = {
        找到解: !!(result && result.data && result.data.found),
        新元素数: solutions.length ? solutions[0].newElementCount : null,
        引擎: result && result.data ? result.data.engine : null,
        会合调用: d ? d.rendezvousCalls : null,
        会合提案: d ? d.rendezvousProposals : null,
        会合重放: d ? d.rendezvousReplays : null,
        会合解: d ? d.rendezvousSolutions : null,
    };
}

// ⑯b 会合（专门构造出「锚点 / 可达点 / 会合点」三点共线的结构）：
//   目标直线 x=1；候选直线 EF（过 (0,-1)、(2,1)，即 y=x-1）与它会合于 T=(1,0)
//   另一个可达点 R=(2,0)：由候选直线 GH（过 (1,-1)、(3,1)，即 y=x-2）与给定圆 ((3,0), r=1) 交出
//   锚点 A=(0,0)：A→R 的方向与 A→T 同向（都是 y=0）→ 作出 A→R 后 T 就成了已知点，再作目标线即可
{
    const harness = createHarness(null);
    const {result, solutions} = search(harness, {
        points: [0, 0, 0, -1, 2, 1, 1, -1, 3, 1],
        circles: [3, 0, 1],
        goalType: 1,
        goals: [1, 0, 1],      // x = 1
        toolType: 2, limit: 4, solutions: 1, timeLimitSeconds: 15, heuristic: true,
        heuristicOptions: {structural: false},   // 把舞台留给会合
    });
    const d = result && result.data && result.data.heuristic;
    out['⑯b 会合（构造的可会合题面）'] = {
        找到解: !!(result && result.data && result.data.found),
        新元素数: solutions.length ? solutions[0].newElementCount : null,
        引擎: result && result.data ? result.data.engine : null,
        会合调用: d ? d.rendezvousCalls : null,
        会合提案: d ? d.rendezvousProposals : null,
        会合重放: d ? d.rendezvousReplays : null,
        会合解: d ? d.rendezvousSolutions : null,
        重启数: d ? d.restarts : null,
    };
}

// ⑯c 后向链式会合（chain_join）：点目标 + limit 4 —— 此时前置/等半径探针都不满足条件（不跑），
// beam 根节点的 remaining 正好是 4，会撞上 structuralCompletion 的 chain_join 那一档
{
    const harness = createHarness(null);
    const {result, solutions} = search(harness, Object.assign({}, TRIANGLE_CASE, {
        // 必须给尺规：structuralCompletion 与 C++ 一样有「toolType === 0 直接返回」的守卫
        toolType: 2, limit: 4, heuristic: true, timeLimitSeconds: 15,
    }));
    const d = result && result.data && result.data.heuristic;
    out['⑯c 后向链式会合（点目标 limit 4，尺规）'] = {
        找到解: !!(result && result.data && result.data.found),
        新元素数: solutions.length ? solutions[0].newElementCount : null,
        引擎: result && result.data ? result.data.engine : null,
        chain调用: d ? d.chainCalls : null,
        chain提案: d ? d.chainProposals : null,
        chain重放: d ? d.chainReplays : null,
        chain解: d ? d.chainSolutions : null,
        会合调用: d ? d.rendezvousCalls : null,
        重启数: d ? d.restarts : null,
        结构收尾被调用: d ? d.structuralCalls : null,
        结构收尾够条件: d ? d.structuralEligible : null,
        层数: d ? d.layers : null,
    };
}

// ⑱ 目标收尾（隔离）：目标直线一步就能作出 —— 纯目标 DFS 应当直接交解
{
    const harness = createHarness(null);
    const k = harness.kernel;
    const graph = new k.Graph();
    graph.addPoint({x: 0, y: 0}, 0);
    graph.addPoint({x: 1, y: 0}, 0);
    graph.initialElementCount = graph.elements.length;
    graph.goalElements.push(k.makeElementFromCoefficients(0, -1, 0, k.TYPE_LINE)); // y = 0
    const collector = new k.SolutionCollector(1);
    const control = {stop: false, found: false, timedOut: false, deadline: Date.now() + 5000};
    const solver = new k.HeuristicSolver(graph, 4, 2, {tailCandidates: 0, tailSeconds: 0}, collector, control);
    const done = solver.goalFinishSearch(graph, 2, Date.now() + 2000);
    out['⑱ 目标收尾（隔离）'] = {
        返回: done,
        交解数: collector.entries.length,
        目标收尾解: solver.metrics.goalFinishSolutions,
        探针作图数: solver.metrics.probeApplied,
    };
}

// ⑲ 点会合（隔离）：目标点 Q=(1,1) 是「过 (0,0)-(2,2) 的直线」与给定直线 y=0.5x+0.5 的交点
{
    const harness = createHarness(null);
    const k = harness.kernel;
    const graph = new k.Graph();
    graph.addPoint({x: 0, y: 0}, 0);
    graph.addPoint({x: 2, y: 2}, 0);
    graph.addInitial(k.makeElementFromCoefficients(0.5, -1, -0.5, k.TYPE_LINE)); // y = 0.5x + 0.5
    graph.initialElementCount = graph.elements.length;
    graph.goalPoints.push({x: 1, y: 1});
    const collector = new k.SolutionCollector(1);
    const control = {stop: false, found: false, timedOut: false, deadline: Date.now() + 5000};
    const solver = new k.HeuristicSolver(graph, 3, 2, {tailCandidates: 0, tailSeconds: 0}, collector, control);
    const done = solver.pointJoinSearch(graph, 3, Date.now() + 2000);
    out['⑲ 点会合（隔离）'] = {
        返回: done,
        交解数: collector.entries.length,
        提案数: solver.metrics.pointJoinProposals,
        重放数: solver.metrics.pointJoinReplays,
    };
}

// ⑳ 单圆圆心收尾（隔离）：目标圆 ((1,1), r=1)，圆心还不已知 —— 先用点会合拿到圆心再收尾
{
    const harness = createHarness(null);
    const k = harness.kernel;
    const graph = new k.Graph();
    graph.addPoint({x: 0, y: 0}, 0);
    graph.addPoint({x: 2, y: 2}, 0);
    graph.addPoint({x: 1, y: 2}, 0);
    graph.addInitial(k.makeElementFromCoefficients(0.5, -1, -0.5, k.TYPE_LINE));
    graph.initialElementCount = graph.elements.length;
    graph.goalElements.push(k.makeElementFromCoefficients(1, 1, 1, k.TYPE_CIRCLE)); // 圆心 (1,1)、r²=1
    const collector = new k.SolutionCollector(1);
    const control = {stop: false, found: false, timedOut: false, deadline: Date.now() + 5000};
    const solver = new k.HeuristicSolver(graph, 3, 2, {tailCandidates: 0, tailSeconds: 0}, collector, control);
    const done = solver.circleCenterFinish(graph, 3, Date.now() + 2000);
    out['⑳ 单圆圆心收尾（隔离）'] = {
        返回: done,
        交解数: collector.entries.length,
        圆心搜索次数: solver.metrics.circleFinishSearches,
        拿到圆心次数: solver.metrics.circleFinishCenters,
    };
}

// ㉑ 反向地标（隔离）：在「过圆外一点作切线」的题面上 Build，看地标规模与目标线的加分
{
    const harness = createHarness(null);
    const k = harness.kernel;
    const slope = 1 / (2 * Math.sqrt(2));
    const graph = new k.Graph();
    graph.addPoint({x: 0, y: 0}, 0);
    graph.addPoint({x: 3, y: 0}, 0);
    graph.addInitial(k.makeElementFromCoefficients(0, 0, 1, k.TYPE_CIRCLE));
    graph.initialElementCount = graph.elements.length;
    const goalLine = k.makeElementFromCoefficients(slope, -1, 3 * slope, k.TYPE_LINE);
    graph.goalElements.push(goalLine);
    const collector = new k.SolutionCollector(1);
    const control = {stop: false, found: false, timedOut: false, deadline: Date.now() + 5000};
    const solver = new k.HeuristicSolver(graph, 6, 2, {tailCandidates: 0, tailSeconds: 0}, collector, control);
    solver.landmarks.build(graph, 2);
    out['㉑ 反向地标（隔离）'] = {
        锚点数: solver.landmarks.anchors.length,
        载线数: solver.landmarks.guides.length,
        探针数: solver.landmarks.probes,
        目标线加分: Number(solver.landmarks.scoreCandidate(graph, goalLine, graph.points.length).toFixed(3)),
        整图分: Number(solver.landmarks.scoreState(graph, graph.goalPoints.length + graph.points.length).toFixed(3)),
    };
}

// ⑰ 开关默认关：请求里不带 heuristic 就走原来的 DFS，引擎名也不同
{
    const harness = createHarness(null);
    const {result, solutions} = search(harness, TRIANGLE_CASE);
    out['⑥ 默认（不带开关）走 DFS'] = {
        找到解: !!(result && result.data && result.data.found),
        新元素数: solutions.length ? solutions[0].newElementCount : null,
        引擎: result && result.data ? result.data.engine : null,
        启发式诊断字段: result && result.data ? result.data.heuristic : 'null',
    };
}

console.log(JSON.stringify(out, null, 1));
