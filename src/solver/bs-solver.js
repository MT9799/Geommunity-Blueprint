/**
 * bs-solver.js —— 搜索主体（bs_v8.cpp 的 Solver 类移植，并按 v9 / v12 对齐）
 *
 * 搜索目标：在最多 limit 步（每步新作一条直线或圆）内，作出所有目标直线/圆/点。
 * 剪枝策略：
 *   · 相邻两步的偏序（对称剪枝，靠 OperationKey 比较）
 *   · 缺要素个数下界（每次作图最多新增一个元素）
 *   · 末段强制目标 / 末段单步点补全 / 反向生成候选（都是**快路径**，见下）
 *   · 预先检查（最后一步的目标能否被当前候选补齐前提）
 * 已经按 C++ v9 / v12 改掉的部分：
 *   · v9-1：目标直线候选枚举**每一对**在线点并逐对复验「作出的就是目标线」（原来只拿第一个
 *     通过 EPS 在线判断的点当前提，那个点可能只是近似在线，真实定义点对反而被漏掉）
 *   · v9-2：只剩 1E 时所有还没取得的目标点都算必经点（原来「同一条载线的射线 + 延长直线」
 *     被算成两个支撑，于是这种点被排除在必经集合外，反向单步尾部直接报无解 —— 见 bs-core.js）
 *   · v12：「支撑数 / 目标此刻能否画出」这类**标量判据不再当必要条件**（会误剪），
 *     反向尾搜降级为快路径、失败后回退真实已知点对流
 * 唯一未移植的是并行与置换表之外的 C++ 线程调度（JS 单线程），因此只保留 Search()；
 * 结构上保留 ProduceFrontierTasks/SearchPrefixTask 所需的字段，方便以后用嵌套 Worker 并行。
 */

/* global EPS, IS_ZERO, CLEAN_ZERO, SQ, SAME_ELEMENT, SAME_POINT, TYPE_LINE, TYPE_CIRCLE, NO_BOUND,
  Graph, BoundedElementSet, TranspositionTable, SolutionCollector, ExactGridLineCache,
  makeOperationKey, compareOperationKey, BoundedElementSet */

/**
 * 目标点对表示缓存 过程函数（C++ GoalPairCache）
 *
 * 只在同一个 DFS 父节点内有效：**有序点前缀**在子节点里只会追加或回滚，不会重排。
 * 缓存里存的是「哪些已知点对能作出目标元素」这些**表示**，不是结论 ——
 * 命中与否在**查询时**现判（含点出生步数、相邻操作偏序），所以缓存不会让结果变味。
 * 前缀点数缩回去（回滚）时调用方必须 reset（见 goalPairCacheFor）。
 */
class GoalPairCache {
    constructor() {
        this.prefix = 0;
        this.entries = [];
    }
    reset(prefix) {
        this.prefix = prefix;
        this.entries = [];
    }
    /**
     * 查/建目标的点对表示，并逐个交给 accept 过程函数
     * @returns {'accepted'|'exhausted'|'unavailable'|'cancelled'} 见 C++ 的 Result
     */
    visit(graph, goal, tool, stats, stop, accept) {
        const MAX_TARGETS = 8;
        const MAX_REPRESENTATIONS = 4096;
        if (stop()) return 'cancelled';
        if (goal.type !== TYPE_LINE && goal.type !== TYPE_CIRCLE) return 'unavailable';
        if (this.prefix > graph.points.length) return 'unavailable';
        const sameElements = (a, b) => a.type === b.type && a.bound === b.bound &&
            rawWordKey(a.a) === rawWordKey(b.a) && rawWordKey(a.b) === rawWordKey(b.b) &&
            rawWordKey(a.c) === rawWordKey(b.c);
        let entry = null;
        for (const old of this.entries) {
            if (old.tool === tool && old.eps === EPS && sameElements(old.goal, goal)) {
                entry = old;
                break;
            }
        }
        if (!entry) {
            if (this.entries.length >= MAX_TARGETS) return 'unavailable';
            entry = {goal: goal, tool: tool, eps: EPS, complete: false, overflow: false,
                hits: [], centers: [], matches: []};
            this.entries.push(entry);
        }
        if (entry.overflow) return 'unavailable';
        const line = goal.type === TYPE_LINE;
        if ((line && tool === 0) || (!line && tool === 1)) return 'exhausted';
        if (!entry.complete) {
            // 上一次构建被取消：部分正负结论都不许外泄，整份重建
            entry.hits = [];
            entry.centers = [];
            entry.matches = [];
            const incident = new Array(this.prefix).fill(false);
            if (line) {
                for (let i = 0; i < this.prefix; i++) {
                    if (stop()) return 'cancelled';
                    if (graph.pointOnElement(graph.points[i], goal)) {
                        incident[i] = true;
                        entry.hits.push(i);
                    }
                }
            }
            for (let i = 0; i < this.prefix; i++) {
                if (stop()) return 'cancelled';
                if (!line) {
                    const p = graph.points[i];
                    if (!SAME_POINT({x: CLEAN_ZERO(p.x), y: CLEAN_ZERO(p.y)}, {x: goal.a, y: goal.b})) continue;
                    entry.centers.push(i);
                }
                for (let j = line ? i + 1 : 0; j < this.prefix; j++) {
                    if (stop()) return 'cancelled';
                    if (i === j) continue;
                    const cand = line ? {i: i, j: j, tool: 2}
                        : {i: Math.min(i, j), j: Math.max(i, j), tool: i < j ? 0 : 1};
                    stats.rawCandidates++;
                    const e = graph.makeCandidate(cand);
                    if (!SAME_ELEMENT(e, goal)) continue;
                    if (entry.matches.length >= MAX_REPRESENTATIONS) {
                        entry.overflow = true;
                        entry.matches = [];
                        return 'unavailable'; // 退回未缓存的完整扫描
                    }
                    entry.matches.push({outer: i, inner: j, candidate: cand, element: e,
                        incident: line && incident[i] && incident[j]});
                }
            }
            entry.complete = true; // 含「扫过整个有序前缀、确认没有表示」这一结论
        }

        // 老外层点：先给缓存里的老-老配对，再给新的内层点；新外层点：重新检查全部内层选择。
        // 这个合并顺序与未缓存时的点对顺序一致，且不会重扫已知的失败。
        const n = graph.points.length;
        const scan = (incidenceOnly, hits) => {
            if (n === this.prefix) {
                for (const old of entry.matches) {
                    if (stop()) return 'cancelled';
                    if ((!incidenceOnly || old.incident) && accept(old.candidate, old.element)) return 'accepted';
                }
                return 'exhausted';
            }
            let cached = 0;
            const outerCount = incidenceOnly ? hits.length
                : line ? n : entry.centers.length + n - this.prefix;
            let newHitIndex = 0;
            while (newHitIndex < hits.length && hits[newHitIndex] < this.prefix) newHitIndex++;
            for (let a = 0; a < outerCount; a++) {
                if (stop()) return 'cancelled';
                const i = incidenceOnly ? hits[a]
                    : line ? a
                    : a < entry.centers.length ? entry.centers[a] : this.prefix + a - entry.centers.length;
                if (!line && i >= this.prefix) {
                    const p = graph.points[i];
                    if (!SAME_POINT({x: CLEAN_ZERO(p.x), y: CLEAN_ZERO(p.y)}, {x: goal.a, y: goal.b})) continue;
                }
                while (cached < entry.matches.length && entry.matches[cached].outer < i) cached++;
                while (cached < entry.matches.length && entry.matches[cached].outer === i) {
                    if (stop()) return 'cancelled';
                    const old = entry.matches[cached++];
                    if ((!incidenceOnly || old.incident) && accept(old.candidate, old.element)) return 'accepted';
                }
                const first = incidenceOnly ? (i < this.prefix ? newHitIndex : a + 1)
                    : line ? Math.max(i + 1, this.prefix) : (i < this.prefix ? this.prefix : 0);
                const end = incidenceOnly ? hits.length : n;
                for (let b = first; b < end; b++) {
                    if (stop()) return 'cancelled';
                    const j = incidenceOnly ? hits[b] : b;
                    if (i === j) continue;
                    const cand = line ? {i: i, j: j, tool: 2}
                        : {i: Math.min(i, j), j: Math.max(i, j), tool: i < j ? 0 : 1};
                    stats.rawCandidates++;
                    const e = graph.makeCandidate(cand);
                    if (SAME_ELEMENT(e, goal) && accept(cand, e)) return 'accepted';
                }
            }
            return 'exhausted';
        };
        let hits = null;
        if (line) {
            hits = entry.hits.slice();
            for (let i = this.prefix; i < n; i++) {
                if (stop()) return 'cancelled';
                if (graph.pointOnElement(graph.points[i], goal)) hits.push(i);
            }
            const fast = scan(true, hits);
            if (fast !== 'exhausted') return fast;
        }
        return scan(false, hits || []);
    }
}

/**
 * 这个已知点能不能当目标圆的圆心 过程函数
 * 这是**数值模型里的必要条件**（不是残差界）：圆规操作是「圆心 → 圆上一点」，
 * 最后一步要作出目标圆，就得先有个已知点当圆心；FromPoints 存圆心系数时会 CleanZero，
 * 所以这里先 CleanZero 再与目标圆心比点 —— 与 C++ solver.hpp 的 CanBeGoalCenter 同一判据。
 * 目标直线 / 圆周在输入处的残差不构成必要条件，故这里不比。
 * @param {Object} point 已知点
 * @param {Object} goal 目标圆
 * @returns {boolean}
 */
function canBeGoalCenter(point, goal) {
    return SAME_POINT({x: CLEAN_ZERO(point.x), y: CLEAN_ZERO(point.y)}, {x: goal.a, y: goal.b});
}

const SOLVER_NOW = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

class Solver {
    constructor(toolType, symmetry, goalFirst, lowMemory, streamDedupEntries, ttBytes, timeLimitSeconds) {
        this.toolType = toolType;
        this.symmetry = symmetry;
        this.goalFirst = goalFirst;
        this.lowMemory = lowMemory;
        this.streamDedupEntries = streamDedupEntries;
        this.ttBytes = ttBytes;
        this.timeLimitSeconds = timeLimitSeconds;
        this.deadline = 0;
        this.timedOut = false;
        this.timeoutPollCounter = 0;
        this.streamSeen = [];
        this.gridSeen = [];
        // 每个深度一个目标点对缓存（C++ scratch_[depth].goalPairs）
        this.goalPairCaches = [];
        this.oneStepSeen = new BoundedElementSet();
        this.transposition = new TranspositionTable();
        this.parallelControl = null;
        this.solutionCollector = null;
        this.frontierTaskSink = null;
        this.frontierDepth = 3;
        this.frontierStopped = false;
        this.frontierProbeMode = false;
        // 搜索进度上报（页面拿它画进度条）：null = 不上报；见 reportProgress
        this.onProgress = null;
        // 「情况」= 搜索树的一个节点（无解的也算一种情况）：到这个深度就开始数，
        // 这一层一共多少个情况由一次浅层探测先数出来（页面用它估总量）
        this.progressDepth = 0;
        this.progressTotalTasks = 0;
        this.progressTasksSeen = 0;
        // 已经搜完的那几个情况一共占了多少节点（页面据此算「平均每个情况多大」）
        this.progressCompletedNodes = 0;
        this.progressLastBoundaryNodes = 0;
        this.progressLastAt = 0;
    }

    /**
     * 搜索进度上报 过程函数（每 200ms 最多一次）
     * 报的是「已经搜了多少个节点 / 已经搜完几个情况」，页面拿它按平均规模外推总量
     * @param {Object} stats
     */
    reportProgress(stats) {
        const now = SOLVER_NOW();
        if (now - this.progressLastAt < 200) return;
        this.progressLastAt = now;
        this.onProgress({
            nodes: stats.nodes,
            tasksDone: this.progressTasksSeen,
            completedNodes: this.progressCompletedNodes,
            totalTasks: this.progressTotalTasks,
        });
    }

    setSolutionCollector(collector) {
        this.solutionCollector = collector;
    }

    /** 超时 / 外部停止的轮询 过程函数（与原版一样每 64 次才真查一次表） */
    checkTimeout() {
        if (this.frontierStopped || this.timedOut) return true;
        const poll = ++this.timeoutPollCounter;
        if ((poll & 63) !== 0) return false;
        if (this.parallelControl && this.parallelControl.stop) {
            this.timedOut = this.parallelControl.timedOut;
            return true;
        }
        if ((poll & 1023) !== 0) return false;
        if (SOLVER_NOW() >= this.deadline) {
            this.timedOut = true;
            if (this.parallelControl && !this.parallelControl.found) {
                this.parallelControl.timedOut = true;
                this.parallelControl.stop = true;
            }
            return true;
        }
        return false;
    }

    /**
     * 枚举当前节点里所有互不相同的新元素候选（低内存模式不用它） 过程函数
     * 用「量化桶 + 邻域 3×3×3 精确比较」去重：量化边界附近不会漏判，也不会误判
     */
    generateUniqueCandidates(graph, stats) {
        const result = [];
        const representatives = [];
        const seen = new Map();

        const n = graph.points.length;
        const add = (i, j, tool) => {
            if (this.checkTimeout()) return;
            stats.rawCandidates++;
            const candidate = {i, j, tool};
            const e = graph.makeCandidate(candidate);
            if (graph.hasElement(e)) {
                stats.existingCandidates++;
                return;
            }
            const qa = quantize(e.a), qb = quantize(e.b), qc = quantize(e.c);
            for (let da = -1; da <= 1; da++) {
                for (let db = -1; db <= 1; db++) {
                    for (let dc = -1; dc <= 1; dc++) {
                        const index = seen.get((qa + da) + ',' + (qb + db) + ',' + (qc + dc) + ',' + e.type);
                        if (index !== undefined && SAME_ELEMENT(representatives[index], e)) {
                            stats.duplicateCandidates++;
                            return;
                        }
                    }
                }
            }
            const id = result.length;
            result.push(candidate);
            representatives.push(e);
            const home = elementBucketKey(e);
            if (!seen.has(home)) seen.set(home, id);
            stats.uniqueCandidates++;
        };

        for (let i = 0; i < n; i++) {
            if (this.checkTimeout()) return result;
            for (let j = i + 1; j < n; j++) {
                if (this.checkTimeout()) return result;
                if (this.toolType === 0 || this.toolType === 2) {
                    add(i, j, 0);
                    if (this.timedOut) return result;
                    add(i, j, 1);
                    if (this.timedOut) return result;
                }
                if (this.toolType === 1 || this.toolType === 2) {
                    add(i, j, 2);
                    if (this.timedOut) return result;
                }
            }
        }

        if (this.checkTimeout()) return result;
        if (this.goalFirst) {
            // 只重排顺序、不删候选：先「正好是缺的目标元素」，再「过缺的目标点」，最后普通辅助
            let exactEnd = 0;
            for (let read = 0; read < result.length; read++) {
                if (this.checkTimeout()) return result;
                if (graph.goalPriority(graph.makeCandidate(result[read])) === 2) {
                    if (exactEnd !== read) {
                        const tmp = result[exactEnd];
                        result[exactEnd] = result[read];
                        result[read] = tmp;
                    }
                    exactEnd++;
                }
            }
            if (graph.hasMissingGoalPoints()) {
                let directedEnd = exactEnd;
                for (let read = exactEnd; read < result.length; read++) {
                    if (this.checkTimeout()) return result;
                    if (graph.goalPriority(graph.makeCandidate(result[read])) === 1) {
                        if (directedEnd !== read) {
                            const tmp = result[directedEnd];
                            result[directedEnd] = result[read];
                            result[read] = tmp;
                        }
                        directedEnd++;
                    }
                }
            }
        }
        return result;
    }

    /** 相邻两步的偏序剪枝 过程函数（依赖上一步的点不受此限制） */
    symmetryPruned(graph, candidate, e, depth, previous, stats) {
        if (!this.symmetry || !previous) return false;
        const dependsOnPrevious = depth > 0 &&
            (graph.pointBirth[candidate.i] === depth || graph.pointBirth[candidate.j] === depth);
        if (!dependsOnPrevious && compareOperationKey(makeOperationKey(e), previous) < 0) {
            stats.symmetryPruned++;
            return true;
        }
        return false;
    }

    /** 进入节点前预先算好的目标相关上下文 过程函数 */
    buildPreApplyContext(graph, remaining) {
        const ctx = {
            missingGoalElements: 0,
            missingDistinctGoal: new Array(graph.goalElements.length).fill(0),
            requiredPoints: [],
            goalPointKnown: [],
            existingSupport: [],
            missingGoalSupports: [],
            previewGoal: -1,
            knownLineHits: 0,
            knownLinePoint: null,
            knownCenter: false,
            knownCircumference: false,
        };

        for (let i = 0; i < graph.goalElements.length; i++) {
            const goal = graph.goalElements[i];
            if (graph.hasElement(goal)) continue;
            let duplicate = false;
            for (let j = 0; j < i; j++) {
                if (SAME_ELEMENT(graph.goalElements[j], goal)) {
                    duplicate = true;
                    break;
                }
            }
            if (!duplicate) {
                ctx.missingDistinctGoal[i] = 1;
                ctx.missingGoalElements++;
            }
        }

        ctx.requiredPoints = graph.goalPoints.map(p => ({x: p.x, y: p.y}));
        for (let gi = 0; gi < graph.goalElements.length; gi++) {
            if (!ctx.missingDistinctGoal[gi]) continue;
            const goal = graph.goalElements[gi];
            if (goal.type !== TYPE_CIRCLE) continue;
            const center = {x: goal.a, y: goal.b};
            let duplicate = false;
            for (const old of ctx.requiredPoints) {
                if (SAME_POINT(old, center)) {
                    duplicate = true;
                    break;
                }
            }
            if (!duplicate) ctx.requiredPoints.push(center);
        }

        const np = ctx.requiredPoints.length;
        ctx.goalPointKnown.length = np;
        ctx.existingSupport.length = np;
        ctx.missingGoalSupports.length = np;
        for (let pi = 0; pi < np; pi++) {
            const p = ctx.requiredPoints[pi];
            const known = graph.hasPoint(p);
            ctx.goalPointKnown[pi] = known ? 1 : 0;
            if (known) {
                ctx.existingSupport[pi] = 0;
                ctx.missingGoalSupports[pi] = 0;
                continue;
            }
            ctx.existingSupport[pi] = Math.min(2, graph.existingSupportCount(p));
            let forced = 0;
            for (let gi = 0; gi < graph.goalElements.length; gi++) {
                if (ctx.missingDistinctGoal[gi] && graph.pointOnElement(p, graph.goalElements[gi])) forced++;
            }
            ctx.missingGoalSupports[pi] = forced;
        }

        // 只剩两步、且只缺一个目标元素时，预先算出「最后一步能不能凑齐前提」
        if (remaining === 2 && ctx.missingGoalElements === 1) {
            for (let gi = 0; gi < graph.goalElements.length; gi++) {
                if (!ctx.missingDistinctGoal[gi]) continue;
                const goal = graph.goalElements[gi];
                if (goal.type === TYPE_LINE) {
                    for (const p of graph.points) {
                        if (!graph.pointOnElement(p, goal)) continue;
                        ctx.knownLinePoint = p;
                        if (++ctx.knownLineHits >= 2) break;
                    }
                    if (ctx.knownLineHits < 2) ctx.previewGoal = gi;
                } else if (goal.type === TYPE_CIRCLE) {
                    ctx.knownCenter = graph.hasPoint({x: goal.a, y: goal.b});
                    for (const p of graph.points) {
                        if (graph.pointOnElement(p, goal)) {
                            ctx.knownCircumference = true;
                            break;
                        }
                    }
                    if (!ctx.knownCenter || !ctx.knownCircumference) ctx.previewGoal = gi;
                }
                break;
            }
        }
        return ctx;
    }

    /** 用现成的上下文快速判断：这个候选会不会让下一步违反联合下界 过程函数 */
    candidateViolatesNextJointLowerBoundFast(graph, candidate, remainingAfter, ctx) {
        if (remainingAfter < 0) return true;

        let completesMissingGoal = false;
        for (let gi = 0; gi < graph.goalElements.length; gi++) {
            if (ctx.missingDistinctGoal[gi] && SAME_ELEMENT(graph.goalElements[gi], candidate)) {
                completesMissingGoal = true;
                break;
            }
        }
        const missingAfter = ctx.missingGoalElements - (completesMissingGoal ? 1 : 0);
        if (missingAfter > remainingAfter) return true;
        if (!ctx.requiredPoints.length) return false;

        const auxiliaryBudget = remainingAfter - missingAfter;
        let requiredAuxiliary = 0;
        for (let pi = 0; pi < ctx.requiredPoints.length; pi++) {
            if (ctx.goalPointKnown[pi]) continue;
            const passes = graph.pointOnElement(ctx.requiredPoints[pi], candidate);
            const existingBefore = ctx.existingSupport[pi];
            if (passes && existingBefore >= 1) continue;

            const existingAfter = Math.min(2, existingBefore + (passes ? 1 : 0));
            let forcedAfter = ctx.missingGoalSupports[pi];
            if (completesMissingGoal && passes && forcedAfter > 0) forcedAfter--;
            const need = Math.max(0, 2 - existingAfter - forcedAfter);
            requiredAuxiliary = Math.max(requiredAuxiliary, need);
            if (requiredAuxiliary > auxiliaryBudget) return true;
        }
        return false;
    }

    /**
     * 预览：这个候选能不能给「最后一个目标元素」补上还缺的前提 过程函数
     * 用的是与真正 Apply 完全相同的数值求交，不会拿目标坐标硬造元素
     */
    candidateCanSupplyLastElementPrerequisites(graph, candidate, ctx) {
        if (ctx.previewGoal < 0) return true;
        const goal = graph.goalElements[ctx.previewGoal];
        if (SAME_ELEMENT(candidate, goal)) return true;

        if (goal.type === TYPE_LINE) {
            let rawHits = 0;
            const needed = 2 - ctx.knownLineHits;
            const visit = p => {
                if (!graph.pointOnElement(p, goal)) return false;
                if (ctx.knownLineHits === 1 && ctx.knownLinePoint && SAME_POINT(p, ctx.knownLinePoint)) return false;
                // 没有任何旧命中时按「事件数」而不是「不同点数」计数（保守，宁可多放行）
                rawHits++;
                return rawHits >= needed;
            };
            for (const old of graph.elements) {
                if (graph.visitIntersections(candidate, old, visit)) return true;
            }
            return false;
        }

        let center = ctx.knownCenter;
        let circumference = ctx.knownCircumference;
        const centerPoint = {x: goal.a, y: goal.b};
        const visit = p => {
            if (!center && SAME_POINT(p, centerPoint)) center = true;
            if (!circumference && graph.pointOnElement(p, goal)) circumference = true;
            return center && circumference;
        };
        for (const old of graph.elements) {
            if (graph.visitIntersections(candidate, old, visit)) return true;
        }
        return false;
    }

    /** 试走一个候选：先过两道预检，再真正落子并递归 过程函数 */
    tryCandidate(graph, e, remaining, depth, stats, preCtx, previewAlreadyPassed = false) {
        if (this.checkTimeout()) return false;
        if (this.candidateViolatesNextJointLowerBoundFast(graph, e, remaining - 1, preCtx)) {
            stats.preApplyLowerBoundPruned++;
            return false;
        }
        if (!previewAlreadyPassed && preCtx.previewGoal >= 0) {
            stats.prerequisitePreviewTested++;
            if (!this.candidateCanSupplyLastElementPrerequisites(graph, e, preCtx)) {
                stats.prerequisitePreviewPruned++;
                return false;
            }
        }
        const key = makeOperationKey(e);
        const mark = graph.getMark();
        graph.applyKnownNew(e, depth + 1);
        stats.applied++;
        if (this.dfs(graph, remaining - 1, depth + 1, key, stats)) return true;
        graph.rollback(mark);
        return false;
    }

    /** 不建元素对象、直接判断候选是否过某点（末段热点路径） 过程函数 */
    fastCandidatePassesPoint(graph, candidate, p) {
        const pi = graph.points[candidate.i];
        const pj = graph.points[candidate.j];
        if (candidate.tool === 0) {
            return IS_ZERO(SQ(pi.x - pj.x) + SQ(pi.y - pj.y) - SQ(pi.x - p.x) - SQ(pi.y - p.y));
        }
        if (candidate.tool === 1) {
            return IS_ZERO(SQ(pi.x - pj.x) + SQ(pi.y - pj.y) - SQ(pj.x - p.x) - SQ(pj.y - p.y));
        }
        const a = pj.y - pi.y;
        const b = pi.x - pj.x;
        const c = pi.x * pj.y - pi.y * pj.x;
        if (!IS_ZERO(b)) return IS_ZERO((a * p.x + b * p.y - c) / b);
        if (!IS_ZERO(a)) return IS_ZERO((a * p.x + b * p.y - c) / a);
        return false;
    }

    fastCandidatePassesForcedTailPoints(graph, candidate, forced) {
        for (const gi of forced) {
            if (!this.fastCandidatePassesPoint(graph, candidate, graph.goalPoints[gi])) return false;
        }
        return true;
    }

    tailCandidateAllowed(graph, e, forcedTailPoints, stats) {
        if (!graph.candidatePassesForcedTailPoints(e, forcedTailPoints)) {
            stats.forcedPointTailPruned++;
            return false;
        }
        return true;
    }

    /**
     * 取本深度的目标点对缓存 过程函数（C++ TailPrefixScope 里 GoalPairCache 那一半）
     * 同一个 DFS 深度上前缀只增不减，缓存可跨多次查询复用；一旦回滚到更短的前缀就重建。
     * 条件与 C++ 一致：有目标元素、目标数 ≤ 8、点数 ≤ 1024。
     */
    goalPairCacheFor(depth, graph) {
        if (!graph.goalElements.length || graph.goalElements.length > 8) return null;
        if (graph.points.length > 1024) return null;
        if (!this.goalPairCaches[depth]) this.goalPairCaches[depth] = new GoalPairCache();
        const cache = this.goalPairCaches[depth];
        if (cache.prefix > graph.points.length) {
            cache.reset(graph.points.length); // 回滚过，索引已经不可信
        } else if (cache.prefix === 0 && graph.points.length) {
            cache.reset(graph.points.length); // 第一次用：以当前点数当有序前缀
        }
        return cache;
    }

    /**
     * 找出「一个」能用现有已知点作出目标元素的候选 过程函数
     * 同一几何元素的不同点对表示会走到同一个状态，找到第一个对称可行的即可
     */
    findGoalConstructionCandidate(graph, goal, depth, previous, forcedTailPoints, stats) {
        // 先问目标点对缓存（命中与否仍然现判：对称剪枝在 accept 里照跑）
        const pairCache = this.goalPairCacheFor(depth, graph);
        if (pairCache) {
            let found = null;
            const result = pairCache.visit(graph, goal, this.toolType, stats,
                () => this.checkTimeout(),
                (candidate, e) => {
                    if (this.symmetryPruned(graph, candidate, e, depth, previous, stats)) return false;
                    stats.uniqueCandidates++;
                    found = candidate;
                    return true;
                });
            if (result !== 'unavailable') return found;
            // 'unavailable' = 容量或取消：退回未缓存的完整扫描（C++ 同一处理）
        }
        const n = graph.points.length;

        if (goal.type === TYPE_LINE) {
            if (this.toolType === 0) return null;
            // 枚举**每一对**在线点，并逐对**再验证**「作出的就是目标直线」。
            // 原来只拿「第一个通过 EPS 在线判断的点」当前提、与后面每个在线点配对，
            // 而那个点可能只是近似落在目标线上 —— 用它配出来的直线并不是目标线，
            // 真实定义点对反而被漏掉（v9 修复 1，见 C++ solver.hpp 的 FindGoalConstructionCandidate）
            const hits = [];
            graph.visitPointIncidences(goal, i => hits.push(i));
            const tryPair = (i, j) => {
                if (i === j) return null;
                stats.rawCandidates++;
                const candidate = {i: Math.min(i, j), j: Math.max(i, j), tool: 2};
                const e = graph.makeCandidate(candidate);
                if (!SAME_ELEMENT(e, goal)) return null;
                if (this.symmetryPruned(graph, candidate, e, depth, previous, stats)) return null;
                stats.uniqueCandidates++;
                return candidate;
            };
            for (let a = 0; a < hits.length; a++) {
                for (let b = a + 1; b < hits.length; b++) {
                    if (this.checkTimeout()) return null;
                    const found = tryPair(hits[a], hits[b]);
                    if (found) return found;
                }
            }
            // 兜底：EPS 判等并不意味着「两个定义点上代入残差都小」，在线判断本身可能把真正的
            // 定义点对漏掉 —— 那就再把**全部已知点对**过一遍，同样逐对验证（C++ 的第二轮循环）
            for (let i = 0; i < n; i++) {
                for (let j = i + 1; j < n; j++) {
                    if (this.checkTimeout()) return null;
                    const found = tryPair(i, j);
                    if (found) return found;
                }
            }
            return null;
        }

        if (goal.type === TYPE_CIRCLE) {
            if (this.toolType === 1 || IS_ZERO(goal.c)) return null;
            // 每个「能当目标圆心的已知点」都试一遍（原来只取第一个同坐标的点），
            // 圆上那一点不预先用 pointOnElement 过滤 —— 一律以「作出的元素确实等于目标圆」为准
            //（C++ 同一处：CanBeGoalCenter 过滤 + 逐对 MakeCandidate/SameElement 复验）
            for (let centerId = 0; centerId < n; centerId++) {
                if (this.checkTimeout()) return null;
                if (!canBeGoalCenter(graph.points[centerId], goal)) continue;
                for (let p = 0; p < n; p++) {
                    if (p === centerId) continue;
                    stats.rawCandidates++;
                    const i = Math.min(centerId, p);
                    const j = Math.max(centerId, p);
                    const tool = (i === centerId) ? 0 : 1;
                    const candidate = {i, j, tool};
                    const e = graph.makeCandidate(candidate);
                    if (!SAME_ELEMENT(e, goal)) continue;
                    if (this.symmetryPruned(graph, candidate, e, depth, previous, stats)) continue;
                    stats.uniqueCandidates++;
                    return candidate;
                }
            }
        }
        return null;
    }

    /**
     * 末段强制目标搜索 过程函数
     * 「剩余步数 == 还缺的目标元素数」时，之后每一步都必须正好是某个缺的目标元素，
     * 于是只搜这些元素，不枚举任何辅助直线/圆
     */
    searchForcedGoalTail(graph, remaining, depth, previous, forcedTailPoints, stats) {
        stats.forcedGoalTailNodes++;

        const missing = [];
        for (let gi = 0; gi < graph.goalElements.length; gi++) {
            const goal = graph.goalElements[gi];
            if (graph.hasElement(goal)) continue;
            let duplicate = false;
            for (let j = 0; j < gi; j++) {
                if (SAME_ELEMENT(graph.goalElements[j], goal)) {
                    duplicate = true;
                    break;
                }
            }
            if (!duplicate) missing.push(gi);
        }
        missing.sort((a, b) => compareOperationKey(
            makeOperationKey(graph.goalElements[a]), makeOperationKey(graph.goalElements[b])));

        for (const gi of missing) {
            if (this.checkTimeout()) return false;
            const goal = graph.goalElements[gi];
            const candidate = this.findGoalConstructionCandidate(
                graph, goal, depth, previous, forcedTailPoints, stats);
            if (!candidate) continue;
            const e = graph.makeCandidate(candidate);
            const key = makeOperationKey(e);
            const mark = graph.getMark();
            graph.applyKnownNew(e, depth + 1);
            stats.applied++;
            if (this.dfs(graph, remaining - 1, depth + 1, key, stats)) return true;
            graph.rollback(mark);
        }
        return false;
    }

    /** 收集「末段每一步都必须过」的目标点（去重） 过程函数 */
    collectUniqueForcedTailPoints(graph, forcedTailPoints, required) {
        required.length = 0;
        for (const gi of forcedTailPoints) {
            const p = graph.goalPoints[gi];
            let duplicate = false;
            for (const q of required) {
                if (SAME_POINT(p, q)) {
                    duplicate = true;
                    break;
                }
            }
            if (!duplicate) required.push({x: p.x, y: p.y});
        }
        return required;
    }

    /** 反向找一个「用已知点就能画出这条直线」的表示 过程函数 */
    findReverseLineRepresentation(graph, line, depth, previous, stats) {
        if (this.toolType === 0) return null;

        let first = -1, second = -1, newborn = -1;
        graph.visitPointIncidences(line, i => {
            if (first < 0) first = i;
            else if (second < 0) second = i;
            if (depth > 0 && graph.pointBirth[i] === depth) newborn = i;
        });
        if (second < 0) return null;

        const make = (a, b) => {
            if (a === b) return null;
            if (a > b) {
                const tmp = a;
                a = b;
                b = tmp;
            }
            const candidate = {i: a, j: b, tool: 2};
            stats.rawCandidates++;
            const e = graph.makeCandidate(candidate);
            if (!SAME_ELEMENT(e, line)) return null;
            if (this.symmetryPruned(graph, candidate, e, depth, previous, stats)) return null;
            return candidate;
        };

        const canonical = make(first, second);
        if (canonical) return canonical;

        // 规范点对只因「相邻操作偏序」被否时，用当层新生点构成的表示一定依赖上一步，必然可行
        if (newborn >= 0) {
            const other = (first === newborn) ? second : first;
            const alternative = make(newborn, other);
            if (alternative) return alternative;
        }
        return null;
    }

    /** 反向找一个「圆心已知、圆上一点也已知」的圆表示 过程函数 */
    findReverseCircleRepresentation(graph, centerId, circle, depth, previous, stats) {
        if (this.toolType === 1 || IS_ZERO(circle.c) || centerId >= graph.points.length) return null;

        let first = -1, newborn = -1;
        graph.visitPointIncidences(circle, q => {
            if (q === centerId) return;
            if (first < 0) first = q;
            if (depth > 0 && graph.pointBirth[q] === depth) newborn = q;
        });
        if (first < 0) return null;

        const make = q => {
            const i = Math.min(centerId, q);
            const j = Math.max(centerId, q);
            const tool = (i === centerId) ? 0 : 1;
            const candidate = {i, j, tool};
            stats.rawCandidates++;
            const e = graph.makeCandidate(candidate);
            if (!SAME_ELEMENT(e, circle)) return null;
            if (this.symmetryPruned(graph, candidate, e, depth, previous, stats)) return null;
            return candidate;
        };

        const canonical = make(first);
        if (canonical) return canonical;

        if (depth > 0 && graph.pointBirth[centerId] !== depth && newborn >= 0 && newborn !== first) {
            const alternative = make(newborn);
            if (alternative) return alternative;
        }
        return null;
    }

    /**
     * 反向生成「过所有强制目标点」的候选 过程函数
     * 末一两层用它取代 O(n² × 工具数) 的点对枚举：
     *   直线：≥2 个强制点时几何唯一；只有 1 个强制点 P 时，一切可行直线都是 P 连某个已知点
     *   圆  ：圆心必须是已知点，还要求所有强制点到圆心等距、且圆上另有已知点
     * @param {Function} acceptCandidate 通过去重后的接受回调，返回 true 表示「整棵搜索可以收了」
     */
    searchReverseForcedPointCandidates(graph, depth, previous, forcedTailPoints, seen, stats,
                                       countStreamDuplicates, oneStepTail, acceptCandidate) {
        const required = this.collectUniqueForcedTailPoints(graph, forcedTailPoints, []);
        if (!required.length) return false;

        seen.beginNode();

        const emit = (candidate, e) => {
            if (this.checkTimeout()) return false;
            if (!graph.candidatePassesForcedTailPoints(e, forcedTailPoints)) {
                stats.forcedPointTailPruned++;
                return false;
            }
            if (graph.hasElement(e)) {
                stats.existingCandidates++;
                return false;
            }
            const inserted = seen.insert(e);
            if (inserted === 'duplicate') {
                stats.duplicateCandidates++;
                if (countStreamDuplicates) stats.streamDuplicates++;
                return false;
            }
            if (inserted === 'untracked') stats.streamDedupOverflow++;

            stats.uniqueCandidates++;
            if (oneStepTail) stats.tailOneCandidates++;
            return acceptCandidate(candidate, e);
        };

        // ----- 直尺候选 -----
        if (this.toolType !== 0) {
            if (required.length >= 2) {
                const line = makeElementFromPoints(required[0], required[1], TYPE_LINE);
                let allOnLine = true;
                for (let k = 2; k < required.length; k++) {
                    if (!graph.pointOnElement(required[k], line)) {
                        allOnLine = false;
                        break;
                    }
                }
                if (allOnLine) {
                    const candidate = this.findReverseLineRepresentation(graph, line, depth, previous, stats);
                    if (candidate) {
                        if (emit(candidate, graph.makeCandidate(candidate))) return true;
                        if (this.timedOut) return false;
                    }
                }
            } else {
                const p = required[0];
                const triedLines = [];
                for (let q = 0; q < graph.points.length; q++) {
                    if (this.checkTimeout()) return false;
                    if (SAME_POINT(p, graph.points[q])) continue;
                    const line = makeElementFromPoints(p, graph.points[q], TYPE_LINE);

                    let duplicate = false;
                    for (const old of triedLines) {
                        if (SAME_ELEMENT(old, line)) {
                            duplicate = true;
                            break;
                        }
                    }
                    if (duplicate) continue;
                    triedLines.push(line);

                    const candidate = this.findReverseLineRepresentation(graph, line, depth, previous, stats);
                    if (candidate) {
                        if (emit(candidate, graph.makeCandidate(candidate))) return true;
                        if (this.timedOut) return false;
                    }
                }
            }
        }

        // ----- 圆规候选 -----
        if (this.toolType !== 1) {
            const p0 = required[0];
            for (let centerId = 0; centerId < graph.points.length; centerId++) {
                if (this.checkTimeout()) return false;
                const center = graph.points[centerId];
                const r2 = SQ(center.x - p0.x) + SQ(center.y - p0.y);
                if (IS_ZERO(r2)) continue; // 半径为零的圆规圆不可能

                let allOnCircle = true;
                for (let k = 1; k < required.length; k++) {
                    const d2 = SQ(center.x - required[k].x) + SQ(center.y - required[k].y);
                    if (!IS_ZERO(d2 - r2)) {
                        allOnCircle = false;
                        break;
                    }
                }
                if (!allOnCircle) continue;

                const circle = makeElementFromCoefficients(center.x, center.y, r2, TYPE_CIRCLE);
                const candidate = this.findReverseCircleRepresentation(graph, centerId, circle, depth, previous, stats);
                if (candidate) {
                    if (emit(candidate, graph.makeCandidate(candidate))) return true;
                    if (this.timedOut) return false;
                }
            }
        }
        return false;
    }

    /**
     * 一步点补全的反向搜索 过程函数
     * 此时联合下界已保证每个缺的目标点都有一条已存支撑，所以唯一剩下的元素必须过它们全部
     */
    searchOneStepPointTail(graph, depth, previous, forcedTailPoints, stats) {
        const accept = (candidate, e) => {
            const mark = graph.getMark();
            graph.applyKnownNew(e, depth + 1);
            stats.applied++;
            if (graph.goalsMet() &&
                (!this.solutionCollector || this.solutionCollector.submit(graph, this.parallelControl))) {
                return true;
            }
            graph.rollback(mark);
            return false;
        };
        return this.searchReverseForcedPointCandidates(
            graph, depth, previous, forcedTailPoints, this.oneStepSeen, stats, false, true, accept);
    }

    /** 剩余两步、且有目标点还没有任何支撑时的专用反向末段 过程函数 */
    streamForcedPointTailCandidates(graph, remaining, depth, previous, forcedTailPoints, stats) {
        let preCtx = null;
        const accept = (candidate, e) => {
            // 真出现反向候选时才建上下文（之前图没变，不会少搜任何分支）
            if (!preCtx) preCtx = this.buildPreApplyContext(graph, remaining);
            return this.tryCandidate(graph, e, remaining, depth, stats, preCtx);
        };
        return this.searchReverseForcedPointCandidates(
            graph, depth, previous, forcedTailPoints, this.streamSeen[depth], stats, true, false, accept);
    }

    /**
     * 直接把还缺的目标元素作出来 过程函数
     * 目标优先级的第 2 档不需要扫全点对：目标直线能画就说明已有两点在上面，
     * 目标圆能画就说明圆心与圆上一点都已已知
     */
    tryDirectMissingGoalElements(graph, remaining, depth, previous, stats, preCtx) {
        const noForcedPoints = [];
        for (let gi = 0; gi < graph.goalElements.length; gi++) {
            if (!preCtx.missingDistinctGoal[gi]) continue;
            const goal = graph.goalElements[gi];
            const candidate = this.findGoalConstructionCandidate(
                graph, goal, depth, previous, noForcedPoints, stats);
            if (!candidate) continue;
            const e = graph.makeCandidate(candidate);
            if (this.tryCandidate(graph, e, remaining, depth, stats, preCtx)) return true;
            if (this.timedOut) return false;
        }
        return false;
    }

    /**
     * 流式枚举候选（低内存主路径） 过程函数
     * 边生成边判、不保存候选表；分档只影响顺序：先「指还缺目标点」的，再普通辅助
     */
    streamCandidates(graph, remaining, depth, previous, stats) {
        const n = graph.points.length;
        const seen = this.streamSeen[depth];
        seen.beginNode();
        let exactSeen = null;
        if (graph.gridMode && graph.gridFast) {
            exactSeen = this.gridSeen[depth];
            exactSeen.beginNode();
        }
        const preCtx = this.buildPreApplyContext(graph, remaining);

        // 开了目标优先时，先试着直接作出还缺的目标直线/圆，通用流里就只剩「指目标点」与辅助两档
        const useGoalBands = this.goalFirst && remaining > 1;
        if (useGoalBands) {
            if (this.tryDirectMissingGoalElements(graph, remaining, depth, previous, stats, preCtx)) return true;
            if (this.timedOut) return false;
        }
        const missingGoalPoints = useGoalBands && graph.hasMissingGoalPoints();
        const passes = useGoalBands ? (missingGoalPoints ? 2 : 1) : 1;
        // 进度：第 1 层扫过的点对 / 它要扫的点对总数（含各 pass）—— 这是从根上数得清的那一档
        for (let pass = 0; pass < passes; pass++) {
            if (this.checkTimeout()) return false;
            for (let i = 0; i < n; i++) {
                if (this.checkTimeout()) return false;
                for (let j = i + 1; j < n; j++) {
                    if (this.checkTimeout()) return false;
                    const consider = tool => {
                        if (this.checkTimeout()) return false;
                        stats.rawCandidates++;
                        const candidate = {i, j, tool};
                        const e = graph.makeCandidate(candidate);

                        // 先做零内存的偏序检查，再做较贵的目标与元素判定
                        if (this.symmetryPruned(graph, candidate, e, depth, previous, stats)) return false;
                        const goalPriority = graph.goalPriority(e);
                        // 只剩一步时，不是冲着目标来的元素不可能补齐任何目标
                        if (remaining === 1 && goalPriority === 0) {
                            stats.finalStepPruned++;
                            return false;
                        }
                        if (useGoalBands) {
                            // 第 2 档刚才已经直接处理过，不要再用全点对扫一遍把它找回来
                            const wantedPriority = missingGoalPoints ? (pass === 0 ? 1 : 0) : 0;
                            if (goalPriority !== wantedPriority) return false;
                        }
                        if (graph.hasElement(e)) {
                            stats.existingCandidates++;
                            return false;
                        }
                        if (exactSeen && !exactSeen.insert(e)) {
                            stats.gridExactDuplicates++;
                            return false;
                        }
                        if (preCtx.previewGoal >= 0) {
                            stats.prerequisitePreviewTested++;
                            if (!this.candidateCanSupplyLastElementPrerequisites(graph, e, preCtx)) {
                                stats.prerequisitePreviewPruned++;
                                return false;
                            }
                        }
                        // 容差相等不满足传递性：末层把预检放在去重之前，因此每个通过预检的表示都要试一次
                        if (preCtx.previewGoal < 0) {
                            const dedup = seen.insert(e);
                            if (dedup === 'duplicate') {
                                stats.duplicateCandidates++;
                                stats.streamDuplicates++;
                                return false;
                            }
                            if (dedup === 'untracked') stats.streamDedupOverflow++;
                        }
                        stats.uniqueCandidates++;
                        return this.tryCandidate(graph, e, remaining, depth, stats, preCtx, true);
                    };

                    if (this.toolType === 0 || this.toolType === 2) {
                        if (consider(0)) return true;
                        if (this.timedOut) return false;
                        if (consider(1)) return true;
                        if (this.timedOut) return false;
                    }
                    if (this.toolType === 1 || this.toolType === 2) {
                        if (consider(2)) return true;
                        if (this.timedOut) return false;
                    }
                }
            }
        }
        return false;
    }

    /**
     * 目标已达成之后的枚举 过程函数
     * 目的不只是收下这个解，还要继续枚举「在同一状态下多作几步」得到的别的解，
     * 否则换一条作图顺序的同构解法会被漏掉
     */
    enumerateSatisfied(graph, remaining, depth, previous, stats) {
        if (!this.frontierProbeMode) {
            if (!this.solutionCollector) return true; // 内部单目标调用的兼容分支
            if (this.solutionCollector.submit(graph, this.parallelControl)) return true;
        }
        if (remaining <= 0) return false;

        const n = graph.points.length;
        const seen = this.streamSeen[depth];
        seen.beginNode();

        for (let i = 0; i < n; i++) {
            for (let j = i + 1; j < n; j++) {
                const consider = tool => {
                    if (this.checkTimeout()) return false;
                    stats.rawCandidates++;
                    const candidate = {i, j, tool};
                    const e = graph.makeCandidate(candidate);
                    if (this.symmetryPruned(graph, candidate, e, depth, previous, stats)) return false;
                    if (graph.hasElement(e)) {
                        stats.existingCandidates++;
                        return false;
                    }
                    if (seen.insert(e) === 'duplicate') {
                        stats.duplicateCandidates++;
                        return false;
                    }
                    stats.uniqueCandidates++;
                    const mark = graph.getMark();
                    graph.applyKnownNew(e, depth + 1);
                    stats.applied++;
                    stats.nodes++;
                    stats.maxPoints = Math.max(stats.maxPoints, graph.points.length);
                    stats.maxElements = Math.max(stats.maxElements, graph.elements.length);
                    if (this.frontierTaskSink && depth + 1 >= this.frontierDepth) {
                        if (!this.frontierTaskSink(graph)) this.frontierStopped = true;
                    } else if (this.enumerateSatisfied(graph, remaining - 1, depth + 1, makeOperationKey(e), stats)) {
                        return true;
                    }
                    graph.rollback(mark);
                    return false;
                };

                if (this.toolType !== 1) {
                    if (consider(0)) return true;
                    if (this.checkTimeout()) return false;
                    if (consider(1)) return true;
                    if (this.checkTimeout()) return false;
                }
                if (this.toolType !== 0) {
                    if (consider(2)) return true;
                    if (this.checkTimeout()) return false;
                }
            }
        }
        return false;
    }

    /** 深度优先搜索主体 过程函数：逐层落子、按各条下界与末段专用策略剪枝 */
    dfs(graph, remaining, depth, previous, stats) {
        if (this.checkTimeout()) return false;
        stats.nodes++;
        if (this.progressDepth > 0 && depth === this.progressDepth) {
            // 走到边界层的一个新「情况」：上一个情况的整棵子树已经搜完，把它的节点数记进
            // 「已搜完情况的总节点数」（第一次会把边界之上的少量节点也算进来，可忽略）
            this.progressCompletedNodes += stats.nodes - this.progressLastBoundaryNodes;
            this.progressLastBoundaryNodes = stats.nodes;
            this.progressTasksSeen++;
        }
        // 每 1024 个节点看一眼要不要上报（真正的时间节流在 reportProgress 里）
        if (this.onProgress && (stats.nodes & 1023) === 0) this.reportProgress(stats);
        stats.maxPoints = Math.max(stats.maxPoints, graph.points.length);
        stats.maxElements = Math.max(stats.maxElements, graph.elements.length);

        if (this.frontierTaskSink && depth >= this.frontierDepth) {
            // 这棵子树整体交给一个 worker（含解收集），调用方负责回滚
            if (!this.frontierTaskSink(graph)) this.frontierStopped = true;
            return false;
        }

        if (graph.goalsMet()) return this.enumerateSatisfied(graph, remaining, depth, previous, stats);

        const rem = Math.max(0, remaining);
        const h1 = graph.stateHash1, h2 = graph.stateHash2;
        const pointCount = graph.points.length;
        const elementCount = graph.elements.length;

        if (this.transposition.wasFailed(h1, h2, pointCount, elementCount, rem)) {
            stats.transpositionPruned++;
            return false;
        }
        if (remaining === 0) {
            this.transposition.storeFailed(h1, h2, pointCount, elementCount, rem);
            return false;
        }

        const missingGoalElements = graph.missingDistinctGoalElementCount();
        if (missingGoalElements > remaining) {
            stats.goalElementLowerBoundPruned++;
            this.transposition.storeFailed(h1, h2, pointCount, elementCount, rem);
            return false;
        }

        // v12：这里**不再**用「标量支撑数 / 目标此刻能不能画出来」当必要条件 ——
        //   · 「给每个缺的目标元素各留一步之后，剩余步数还得够给每个目标点补两条支撑」这条联合下界
        //     在 SamePoint 只保证坐标 EPS 盒、不保证代入残差的情形下会误剪（v10 的老问题）；
        //   · 「缺的目标元素此刻能不能直接画出来」同样只是标量判据。
        // 只保留「缺元素数 ≤ 剩余步」这条按定义成立的界，真正的可行性交给按已知点对的真实构造与求交检查。
        // 见 C++ solver.hpp 的 DFS 注释「Scalar support counts … are not necessary conditions」

        // 标量支撑数只用来**挑反向搜索的候选**（提示），既不否决通用已知点对候选，也不代表尾部已穷尽
        const forcedTailPoints = [];
        if (remaining <= 2 && graph.goalPoints.length) {
            graph.collectForcedTailPointIndices(remaining, forcedTailPoints);
        }

        if (missingGoalElements === remaining && missingGoalElements > 0) {
            const found = this.searchForcedGoalTail(graph, remaining, depth, previous, forcedTailPoints, stats);
            if (!found && !this.timedOut) {
                this.transposition.storeFailed(h1, h2, pointCount, elementCount, rem);
            }
            return found;
        }

        if (remaining === 1) {
            // 只剩一步：先走反向点补全快路径（**只认成功**）。失败不等于穷尽 ——
            // 反向几何固定的是输入坐标，而被接受的交点可以落在它 EPS 盒内的任意位置；
            // 所以失败后必须回退到真实的已知点对流（带求交预览），不能直接宣判无解
            // （C++ 同一处：SearchOneStepPointTail 失败后 return StreamCandidates(...)）
            if (this.searchOneStepPointTail(graph, depth, previous, forcedTailPoints, stats)) return true;
            if (this.timedOut) return false;
            const found = this.streamCandidates(graph, remaining, depth, previous, stats);
            if (!found && !this.timedOut) {
                this.transposition.storeFailed(h1, h2, pointCount, elementCount, rem);
            }
            return found;
        }

        let found = false;
        if (this.lowMemory) {
            // 反向强制点尾部也是快路径：没找着就继续通用流式枚举，不能就此收工
            if (remaining === 2 && forcedTailPoints.length
                && this.streamForcedPointTailCandidates(graph, remaining, depth, previous, forcedTailPoints, stats)) {
                return true;
            }
            if (this.timedOut) return false;
            found = this.streamCandidates(graph, remaining, depth, previous, stats);
        } else {
            const candidates = this.generateUniqueCandidates(graph, stats);
            if (this.timedOut) return false;
            const preCtx = this.buildPreApplyContext(graph, remaining);
            for (const candidate of candidates) {
                if (this.checkTimeout()) return false;
                const e = graph.makeCandidate(candidate);
                if (this.symmetryPruned(graph, candidate, e, depth, previous, stats)) continue;
                // 这里原来还有两条「提示型」剪枝，v12 一并去掉了：
                //   · 强制点提示（强制点只是反向搜索的候选提示，不能否决真实的已知点对构造）
                //   · 「末步非目标元素」——末步那一个元素完全可能靠**交出新点**满足目标点，
                //     却被 goalPriority 判成无关元素剪掉
                // generateUniqueCandidates 已经保证 e 在本节点是新元素
                if (this.tryCandidate(graph, e, remaining, depth, stats, preCtx)) {
                    found = true;
                    break;
                }
            }
        }

        if (!found && !this.timedOut) {
            this.transposition.storeFailed(h1, h2, pointCount, elementCount, rem);
        }
        return found;
    }

    /**
     * 单线程搜索入口 过程函数
     * @returns {boolean} 是否达到要求的解数（收够即为 true，中途超时返回 false）
     */
    search(graph, limit, stats) {
        this.timedOut = false;
        this.timeoutPollCounter = 1023;
        this.parallelControl = null;
        this.frontierTaskSink = null;
        this.frontierStopped = false;
        this.deadline = SOLVER_NOW() + this.timeLimitSeconds * 1000;
        // 进度计数从头开始（探测那几个数由调用方在搜索前设好）
        this.progressTasksSeen = 0;
        this.progressCompletedNodes = 0;
        this.progressLastBoundaryNodes = 0;
        this.progressLastAt = 0;

        this.streamSeen = new Array(limit + 1);
        for (let i = 0; i <= limit; i++) this.streamSeen[i] = new BoundedElementSet();
        if (graph.gridMode && graph.gridFast) {
            this.gridSeen = new Array(limit + 1);
            for (let i = 0; i <= limit; i++) this.gridSeen[i] = new ExactGridLineCache();
        }
        if (this.lowMemory) this.streamSeen.forEach(set => set.configure(this.streamDedupEntries));
        if (graph.goalPoints.length) this.oneStepSeen.configure(Math.max(this.streamDedupEntries, 4096));

        // 普通单线程路径沿用原版置换表策略：开了对称剪枝就不用（否则状态哈希不成立）
        this.transposition.configure(this.symmetry ? 0 : this.ttBytes);
        graph.setStateHashingEnabled(this.transposition.enabled());
        return this.dfs(graph, limit, 0, null, stats);
    }

    /**
     * 产出搜索树的前缀任务 过程函数（并行用，对应 C++ 版 bs_v8 的 ProduceFrontierTasks）
     * 按普通 DFS 顺序走到 splitDepth 层，每到一个前缀就把当前图交给 sink（sink 里取走
     * 「initialElementCount 之后新作的那些元素」就是任务的前缀）。
     * sink 返回 false 表示够了（sink 里自己收住），遍历随即停下。
     * 与 C++ 版一致：这一趟不收集解、不用置换表（并行任务之间不共享失败状态）
     * @param {Graph} graph
     * @param {number} limit
     * @param {Object} stats
     * @param {(graph: Graph) => boolean} sink
     * @param {number} splitDepth
     * @returns {boolean}
     */
    produceFrontierTasks(graph, limit, stats, sink, splitDepth) {
        this.timedOut = false;
        this.timeoutPollCounter = 1023;
        this.parallelControl = null;
        this.frontierTaskSink = sink;
        this.frontierDepth = Math.max(1, splitDepth | 0);
        this.frontierStopped = false;
        this.frontierProbeMode = false;
        this.deadline = SOLVER_NOW() + this.timeLimitSeconds * 1000;

        this.streamSeen = new Array(limit + 1);
        for (let i = 0; i <= limit; i++) this.streamSeen[i] = new BoundedElementSet();
        if (graph.gridMode && graph.gridFast) {
            this.gridSeen = new Array(limit + 1);
            for (let i = 0; i <= limit; i++) this.gridSeen[i] = new ExactGridLineCache();
        }
        if (this.lowMemory) this.streamSeen.forEach(set => set.configure(this.streamDedupEntries));
        if (graph.goalPoints.length) this.oneStepSeen.configure(Math.max(this.streamDedupEntries, 4096));

        this.transposition.configure(0);
        graph.setStateHashingEnabled(false);
        const found = this.dfs(graph, limit, 0, null, stats);
        this.frontierTaskSink = null;
        return found;
    }

    /**
     * 搜索一个独占的前缀 过程函数（并行用，对应 C++ 版 bs_v8 的 SearchPrefixTask）
     * 把前缀里的元素依次重放上去（点的新生步数、上一步的操作键都靠重放还原），再从那里 DFS。
     * 与 C++ 版一致：并行任务不用置换表，去重表是本任务私有的（避免跨任务共享失败状态）
     * @param {Graph} graph
     * @param {number} limit
     * @param {Object[]} prefixElements 前缀里新作的那些元素
     * @param {Object} stats
     * @returns {boolean}
     */
    searchPrefixTask(graph, limit, prefixElements, stats) {
        this.timedOut = false;
        this.timeoutPollCounter = 1023;
        this.parallelControl = null;
        this.frontierTaskSink = null;
        this.frontierStopped = false;
        this.frontierProbeMode = false;
        this.deadline = SOLVER_NOW() + this.timeLimitSeconds * 1000;

        if (this.streamSeen.length !== limit + 1) {
            this.streamSeen = new Array(limit + 1);
            for (let i = 0; i <= limit; i++) this.streamSeen[i] = new BoundedElementSet();
            if (graph.gridMode && graph.gridFast) {
                this.gridSeen = new Array(limit + 1);
                for (let i = 0; i <= limit; i++) this.gridSeen[i] = new ExactGridLineCache();
            }
            if (this.lowMemory) this.streamSeen.forEach(set => set.configure(this.streamDedupEntries));
            if (graph.goalPoints.length) this.oneStepSeen.configure(Math.max(this.streamDedupEntries, 4096));
        }
        this.transposition.configure(0);
        graph.setStateHashingEnabled(false);

        let previous = null;
        let depth = 0;
        for (const element of prefixElements || []) {
            if (this.checkTimeout()) return false;
            // 防御：合法的重放前缀不会撞上已存元素
            if (graph.hasElement(element)) return false;
            graph.applyKnownNew(element, depth + 1);
            previous = makeOperationKey(element);
            depth++;
        }
        return this.dfs(graph, Math.max(0, limit - depth), depth, previous, stats);
    }

    transpositionBytes() {
        return this.transposition.bytes();
    }

    isTimedOut() {
        return this.timedOut;
    }
}
