/**
 * bs-solver.js —— 搜索主体（移植自 bs_v8.cpp 的 Solver 类）
 *
 * 搜索目标：在最多 limit 步（每步新作一条直线或圆）内，作出所有目标直线/圆/点。
 * 移植时保留了原版的全部剪枝策略：
 *   · 相邻两步的偏序（对称剪枝，靠 OperationKey 比较）
 *   · 缺要素个数下界（每次作图最多新增一个元素）
 *   · 目标点联合下界（先给每个缺的目标元素预留一步，再看剩下的够不够补目标点的两条支撑）
 *   · 末段强制目标 / 末段单步点补全 / 反向生成候选
 *   · 预先检查（最后一步的目标能否被当前候选补齐前提）
 * 唯一未移植的是并行与置换表之外的 C++ 线程调度（JS 单线程），因此只保留 Search()；
 * 结构上保留 ProduceFrontierTasks/SearchPrefixTask 所需的字段，方便以后用嵌套 Worker 并行。
 */

/* global EPS, IS_ZERO, SQ, SAME_ELEMENT, SAME_POINT, TYPE_LINE, TYPE_CIRCLE, NO_BOUND,
   Graph, BoundedElementSet, TranspositionTable, SolutionCollector, ExactGridLineCache,
   makeOperationKey, compareOperationKey, BoundedElementSet */

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
        this.oneStepSeen = new BoundedElementSet();
        this.transposition = new TranspositionTable();
        this.parallelControl = null;
        this.solutionCollector = null;
        this.frontierTaskSink = null;
        this.frontierDepth = 3;
        this.frontierStopped = false;
        this.frontierProbeMode = false;
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
     * 找出「一个」能用现有已知点作出目标元素的候选 过程函数
     * 同一几何元素的不同点对表示会走到同一个状态，找到第一个对称可行的即可
     */
    findGoalConstructionCandidate(graph, goal, depth, previous, forcedTailPoints, stats) {
        const n = graph.points.length;

        if (goal.type === TYPE_LINE) {
            if (this.toolType === 0) return null;
            let firstHit = -1;
            for (let i = 0; i < n; i++) {
                if (!graph.pointOnElement(graph.points[i], goal)) continue;
                if (firstHit < 0) {
                    firstHit = i;
                    continue;
                }
                // 第一个命中点分别与后面每个命中点配对，作出的都是同一条直线
                stats.rawCandidates++;
                const candidate = {i: firstHit, j: i, tool: 2};
                const e = graph.makeCandidate(candidate);
                if (!graph.candidatePassesForcedTailPoints(e, forcedTailPoints)) {
                    stats.forcedPointTailPruned++;
                    return null;
                }
                if (this.symmetryPruned(graph, candidate, e, depth, previous, stats)) continue;
                stats.uniqueCandidates++;
                return candidate;
            }
            return null;
        }

        if (goal.type === TYPE_CIRCLE) {
            if (this.toolType === 1 || IS_ZERO(goal.c)) return null;
            let centerId = -1;
            const center = {x: goal.a, y: goal.b};
            for (let i = 0; i < n; i++) {
                if (SAME_POINT(graph.points[i], center)) {
                    centerId = i;
                    break;
                }
            }
            if (centerId < 0) return null;

            for (let p = 0; p < n; p++) {
                if (p === centerId || !graph.pointOnElement(graph.points[p], goal)) continue;
                stats.rawCandidates++;
                const i = Math.min(centerId, p);
                const j = Math.max(centerId, p);
                const tool = (i === centerId) ? 0 : 1;
                const candidate = {i, j, tool};
                const e = graph.makeCandidate(candidate);
                if (!SAME_ELEMENT(e, goal)) continue;
                if (!graph.candidatePassesForcedTailPoints(e, forcedTailPoints)) {
                    stats.forcedPointTailPruned++;
                    return null;
                }
                if (this.symmetryPruned(graph, candidate, e, depth, previous, stats)) continue;
                stats.uniqueCandidates++;
                return candidate;
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

        // 给每个缺的目标元素各留一步之后，剩下的步数还得够给每个目标点补足两条支撑
        const auxiliaryBudget = remaining - missingGoalElements;
        if (graph.requiredAuxiliaryStepsForGoalPoints() > auxiliaryBudget) {
            stats.jointPointLowerBoundPruned++;
            this.transposition.storeFailed(h1, h2, pointCount, elementCount, rem);
            return false;
        }

        // 剩余步数正好等于缺的目标元素数时，每一步都必须是目标元素；一个都作不出来就是死结点
        if (missingGoalElements === remaining && missingGoalElements > 0) {
            const anyDrawable = remaining === 1
                ? graph.missingGoalElementsDrawableInOneStep(this.toolType)
                : graph.anyMissingGoalElementDrawableNow(this.toolType);
            if (!anyDrawable) {
                stats.exactReachabilityPruned++;
                this.transposition.storeFailed(h1, h2, pointCount, elementCount, rem);
                return false;
            }
        }

        // 预先标出「最后一两步都必须过」的目标点，避免每个候选都去扫一遍元素表
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
            const found = this.searchOneStepPointTail(graph, depth, previous, forcedTailPoints, stats);
            if (!found && !this.timedOut) {
                this.transposition.storeFailed(h1, h2, pointCount, elementCount, rem);
            }
            return found;
        }

        let found = false;
        if (this.lowMemory) {
            if (remaining === 2 && forcedTailPoints.length) {
                found = this.streamForcedPointTailCandidates(graph, remaining, depth, previous, forcedTailPoints, stats);
            } else {
                found = this.streamCandidates(graph, remaining, depth, previous, stats);
            }
        } else {
            const candidates = this.generateUniqueCandidates(graph, stats);
            if (this.timedOut) return false;
            const preCtx = this.buildPreApplyContext(graph, remaining);
            for (const candidate of candidates) {
                if (this.checkTimeout()) return false;
                const e = graph.makeCandidate(candidate);
                if (this.symmetryPruned(graph, candidate, e, depth, previous, stats)) continue;
                if (forcedTailPoints.length && !this.tailCandidateAllowed(graph, e, forcedTailPoints, stats)) continue;
                if (remaining === 1 && !graph.isGoalDirected(e)) {
                    stats.finalStepPruned++;
                    continue;
                }
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

    transpositionBytes() {
        return this.transposition.bytes();
    }

    isTimedOut() {
        return this.timedOut;
    }
}
