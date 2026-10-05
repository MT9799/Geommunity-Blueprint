/**
 * bs-heuristic.js —— 启发式搜索（beam + 组合重启）移植
 *
 * 对应 C++ v12 的 src/heuristic.hpp。与穷尽式 DFS 的分工必须说清楚：
 *   · DFS（bs-solver.js）能证明「搜完没有解」；
 *   · 这里只是**找一个解**的启发式 —— 跑完一轮重启**不代表**穷尽，
 *     所以调用方只能报「启发式已停止」，绝不能报「已搜尽」。
 * 评分永远只是排序依据，**不是成功判据**：每一步真正入图、以及最终的 goalsMet 都由内核判定。
 *
 * 已移植（与 C++ 同名同参数）：
 *   · beam 逐层展开：beamWidth / branchLimit / 每父节点配额（配额用于自适应风格）
 *   · 候选评分：CheapScore / WholeScore / PrerequisitePreview
 *     权重：目标 10000、支撑 350、前置 400、方向 35、邻近 8、成长 10
 *   · 多样性池：按分数取精英 + 按随机排名取一批（C++ DiversePool 的两堆结构）
 *   · 组合式重启：4 种风格轮换（权重抖动，支撑型 / 前置型 / 方向型），乱序种子
 *   · 尾助搜：剩余 ≤ 2 步时，对前 tailCandidates 个 beam 条目各跑一小段真 DFS（只认成功）
 *   · 候选按**原始位**去重（CandidateSeen；不做 CleanZero / EPS 分桶）
 *   · 家族池 / 新颖度池（family_pool.hpp / novelty_pool.hpp）：同一构造族只留一个代表，
 *     自适应风格按「分数精英 3/4 + 家族随机排名 1/4」保种
 * 尚未移植（下一步，见 CHANGELOG / TODO.md 2.1）：
 *   结构会合与链式会合（rendezvous / chain_join）、反向地标（landmarks）、
 *   等半径 / 直径 / 镜像 / 位似 / 切线探针、单圆圆心收尾、
 *   覆盖线程（coverage threads）、BridgeScore 的样式 3 前瞻、证书与自检。
 */

/* global IS_ZERO, SQ, SAME_POINT, SAME_ELEMENT, TYPE_CIRCLE, TYPE_LINE,
   Graph, SolutionCollector, Solver, makeSearchStats */

/** 评分权重（与 C++ heuristic.hpp 的 Weights 一致） */
const HEURISTIC_BASE_WEIGHTS = {
    goal: 10000.0,
    support: 350.0,
    prerequisite: 400.0,
    direction: 35.0,
    proximity: 8.0,
    growth: 10.0,
};

/** 默认参数（与 C++ HeuristicOptions 一致） */
const HEURISTIC_DEFAULT_OPTIONS = {
    beamWidth: 64,
    branchLimit: 96,
    restarts: 0,          // 0 = 一直重启到时间到，除非整轮没有任何截断
    seed: 1,
    tailSeconds: 0.02,
    tailCandidates: 4,
    adaptive: true,
    structural: true,
    prerequisites: true,
    // -1 自动：多 worker 时可能留一个跑 DFS 兜底（见 run 里的覆盖线程分支）。
    // 单线程构建下这一支不会触发（threads 恒为 1）
    coverageThreads: -1,
    threads: 1,
    // 反向地标：默认关，自适应风格会自动在某些重启上开（见 configurePortfolio）
    landmarks: false,
};

const HEURISTIC_NOW = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const HEURISTIC_MASK64 = (1n << 64n) - 1n;

/** SplitMix64（与内核哈希同源；这里自带一份，免得依赖别处的实现细节） */
function heuristicSplitMix64(value) {
    let v = (value + 0x9e3779b97f4a7c15n) & HEURISTIC_MASK64;
    v = ((v ^ (v >> 30n)) * 0xbf58476d1ce4e5b9n) & HEURISTIC_MASK64;
    v = ((v ^ (v >> 27n)) * 0x94d049bb133111ebn) & HEURISTIC_MASK64;
    return (v ^ (v >> 31n)) & HEURISTIC_MASK64;
}

/** 可复现随机源（C++ heuristic_detail::Random） */
class HeuristicRandom {
    constructor(seed) {
        this.state = BigInt(Math.trunc(seed) || 1) & HEURISTIC_MASK64;
    }
    next() {
        this.state = (this.state + 0x9e3779b97f4a7c15n) & HEURISTIC_MASK64;
        return heuristicSplitMix64(this.state);
    }
    unit() {
        return Number(this.next() >> 11n) * 1.1102230246251565e-16; // 2^-53，与 C++ 一致
    }
}

const RAW_VIEW = new Float64Array(1);
const RAW_WORDS = new Uint32Array(RAW_VIEW.buffer);

/** 一个浮点数的**原始位**（不做 CleanZero，也不按 EPS 分桶） 过程函数 */
function rawWordKey(value) {
    RAW_VIEW[0] = value;
    return RAW_WORDS[0] + ':' + RAW_WORDS[1];
}

/**
 * 候选按原始位去重 过程函数（C++ CandidateSeen）
 * 定长表 + 直接覆盖：碰撞只会漏判一个重复，绝不会丢掉不同的候选
 */
class HeuristicCandidateSeen {
    constructor(size = 4096) {
        this.slots = new Array(size).fill(null);
        this.mask = size - 1;
    }
    reset() {
        this.slots.fill(null);
    }
    duplicate(element) {
        const key = rawWordKey(element.a) + '|' + rawWordKey(element.b) + '|' +
            rawWordKey(element.c) + '|' + element.type;
        const hash = heuristicSplitMix64(BigInt(element.type) ^ BigInt(key.length));
        const index = Number((hash ^ BigInt((key.charCodeAt(0) + key.charCodeAt(key.length - 1)))) & BigInt(this.mask));
        if (this.slots[index] === key) return true;
        this.slots[index] = key;
        return false;
    }
}

/** 候选/状态的排序：先比分数，再比先后（与 C++ 的 Better 一致） 过程函数 */
function heuristicBetter(left, right) {
    return left.score > right.score || (left.score === right.score && left.serial < right.serial);
}

/**
 * 两堆有界池：分数最好的那批 + 随机排名的那批 过程函数（C++ DiversePool）
 * 两堆互不重叠 —— 随机那份专门留出位置给「分数不亮眼但方向新颖」的候选
 * @param {string} counter 丢弃计数记到哪个 metrics 字段上（候选池 candidateDiscarded，beam 池 beamDiscarded）
 */
class HeuristicPool {
    constructor(capacity, diverseCount, metrics, counter) {
        this.capacity = Math.max(1, capacity);
        this.diverseCount = Math.max(0, Math.min(diverseCount, this.capacity));
        this.metrics = metrics;
        this.counter = counter || 'discarded';
        this.items = [];
    }
    offer(item) {
        this.items.push(item);
        // 只是内存上限，不是搜索剪枝：超了就丢掉分数最差的那些
        if (this.items.length > 8 * this.capacity) {
            this.items.sort((left, right) => right.score - left.score || left.serial - right.serial);
            this.items.length = this.capacity;
        }
    }
    take() {
        const sorted = this.items.slice().sort((left, right) =>
            right.score - left.score || left.serial - right.serial);
        const eliteCount = this.capacity - this.diverseCount;
        const elite = sorted.slice(0, eliteCount);
        const rest = sorted.slice(eliteCount);
        rest.sort((left, right) => (right.diversity > left.diversity ? 1 : -1));
        const diverse = rest.slice(0, this.diverseCount);
        const discarded = sorted.length - elite.length - diverse.length;
        if (discarded > 0) {
            this.metrics[this.counter] += discarded;
            this.metrics.poolLimited = true;
        }
        const result = elite.concat(diverse);
        this.items = [];
        return result;
    }
}

/** 一个元素的**原始位**键 过程函数（C++ RawKey：类型 + 三个系数的位模式） */
function rawElementKey(element) {
    return element.type + '|' + rawWordKey(element.a) + '|' + rawWordKey(element.b) + '|' +
        rawWordKey(element.c);
}

/**
 * 构造族 过程函数（C++ ConstructionFamily）
 * 「前缀 + 这个候选」的元素**集合**（排序后）—— 家族只表示多样性，**不表示**这两个有序状态
 * 可以互相替换（顺序不同的前缀仍是同一个族）
 */
function constructionFamily(prefix, element) {
    const keys = prefix.map(rawElementKey);
    keys.push(rawElementKey(element));
    keys.sort();
    return keys.join(',');
}

/**
 * 按「构造族」去重的池 过程函数（C++ FamilyPool）
 * 同一族只留分数最好的那一个，容量满时替换最差的。家族合并只计数、不当剪枝依据
 * （EPS 相近的键、哈希碰撞都会各算一族，绝不会因此丢掉不同的状态）
 */
class HeuristicFamilyPool {
    constructor(capacity, metrics) {
        this.capacity = capacity;
        this.metrics = metrics;
        this.records = new Map();
    }
    drop(merged) {
        this.metrics.beamDiscarded++;
        if (merged) this.metrics.familyMerged++;
        this.metrics.poolLimited = true;
    }
    offer(child, familyKey) {
        const existing = this.records.get(familyKey);
        if (existing) {
            if (heuristicBetter(child, existing)) this.records.set(familyKey, child);
            this.drop(true);
            return;
        }
        if (!this.capacity) {
            this.drop(false);
            return;
        }
        if (this.records.size < this.capacity) {
            this.records.set(familyKey, child);
            return;
        }
        let worstKey = null;
        let worst = null;
        for (const entry of this.records) {
            if (!worst || heuristicBetter(worst, entry[1])) {
                worst = entry[1];
                worstKey = entry[0];
            }
        }
        if (heuristicBetter(child, worst)) {
            this.records.delete(worstKey);
            this.records.set(familyKey, child);
        }
        this.drop(false);
    }
    take() {
        const result = Array.from(this.records.values())
            .sort((left, right) => right.score - left.score || left.serial - right.serial);
        this.records.clear();
        return result;
    }
}

/**
 * 「新颖度」池 过程函数（C++ NoveltyPool）
 * 名额分成两份：**分数精英**（容量 3/4）与**家族随机排名**（吃满容量）。
 * 随机签按家族键固定 —— 同一个家族永远同一个签，换作图顺序买不到额外的彩票；
 * 第一次 Offer 的 diversity 当盐（每次重启换一个盐）。
 * 这里的选取在 take() 时一次算出来（C++ 是增量维护两个有序集合），结果口径一致
 */
class HeuristicNoveltyPool {
    constructor(capacity, metrics) {
        this.capacity = capacity;
        this.eliteLimit = capacity - (capacity > 1 ? Math.max(1, Math.floor(capacity / 4)) : 0);
        this.randomLimit = capacity > 1 ? capacity : 0;
        this.metrics = metrics;
        this.records = new Map();
        this.salt = 0;
        this.seeded = false;
    }
    priority(familyKey) {
        let rank = heuristicSplitMix64(BigInt(this.salt) ^ heuristicSplitMix64(BigInt(familyKey.length)));
        for (let i = 0; i < familyKey.length; i++) {
            rank = heuristicSplitMix64(rank ^ BigInt(familyKey.charCodeAt(i)));
        }
        return rank;
    }
    drop(merged) {
        this.metrics.beamDiscarded++;
        if (merged) this.metrics.familyMerged++;
        this.metrics.poolLimited = true;
    }
    offer(child, familyKey) {
        if (!this.seeded) {
            // 第一次 Offer 的 diversity 当盐：换一轮重启，家族随机排名整体换一批
            this.salt = Number(child.diversity & 0xffffffffn);
            this.seeded = true;
        }
        const existing = this.records.get(familyKey);
        if (existing) {
            // 同一族的重复代表只按分数与先后竞争，**不比**各自的 diversity（免得靠乱序多中签）
            if (heuristicBetter(child, existing)) {
                existing.score = child.score;
                existing.serial = child.serial;
            }
            this.drop(true);
            return;
        }
        if (!this.capacity) {
            this.drop(false);
            return;
        }
        this.records.set(familyKey, Object.assign({}, child, {
            priority: this.priority(familyKey),
            elite: false,
        }));
    }
    take() {
        const all = Array.from(this.records.values());
        const selected = [];
        const elite = all.slice().sort((left, right) =>
            right.score - left.score || left.serial - right.serial).slice(0, this.eliteLimit);
        for (const record of elite) {
            record.elite = true;
            selected.push(record);
        }
        const rest = all.filter(record => !record.elite)
            .sort((left, right) => (left.priority > right.priority ? -1 : left.priority < right.priority ? 1 : 0));
        for (const record of rest) {
            if (selected.length >= Math.max(this.randomLimit, this.capacity)) break;
            selected.push(record);
        }
        // 没被选中的代表算作丢弃（C++ 的 Take 里 extras 也是这么计的）
        if (selected.length < all.length) {
            this.metrics.beamDiscarded += all.length - selected.length;
            this.metrics.poolLimited = true;
        }
        this.records.clear();
        this.seeded = false;
        selected.sort((left, right) => right.score - left.score || left.serial - right.serial);
        return selected;
    }
}

/** 打分辅助：把「距离」压成 (0,1] 的相似度 过程函数 */
function heuristicSmooth(distance) {
    return isFinite(distance) && distance >= 0.0 ? 1.0 / (1.0 + distance) : 0.0;
}

/** 两个点有多近 过程函数（按目标点的量级归一） */
function heuristicPointNear(a, b) {
    const scale = 1.0 + Math.abs(b.x) + Math.abs(b.y);
    return heuristicSmooth((Math.abs(a.x - b.x) + Math.abs(a.y - b.y)) / scale);
}

/** 点离元素有多近 过程函数 */
function heuristicCurveNear(p, e) {
    if (e.type === TYPE_CIRCLE) {
        const d = SQ(p.x - e.a) + SQ(p.y - e.b);
        return heuristicSmooth(Math.abs(d - e.c) / (1.0 + Math.abs(e.c)));
    }
    const scale = 1.0 + Math.abs(e.a) + Math.abs(e.b);
    return heuristicSmooth(Math.abs(e.a * p.x + e.b * p.y - e.c) / scale);
}

/** 两条载线的方向关系打分 过程函数（平行或垂直都可能给出有用的交点） */
function heuristicDirectionScore(a, b) {
    if (a.type === TYPE_CIRCLE || b.type === TYPE_CIRCLE) return 0.0;
    const na = Math.hypot(a.a, a.b);
    const nb = Math.hypot(b.a, b.b);
    if (!(na > 0.0) || !(nb > 0.0) || !isFinite(na) || !isFinite(nb)) return 0.0;
    const cosine = Math.abs((a.a / na) * (b.a / nb) + (a.b / na) * (b.b / nb));
    return Math.max(cosine * cosine, (1.0 - cosine) * (1.0 - cosine));
}

/** 停止信号（不是错误）：时间到、外部掐断、或者解已收够） */
class HeuristicStop {}

/* ---------------- 反向地标（C++ BackwardLandmarks） ---------------- */

/**
 * 有界采样 过程函数（C++ BackwardLandmarks::Scan）
 * 先取固定前缀，再均匀取样（含最后一项）；点数/元素数的扫描都有上界，
 * 大图上也不会有 k*n 溢出。采样可能漏掉有用的几何 —— 那只会少一点加分，绝不会丢候选。
 */
function landmarkScan(begin, end, cap, visit) {
    begin = Math.min(begin, end);
    const n = end - begin;
    const count = Math.min(n, cap);
    if (!count) return;
    if (count === n) {
        for (let i = begin; i < end; i++) if (visit(i)) return;
        return;
    }
    const head = Math.min(32, Math.floor(count / 2));
    for (let k = 0; k < head; k++) if (visit(begin + k)) return;
    const rest = count - head;
    const span = n - head - 1;
    for (let k = 0; k < rest; k++) {
        const offset = rest === 1 ? span
            : k * Math.floor(span / (rest - 1)) + Math.floor(k * (span % (rest - 1)) / (rest - 1));
        if (visit(begin + head + offset)) return;
    }
}

/**
 * 反向地标 过程函数（C++ BackwardLandmarks）
 * **纯加分特征**：不是操作来源、不是可达性判定、更不是剪枝或成功判据；
 * 虚拟点 / 虚拟载线**绝不**插入图里。在初始图上 Build 一次，之后只读。
 */
class BackwardLandmarks {
    constructor() {
        this.maxAnchors = 64;
        this.maxGuides = 64;
        this.maxProbes = 128;
        this.maxPointScan = 512;
        this.anchors = [];   // {point, weight}
        this.guides = [];    // {curve, weight}
        this.probes = 0;
        this.initialElementCount = 0;
    }
    /** 点的「有用程度」数组里只留最大的三个 过程函数 */
    static include(best, value) {
        for (let i = 0; i < 3; i++) {
            if (value > best[i]) {
                const swap = best[i];
                best[i] = value;
                value = swap;
            }
        }
    }
    static total(best) {
        return best[0] + 0.5 * best[1] + 0.25 * best[2];
    }
    static bounded(score) {
        return isFinite(score) ? Math.min(8.0, Math.max(0.0, score)) : 0.0;
    }
    static finitePoint(p) {
        return isFinite(p.x) && isFinite(p.y);
    }
    static finiteElement(e) {
        if (!isFinite(e.a) || !isFinite(e.b) || !isFinite(e.c)) return false;
        return e.type === TYPE_CIRCLE ? e.c > 0.0 : (e.a !== 0.0 || e.b !== 0.0);
    }
    /** 这个点是不是（采样范围内的）已知点 过程函数 */
    known(graph, p, begin) {
        let found = false;
        landmarkScan(begin, graph.points.length, this.maxPointScan, i => {
            found = SAME_POINT(p, graph.points[i]);
            return found;
        });
        return found;
    }
    /** 这个元素是不是（采样范围内的）已存元素 过程函数 */
    present(graph, e, begin) {
        let found = false;
        landmarkScan(begin, graph.elements.length, this.maxPointScan, i => {
            found = graph.sameStoredElement(e, graph.elements[i]);
            return found;
        });
        return found;
    }
    anchorAt(graph, p, weight) {
        if (!isFinite(p.x) || !isFinite(p.y)) return;
        if (typeof graph.pointAllowed === 'function' && !graph.pointAllowed(p)) return;
        for (const anchor of this.anchors) {
            if (SAME_POINT(p, anchor.point)) {
                anchor.weight = Math.max(anchor.weight, weight);
                return;
            }
        }
        if (this.anchors.length < this.maxAnchors) {
            this.anchors.push({point: p, weight: weight});
            return;
        }
        let slot = 0;
        for (let i = 1; i < this.anchors.length; i++) {
            if (this.anchors[i].weight < this.anchors[slot].weight) slot = i;
        }
        if (weight <= this.anchors[slot].weight) return;
        this.anchors[slot] = {point: p, weight: weight};
    }
    guideOn(e, weight) {
        if (!BackwardLandmarks.finiteElement(e)) return;
        for (const guide of this.guides) {
            if (SAME_ELEMENT(e, guide.curve)) {
                guide.weight = Math.max(guide.weight, weight);
                return;
            }
        }
        if (this.guides.length < this.maxGuides) {
            this.guides.push({curve: e, weight: weight});
            return;
        }
        let slot = 0;
        for (let i = 1; i < this.guides.length; i++) {
            if (this.guides[i].weight < this.guides[slot].weight) slot = i;
        }
        if (weight <= this.guides[slot].weight) return;
        this.guides[slot] = {curve: e, weight: weight};
    }
    /**
     * 在初始图上建一次地标 过程函数（C++ Build）
     * 工具：0 圆规 / 1 直尺 / 2 两者 / 3 网格直尺
     */
    build(initial, tools) {
        this.anchors = [];
        this.guides = [];
        this.probes = 0;
        this.initialElementCount = initial.elements.length;
        if (tools < 0 || tools > 3) return;
        if (!initial.goalPoints.length && !initial.goalElements.length) return;
        const lines = tools !== 0;
        const goals = [];
        const targets = [];
        const carriers = [];
        landmarkScan(0, initial.goalPoints.length, 16, i => {
            const p = initial.goalPoints[i];
            if (BackwardLandmarks.finitePoint(p) &&
                (typeof initial.pointAllowed !== 'function' || initial.pointAllowed(p)) &&
                !this.known(initial, p, 0)) {
                goals.push(p);
                this.anchorAt(initial, p, 1.0);
            }
            return false;
        });
        landmarkScan(0, initial.goalElements.length, 16, i => {
            const e = initial.goalElements[i];
            if (!BackwardLandmarks.finiteElement(e) || this.present(initial, e, 0)) return false;
            targets.push(e);
            if ((e.type === TYPE_LINE && lines) || (e.type === TYPE_CIRCLE && tools !== 1 && tools !== 3)) {
                this.guideOn(e, 1.0);
            }
            if (e.type === TYPE_CIRCLE) {
                const center = {x: e.a, y: e.b};
                if (!this.known(initial, center, 0)) this.anchorAt(initial, center, 1.0);
            }
            return false;
        });
        landmarkScan(0, initial.elements.length, 64, i => {
            carriers.push(initial.elements[i]);
            return false;
        });

        // 第一层：目标载线上「有用的点」（不是这条载线自己给出的点）。
        // 先圆/非网格几何，再轮到数量庞大的网格交点
        const isGrid = e => (typeof initial.isAutomaticGridLine === 'function'
            ? initial.isAutomaticGridLine(e) : false);
        for (let pass = 0; pass < 2; pass++) {
            for (const old of carriers) {
                if (isGrid(old) !== (pass === 1)) continue;
                for (const target of targets) {
                    initial.visitIntersections(target, old, p => {
                        if (BackwardLandmarks.finitePoint(p) && !this.known(initial, p, 0)) {
                            this.anchorAt(initial, p, 0.45);
                        }
                        return false;
                    });
                }
            }
        }

        let circles = 0;
        let joins = 0;
        for (const circle of carriers) {
            if (circle.type !== TYPE_CIRCLE || !BackwardLandmarks.finiteElement(circle)) continue;
            if (++circles > 8) break;
            const center = {x: circle.a, y: circle.b};
            const centerKnown = this.known(initial, center, 0);
            const rim = [];
            const opposite = [];
            const missing = [];
            landmarkScan(0, initial.points.length, this.maxPointScan, i => {
                const p = initial.points[i];
                if (BackwardLandmarks.finitePoint(p) && initial.pointOnElement(p, circle)) {
                    rim.push(p);
                    opposite.push({x: 2.0 * center.x - p.x, y: 2.0 * center.y - p.y});
                    const image = opposite[opposite.length - 1];
                    const absent = BackwardLandmarks.finitePoint(image) &&
                        (typeof initial.pointAllowed !== 'function' || initial.pointAllowed(image)) &&
                        !this.known(initial, image, 0);
                    missing.push(absent);
                }
                return rim.length >= 16;
            });
            for (let i = 0; i < rim.length; i++) {
                if (!missing[i]) continue;
                this.anchorAt(initial, opposite[i], 0.35);
                if (lines && centerKnown) {
                    this.guideOn(makeLineFromPoints(center, rim[i]), 0.4);
                }
            }
            for (const p of goals) {
                if (initial.pointOnElement(p, circle)) {
                    const oppositeGoal = {x: 2.0 * center.x - p.x, y: 2.0 * center.y - p.y};
                    if (BackwardLandmarks.finitePoint(oppositeGoal) && !this.known(initial, oppositeGoal, 0)) {
                        this.anchorAt(initial, oppositeGoal, 0.65);
                    }
                }
            }
            if (!lines || !centerKnown) continue;

            // 第二层：弦 H 与目标交于 Y；从已有圆周点 P 过 Y 的载线可能还需要一个对径点 U，
            // 过已知圆心的直径能把它暴露出来。这里把 H、那条直径、P-U、U 都奖励上。
            for (let i = 0; i < rim.length && this.probes < this.maxProbes; i++) {
                for (let j = i + 1; j < rim.length && this.probes < this.maxProbes; j++) {
                    this.probes++;
                    const chord = makeLineFromPoints(rim[i], rim[j]);
                    if (!BackwardLandmarks.finiteElement(chord)) continue;
                    const meet = y => {
                        if (!BackwardLandmarks.finitePoint(y)) return false;
                        if (typeof initial.pointAllowed === 'function' && !initial.pointAllowed(y)) return false;
                        if (this.known(initial, y, 0)) return false;
                        for (let u = 0; u < rim.length; u++) {
                            if (!missing[u]) continue;
                            for (let p = 0; p < rim.length; p++) {
                                if (joins++ >= 16384) return true;
                                if (SAME_POINT(y, rim[p]) || SAME_POINT(y, opposite[u])) continue;
                                const next = makeLineFromPoints(rim[p], opposite[u]);
                                if (!BackwardLandmarks.finiteElement(next) ||
                                    SAME_ELEMENT(chord, next) || !initial.pointOnElement(y, next)) continue;
                                this.anchorAt(initial, opposite[u], 1.8);
                                this.anchorAt(initial, y, 1.2);
                                this.guideOn(chord, 2.0);
                                this.guideOn(makeLineFromPoints(center, rim[u]), 1.75);
                                this.guideOn(next, 1.6);
                            }
                        }
                        return false;
                    };
                    for (const target of targets) {
                        if (joins >= 16384) break;
                        initial.visitIntersections(chord, target, meet);
                    }
                    for (const goal of goals) {
                        if (joins >= 16384) break;
                        if (initial.pointOnElement(goal, chord)) meet(goal);
                    }
                    if (joins >= 16384) break;
                }
                if (joins >= 16384) break;
            }
        }
    }
    /**
     * 给一条候选打分 过程函数（C++ ScoreCandidate）
     * apply 之前传 `g.points.length`（只算曲线本身）；真 apply 之后传 `mark.pointCount`
     *（新生出来的地标点也算）。返回无量纲的 [0,8] 加分，用的时候乘以前置权重。
     */
    scoreCandidate(g, e, pointBegin) {
        if (!BackwardLandmarks.finiteElement(e)) return 0.0;
        let curve = 0.0;
        let support = 0.0;
        const born = [0.0, 0.0, 0.0];
        for (const guide of this.guides) {
            if (SAME_ELEMENT(e, guide.curve)) curve = Math.max(curve, guide.weight);
        }
        for (const anchor of this.anchors) {
            if (pointBegin < g.points.length && this.known(g, anchor.point, pointBegin)) {
                BackwardLandmarks.include(born, anchor.weight);
            } else if (g.pointOnElement(anchor.point, e) && !this.known(g, anchor.point, 0)) {
                support = Math.max(support, 0.35 * anchor.weight);
            }
        }
        return BackwardLandmarks.bounded(curve + support + BackwardLandmarks.total(born));
    }
    /** 整张图的地标累计分 过程函数（C++ ScoreState） */
    scoreState(g, originalPointCount) {
        const points = [0.0, 0.0, 0.0];
        const curves = [0.0, 0.0, 0.0];
        for (const anchor of this.anchors) {
            if (this.known(g, anchor.point, originalPointCount)) {
                BackwardLandmarks.include(points, anchor.weight);
            }
        }
        for (const guide of this.guides) {
            if (this.present(g, guide.curve, this.initialElementCount)) {
                BackwardLandmarks.include(curves, guide.weight);
            }
        }
        return BackwardLandmarks.bounded(BackwardLandmarks.total(points) + BackwardLandmarks.total(curves));
    }
}

/* ---------------- 探针（probe）共用的守卫与工具 ---------------- */

/**
 * 探针父图的一致性检查 过程函数（C++ ValidateProbeParent）
 * 出生步数必须单调、坐标必须有限、深度不能溢出 —— 任何一条不成立就放弃这个探针
 * @returns {number} 父图已花的步数；-1 表示不合格
 */
function validateProbeParent(graph) {
    const depth = graph.elements.length - graph.initialElementCount;
    if (depth < 0 || graph.points.length !== graph.pointBirth.length) return -1;
    for (let i = 0; i < graph.points.length; i++) {
        const p = graph.points[i];
        if (!isFinite(p.x) || !isFinite(p.y)) return -1;
        if (graph.pointBirth[i] > depth) return -1;
        if (i && graph.pointBirth[i] < graph.pointBirth[i - 1]) return -1;
    }
    for (const e of graph.elements) {
        if (!isFinite(e.a) || !isFinite(e.b) || !isFinite(e.c)) return -1;
    }
    for (const p of graph.goalPoints) if (!isFinite(p.x) || !isFinite(p.y)) return -1;
    for (const e of graph.goalElements) {
        if (!isFinite(e.a) || !isFinite(e.b) || !isFinite(e.c)) return -1;
    }
    return depth;
}

/**
 * 应用一个探针元素 过程函数（C++ ApplyFiniteProbe）
 * 新出现的点必须有限、且落在允许域内，否则整个元素撤回去
 */
function applyFiniteProbe(graph, element, birth) {
    const before = graph.getMark();
    if (!graph.apply(element, birth)) return false;
    for (let i = before.pointCount; i < graph.points.length; i++) {
        const p = graph.points[i];
        if (!isFinite(p.x) || !isFinite(p.y) ||
            (typeof graph.pointAllowed === 'function' && !graph.pointAllowed(p))) {
            graph.rollback(before);
            return false;
        }
    }
    return true;
}

/** 找出「坐标就是 p」的已知点下标（没有则 -1） 过程函数（C++ 探针里的 find） */
function findPointIndex(graph, p) {
    for (let i = 0; i < graph.points.length; i++) {
        if (SAME_POINT(graph.points[i], p)) return i;
    }
    return -1;
}

/** 两个点下标 → 候选（a<b 时圆心/起点取 a） 过程函数（C++ tangent_detail::Pair） */
function pointCandidate(a, b, circle) {
    if (a < b) return {i: a, j: b, tool: circle ? 0 : 2};
    return {i: b, j: a, tool: circle ? 1 : 2};
}

/** 方向角（模 π，落在 [0, π)） 过程函数（C++ rendezvous_detail::DirectionOf） */
function rendezvousDirectionOf(a, b) {
    let value = Math.atan2(a.y - b.y, a.x - b.x);
    if (value < 0) value += Math.PI;
    if (value >= Math.PI) value -= Math.PI;
    return value;
}

/** 在按角度排好序的数组里找第一个 angle >= value 的位置 过程函数（二分） */
function rendezvousLowerBound(directions, value) {
    let low = 0;
    let high = directions.length;
    while (low < high) {
        const middle = (low + high) >> 1;
        if (directions[middle].angle < value) low = middle + 1;
        else high = middle;
    }
    return low;
}

/** 由两点构造一条直线元素 过程函数（C++ Element::FromPoints(..., Type::Line)） */
function makeLineFromPoints(a, b) {
    return makeElementFromCoefficients(b.y - a.y, a.x - b.x, a.x * b.y - a.y * b.x, TYPE_LINE);
}

/** 元素是不是「能用」的（有限 + 非退化） 过程函数（C++ tangent_detail::Valid） */
function validProbeElement(e) {
    if (!isFinite(e.a) || !isFinite(e.b) || !isFinite(e.c)) return false;
    if (e.type === TYPE_CIRCLE) return e.c > 0.0;
    return e.a !== 0.0 || e.b !== 0.0;
}

/**
 * 启发式搜索器 过程函数
 * 一次 run() 从根开始不断重启（每轮换一组权重与随机种子），直到时间到 / 收够解 /
 * 某一轮完全没有发生「候选或 beam 截断」（那说明这一轮把真实候选全装下了，再换个权重也没用）
 */
class HeuristicSolver {
    /**
     * @param {Graph} graph 起始图（会被克隆，不修改调用方的图）
     * @param {number} limit 步数上限
     * @param {number} toolType 0 圆规 / 1 直尺 / 2 两者
     * @param {Object} options 见 HEURISTIC_DEFAULT_OPTIONS
     * @param {SolutionCollector} collector 解收集器
     * @param {Object} control {stop, found, timedOut, deadline} 与页面/其他 worker 共享的停止信号
     */
    constructor(graph, limit, toolType, options, collector, control) {
        this.baseGraph = graph;
        this.limit = limit;
        this.toolType = toolType;
        this.options = Object.assign({}, HEURISTIC_DEFAULT_OPTIONS, options || {});
        this.collector = collector;
        this.control = control;
        this.deadline = control.deadline;
        this.random = new HeuristicRandom(this.options.seed);
        this.weights = Object.assign({}, HEURISTIC_BASE_WEIGHTS);
        this.seen = new HeuristicCandidateSeen();
        this.graph = graph.clone();
        this.root = this.graph.getMark();
        this.depth = 0;
        this.serial = 0;
        this.diversityDivisor = 4;
        this.adaptiveStyle = false;
        this.noveltyStyle = false;
        this.bridgeStyle = false;
        this.metrics = {
            restarts: 0, layers: 0, expanded: 0, generated: 0, evaluated: 0,
            beamDiscarded: 0, discarded: 0, familyMerged: 0, tailCalls: 0,
            beamSolutions: 0, helperSolutions: 0,
            // 反向地标（Build 出来的规模）
            landmarkAnchors: 0, landmarkGuides: 0, landmarkProbes: 0,
            // 探针族（切线 / 直径 / 镜像 / 等半径）
            prerequisiteCalls: 0, prerequisiteCompletions: 0, probeApplied: 0,
            radiusProbeCalls: 0, radiusProbePrefixes: 0, radiusProbeSolutions: 0, radiusProbeCapHits: 0,
            // 会合
            rendezvousCalls: 0, rendezvousProposals: 0, rendezvousReplays: 0, rendezvousSolutions: 0,
            // 后向链式会合（structuralCompletion 里 remaining == 4 那一档）
            chainCalls: 0, chainProposals: 0, chainReplays: 0, chainSolutions: 0,
            structuralCalls: 0, structuralEligible: 0,
            // 目标收尾（goal_finish）
            goalFinishCalls: 0, goalFinishSolutions: 0,
            // 点会合（point_join）
            pointJoinCalls: 0, pointJoinProposals: 0, pointJoinReplays: 0, pointJoinSolutions: 0,
            // 单圆圆心收尾（circle_center_finish）
            circleFinishSearches: 0, circleFinishCenters: 0, circleFinishSolutions: 0,
            peakBeam: 1, budgetLimited: false, poolLimited: false,
        };
        this.stats = makeSearchStats();
        this.onProgress = null;
        this.progressAt = 0;
        // 结构收尾的去重表与累计用时（C++ structureSeen_ / structuralSeconds_）
        this.structureSeen = new Set();
        this.structuralSeconds = 0.0;
        // 反向地标（纯加分特征，Build 一次后只读）
        this.landmarks = new BackwardLandmarks();
        this.landmarkStyle = false;
    }

    /** 时间 / 停止检查 过程函数（超时会把 timedOut 落到共享 control 上） */
    checkNow() {
        if (HEURISTIC_NOW() >= this.deadline) {
            if (!this.control.found) this.control.timedOut = true;
            this.control.stop = true;
            throw new HeuristicStop();
        }
        if (this.control.stop) throw new HeuristicStop();
    }

    /** 定期上报进度（只在「搜了多少节点」这个量上有意义，总量对启发式是未知的） 过程函数 */
    poll() {
        this.stats.nodes++;
        if (this.onProgress && HEURISTIC_NOW() - this.progressAt > 500) {
            this.progressAt = HEURISTIC_NOW();
            this.onProgress({nodes: this.stats.nodes, heuristic: true});
        }
        if ((this.stats.nodes & 1023) === 0) this.checkNow();
    }

    /** 点是否已经是已知点（启发式里用线性扫描；点集不大，够用） 过程函数 */
    hasPoint(point) {
        return this.graph.hasPoint(point);
    }

    /** 元素是否已存在 过程函数 */
    hasElement(element) {
        return this.graph.hasElement(element);
    }

    /**
     * 目标点有几个「支撑」 过程函数
     * 射线 / 线段与它的载线算**同一个**支撑（只用于打分，绝不当必要条件用）
     */
    supports(point) {
        let count = 0;
        let first = null;
        for (let i = 0; i < this.graph.elements.length; i++) {
            const e = this.graph.elements[i];
            if (!this.graph.pointOnElement(point, e)) continue;
            const carrier = e.type === TYPE_CIRCLE ? e : {a: e.a, b: e.b, c: e.c, type: TYPE_LINE};
            if (count && first && SAME_ELEMENT(first, carrier)) continue;
            first = carrier;
            if (++count === 2) break;
        }
        return count;
    }

    /** 组装当前状态的目标上下文 过程函数（C++ MakeContext） */
    makeContext() {
        const context = {targets: [], missingElements: []};
        for (const p of this.graph.goalPoints) {
            if (this.hasPoint(p)) continue;
            context.targets.push({point: p, support: this.supports(p), importance: 1.0});
        }
        for (const e of this.graph.goalElements) {
            if (this.hasElement(e)) continue;
            context.missingElements.push(e);
            if (e.type === TYPE_CIRCLE) {
                const center = {x: e.a, y: e.b};
                if (!this.hasPoint(center)) {
                    context.targets.push({point: center, support: this.supports(center), importance: 0.7});
                }
            }
        }
        return context;
    }

    /** 候选的「即时代价」分 过程函数（C++ CheapScore） */
    cheapScore(e, c, context) {
        let value = 0.0;
        let hits = 0.0;
        for (const target of context.targets) {
            if (this.graph.pointOnElement(target.point, e)) {
                hits += target.importance;
                value += this.weights.support * target.importance * (1.0 + target.support);
            } else if (this.weights.proximity !== 0.0) {
                value += this.weights.proximity * target.importance *
                    heuristicCurveNear(target.point, e);
            }
        }
        value += this.weights.support * Math.min(8.0, hits * hits) * 0.25;
        for (const goal of context.missingElements) {
            if (SAME_ELEMENT(e, goal)) value += this.weights.goal;
            if (goal.type === TYPE_CIRCLE) {
                if (e.type === TYPE_CIRCLE) {
                    if (SAME_POINT({x: e.a, y: e.b}, {x: goal.a, y: goal.b})) {
                        value += this.weights.prerequisite;
                    }
                    value += this.weights.direction * heuristicSmooth(
                        Math.abs(e.c - goal.c) / (1.0 + Math.abs(goal.c)));
                }
            } else {
                value += this.weights.direction * heuristicDirectionScore(e, goal);
                // 过目标线上**已有**点的载线能再曝出一个点；端点一定都是已知点
                if (this.graph.pointOnElement(this.graph.points[c.i], goal) ||
                    this.graph.pointOnElement(this.graph.points[c.j], goal)) {
                    value += this.weights.direction;
                }
            }
        }
        if (this.depth && (this.graph.pointBirth[c.i] === this.depth ||
            this.graph.pointBirth[c.j] === this.depth)) {
            value += this.weights.growth;
        }
        return isFinite(value) ? value : 0.0;
    }

    /** 整张图的评分 过程函数（C++ WholeScore，用于 beam 层间排序） */
    wholeScore() {
        let value = 0.0;
        for (const goal of this.graph.goalPoints) {
            if (this.hasPoint(goal)) {
                value += this.weights.goal;
                continue;
            }
            value += this.weights.support * this.supports(goal);
            let closeness = 0.0;
            if (this.weights.proximity !== 0.0) {
                for (const p of this.graph.points) closeness = Math.max(closeness, heuristicPointNear(p, goal));
            }
            value += this.weights.proximity * closeness;
        }
        for (const goal of this.graph.goalElements) {
            if (this.hasElement(goal)) {
                value += this.weights.goal;
                continue;
            }
            let hits = 0;
            let closeness = 0.0;
            for (const p of this.graph.points) {
                if (hits < 3 && this.graph.pointOnElement(p, goal)) hits++;
                if (this.weights.proximity !== 0.0) closeness = Math.max(closeness, heuristicCurveNear(p, goal));
                else if (hits === 3) break;
            }
            if (goal.type === TYPE_CIRCLE) {
                const center = {x: goal.a, y: goal.b};
                const centerKnown = this.hasPoint(center);
                value += this.weights.prerequisite * (centerKnown ? 1.5 : 0.0);
                value += this.weights.prerequisite * (hits ? 0.75 : 0.0);
                if (centerKnown && hits) value += this.weights.prerequisite;
                if (!centerKnown) value += 0.5 * this.weights.support * this.supports(center);
            } else {
                // 只是**特征**：两个 EPS 在线的点也不一定作得出目标线（要真的逐对复验）
                value += this.weights.prerequisite * Math.min(2, hits);
                if (hits > 2) value += this.weights.direction;
            }
            value += this.weights.proximity * closeness;
        }
        // 奖励「落在连接两个目标点的载线上」的已知点；这些载线只是打分用，不入图
        let guides = 0;
        for (let i = 0; i < this.graph.goalPoints.length && guides < 16; i++) {
            for (let j = i + 1; j < this.graph.goalPoints.length && guides < 16; j++) {
                if (SAME_POINT(this.graph.goalPoints[i], this.graph.goalPoints[j])) continue;
                guides++;
                const guide = makeElementFromCoefficients(
                    this.graph.goalPoints[j].y - this.graph.goalPoints[i].y,
                    this.graph.goalPoints[i].x - this.graph.goalPoints[j].x,
                    this.graph.goalPoints[i].x * this.graph.goalPoints[j].y -
                        this.graph.goalPoints[i].y * this.graph.goalPoints[j].x,
                    TYPE_LINE);
                let hits = 0;
                for (const p of this.graph.points) {
                    if (this.graph.pointOnElement(p, guide) && ++hits === 3) break;
                }
                value += this.weights.direction * hits;
            }
        }
        const added = this.graph.points.length - this.baseGraph.points.length;
        value += this.weights.growth * Math.log1p(added);
        return isFinite(value) ? value : 0.0;
    }

    /**
     * 「这个候选的新交点里有没有落进目标需要的形状」的前瞻分 过程函数
     * （C++ PrerequisitePreview；只对自适应风格生效）
     */
    prerequisitePreview(element, context) {
        if (!this.adaptiveStyle || !context.missingElements.length) return 0.0;
        let score = 0.0;
        for (const old of this.graph.elements) {
            this.graph.visitIntersections(element, old, point => {
                if (!isFinite(point.x) || !isFinite(point.y)) return false;
                let proposed = score;
                for (const target of context.targets) {
                    if (SAME_POINT(point, target.point)) proposed = Math.max(proposed, this.weights.goal * 0.5);
                }
                for (const goal of context.missingElements) {
                    if (this.graph.pointOnElement(point, goal)) {
                        proposed = Math.max(proposed, this.weights.prerequisite * 3.0);
                    }
                    if (goal.type === TYPE_CIRCLE && SAME_POINT(point, {x: goal.a, y: goal.b})) {
                        proposed = Math.max(proposed, this.weights.prerequisite * 4.0);
                    }
                }
                if (proposed > score && !this.graph.hasPoint(point)) score = proposed;
                return false;
            });
        }
        return score;
    }

    /**
     * 选出这一层要展开的候选 过程函数（C++ SelectCandidates）
     * 枚举所有已知点对（点对 → 圆规两种 + 直线一种），打分后进多样性池
     */
    selectCandidates() {
        const context = this.makeContext();
        const pool = new HeuristicPool(
            this.options.branchLimit, this.diverseCount(this.options.branchLimit), this.metrics,
            'discarded');
        this.seen.reset();
        const n = this.graph.points.length;
        const emit = (i, j, tool) => {
            this.stats.rawCandidates++;
            this.metrics.generated++;
            const candidate = {i, j, tool};
            const e = this.graph.makeCandidate(candidate);
            if (!isFinite(e.a) || !isFinite(e.b) || !isFinite(e.c) ||
                (e.type === TYPE_LINE ? (e.a === 0.0 && e.b === 0.0) : e.c <= 0.0)) {
                this.metrics.discarded++;
                this.metrics.budgetLimited = true;
                return;
            }
            if (this.graph.hasElement(e)) {
                this.stats.existingCandidates++;
                return;
            }
            if (this.seen.duplicate(e)) {
                this.stats.duplicateCandidates++;
                return;
            }
            this.stats.uniqueCandidates++;
            // 反向地标只加在评分上（score-only）：离目标的距离估计
            let bridge = this.prerequisitePreview(e, context);
            if (this.landmarkStyle) {
                bridge += this.weights.prerequisite * this.landmarks.scoreCandidate(this.graph, e, this.graph.points.length);
            }
            pool.offer({
                element: e,
                candidate: candidate,
                serial: this.serial++,
                diversity: this.random.next(),
                bridge: bridge,
                score: this.cheapScore(e, candidate, context) + bridge,
            });
        };
        for (let i = 0; i < n; i++) {
            this.poll();
            for (let j = i + 1; j < n; j++) {
                this.poll();
                if (this.toolType !== 1) {
                    emit(i, j, 0);
                    emit(i, j, 1);
                }
                if (this.toolType !== 0) emit(i, j, 2);
            }
        }
        return pool.take();
    }

    /** 多样性配额 过程函数 */
    diverseCount(capacity) {
        return capacity > 1 ? Math.max(1, Math.floor(capacity / this.diversityDivisor)) : 0;
    }

    /** 把图恢复成「起始图 + 前缀」 过程函数（C++ Replay；重建过程不计入搜索节点/applied） */
    replay(prefix) {
        this.graph.rollback(this.root);
        let birth = 0;
        for (const e of prefix) {
            this.checkNow();
            if (!this.graph.apply(e, ++birth)) {
                throw new Error('启发式前缀重放改变了有序状态');
            }
        }
    }

    /**
     * 尾助搜 过程函数（C++ TailHelper）
     * 用一小段**真正的 DFS** 从前缀往下搜；失败不算任何结论（绝不因此丢掉 beam 条目）
     */
    tailHelper(prefix, sliceSeconds) {
        if (!this.options.tailCandidates || !this.options.tailSeconds) return;
        this.checkNow();
        const leftSeconds = Math.max(0.0, (this.deadline - HEURISTIC_NOW()) / 1000);
        const seconds = Math.min(
            sliceSeconds !== undefined ? sliceSeconds : this.options.tailSeconds, leftSeconds);
        if (!(seconds > 0)) return;
        const graph = this.baseGraph.clone();
        const helper = new Solver(this.toolType, false, true, true, 0, 0, seconds);
        const stats = makeSearchStats();
        this.metrics.tailCalls++;
        const found = helper.searchPrefixTask(graph, this.limit, prefix, stats);
        this.mergeStats(stats);
        if (helper.isTimedOut()) this.metrics.budgetLimited = true;
        // 助搜刻意不挂解收集器与进度：本地超时不许污染全局停止标志
        if (found && graph.goalsMet()) this.submit(graph, true);
        this.checkNow();
    }

    /** 统计合并 过程函数 */
    mergeStats(other) {
        for (const key of Object.keys(this.stats)) {
            if (typeof other[key] === 'number' && typeof this.stats[key] === 'number') {
                this.stats[key] += other[key];
            }
        }
        this.stats.maxPoints = Math.max(this.stats.maxPoints || 0, other.maxPoints || 0);
        this.stats.maxElements = Math.max(this.stats.maxElements || 0, other.maxElements || 0);
    }

    /**
     * 交一条解 过程函数
     * 评分永远不是成功判据：这里必须真的 goalsMet 才算
     * @returns {boolean} true 表示收够解数，可以整场停了
     */
    submit(graph, helper) {
        if (!graph.goalsMet()) return false;
        if (helper) this.metrics.helperSolutions++;
        else this.metrics.beamSolutions++;
        const quotaReached = this.collector.submit(graph, null);
        if (!quotaReached) return false;
        this.control.found = true;
        this.control.stop = true;
        return true;
    }

    /**
     * 切线探针 过程函数（C++ tangent_detail::Probe）
     * 触发：画布上有一个**与某条还缺的目标直线相切**的圆（那条切线正是玩家要作的）。
     * 两条路都只走真作图 —— 所有中间点都必须从真实已知交点里取到，绝不凭空插入解析切点：
     *   · 倍弦构造：作圆 O,H → 轴线 OH 与这个圆交出 P → 圆 P,H 与轴线交出 Q →
     *     圆 H′,Q 与圆 O,H 交出 K → 直线 HK（H′ 是 H 关于 O 的对称点）；
     *   · 泰勒斯圆兜底：以 OH 为直径作圆，与现有圆交出切点 T，再作直线 HT。
     * @param {Graph} parent 探针起点（内部克隆，不改动它）
     * @param {number} remaining 还能作几步
     * @param {number} deadline 探针自己的时间上限
     * @param {Function} complete (graph, remainingLeft) => boolean 提交回调
     * @returns {boolean} 被回调收下（且收够解数）则 true
     */
    tangentProbe(parent, remaining, deadline, complete) {
        if (this.toolType !== 2 || remaining < 1) return false;
        if (parent.points.length > 128 || parent.elements.length > 64) return false;
        if (validateProbeParent(parent) < 0) return false;
        const targets = parent.goalElements.filter(e => e.type === TYPE_LINE && !parent.hasElement(e));
        if (!targets.length) return false;

        const graph = parent.clone();
        const root = graph.getMark();
        const parentElements = parent.elements.length;
        const stop = () => this.control.stop || HEURISTIC_NOW() >= deadline;

        let applied = 0;
        let circles = 0;
        let externalPoints = 0;
        const apply = (a, b, circle) => {
            if (stop() || a === b || SAME_POINT(graph.points[a], graph.points[b])) return false;
            const element = graph.makeCandidate(pointCandidate(a, b, circle));
            this.stats.rawCandidates++;
            if (!validProbeElement(element)) return false;
            // 已经存在也算「到位了」：后面的 findPointIndex 能取到它的点
            if (graph.hasElement(element)) return true;
            if (graph.elements.length - parentElements >= remaining) return false;
            const birth = graph.elements.length - graph.initialElementCount + 1;
            if (!applyFiniteProbe(graph, element, birth)) return false;
            applied++;
            // 就地记账：complete 收下时函数会提前 return，留在末尾加会漏掉
            this.metrics.probeApplied++;
            this.stats.applied++;
            this.stats.nodes++;
            this.stats.maxPoints = Math.max(this.stats.maxPoints || 0, graph.points.length);
            this.stats.maxElements = Math.max(this.stats.maxElements || 0, graph.elements.length);
            return true;
        };

        for (const circle of parent.elements) {
            if (stop()) return false;
            if (circle.type !== TYPE_CIRCLE || circle.c <= 0.0) continue;
            if (++circles > 16) break;
            const center = findPointIndex(parent, {x: circle.a, y: circle.b});
            if (center < 0) continue;
            for (const target of targets) {
                const normal2 = SQ(target.a) + SQ(target.b);
                if (normal2 <= 0.0 || !isFinite(normal2)) continue;
                // 只在这个圆**与目标直线相切**时才触发（相切只是个启动条件，不作几何结论用）
                const residual = target.a * circle.a + target.b * circle.b - target.c;
                const gap = Math.abs(SQ(residual) / normal2 - circle.c);
                if (gap > Math.max(EPS * 100, 1e-10) * (1 + circle.c)) continue;
                for (let h = 0; h < parent.points.length; h++) {
                    if (stop() || externalPoints >= 64) return false;
                    const O = parent.points[center];
                    const H = parent.points[h];
                    if (!parent.pointOnElement(H, target)) continue;
                    if (SQ(H.x - O.x) + SQ(H.y - O.y) <= circle.c + EPS) continue;
                    externalPoints++;
                    graph.rollback(root);

                    // ----- 倍弦构造（paid doubled-chord） -----
                    const axis = graph.makeCandidate(pointCandidate(center, h, false));
                    const distance = Math.sqrt(SQ(H.x - O.x) + SQ(H.y - O.y));
                    const radius = Math.sqrt(circle.c);
                    const predictedP = {
                        x: O.x + (H.x - O.x) * radius / distance,
                        y: O.y + (H.y - O.y) * radius / distance,
                    };
                    let p = findPointIndex(graph, predictedP);
                    if (p < 0 && apply(center, h, false)) p = findPointIndex(graph, predictedP);
                    if (p >= 0 && apply(center, h, true)) {
                        const outer = graph.makeCandidate(pointCandidate(center, h, true));
                        const opposite = findPointIndex(graph, {x: 2 * O.x - H.x, y: 2 * O.y - H.y});
                        if (opposite >= 0 && apply(p, h, true)) {
                            const transfer = graph.makeCandidate(pointCandidate(p, h, true));
                            const qCandidates = [];
                            graph.visitIntersections(axis, transfer, q => {
                                const id = findPointIndex(graph, q);
                                if (id >= 0 && id !== h && !SAME_POINT(q, H)) qCandidates.push(id);
                                return false;
                            });
                            const beforeLastCircle = graph.getMark();
                            for (const q of qCandidates) {
                                graph.rollback(beforeLastCircle);
                                if (stop() || !apply(opposite, q, true)) continue;
                                const doubled = graph.makeCandidate(pointCandidate(opposite, q, true));
                                const candidates = [];
                                graph.visitIntersections(outer, doubled, k => {
                                    const id = findPointIndex(graph, k);
                                    if (id >= 0) candidates.push(id);
                                    return false;
                                });
                                const ready = graph.getMark();
                                for (const k of candidates) {
                                    graph.rollback(ready);
                                    if (stop() || !apply(h, k, false)) continue;
                                    const spent = graph.elements.length - parentElements;
                                    if (complete(graph, remaining - spent)) return true;
                                }
                            }
                        }
                    }
                    graph.rollback(root);

                    // ----- 泰勒斯圆兜底 -----
                    let middle = findPointIndex(graph, {x: (O.x + H.x) * 0.5, y: (O.y + H.y) * 0.5});
                    if (middle < 0) {
                        if (!apply(center, h, true) || !apply(h, center, true)) continue;
                        const c1 = graph.makeCandidate(pointCandidate(center, h, true));
                        const c2 = graph.makeCandidate(pointCandidate(h, center, true));
                        const cross = [];
                        graph.visitIntersections(c1, c2, q => {
                            const id = findPointIndex(graph, q);
                            if (id >= 0) cross.push(id);
                            return false;
                        });
                        // 两圆交点连成的就是 OH 的中垂线；中垂线本身不给中点，再补轴线
                        if (cross.length !== 2 || !apply(cross[0], cross[1], false)) continue;
                        middle = findPointIndex(graph, {x: (O.x + H.x) * 0.5, y: (O.y + H.y) * 0.5});
                        if (middle < 0) {
                            if (!apply(center, h, false)) continue;
                            middle = findPointIndex(graph, {x: (O.x + H.x) * 0.5, y: (O.y + H.y) * 0.5});
                        }
                    }
                    if (middle < 0 || !apply(middle, center, true)) continue;
                    const thales = graph.makeCandidate(pointCandidate(middle, center, true));
                    const touches = [];
                    graph.visitIntersections(thales, circle, q => {
                        const id = findPointIndex(graph, q);
                        if (id >= 0) touches.push(id);
                        return false;
                    });
                    const base = graph.getMark();
                    for (const t of touches) {
                        graph.rollback(base);
                        if (stop() || !apply(h, t, false)) continue;
                        const spent = graph.elements.length - parentElements;
                        if (complete(graph, remaining - spent)) return true;
                    }
                }
            }
        }
        return false;
    }

    /**
     * 直径探针 过程函数（C++ diameter_detail::Probe）
     * 对每一对已知点：按「这两点是直径两端」把那个直径圆作出来 ——
     * 两个互过对方端点的圆（半径都是 |AB|）→ 它们的公共弦（中垂线）→ 中点 →
     * 以中点为中心、过 A 的圆（半径 |AB|/2，正是直径圆）。
     * 解析中点只是**查表键**：每个点都必须来自真实的已知交点。
     */
    diameterProbe(parent, remaining, deadline, complete) {
        if (this.toolType !== 2 || remaining < 1) return false;
        if (parent.points.length < 2 || parent.points.length > 32 || parent.elements.length > 64) return false;
        if (validateProbeParent(parent) < 0) return false;

        const graph = parent.clone();
        const root = graph.getMark();
        const parentElements = parent.elements.length;
        const stop = () => this.control.stop || HEURISTIC_NOW() >= deadline;
        let applied = 0;
        const apply = (a, b, circle) => {
            if (stop() || a === b) return false;
            if (a >= graph.points.length || b >= graph.points.length) return false;
            if (SAME_POINT(graph.points[a], graph.points[b])) return false;
            this.stats.rawCandidates++;
            const element = graph.makeCandidate(pointCandidate(a, b, circle));
            if (!validProbeElement(element)) return false;
            if (graph.hasElement(element)) return true;
            if (graph.elements.length - parentElements >= remaining) return false;
            const birth = graph.elements.length - graph.initialElementCount + 1;
            if (!applyFiniteProbe(graph, element, birth)) return false;
            applied++;
            this.metrics.probeApplied++;
            this.stats.applied++;
            this.stats.nodes++;
            this.stats.uniqueCandidates++;
            this.stats.maxPoints = Math.max(this.stats.maxPoints || 0, graph.points.length);
            this.stats.maxElements = Math.max(this.stats.maxElements || 0, graph.elements.length);
            return true;
        };

        let pairs = 0;
        for (let a = 0; a < parent.points.length; a++) {
            for (let b = a + 1; b < parent.points.length; b++) {
                if (stop()) return false;
                if (++pairs > 64) return false;
                graph.rollback(root);
                const p = graph.points[a];
                const q = graph.points[b];
                if (SAME_POINT(p, q)) continue;
                const predictedMid = {x: (p.x + q.x) * 0.5, y: (p.y + q.y) * 0.5};
                let mid = findPointIndex(graph, predictedMid);
                if (mid < 0) {
                    if (!apply(a, b, true) || !apply(b, a, true)) continue;
                    const first = graph.makeCandidate(pointCandidate(a, b, true));
                    const second = graph.makeCandidate(pointCandidate(b, a, true));
                    const intersections = [];
                    graph.visitIntersections(first, second, v => {
                        intersections.push(v);
                        return false;
                    });
                    if (intersections.length !== 2) continue;
                    const x = findPointIndex(graph, intersections[0]);
                    const y = findPointIndex(graph, intersections[1]);
                    if (x < 0 || y < 0 || !apply(x, y, false)) continue;
                    mid = findPointIndex(graph, predictedMid);
                    if (mid < 0) {
                        if (!apply(a, b, false)) continue;
                        mid = findPointIndex(graph, predictedMid);
                    }
                }
                if (mid < 0 || mid === a || mid === b || !apply(mid, a, true)) continue;
                if (stop()) return false;
                const spent = graph.elements.length - parentElements;
                if (complete(graph, remaining - spent)) return true;
            }
        }
        return false;
    }

    /**
     * 镜像探针 过程函数（C++ mirror_detail::Probe）
     * 拿一条已有的**载线**当对称轴：轴上有两个已知点时，以它们为圆心、过同一个已知点 P 作两圆，
     * 两圆的**另一个**交点就是 P 关于这条轴的镜像。反射位置只是几何元数据（查表键），
     * 镜像点本身仍然是真实求交出来的；`tools == 2` 时还会顺手把 P 与镜像点连成垂线。
     * 注：C++ 里这个探针写好了但**没接到任何地方**，这里接在直径探针之后。
     */
    mirrorProbe(parent, remaining, deadline, complete) {
        if (this.toolType !== 0 && this.toolType !== 2) return false;
        if (remaining < 1 || parent.points.length < 3) return false;
        if (parent.points.length > 128 || parent.elements.length > 64) return false;
        if (validateProbeParent(parent) < 0) return false;

        const graph = parent.clone();
        const root = graph.getMark();
        const parentElements = parent.elements.length;
        const stop = () => this.control.stop || HEURISTIC_NOW() >= deadline;
        let candidates = 0;
        let applied = 0;
        const apply = (a, b, circle) => {
            if (stop() || a === b || SAME_POINT(graph.points[a], graph.points[b])) return false;
            this.stats.rawCandidates++;
            candidates++;
            const element = graph.makeCandidate(pointCandidate(a, b, circle));
            if (!validProbeElement(element)) return false;
            if (graph.hasElement(element)) return true;
            if (graph.elements.length - parentElements >= remaining) return false;
            const birth = graph.elements.length - graph.initialElementCount + 1;
            if (!applyFiniteProbe(graph, element, birth)) return false;
            applied++;
            this.metrics.probeApplied++;
            this.stats.applied++;
            this.stats.nodes++;
            this.stats.uniqueCandidates++;
            this.stats.maxPoints = Math.max(this.stats.maxPoints || 0, graph.points.length);
            this.stats.maxElements = Math.max(this.stats.maxElements || 0, graph.elements.length);
            return true;
        };

        let axes = 0;
        let proposals = 0;
        for (const axis of parent.elements) {
            if (stop()) return false;
            if (axis.type === TYPE_CIRCLE) continue;
            if (++axes > 24) break;
            const denom = SQ(axis.a) + SQ(axis.b);
            if (!isFinite(denom) || denom <= 0.0) continue;
            const anchors = [];
            for (let i = 0; i < parent.points.length && anchors.length < 16; i++) {
                if (parent.pointOnElement(parent.points[i], axis)) anchors.push(i);
            }
            if (anchors.length < 2) continue;
            // 「有用」的点排在前面：目标点本身、或落在某个目标元素上的点
            const selected = [];
            for (let i = 0; i < parent.points.length; i++) {
                let useful = false;
                for (const goal of parent.goalPoints) {
                    if (SAME_POINT(parent.points[i], goal)) {
                        useful = true;
                        break;
                    }
                }
                if (!useful) {
                    for (const goal of parent.goalElements) {
                        if (parent.pointOnElement(parent.points[i], goal)) {
                            useful = true;
                            break;
                        }
                    }
                }
                if (useful) selected.push(i);
            }
            for (let i = 0; i < parent.points.length && selected.length < 32; i++) {
                if (selected.indexOf(i) < 0) selected.push(i);
            }
            if (selected.length > 32) selected.length = 32;

            for (const p of selected) {
                if (stop()) return false;
                const point = parent.points[p];
                const residual = axis.a * point.x + axis.b * point.y - axis.c;
                if (IS_ZERO(residual)) continue;
                const mirror = {
                    x: point.x - 2 * axis.a * residual / denom,
                    y: point.y - 2 * axis.b * residual / denom,
                };
                if (!isFinite(mirror.x) || !isFinite(mirror.y)) continue;
                if (typeof parent.pointAllowed === 'function' && !parent.pointAllowed(mirror)) continue;
                if (parent.hasPoint(mirror)) continue;
                for (let a = 0; a < anchors.length; a++) {
                    for (let b = a + 1; b < anchors.length; b++) {
                        if (stop() || ++proposals > 512) return false;
                        graph.rollback(root);
                        const i = anchors[a];
                        const j = anchors[b];
                        // 以轴上的两个已知点为圆心、都过 P：另一个交点就是 P 的镜像
                        if (!apply(i, p, true) || !apply(j, p, true)) continue;
                        const mirrored = findPointIndex(graph, mirror);
                        if (mirrored < 0) continue;
                        const circles = graph.getMark();
                        let spent = graph.elements.length - parentElements;
                        if (complete(graph, remaining - spent)) return true;
                        if (this.toolType === 2 && remaining > spent && apply(p, mirrored, false)) {
                            spent = graph.elements.length - parentElements;
                            if (complete(graph, remaining - spent)) return true;
                        }
                        graph.rollback(circles);
                    }
                }
            }
        }
        return false;
    }

    /**
     * 会合搜索 过程函数（C++ rendezvous_detail::Find）
     * 思路：让两个「独立可达」的点在同一处对上 ——
     *   ① 一条候选直线（由两个已知点作出）与目标直线的交点是「会合点」；
     *   ② 从某个已知锚点出发、方向也指向这个会合点的**另一个可达点**，由第二条直线（另一对已知点）作出；
     *   ③ 于是「锚点 → 那个可达点」这条直线正好经过会合点，最后再照常作出目标直线（第 4 刀）。
     * 方向容差只用来**提候选**；每次命中都会用真实已知点重放（普通 apply + GoalsMet 复核），
     * 目标坐标从不直接落点。
     * @param {number} deadline 本次会合搜索的时间上限
     * @returns {boolean} 收够解数为 true
     */
    rendezvousSearch(deadline) {
        const initial = this.baseGraph;
        if (this.limit < 4 || this.toolType === 0) return false;
        if (initial.points.length < 2 || initial.points.length > 128) return false;
        if (initial.elements.length > 128 || initial.goalElements.length > 8) return false;
        const goals = initial.goalElements.filter(e => e.type === TYPE_LINE && !initial.hasElement(e));
        if (!goals.length) return false;

        let polls = 0;
        const stopped = () => {
            if ((++polls & 255) !== 0) return false;
            return this.control.stop || HEURISTIC_NOW() >= deadline;
        };

        const MAX_CANDIDATES = 8192;
        const INDEX_BYTE_BUDGET = 32 * 1024 * 1024;
        const maxReachable = Math.min(65536,
            Math.floor(INDEX_BYTE_BUDGET / (12 * Math.max(1, initial.points.length))));
        const candidates = [];
        const reachable = [];
        const pointSeen = new Set();
        for (let i = 0; i < initial.points.length; i++) {
            for (let j = i + 1; j < initial.points.length; j++) {
                if (stopped()) return false;
                this.stats.rawCandidates++;
                const e = initial.makeCandidate({i: i, j: j, tool: 2});
                if (!isFinite(e.a) || !isFinite(e.b) || !isFinite(e.c)) continue;
                if (initial.hasElement(e)) continue;
                let duplicate = false;
                for (const old of candidates) {
                    if (rawElementKey(old) === rawElementKey(e)) {
                        duplicate = true;
                        break;
                    }
                }
                if (duplicate) continue;
                if (candidates.length >= MAX_CANDIDATES) break;
                candidates.push(e);
                this.stats.uniqueCandidates++;
                if (reachable.length >= maxReachable) continue;
                for (const old of initial.elements) {
                    if (stopped()) return false;
                    initial.visitIntersections(e, old, p => {
                        if (reachable.length >= maxReachable) return true;
                        if (!isFinite(p.x) || !isFinite(p.y) || initial.hasPoint(p)) return false;
                        const bits = rawWordKey(p.x) + ':' + rawWordKey(p.y);
                        if (!pointSeen.has(bits)) {
                            pointSeen.add(bits);
                            reachable.push({point: p, witness: e});
                        }
                        return false;
                    });
                }
            }
        }
        if (!reachable.length) return false;

        // 每个锚点：把「到各可达点的方向」排好序，便于按角度窗口取候选
        const index = [];
        for (let i = 0; i < initial.points.length; i++) {
            const angles = [];
            for (let j = 0; j < reachable.length; j++) {
                if (stopped()) return false;
                angles.push({angle: rendezvousDirectionOf(reachable[j].point, initial.points[i]), reachable: j});
            }
            angles.sort((a, b) => a.angle - b.angle || a.reachable - b.reachable);
            index.push(angles);
        }

        const graph = initial.clone();
        const root = graph.getMark();
        const replay = (first, second, anchor) => {
            if (this.control.stop || HEURISTIC_NOW() >= deadline) return false;
            this.metrics.rendezvousReplays++;
            graph.rollback(root);
            if (!graph.apply(first, 1)) return false;
            this.stats.applied++;
            if (!graph.apply(second.witness, 2)) return false;
            this.stats.applied++;
            const point = findPointIndex(graph, second.point);
            if (point < 0 || point === anchor) return false;
            const third = graph.makeCandidate(pointCandidate(anchor, point, false));
            if (!graph.apply(third, 3)) return false;
            this.stats.applied++;
            this.stats.nodes++;
            this.stats.maxPoints = Math.max(this.stats.maxPoints || 0, graph.points.length);
            this.stats.maxElements = Math.max(this.stats.maxElements || 0, graph.elements.length);
            if (graph.goalsMet()) {
                this.metrics.rendezvousSolutions++;
                return this.submit(graph, true);
            }
            const three = graph.getMark();
            for (const goal of goals) {
                const hits = [];
                graph.visitPointIncidences(goal, i => hits.push(i));
                for (let a = 0; a < hits.length; a++) {
                    for (let b = a + 1; b < hits.length; b++) {
                        if (stopped()) return false;
                        this.stats.rawCandidates++;
                        const last = graph.makeCandidate({i: hits[a], j: hits[b], tool: 2});
                        if (!SAME_ELEMENT(last, goal)) continue;
                        if (graph.apply(last, 4)) {
                            this.stats.applied++;
                            this.stats.nodes++;
                            if (graph.goalsMet()) {
                                this.metrics.rendezvousSolutions++;
                                if (this.submit(graph, true)) return true;
                            }
                            graph.rollback(three);
                        }
                    }
                }
            }
            return false;
        };

        const window = Math.min(1e-4, Math.max(1e-8, 1000 * EPS));
        for (const first of candidates) {
            for (const goal of goals) {
                if (stopped()) return false;
                let solved = false;
                initial.visitIntersections(first, goal, target => {
                    if (!isFinite(target.x) || !isFinite(target.y)) return false;
                    if (initial.hasPoint(target)) return false;
                    for (let anchor = 0; anchor < initial.points.length; anchor++) {
                        if (stopped()) return true;
                        if (SAME_POINT(target, initial.points[anchor])) continue;
                        const angle = rendezvousDirectionOf(target, initial.points[anchor]);
                        const directions = index[anchor];
                        let proposals = 0;
                        for (let wrap = -1; wrap <= 1; wrap++) {
                            const middle = angle + wrap * Math.PI;
                            for (let at = rendezvousLowerBound(directions, middle - window);
                                at < directions.length && directions[at].angle <= middle + window && proposals < 64;
                                at++) {
                                if (stopped()) return true;
                                const point = reachable[directions[at].reachable];
                                if (rawElementKey(point.witness) === rawElementKey(first)) continue;
                                this.metrics.rendezvousProposals++;
                                proposals++;
                                if (replay(first, point, anchor)) {
                                    solved = true;
                                    return true;
                                }
                            }
                        }
                    }
                    return false;
                });
                if (solved) return true;
                if (this.control.stop || HEURISTIC_NOW() >= deadline) return false;
            }
        }
        return false;
    }

    /**
     * 后向链式会合 过程函数（C++ chain_join_detail::Find）
     * 结构是一条「后向提案链」：Q —A3— M —A2— H（Q 是缺的目标点，H 有一刀就能作出来的见证）。
     * Q、M 只是按坐标索引的**虚拟点**；真正被接受的构造是重放：
     *   见证(H) → 直线(A2,H) → 直线(A3, M_实际) → （还够步数时）再作目标直线。
     * M 必须与预测坐标对得上、且真的落在载线上，否则这个提案直接放弃（数值顺序偏出 EPS 就不认）。
     * @param {Graph} parent 当前前缀重放后的图
     * @param {number} remaining 还能作几步
     * @param {number} deadline 本次的时间上限
     * @returns {boolean} 收够解数为 true
     */
    chainJoinSearch(parent, remaining, deadline) {
        if (this.toolType === 0 || remaining < 3) return false;
        if (parent.points.length < 2 || parent.points.length > 128) return false;
        if (parent.elements.length > 96) return false;
        if (validateProbeParent(parent) < 0) return false;
        const n = parent.points.length;
        let polls = 0;
        let cancelled = false;
        const stop = force => {
            if (cancelled) return true;
            if (!force && (++polls & 255)) return false;
            cancelled = this.control.stop || HEURISTIC_NOW() >= deadline;
            return cancelled;
        };

        const targets = [];
        for (const p of parent.goalPoints) {
            if (stop(false)) return false;
            if (parent.hasPoint(p)) continue;
            if (isFinite(p.x) && isFinite(p.y) && parent.pointAllowed(p)) targets.push(p);
            if (targets.length >= 8) break;
        }
        if (!targets.length) return false;

        const cap = Math.min(32768, Math.floor((16 * 1024 * 1024) / (12 * Math.max(1, n))));
        const reach = [];
        const pointsSeen = new Set();
        const elementSeen = new Set();
        const MAX_OPS = 8192;
        for (let i = 0; i < n; i++) {
            for (let j = i + 1; j < n; j++) {
                if (stop(false)) return false;
                for (let tool = 0; tool < 3; tool++) {
                    if (this.toolType === 1 && tool !== 2) continue;
                    if (this.toolType === 0 && tool === 2) continue;
                    if (stop(false)) return false;
                    this.stats.rawCandidates++;
                    const e = parent.makeCandidate({i: i, j: j, tool: tool});
                    if (!validProbeElement(e) || parent.hasElement(e)) continue;
                    if (elementSeen.size >= MAX_OPS || reach.length >= cap) break;
                    const key = rawElementKey(e);
                    if (elementSeen.has(key)) continue;
                    elementSeen.add(key);
                    this.stats.uniqueCandidates++;
                    for (const old of parent.elements) {
                        if (stop(false)) return false;
                        parent.visitIntersections(e, old, p => {
                            if (stop(false)) return true;
                            if (reach.length >= cap) return true;
                            if (!isFinite(p.x) || !isFinite(p.y) || parent.hasPoint(p)) return false;
                            const bits = rawWordKey(p.x) + ':' + rawWordKey(p.y);
                            if (!pointsSeen.has(bits)) {
                                pointsSeen.add(bits);
                                reach.push({point: p, witness: e});
                            }
                            return false;
                        });
                    }
                }
            }
        }
        if (!reach.length || stop(true)) return false;

        const index = [];
        for (let anchor = 0; anchor < n; anchor++) {
            if (stop(true)) return false;
            const row = [];
            for (let i = 0; i < reach.length; i++) {
                if (stop(false)) return false;
                row.push({angle: rendezvousDirectionOf(reach[i].point, parent.points[anchor]), reachable: i});
            }
            row.sort((a, b) => a.angle - b.angle || a.reachable - b.reachable);
            index.push(row);
        }

        const depth = parent.elements.length - parent.initialElementCount;
        const graph = parent.clone();
        const root = graph.getMark();
        const applied = () => {
            this.stats.applied++;
            this.stats.nodes++;
            this.stats.maxPoints = Math.max(this.stats.maxPoints || 0, graph.points.length);
            this.stats.maxElements = Math.max(this.stats.maxElements || 0, graph.elements.length);
        };
        const submit = () => {
            if (stop(true) || !graph.goalsMet()) return false;
            this.metrics.chainSolutions++;
            return this.submit(graph, true);
        };
        const replay = (source, a2, a3, carrier, virtualM) => {
            if (stop(true)) return false;
            this.metrics.chainReplays++;
            graph.rollback(root);
            if (!graph.apply(source.witness, depth + 1)) return false;
            applied();
            const h = findPointIndex(graph, source.point);
            if (h < 0 || h === a2) return false;
            const second = graph.makeCandidate(pointCandidate(a2, h, false));
            if (!validProbeElement(second) || !graph.apply(second, depth + 2)) return false;
            applied();
            const m = findPointIndex(graph, virtualM);
            if (m < 0 || m === a3 || !graph.pointOnElement(graph.points[m], carrier)) return false;
            const third = graph.makeCandidate(pointCandidate(a3, m, false));
            if (!validProbeElement(third) || !graph.apply(third, depth + 3)) return false;
            applied();
            if (submit()) return true;
            if (remaining < 4) return false;
            const three = graph.getMark();
            for (const goal of graph.goalElements) {
                if (stop(false)) return false;
                if (goal.type !== TYPE_LINE || graph.hasElement(goal)) continue;
                const hits = [];
                graph.visitPointIncidences(goal, i => hits.push(i));
                for (let i = 0; i < hits.length; i++) {
                    for (let j = i + 1; j < hits.length; j++) {
                        if (stop(false)) return false;
                        this.stats.rawCandidates++;
                        const last = graph.makeCandidate({i: hits[i], j: hits[j], tool: 2});
                        if (!validProbeElement(last) || !SAME_ELEMENT(last, goal)) continue;
                        if (graph.apply(last, depth + 4)) {
                            applied();
                            if (submit()) return true;
                            graph.rollback(three);
                        }
                    }
                }
            }
            return false;
        };

        const window = Math.min(1e-4, Math.max(1e-8, 1000 * EPS));
        for (const target of targets) {
            for (let a3 = 0; a3 < n; a3++) {
                if (stop(false)) return false;
                if (SAME_POINT(target, parent.points[a3])) continue;
                const virtualThird = makeLineFromPoints(target, parent.points[a3]);
                for (const carrier of parent.elements) {
                    if (stop(false)) return false;
                    let found = false;
                    parent.visitIntersections(virtualThird, carrier, virtualM => {
                        if (stop(false)) return true;
                        if (!isFinite(virtualM.x) || !isFinite(virtualM.y)) return false;
                        if (SAME_POINT(virtualM, target) || parent.hasPoint(virtualM)) return false;
                        for (let a2 = 0; a2 < n; a2++) {
                            if (stop(false)) return true;
                            if (a2 === a3 || SAME_POINT(parent.points[a2], virtualM)) continue;
                            const direction = rendezvousDirectionOf(virtualM, parent.points[a2]);
                            const row = index[a2];
                            let matches = 0;
                            for (let wrap = -1; wrap <= 1; wrap++) {
                                const middle = direction + wrap * Math.PI;
                                for (let at = rendezvousLowerBound(row, middle - window);
                                    at < row.length && row[at].angle <= middle + window && matches < 32;
                                    at++) {
                                    if (stop(false)) return true;
                                    matches++;
                                    this.metrics.chainProposals++;
                                    if (replay(reach[row[at].reachable], a2, a3, carrier, virtualM)) {
                                        found = true;
                                        return true;
                                    }
                                }
                            }
                        }
                        return false;
                    });
                    if (found) return true;
                }
            }
        }
        return false;
    }

    /**
     * 点会合 过程函数（C++ point_join_detail::Find）
     * 目标是**一个还缺的目标点** Q：把两个「可达点」连成直线去命中它 ——
     *   可达点 = 全部已有点（见证为空、零成本）+ 某**一刀**候选操作新造出的点（见证 = 那个候选下标）；
     *   两个可达点到 Q 的方向（模 π）落在同一窗口 ⇒ 它们大致共线于 Q ⇒ 直线 a-b 应当经过 Q。
     * 目标坐标只是**索引键**：从不插入预测点；最后一刀一定从**重放后真实的已知点**重新生成。
     * 返回 true = 收够解数；false = **未知**（含「交了解但没到配额」），绝不是「不可达」。
     */
    pointJoinSearch(parent, remaining, deadline, collector, control) {
        // 子目标调用（圆心收尾）会传自己的**局部收集器与局部控制**：它们收下的东西不算解，
        // 也不许把 stop/found 传出去（与 C++ circle_center_finish 的 localCollector 一致）
        const owner = collector || this.collector;
        const localControl = control || this.control;
        const MAX_ROOT_POINTS = 128;
        const MAX_ROOT_ELEMENTS = 64;
        const MAX_CANDIDATES = 16384;
        const MAX_REACHABLE = 65536;
        const MAX_PARTNERS = 256;
        const MAX_PROPOSALS = 65536;

        if (this.control.stop || HEURISTIC_NOW() >= deadline) return false;
        if (remaining < 1 || this.toolType === 0) return false;
        if (parent.points.length < 2 || parent.points.length > MAX_ROOT_POINTS) return false;
        if (parent.elements.length > MAX_ROOT_ELEMENTS || !parent.goalPoints.length) return false;
        const budget = Math.min(remaining, 3);
        if (validateProbeParent(parent) < 0) return false;
        const depth = parent.elements.length - parent.initialElementCount;

        let cancelled = false;
        let ticks = 0;
        const stopNow = () => {
            cancelled = cancelled || this.control.stop || localControl.stop || HEURISTIC_NOW() >= deadline;
            return cancelled;
        };
        const poll = () => cancelled || ((++ticks & 255) === 0 && stopNow());

        let goal = null;
        for (const p of parent.goalPoints) {
            if (poll()) return false;
            if (isFinite(p.x) && isFinite(p.y) && !parent.hasPoint(p)) {
                goal = p;
                break;
            }
        }
        if (!goal) return false;
        if (typeof parent.pointAllowed === 'function' && !parent.pointAllowed(goal)) return false;
        if (stopNow()) return false;

        const reachable = [];
        const pointSeen = new Set();
        const candidateSeen = new Set();
        for (const p of parent.points) {
            if (poll()) return false;
            if (!isFinite(p.x) || !isFinite(p.y)) continue;
            pointSeen.add(rawWordKey(p.x) + ':' + rawWordKey(p.y));
            reachable.push({point: p, witness: -1});
        }

        const candidates = [];
        const directWitnesses = [];
        if (budget > 1) {
            let full = false;
            for (let i = 0; i < parent.points.length && !full; i++) {
                for (let j = i + 1; j < parent.points.length && !full; j++) {
                    if (poll()) return false;
                    if (SAME_POINT(parent.points[i], parent.points[j])) continue;
                    for (let tool = this.toolType === 1 ? 2 : 0; tool <= 2; tool++) {
                        if (poll()) return false;
                        if (candidates.length >= MAX_CANDIDATES || reachable.length >= MAX_REACHABLE) {
                            full = true;
                            break;
                        }
                        this.stats.rawCandidates++;
                        const candidate = {i: i, j: j, tool: tool};
                        const e = parent.makeCandidate(candidate);
                        if (!validProbeElement(e)) continue;
                        if (parent.hasElement(e)) {
                            this.stats.existingCandidates++;
                            continue;
                        }
                        const key = rawElementKey(e);
                        if (candidateSeen.has(key)) {
                            this.stats.duplicateCandidates++;
                            continue;
                        }
                        candidateSeen.add(key);
                        const witness = candidates.length;
                        candidates.push(candidate);
                        this.stats.uniqueCandidates++;
                        let createsGoal = false;
                        for (const old of parent.elements) {
                            if (poll()) return false;
                            if (reachable.length >= MAX_REACHABLE) break;
                            parent.visitIntersections(e, old, p => {
                                if (poll() || reachable.length >= MAX_REACHABLE) return true;
                                if (!isFinite(p.x) || !isFinite(p.y)) return false;
                                if (typeof parent.pointAllowed === 'function' && !parent.pointAllowed(p)) return false;
                                if (parent.hasPoint(p)) return false;
                                if (SAME_POINT(p, goal)) createsGoal = true;
                                const bits = rawWordKey(p.x) + ':' + rawWordKey(p.y);
                                if (!pointSeen.has(bits)) {
                                    pointSeen.add(bits);
                                    reachable.push({point: p, witness: witness});
                                }
                                return false;
                            });
                        }
                        if (createsGoal) directWitnesses.push(witness);
                    }
                }
            }
        }
        if (stopNow()) return false;

        // 方向索引：每个可达点到目标点的方向（模 π）排序
        const index = [];
        for (let i = 0; i < reachable.length; i++) {
            if (poll()) return false;
            if (SAME_POINT(reachable[i].point, goal)) continue; // 自己到自己没有方向
            const angle = rendezvousDirectionOf(reachable[i].point, goal);
            if (isFinite(angle)) index.push({angle: angle, reachable: i});
        }
        index.sort((a, b) => a.angle - b.angle || a.reachable - b.reachable);
        if (stopNow()) return false;

        const graph = parent.clone();
        const root = graph.getMark();
        /** 重放一条提案 过程函数：先作两个见证，再用**真实已知点**连最后一刀 */
        const replay = (first, second, a, b) => {
            if (stopNow()) return false;
            this.metrics.pointJoinReplays++;
            graph.rollback(root);
            let paid = 0;
            const recordApply = () => {
                paid++;
                this.stats.applied++;
                this.stats.nodes++;
                this.stats.maxPoints = Math.max(this.stats.maxPoints || 0, graph.points.length);
                this.stats.maxElements = Math.max(this.stats.maxElements || 0, graph.elements.length);
            };
            // 0 = 还没成解；1 = 交了解但没到配额；2 = 收够配额；-1 = 被取消
            const submit = () => {
                if (stopNow()) return -1;
                if (!graph.goalsMet()) return 0;
                if (stopNow()) return -1;
                this.metrics.pointJoinSolutions++;
                const quota = owner.submit(graph, control ? null : this.control);
                return quota ? 2 : 1;
            };
            for (const witness of [first, second]) {
                if (witness < 0) continue;
                if (stopNow()) return false;
                // 从**真实已知点**重新生成，不用存下来的预测系数
                const e = graph.makeCandidate(candidates[witness]);
                if (graph.hasElement(e)) continue;
                if (paid >= budget || !graph.apply(e, depth + paid + 1)) return false;
                recordApply();
                const status = submit();
                if (status !== 0) return status === 2;
            }
            if (!a || !b || paid >= budget || stopNow()) return false;
            const ia = findPointIndex(graph, a.point);
            const ib = findPointIndex(graph, b.point);
            if (ia < 0 || ib < 0 || ia === ib || SAME_POINT(graph.points[ia], graph.points[ib])) return false;
            this.stats.rawCandidates++;
            const last = graph.makeCandidate(pointCandidate(ia, ib, false));
            if (!validProbeElement(last) || !graph.apply(last, depth + paid + 1)) return false;
            this.stats.uniqueCandidates++;
            recordApply();
            return submit() === 2;
        };

        for (const witness of directWitnesses) {
            if (stopNow()) return false;
            if (replay(witness, -1, null, null)) return true;
        }

        // 方向窗口配对：两个可达点到目标点的方向够近 ⇒ 连起来大致经过目标点
        const window = Math.min(1e-4, Math.max(1e-8, 1000 * EPS));
        let proposals = 0;
        const propose = (ai, bi) => {
            const a = reachable[ai];
            const b = reachable[bi];
            const cost = 1 + (a.witness >= 0 ? 1 : 0) + (b.witness >= 0 && b.witness !== a.witness ? 1 : 0);
            if (cost > budget || SAME_POINT(a.point, b.point)) return false;
            const predicted = makeLineFromPoints(a.point, b.point);
            if (!validProbeElement(predicted) || parent.hasElement(predicted)) return false;
            proposals++;
            this.metrics.pointJoinProposals++;
            if (replay(a.witness, b.witness, a, b)) return true;
            // 两个独立操作的代表元顺序也可能有 EPS 差别：换一下顺序再试
            if (a.witness >= 0 && b.witness >= 0 && a.witness !== b.witness) {
                return replay(b.witness, a.witness, a, b);
            }
            return false;
        };
        for (let i = 0; i < index.length; i++) {
            if (poll() || proposals >= MAX_PROPOSALS) return false;
            let partners = 0;
            for (let j = i + 1; j < index.length && index[j].angle - index[i].angle <= window; j++) {
                if (poll() || proposals >= MAX_PROPOSALS) return false;
                if (partners++ >= MAX_PARTNERS) break;
                if (propose(index[i].reachable, index[j].reachable)) return true;
            }
            // 模 π 方向在 0/π 处相邻的点也是一对（每对只提一次）
            if (index[i].angle + window >= Math.PI) {
                for (let j = 0; j < i && index[j].angle + Math.PI - index[i].angle <= window; j++) {
                    if (poll() || proposals >= MAX_PROPOSALS) return false;
                    if (partners++ >= MAX_PARTNERS) break;
                    if (propose(index[i].reachable, index[j].reachable)) return true;
                }
            }
        }
        return false;
    }

    /**
     * 单圆圆心收尾 过程函数（C++ circle_center_finish_detail::Finish）
     * 目标只有一个圆、且圆心还不是已知点时：先用 **1–3 刀点会合**（≤30ms）把圆心拿到，
     * 再用**真正剩余**的步数跑目标收尾。私有的本地收集器/本地控制只用来拿圆心，
     * 它的 stop/found **不会**往外传播（只有全局取消会）。
     */
    circleCenterFinish(parent, remaining, deadline) {
        deadline = Math.min(deadline, HEURISTIC_NOW() + 30);
        deadline = Math.min(deadline, this.deadline);
        const stop = () => this.control.stop || HEURISTIC_NOW() >= deadline;
        if (stop()) return false;
        if (validateProbeParent(parent) < 0) return false;
        if (remaining < 2 || remaining > 4) return false;
        if (parent.points.length > 96 || parent.elements.length > 64) return false;
        if (parent.goalElements.length !== 1 || parent.goalPoints.length) return false;
        const target = parent.goalElements[0];
        if (target.type !== TYPE_CIRCLE || !validProbeElement(target)) return false;

        const finishOriginal = (graph, left, successesBefore) => {
            if (stop()) return false;
            this.metrics.goalFinishCalls++;
            const quota = this.goalFinishSearch(graph, left, deadline);
            this.metrics.circleFinishSolutions += this.metrics.goalFinishSolutions - successesBefore;
            return quota;
        };
        // 目标本来就达成了 → 不需要额外步数（哪怕圆心未知），直接收尾
        if (parent.goalsMet()) {
            return finishOriginal(parent, remaining, this.metrics.goalFinishSolutions);
        }
        const center = {x: target.a, y: target.b};
        if (this.toolType !== 2 || parent.points.length < 2 || parent.hasPoint(center)) return false;
        if (typeof parent.pointAllowed === 'function' && !parent.pointAllowed(center)) return false;

        // 子目标：只要圆心（判据而已，绝不真的 AddPoint / 封盘）
        const subgoal = parent.clone();
        subgoal.goalElements.length = 0;
        subgoal.goalPoints = [{x: center.x, y: center.y}];
        const localCollector = new SolutionCollector(1);
        const localControl = {stop: false, found: false, timedOut: false, deadline: deadline};
        this.metrics.circleFinishSearches++;
        this.pointJoinSearch(subgoal, remaining - 1, deadline, localCollector, localControl);
        if (stop() || !localCollector.entries.length) return false;
        const acquired = localCollector.entries[0].graph;
        if (!acquired) return false;
        if (acquired.initialElementCount !== parent.initialElementCount) return false;
        if (acquired.elements.length <= parent.elements.length) return false;
        const spent = acquired.elements.length - parent.elements.length;
        if (spent > remaining - 1 || !acquired.hasPoint(center)) return false;
        for (let i = parent.points.length; i < acquired.points.length; i++) {
            const p = acquired.points[i];
            if (!isFinite(p.x) || !isFinite(p.y)) return false;
            if (typeof acquired.pointAllowed === 'function' && !acquired.pointAllowed(p)) return false;
        }
        this.metrics.circleFinishCenters++;
        return finishOriginal(acquired, remaining - spent, this.metrics.goalFinishSolutions);
    }

    /**
     * 目标收尾 过程函数（C++ goal_finish_detail::Find）
     * 两步：
     *   ① **纯目标 DFS**：每一步都只作「还缺的目标元素」（用在线点 / 圆心＋圆上点这些关联点对），
     *      一旦 GoalsMet 就交解；
     *   ② 若还够步数，再对**根上的已知点对**枚举一刀**辅助操作**（≤4096），
     *      每个都在真 apply 之后算一次评分（目标点/目标元素的完成度），回滚后排个序，
     *      再逐个重放、接上纯目标 DFS。
     * 评分只在**真正 apply 过的状态**上算，只是排序提示 —— 既不是「有解」的证据，也绝不丢候选。
     * 返回 true = 收够解数；false = **未知**，绝不代表调用方的分支可以剪掉。
     */
    goalFinishSearch(parent, remaining, deadline) {
        const MAX_REMAINING = 6;
        const MAX_GOALS = 8;
        const MAX_PARENT_POINTS = 128;
        const MAX_PARENT_ELEMENTS = 96;
        const MAX_AUXILIARY = 4096;
        const MAX_GOAL_CANDIDATES = 100000;

        if (this.control.stop) return false;
        deadline = Math.min(deadline, this.deadline);
        if (HEURISTIC_NOW() >= deadline) return false;
        if (remaining < 0) return false;
        if (remaining > MAX_REMAINING || parent.points.length > MAX_PARENT_POINTS ||
            parent.elements.length > MAX_PARENT_ELEMENTS) return false;
        if (parent.goalElements.length > MAX_GOALS ||
            parent.goalPoints.length > MAX_GOALS - parent.goalElements.length) return false;
        if (!parent.goalElements.length && !parent.goalPoints.length) return false;
        if (validateProbeParent(parent) < 0) return false;

        const graph = parent.clone();
        const root = graph.getMark();
        let cancelled = false;
        let ticks = 0;
        let goalOperations = 0;
        let auxiliaryOperations = 0;
        const stop = force => {
            if (cancelled) return true;
            if (!force && (++ticks & 63)) return false;
            cancelled = this.control.stop || HEURISTIC_NOW() >= deadline;
            return cancelled;
        };
        const make = candidate => {
            if (stop(false)) return null;
            if (candidate.i >= graph.points.length || candidate.j >= graph.points.length) return null;
            if (candidate.i === candidate.j) return null;
            const p = graph.points[candidate.i];
            const q = graph.points[candidate.j];
            if (!isFinite(p.x) || !isFinite(p.y) || !isFinite(q.x) || !isFinite(q.y)) return null;
            if (typeof graph.pointAllowed === 'function' && (!graph.pointAllowed(p) || !graph.pointAllowed(q))) return null;
            if (SAME_POINT(p, q)) return null;
            this.stats.rawCandidates++;
            const e = graph.makeCandidate(candidate);
            if (!validProbeElement(e)) return null;
            return e;
        };
        const apply = (e, preview, goal) => {
            if (stop(true)) return false;
            if (graph.hasElement(e)) {
                this.stats.existingCandidates++;
                return false;
            }
            const before = graph.getMark();
            const birth = graph.elements.length - graph.initialElementCount + 1;
            if (!graph.apply(e, birth)) return false;
            this.metrics.probeApplied++;
            this.stats.uniqueCandidates++;
            this.stats.applied++;
            this.stats.nodes++;
            this.stats.maxPoints = Math.max(this.stats.maxPoints || 0, graph.points.length);
            this.stats.maxElements = Math.max(this.stats.maxElements || 0, graph.elements.length);
            for (let i = before.pointCount; i < graph.points.length; i++) {
                const p = graph.points[i];
                if (stop(false) || !isFinite(p.x) || !isFinite(p.y) ||
                    (typeof graph.pointAllowed === 'function' && !graph.pointAllowed(p))) {
                    graph.rollback(before);
                    return false;
                }
            }
            return true;
        };
        /** 纯目标 DFS 过程函数：每一步都只作还缺的目标元素 */
        const goalOnly = left => {
            if (stop(true)) return false;
            if (graph.goalsMet()) {
                if (stop(true)) return false;
                this.metrics.goalFinishSolutions++;
                return this.submit(graph, true);
            }
            if (left === 0) return false;
            const before = graph.getMark();
            const attempt = (candidate, goal) => {
                if (stop(false)) return false;
                if (goalOperations >= MAX_GOAL_CANDIDATES) {
                    cancelled = true;
                    return false;
                }
                goalOperations++;
                const e = make(candidate);
                if (!e || !SAME_ELEMENT(e, goal) || !apply(e, false, true)) return false;
                const quota = goalOnly(left - 1);
                graph.rollback(before);
                return quota;
            };
            // 关联（在线点 / 圆心＋圆上点）只是**提案过滤**，绝不用目标系数直接落点
            for (const goal of graph.goalElements) {
                if (stop(false)) return false;
                if (!validProbeElement(goal) || graph.hasElement(goal)) continue;
                if ((goal.type === TYPE_LINE && this.toolType === 0) ||
                    (goal.type === TYPE_CIRCLE && this.toolType === 1)) continue;
                const rim = [];
                const centers = [];
                for (let i = 0; i < graph.points.length; i++) {
                    if (stop(false)) return false;
                    if (graph.pointOnElement(graph.points[i], goal)) rim.push(i);
                    if (goal.type === TYPE_CIRCLE && SAME_POINT(graph.points[i], {x: goal.a, y: goal.b})) {
                        centers.push(i);
                    }
                }
                if (goal.type === TYPE_LINE) {
                    for (let i = 0; i < rim.length; i++) {
                        for (let j = i + 1; j < rim.length; j++) {
                            if (stop(false)) return false;
                            if (attempt(pointCandidate(rim[i], rim[j], false), goal)) return true;
                        }
                    }
                } else {
                    for (const center of centers) {
                        for (const through of rim) {
                            if (stop(false)) return false;
                            if (center !== through && attempt(pointCandidate(center, through, true), goal)) return true;
                        }
                    }
                }
            }
            return false;
        };

        if (goalOnly(remaining)) return true;
        if (remaining === 0 || stop(true)) return false;

        /** 只对真 apply 过的状态打分（目标点/目标元素的完成度） 过程函数 */
        const score = () => {
            let value = 0;
            for (const p of graph.goalPoints) {
                if (stop(false)) return value;
                if (graph.hasPoint(p)) value += 1024;
            }
            for (const goal of graph.goalElements) {
                if (stop(false)) return value;
                if (graph.hasElement(goal)) {
                    value += 1024;
                    continue;
                }
                if (!validProbeElement(goal) ||
                    (goal.type === TYPE_LINE && this.toolType === 0) ||
                    (goal.type === TYPE_CIRCLE && this.toolType === 1)) continue;
                let hits = 0;
                let center = false;
                for (const p of graph.points) {
                    if (stop(false)) return value;
                    if (graph.pointOnElement(p, goal)) hits++;
                    if (goal.type === TYPE_CIRCLE && SAME_POINT(p, {x: goal.a, y: goal.b})) center = true;
                }
                value += Math.min(hits, 8);
                if (goal.type === TYPE_CIRCLE) value += center ? 16 : 0;
                if (goal.type === TYPE_LINE ? hits >= 2 : (center && hits >= 1)) value += 128;
            }
            return value;
        };

        const proposals = [];
        let full = false;
        for (let i = 0; i < root.pointCount && !full; i++) {
            for (let j = i + 1; j < root.pointCount && !full; j++) {
                const firstTool = this.toolType === 1 ? 2 : 0;
                const endTool = this.toolType === 0 ? 2 : 3;
                for (let tool = firstTool; tool < endTool; tool++) {
                    if (stop(false)) return false;
                    if (auxiliaryOperations >= MAX_AUXILIARY) {
                        full = true;
                        break;
                    }
                    auxiliaryOperations++;
                    const candidate = {i: i, j: j, tool: tool};
                    const e = make(candidate);
                    if (!e || !apply(e, true, false)) continue;
                    const priority = score();
                    graph.rollback(root);
                    if (stop(false)) return false;
                    proposals.push({candidate: candidate, priority: priority});
                }
            }
        }
        if (stop(true)) return false;
        proposals.sort((a, b) => b.priority - a.priority);
        for (const proposal of proposals) {
            if (stop(true)) return false;
            const e = make(proposal.candidate);
            if (!e || !apply(e, false, false)) continue;
            const quota = goalOnly(remaining - 1);
            graph.rollback(root);
            if (quota) return true;
        }
        return false;
    }

    /**
     * 结构收尾入口 过程函数（C++ StructuralCompletion）
     * 只在前 4 个 beam 条目上、且还剩 3~4 步时跑；每个**有序前缀**只试一次
     *（去重表 128 条、累计时间上限 6 秒、单次 ≤0.6s 且不超过剩余时间的 5%）。
     * 注：C++ 在 remaining == 3 时走的是 `point_join`（还没搬），这里只做 remaining == 4 的 chain_join。
     */
    structuralCompletion(prefix, remaining, rank) {
        if (!this.options.structural || !this.options.adaptive) return;
        if (!this.baseGraph.goalPoints.length) return;
        if (remaining !== 3 && remaining !== 4) return;
        if (this.toolType === 0 || rank >= 4) return;
        if (this.structureSeen.size >= 128 || this.structuralSeconds >= 6.0) return;
        const key = prefix.map(rawElementKey).join(',');
        if (this.structureSeen.has(key)) return;
        this.structureSeen.add(key);
        this.checkNow();
        const left = Math.max(0, (this.deadline - HEURISTIC_NOW()) / 1000);
        const budget = Math.min(0.6, left * 0.05, 6.0 - this.structuralSeconds);
        if (budget < 0.005) return;
        const started = HEURISTIC_NOW();
        const end = started + budget * 1000;
        if (remaining === 4) {
            this.metrics.chainCalls++;
            this.chainJoinSearch(this.graph, remaining, end);
        } else {
            // remaining == 3：C++ 走的是「点会合」（把差的那一个点用两刀以内的直线命中）
            this.metrics.pointJoinCalls++;
            this.pointJoinSearch(this.graph, remaining, end);
        }
        this.structuralSeconds += (HEURISTIC_NOW() - started) / 1000;
    }

    /**
     * 等半径探针 过程函数（C++ equal_radius_detail::Probe）
     * 在「已经花过钱的父图」上跑一条**定长半径链**，全部用普通已知点对操作传递同一个半径：
     *   圆(中心,经过) → 新生点 R → 圆(R,中心) → 载线 → 新生点 S → 圆(S,R) → 供货一步。
     * R 真的生在第一圆上、S 真的生在倒数圆上（半径靠点关联传递，**不用**任何「圆规搬半径」的自由操作）；
     * 供货那一步只认**真实求交出生**的新点，预览不算数。
     * 所有上限（首圆 32 / 新心 8 / 载线 128 / 供货候选 4096 / 提案 64 / 回调 32）都是启发式配额，
     * 不是等价性或完备性的声明。
     * @param {Graph} parent 已花过钱的父图
     * @param {number} remaining 父图之后**还能作几步**
     * @param {number} deadline 探针自己的时间上限
     * @param {Function} complete (graph, remainingLeft) => boolean 提交回调（回调自己管尾段时间）
     * @returns {boolean} 回调收下（且收够解数）为 true
     */
    equalRadiusProbe(parent, remaining, deadline, complete) {
        const MAX_ROOT_POINTS = 8;
        const MAX_PARENT_POINTS = 128;
        const MAX_PARENT_ELEMENTS = 16;
        const MAX_FIRST_CIRCLES = 32;
        const MAX_NEW_CENTERS = 8;
        const MAX_CARRIER_LINES = 128;
        const MAX_SUPPLY_OPERATIONS = 4096;
        const MAX_SUPPLY_PROPOSALS = 64;
        const MAX_CALLBACKS = 32;
        const MAX_GOALS = 16;

        if (this.toolType !== 2 || remaining < 6) return false;
        if (parent.points.length < 2 || parent.points.length > MAX_PARENT_POINTS) return false;
        if (parent.elements.length > MAX_PARENT_ELEMENTS) return false;
        if (validateProbeParent(parent) < 0) return false;
        if (!parent.goalPoints.length && !parent.goalElements.length) return false;

        const roots = [];
        for (let i = 0; i < parent.points.length && parent.pointBirth[i] === 0; i++) roots.push(i);
        if (roots.length < 2 || roots.length > MAX_ROOT_POINTS) return false;

        // 自己的时间上限：最多 2 秒，且不超过全局剩余时间的 10%
        let end = Math.min(deadline, HEURISTIC_NOW() + 2000);
        const globalLeft = this.deadline - HEURISTIC_NOW();
        if (globalLeft <= 0) return false;
        end = Math.min(end, HEURISTIC_NOW() + globalLeft / 10);

        const graph = parent.clone();
        const root = graph.getMark();
        let cancelled = false;
        let ticks = 0;
        let callbacks = 0;
        const stop = force => {
            if (cancelled) return true;
            if (callbacks >= MAX_CALLBACKS) {
                this.metrics.radiusProbeCapHits++;
                return true;
            }
            if (!force && (++ticks & 63)) return false;
            cancelled = this.control.stop || HEURISTIC_NOW() >= end;
            return cancelled;
        };
        const make = candidate => {
            this.stats.rawCandidates++;
            return graph.makeCandidate(candidate);
        };
        const apply = candidate => {
            if (stop(true)) return false;
            if (candidate.i >= graph.points.length || candidate.j >= graph.points.length) return false;
            if (candidate.i === candidate.j) return false;
            if (SAME_POINT(graph.points[candidate.i], graph.points[candidate.j])) return false;
            const e = make(candidate);
            if (!validProbeElement(e)) return false;
            if (graph.hasElement(e)) {
                this.stats.existingCandidates++;
                return false;
            }
            const birth = graph.elements.length - graph.initialElementCount + 1;
            if (!graph.apply(e, birth)) return false;
            this.metrics.probeApplied++;
            this.stats.uniqueCandidates++;
            this.stats.applied++;
            this.stats.nodes++;
            this.stats.maxPoints = Math.max(this.stats.maxPoints || 0, graph.points.length);
            this.stats.maxElements = Math.max(this.stats.maxElements || 0, graph.elements.length);
            return true;
        };
        const handoff = () => {
            if (stop(true)) return false;
            if (callbacks >= MAX_CALLBACKS) {
                this.metrics.radiusProbeCapHits++;
                return false;
            }
            callbacks++;
            this.metrics.prerequisiteCompletions++;
            const spent = graph.elements.length - parent.elements.length;
            const quota = complete(graph, remaining - spent);
            if (quota) {
                this.metrics.radiusProbeSolutions++;
                return true;
            }
            stop(true);
            return false;
        };

        // 目标：还缺的目标点（显式点优先于「落在目标元素上」的偶然点）+ 还缺的目标元素
        const targetPoints = [];
        const targetElements = [];
        for (const p of parent.goalPoints) {
            if (stop(false)) return false;
            if (!isFinite(p.x) || !isFinite(p.y)) continue;
            if (typeof parent.pointAllowed === 'function' && !parent.pointAllowed(p)) continue;
            if (parent.hasPoint(p)) continue;
            if (targetPoints.length >= MAX_GOALS) {
                this.metrics.radiusProbeCapHits++;
                break;
            }
            targetPoints.push(p);
        }
        for (const e of parent.goalElements) {
            if (stop(false)) return false;
            if (parent.hasElement(e)) continue;
            if (targetElements.length >= MAX_GOALS) {
                this.metrics.radiusProbeCapHits++;
                break;
            }
            targetElements.push(e);
            // 缺的目标圆还有个隐含前提：圆心得先成为已知点
            if (e.type === TYPE_CIRCLE && !parent.hasPoint({x: e.a, y: e.b}) &&
                targetPoints.length < MAX_GOALS) {
                targetPoints.push({x: e.a, y: e.b});
            }
        }
        if ((!targetPoints.length && !targetElements.length) || stop(true)) return false;

        /** 供货一步 过程函数：用普通已知点对造出「目标点 / 目标元素上的点」 */
        const supplyGoalPoint = newBegin => {
            const four = graph.getMark();
            if (stop(true)) return false;
            if (graph.goalsMet()) return handoff();
            const missing = targetPoints.filter(p => !graph.hasPoint(p));
            const missingElements = targetElements.filter(e => !graph.hasElement(e));
            const priority = p => {
                if (!isFinite(p.x) || !isFinite(p.y)) return 0;
                if (typeof graph.pointAllowed === 'function' && !graph.pointAllowed(p)) return 0;
                for (const goal of missing) if (SAME_POINT(p, goal)) return 2;
                for (const goal of missingElements) if (graph.pointOnElement(p, goal)) return 1;
                return 0;
            };
            const candidates = [];
            let capped = false;
            // 优先「新生点 Q 连任意根锚」的直线，随后是普通全点对枚举（在同一配额内）
            for (let q = newBegin; q < graph.points.length && !capped; q++) {
                for (const anchor of roots) {
                    if (stop(false)) return false;
                    if (candidates.length >= MAX_SUPPLY_OPERATIONS) {
                        this.metrics.radiusProbeCapHits++;
                        capped = true;
                        break;
                    }
                    candidates.push(pointCandidate(q, anchor, false));
                }
            }
            let full = capped;
            for (let i = 0; i < graph.points.length && !full; i++) {
                for (let j = i + 1; j < graph.points.length && !full; j++) {
                    if (stop(false)) return false;
                    for (let tool = 0; tool < 3; tool++) {
                        if (candidates.length >= MAX_SUPPLY_OPERATIONS) {
                            this.metrics.radiusProbeCapHits++;
                            full = true;
                            break;
                        }
                        // 「新生点连根锚」的直线上面已经收过了
                        if (tool === 2 && j >= newBegin && graph.pointBirth[i] === 0) continue;
                        candidates.push({i: i, j: j, tool: tool});
                    }
                }
            }
            const proposals = [];
            for (const candidate of candidates) {
                if (stop(false)) return false;
                if (SAME_POINT(graph.points[candidate.i], graph.points[candidate.j])) continue;
                const e = make(candidate);
                if (!validProbeElement(e)) continue;
                if (graph.hasElement(e)) {
                    this.stats.existingCandidates++;
                    continue;
                }
                let pointDirected = false;
                for (const p of missing) {
                    if (graph.pointOnElement(p, e)) {
                        pointDirected = true;
                        break;
                    }
                }
                if (!pointDirected && !missingElements.length) continue;
                let score = 0;
                for (const old of graph.elements) {
                    if (stop(false)) return false;
                    graph.visitIntersections(e, old, p => {
                        if (!graph.hasPoint(p)) score = Math.max(score, priority(p));
                        return score === 2;
                    });
                    if (score === 2) break;
                }
                if (score === 0) continue;
                proposals.push({candidate: candidate, priority: score});
                if (proposals.length >= MAX_SUPPLY_PROPOSALS) {
                    this.metrics.radiusProbeCapHits++;
                    break;
                }
            }
            // 稳定排序：同优先级保持「普通点对 / 真实新点」的原有顺序
            proposals.sort((left, right) => right.priority - left.priority);
            for (const proposal of proposals) {
                if (stop(true) || callbacks >= MAX_CALLBACKS) return false;
                graph.rollback(four);
                if (!apply(proposal.candidate)) continue;
                let supplied = false;
                for (let i = four.pointCount; i < graph.points.length; i++) {
                    if (priority(graph.points[i]) !== 0) {
                        supplied = true;
                        break;
                    }
                }
                // 预览不算证据：只有**真的被 apply 生出来**的点才算供货成功
                if (supplied && handoff()) return true;
            }
            graph.rollback(four);
            return false;
        };

        // 外层：首圆（中心、经过 都是根点）
        let firstCount = 0;
        for (const center of roots) {
            for (const through of roots) {
                if (stop(true) || callbacks >= MAX_CALLBACKS) return false;
                if (center === through) continue;
                if (firstCount++ >= MAX_FIRST_CIRCLES) {
                    this.metrics.radiusProbeCapHits++;
                    return false;
                }
                graph.rollback(root);
                if (!apply(pointCandidate(center, through, true))) continue;
                const first = graph.elements[graph.elements.length - 1];
                const one = graph.getMark();
                let rCount = 0;
                // 新生点 R：必须真的落在首圆上
                for (let r = root.pointCount; r < one.pointCount; r++) {
                    if (stop(true) || callbacks >= MAX_CALLBACKS) return false;
                    graph.rollback(one);
                    if (!graph.pointOnElement(graph.points[r], first)) continue;
                    if (rCount++ >= MAX_NEW_CENTERS) {
                        this.metrics.radiusProbeCapHits++;
                        break;
                    }
                    if (!apply(pointCandidate(r, center, true))) continue;
                    const second = graph.elements[graph.elements.length - 1];
                    const two = graph.getMark();
                    // 载线：先根点对，再（新生点、根锚）
                    const carriers = [];
                    for (let i = 0; i < roots.length; i++) {
                        for (let j = i + 1; j < roots.length; j++) {
                            carriers.push(pointCandidate(roots[i], roots[j], false));
                        }
                    }
                    for (let q = 0; q < two.pointCount && carriers.length < MAX_CARRIER_LINES; q++) {
                        if (graph.pointBirth[q] === 0) continue;
                        for (const anchor of roots) {
                            if (carriers.length >= MAX_CARRIER_LINES) {
                                this.metrics.radiusProbeCapHits++;
                                break;
                            }
                            carriers.push(pointCandidate(q, anchor, false));
                        }
                    }
                    for (const carrier of carriers) {
                        if (stop(true) || callbacks >= MAX_CALLBACKS) return false;
                        graph.rollback(two);
                        if (!apply(carrier)) continue;
                        const three = graph.getMark();
                        let sCount = 0;
                        // 新生点 S：必须真的落在倒数圆上
                        for (let s = two.pointCount; s < three.pointCount; s++) {
                            if (stop(true) || callbacks >= MAX_CALLBACKS) return false;
                            graph.rollback(three);
                            if (!graph.pointOnElement(graph.points[s], second)) continue;
                            if (sCount++ >= MAX_NEW_CENTERS) {
                                this.metrics.radiusProbeCapHits++;
                                break;
                            }
                            if (!apply(pointCandidate(s, r, true))) continue;
                            this.metrics.radiusProbePrefixes++;
                            if (supplyGoalPoint(three.pointCount)) return true;
                        }
                    }
                }
            }
        }
        // 返回 false 表示「未知」（回调拿到解但没到配额也算未知），绝不是「穷尽」
        return false;
    }

    /** 等半径探针的入口 过程函数（C++ EqualRadiusCompletion） */
    equalRadiusCompletion() {
        if (!this.options.structural || !this.options.adaptive) return;
        if (this.toolType !== 2 || this.limit < 6) return;
        if (this.baseGraph.points.length > 8) return;
        this.checkNow();
        const left = Math.max(0, (this.deadline - HEURISTIC_NOW()) / 1000);
        const seconds = Math.min(2.0, left * 0.1);
        if (!(seconds > 0.01)) return;
        const end = HEURISTIC_NOW() + seconds * 1000;
        this.metrics.radiusProbeCalls++;
        const complete = (graph, remainingLeft) => {
            this.checkNow();
            if (graph.goalsMet()) return this.submit(graph, true);
            if (remainingLeft < 1 || !this.options.tailCandidates || !this.options.tailSeconds) return false;
            if (HEURISTIC_NOW() >= end) return false;
            this.metrics.prerequisiteCompletions++;
            this.tailHelper(graph.elements.slice(graph.initialElementCount), 0.03);
            return this.control.found;
        };
        this.equalRadiusProbe(this.baseGraph, this.limit, end, complete);
        this.checkNow();
    }

    /**
     * 探针族入口 过程函数（C++ PrerequisiteCompletion 的简化版）
     * 只在「尺规 + 有目标直线 + 自适应风格」时跑，最多拿走剩余时间的 10%（且不超过 2 秒）。
     * 目前接的是**切线探针**；直径 / 位似 / 等半径探针还没搬（见 TODO.md 2.1）
     */
    prerequisiteCompletion() {
        // 这里判的是**选项**（与 C++ 一致）：`adaptiveStyle` 要等第一轮 ConfigurePortfolio 才有值，
        // 探针排在重启循环之前，用它会永远进不来
        if (!this.options.prerequisites || !this.options.structural || !this.options.adaptive) return;
        if (this.toolType !== 2 || !this.baseGraph.goalElements.length) return;
        this.checkNow();
        const left = Math.max(0, (this.deadline - HEURISTIC_NOW()) / 1000);
        const seconds = Math.min(2.0, left * 0.1);
        if (!(seconds > 0.01)) return;
        const end = HEURISTIC_NOW() + seconds * 1000;
        this.metrics.prerequisiteCalls++;
        // 三个探针共用的「收尾」：直接达成 → 交解；否则把它作出来的前缀交给真 DFS 收一小段
        //（与 C++ 的 TailHelper 同一手法，30ms 一片）
        const direct = (graph, remainingLeft) => {
            this.checkNow();
            if (graph.goalsMet()) return this.submit(graph, true);
            if (remainingLeft < 1 || HEURISTIC_NOW() >= end) return false;
            // C++ FinishPrerequisite：先跑一小片「目标收尾」（40ms）
            this.metrics.goalFinishCalls++;
            const slice = Math.min(end, HEURISTIC_NOW() + 40);
            if (this.goalFinishSearch(graph, Math.min(remainingLeft, 6), slice)) return true;
            if (this.control.stop || remainingLeft < 2 || remainingLeft > 4 || HEURISTIC_NOW() >= end) return false;
            // 单圆圆心收尾（C++ 同一处）：目标只有一个圆时，先用几刀点会合把圆心拿到
            if (this.circleCenterFinish(graph, remainingLeft, end)) return true;
            if (this.control.stop || HEURISTIC_NOW() >= end) return false;
            // 再补一段真 DFS 尾（C++ 只在等半径那一档有；这里当超集保留，只认成功）
            if (!this.options.tailCandidates || !this.options.tailSeconds) return false;
            this.metrics.prerequisiteCompletions++;
            this.tailHelper(graph.elements.slice(graph.initialElementCount), 0.03);
            return this.control.found;
        };
        // 顺序：直径（C++ 排第一）→ 镜像（C++ 里写好了却没接上，这里接在直径之后）→ 切线
        //（C++ 把切线套在位似探针的完成回调里；位似还没搬，先直接对着初始图跑）
        this.diameterProbe(this.baseGraph, this.limit, end, direct);
        if (!this.control.stop && HEURISTIC_NOW() < end) {
            this.mirrorProbe(this.baseGraph, this.limit, end, direct);
        }
        if (!this.control.stop && HEURISTIC_NOW() < end) {
            this.tangentProbe(this.baseGraph, this.limit, end, direct);
        }
        this.checkNow();
    }

    /** 这一轮重启的权重与风格 过程函数（C++ ConfigurePortfolio） */
    configurePortfolio(restart) {
        this.random.state = heuristicSplitMix64(
            BigInt(this.options.seed) ^ heuristicSplitMix64(BigInt(restart) + 0xd1b54a32d192ed03n)) & HEURISTIC_MASK64;
        this.weights = Object.assign({}, HEURISTIC_BASE_WEIGHTS);
        const varied = () => 0.55 + 1.35 * this.random.unit();
        this.weights.support *= varied();
        this.weights.prerequisite *= varied();
        this.weights.direction *= varied();
        this.weights.proximity *= varied();
        this.weights.growth *= varied();
        // 单线程：风格只按重启次数轮换（C++ 多线程时再叠 workerId）
        const style = restart % 4;
        if (style === 1) {
            this.weights.support *= 2.0;
            this.weights.growth *= 0.5;
        }
        if (style === 2) {
            this.weights.prerequisite *= 2.0;
            this.weights.proximity = 0.0;
        }
        if (style === 3) {
            this.weights.direction *= 2.0;
            this.weights.growth *= 3.0;
        }
        this.diversityDivisor = style === 3 ? 2 : 4;
        this.bridgeStyle = style === 3;   // 样式 3 的 BridgeScore 前瞻尚未移植
        this.adaptiveStyle = this.options.adaptive && this.baseGraph.goalElements.length > 0 && restart % 2 === 0;
        this.noveltyStyle = this.adaptiveStyle && restart % 4 === 0;
        // 反向地标只在部分重启上开（单线程：每 4 轮一次；显式打开 options.landmarks 则每轮都开）
        this.landmarkStyle = this.options.landmarks ||
            (this.options.adaptive && this.baseGraph.goalElements.length > 0 && restart % 4 === 0);
        if (this.adaptiveStyle) {
            // 不带来新目标结构的「长大」只是平台期
            this.weights.growth = restart % 3 === 0 ? 0.0 : this.weights.growth * 0.2;
            this.weights.proximity = 0.0;
        }
    }

    /** 跑一轮 beam 过程函数（C++ OneRestart） */
    oneRestart() {
        let beam = [{prefix: [], score: 0.0, serial: 0, diversity: 0n}];
        this.metrics.peakBeam = Math.max(this.metrics.peakBeam, 1);
        this.stats.nodes++;
        for (let depth = 0; depth < this.limit && beam.length; depth++) {
            this.depth = depth;
            this.checkNow();
            this.metrics.layers++;
            const remaining = this.limit - depth;
            const next = new HeuristicPool(
                this.options.beamWidth, this.diverseCount(this.options.beamWidth), this.metrics,
                'beamDiscarded');
            let families = null;
            if (this.noveltyStyle) {
                // 新颖度池：分数精英 3/4 + 家族随机排名吃满容量（见 novelty_pool.hpp）
                families = new HeuristicNoveltyPool(this.options.beamWidth, this.metrics);
            } else if (this.adaptiveStyle) {
                // 家族池：每个构造族只留一个代表，容量 4 倍，交给后面的「每父节点配额」再截到 beamWidth
                families = new HeuristicFamilyPool(this.options.beamWidth * 4, this.metrics);
            }
            for (let parent = 0; parent < beam.length; parent++) {
                this.checkNow();
                if (remaining <= 2 && parent < this.options.tailCandidates) {
                    this.tailHelper(beam[parent].prefix);
                }
                this.replay(beam[parent].prefix);
                // 结构收尾（C++ OneRestart：重放 → GoalLocked → Structural → 选候选）
                this.metrics.structuralCalls++;
                if (remaining === 3 || remaining === 4) this.metrics.structuralEligible++;
                this.structuralCompletion(beam[parent].prefix, remaining, parent);
                this.metrics.expanded++;
                const candidates = this.selectCandidates();
                for (const entry of candidates) {
                    this.poll();
                    const mark = this.graph.getMark();
                    this.graph.applyKnownNew(entry.element, depth + 1);
                    this.stats.applied++;
                    this.metrics.evaluated++;
                    if (this.submit(this.graph)) throw new HeuristicStop();
                    if (remaining > 1) {
                        const child = {
                            parent: parent,
                            element: entry.element,
                            serial: this.serial++,
                            diversity: this.random.next(),
                            score: this.wholeScore() + entry.bridge
                                // 地标的整图累计分（真 apply 之后再加，新生地标点也算）
                                + (this.landmarkStyle ? this.weights.prerequisite *
                                    this.landmarks.scoreState(this.graph, this.baseGraph.points.length) : 0),
                        };
                        if (families) families.offer(child, constructionFamily(beam[parent].prefix, entry.element));
                        else next.offer(child);
                    }
                    this.graph.rollback(mark);
                }
            }
            let survivors = families ? families.take() : next.take();
            if (this.adaptiveStyle && survivors.length > this.options.beamWidth) {
                // 每个父节点留配额，剩下的名额按随机排名补齐（C++ OneRestart 里那一段）
                const diversified = [];
                const parentCounts = new Array(beam.length).fill(0);
                const quota = Math.max(2, Math.floor(this.options.beamWidth / 8));
                const picked = new Array(survivors.length).fill(false);
                const elite = this.options.beamWidth - this.diverseCount(this.options.beamWidth);
                for (let i = 0; i < survivors.length && diversified.length < elite; i++) {
                    if (parentCounts[survivors[i].parent] >= quota) continue;
                    parentCounts[survivors[i].parent]++;
                    picked[i] = true;
                    diversified.push(survivors[i]);
                }
                const randomOrder = [];
                for (let i = 0; i < survivors.length; i++) if (!picked[i]) randomOrder.push(i);
                randomOrder.sort((a, b) => (survivors[a].diversity > survivors[b].diversity ? -1 : 1));
                for (const i of randomOrder) {
                    if (diversified.length >= this.options.beamWidth) break;
                    diversified.push(survivors[i]);
                }
                this.metrics.beamDiscarded += survivors.length - diversified.length;
                this.metrics.budgetLimited = true;
                diversified.sort((a, b) => b.score - a.score || a.serial - b.serial);
                survivors = diversified;
            }
            beam = survivors.map(child => {
                const prefix = beam[child.parent].prefix.concat([child.element]);
                return {prefix: prefix, score: child.score, serial: child.serial, diversity: child.diversity};
            });
            this.metrics.peakBeam = Math.max(this.metrics.peakBeam, beam.length);
        }
    }

    /**
     * 跑到时间到 / 收够解 过程函数（C++ Run）
     * 注意：这里结束**不代表**搜尽，调用方只能报「启发式已停止」
     */
    run() {
        try {
            // 先跑探针族（直径 / 镜像 / 切线 / 等半径）：对着题面里的几何结构做定向搜索，
            // 与 C++ 一样排在 beam 之前、只用剩余时间的一小片。
            // 顺序按 C++ 的 Run：目标只有一个圆时先前置探针再等半径，其余相反
            const singleCircleGoal = !this.baseGraph.goalPoints.length &&
                this.baseGraph.goalElements.length === 1 &&
                this.baseGraph.goalElements[0].type === TYPE_CIRCLE;
            if (singleCircleGoal) {
                this.prerequisiteCompletion();
                this.equalRadiusCompletion();
            } else {
                this.equalRadiusCompletion();
                this.prerequisiteCompletion();
            }
            // 反向地标：在初始图上 Build 一次（纯加分特征，之后只读；C++ Run 里紧跟探针之后）
            if (this.options.landmarks || (this.options.adaptive && this.baseGraph.goalElements.length)) {
                this.landmarks.build(this.baseGraph, this.toolType);
                this.metrics.landmarkAnchors = this.landmarks.anchors.length;
                this.metrics.landmarkGuides = this.landmarks.guides.length;
                this.metrics.landmarkProbes = this.landmarks.probes;
            }
            // 会合（C++ Run 里排在探针之后、beam 之前）：自适应风格且 limit ≥ 4 时跑，
            // 最多拿剩余时间的 25%（且不超过 12 秒）。它是纯粹的**找解**手段，失败不代表任何结论
            if (this.options.adaptive && this.limit >= 4 && !this.control.stop) {
                const leftSeconds = Math.max(0, (this.deadline - HEURISTIC_NOW()) / 1000);
                const seconds = Math.min(12.0, leftSeconds * 0.25);
                if (seconds > 0.01) {
                    this.metrics.rendezvousCalls++;
                    this.rendezvousSearch(HEURISTIC_NOW() + seconds * 1000);
                }
            }
            for (let restart = 0; ; restart++) {
                this.checkNow();
                // 覆盖线程（C++ coverageThreads == 0）：多 worker 时留**一个**继续跑普通 DFS 兜底，
                // 免得 beam 的排序陷在平台期上。本构建的启发式是单线程（threads 恒为 1），
                // 所以这一支不会触发 —— 单线程里的等价物是 worker 层「先启发式、找不到再回退 DFS」。
                if (this.options.adaptive && this.options.coverageThreads === 0 && this.options.restarts === 0 &&
                    this.options.threads > 1 && this.limit >= 4 && restart > 0 &&
                    this.options.tailCandidates && this.options.tailSeconds > 0) {
                    const insurance = new Solver(this.toolType, true, true, true, 0, 0, 1.0);
                    insurance.setSolutionCollector(this.collector);
                    const work = makeSearchStats();
                    this.metrics.tailCalls++;
                    insurance.searchPrefixTask(this.baseGraph.clone(), this.limit, [], work);
                    this.mergeStats(work);
                    this.metrics.helperSolutions += this.collector.entries.length ? 1 : 0;
                    this.checkNow();
                    return {timedOut: this.control.timedOut, metrics: this.metrics};
                }
                this.configurePortfolio(restart);
                this.metrics.restarts++;
                const oldCandidates = this.metrics.discarded;
                const oldBeam = this.metrics.beamDiscarded;
                this.oneRestart();
                this.checkNow();
                // 这一轮所有真实候选与状态都装下了 → 换个权重也得不到新信息（仍只是启发式结论）
                if (this.metrics.discarded === oldCandidates && this.metrics.beamDiscarded === oldBeam) break;
                if (this.options.restarts && restart + 1 >= this.options.restarts) {
                    this.metrics.budgetLimited = true;
                    break;
                }
            }
        } catch (error) {
            if (!(error instanceof HeuristicStop)) throw error;
        }
        return {timedOut: this.control.timedOut, metrics: this.metrics};
    }
}
