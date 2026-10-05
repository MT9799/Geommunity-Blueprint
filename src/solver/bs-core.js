/**
 * bs-core.js —— 作图搜索器的数值与图结构层
 *
 * 移植自 C++ 版（bs_v8.cpp，作者 Ander 与 zzzzzz）的 Graph / Element 部分。
 * 这一层只做几何与数据：点、直线/射线/线段/圆、交点、回滚标记、状态哈希。
 * 搜索策略在 bs-search.js，Worker 收发消息在 search-worker.js。
 *
 * 与 C++ 版的两处实现差异（都不影响结果）：
 *   1. 哈希只要求「同一次运行内自洽」，不要求与 C++ 的位模式一致，所以桶哈希用 32 位实现；
 *      状态哈希（只有启用置换表时才计算）用 BigInt 实现 64 位 splitmix64。
 *   2. SSE2 向量化的点关联扫描在 JS 里退化为逐点标量循环，判定条件与之一致。
 */

/**
 * 几何判定容差。C++ 版默认 1e-11，可用 --eps= 覆盖；这里由 Worker 在搜索前按需改写。
 * （importScripts 共享同一个全局词法作用域，所以这个绑定对本文件之外也可见。）
 */
let EPS = 1e-11;

const NO_BOUND = 4294967295; // uint32 max，表示「没有边界」
const DEFAULT_TIME_LIMIT_SECONDS = 30.0;

const TYPE_CIRCLE = 0;
const TYPE_LINE = 1;
const TYPE_RAY = 2;
const TYPE_SEGMENT = 3;

const IS_ZERO = v => Math.abs(v) < EPS;
const SQ = v => v * v;
const CLEAN_ZERO = v => (IS_ZERO(v) ? 0.0 : v);

const SAME_POINT = (p, q) => IS_ZERO(p.x - q.x) && IS_ZERO(p.y - q.y);

/** 两个元素是否同一几何对象（同类型 + 三个系数都在容差内相等） */
const SAME_ELEMENT = (e, f) =>
    e.type === f.type && IS_ZERO(e.a - f.a) && IS_ZERO(e.b - f.b) && IS_ZERO(e.c - f.c);

/** 直线系数规范化：b 不为零除以 b，否则除以 a（与原版 NormalizeOriginal 一致） */
function normalizeOriginal(element) {
    if (!IS_ZERO(element.b)) {
        element.a /= element.b;
        element.c /= element.b;
        element.b = 1.0;
    } else if (!IS_ZERO(element.a)) {
        element.c /= element.a;
        element.a = 1.0;
        element.b = 0.0;
    }
    element.a = CLEAN_ZERO(element.a);
    element.b = CLEAN_ZERO(element.b);
    element.c = CLEAN_ZERO(element.c);
}

/* ------------------------------------------------------------------
 * 鲁棒求交 常量与工具（移植自 C++ 的 src/robust_intersections.hpp）
 *
 * 这里所有界都是**二进制换算误差尺度**（1 ulp ≈ 2.2e-16），
 * 与应用侧几何容差 EPS（默认 1e-11，Worker 还会按图幅放大）是两码事，不能互相顶替。
 * 目的：严格相切的两个圆 / 直线与圆，二进制系数的舍入本身就会产生一个很小的正判别式，
 * 于是「凭空」多出两个交点 —— 假点会让搜索交出一个回放不过去的假解。
 * 原则（保守）：
 *   · 判别式落在误差带里（不确定接触）：只复用舍入误差内的**已知见证点**，
 *     或在多项式于**存下来的系数**里精确为零时才产出这个切点；
 *   · 判别式明确为正（良态交点）：照旧用原来的算式与顺序；
 *   · 低于舍入不确定度的真实新交点可能被漏掉 —— 这是保守方向（宁可不产点，也不造假点）。
 * ------------------------------------------------------------------ */
const ROBUST_U = Number.EPSILON;
/** 乘积下溢就不认展开有效（与 C++ 的 0x1p-900 同一量级） */
const ROBUST_MIN_PRODUCT = 1e-270;
/** Dekker 分裂常数 2^27 + 1 */
const SPLITTER = 134217729;

/** 无误差乘积 过程函数：JS 没有 fma，用 Dekker 分裂拿回乘积的舍入残差 */
function twoProduct(x, y) {
    const product = x * y;
    const c = SPLITTER * x;
    const xHigh = c - (c - x);
    const xLow = x - xHigh;
    const d = SPLITTER * y;
    const yHigh = d - (d - y);
    const yLow = y - yHigh;
    const error = ((xHigh * yHigh - product) + xHigh * yLow + xLow * yHigh) + xLow * yLow;
    return {product: product, error: error};
}

/**
 * 误差无损的浮点和 过程函数（Shewchuk 展开）
 * terms 里是互不重叠的部分和；isZero() 为真即「这一串运算的结果精确等于 0」
 */
class Expansion {
    constructor(x = 0.0) {
        this.terms = [];
        this.valid = true;
        if (x !== 0.0) this.terms.push(x);
    }
    addTerm(x) {
        if (!this.valid || !isFinite(x)) {
            this.valid = false;
            return;
        }
        let carry = x;
        const next = [];
        for (const y of this.terms) {
            const sum = carry + y;
            if (!isFinite(sum)) {
                this.valid = false;
                return;
            }
            const bv = sum - carry;
            const error = (carry - (sum - bv)) + (y - bv);
            if (error !== 0.0) next.push(error);
            carry = sum;
        }
        if (carry !== 0.0) next.push(carry);
        this.terms = next;
    }
    add(other) {
        for (const term of other.terms) this.addTerm(term);
        return this;
    }
    sub(other) {
        for (const term of other.terms) this.addTerm(-term);
        return this;
    }
    mulDouble(s) {
        const terms = this.terms.slice();
        this.terms = [];
        for (const term of terms) {
            const product = term * s;
            // 极端乘积（下溢到丢了残差）直接判无效，免得把「假相切」认证成精确零
            if (!isFinite(product) || Math.abs(product) < ROBUST_MIN_PRODUCT) {
                this.valid = false;
                return this;
            }
            const split = twoProduct(term, s);
            this.addTerm(split.error);
            this.addTerm(split.product);
        }
        return this;
    }
    mul(other) {
        const terms = this.terms.slice();
        this.terms = [];
        for (const x of terms) {
            for (const y of other.terms) {
                const product = x * y;
                if (!isFinite(product) || Math.abs(product) < ROBUST_MIN_PRODUCT) {
                    this.valid = false;
                    return this;
                }
                const split = twoProduct(x, y);
                this.addTerm(split.error);
                this.addTerm(split.product);
            }
        }
        return this;
    }
    isZero() {
        return this.valid && this.terms.length === 0;
    }
}

/** 两个圆是否在**存下来的二进制系数**上精确相切 过程函数 */
function exactCircleContact(first, second) {
    const x = new Expansion(second.a).sub(new Expansion(first.a));
    const y = new Expansion(second.b).sub(new Expansion(first.b));
    const d2 = x.mul(x).add(y.mul(y));
    const n = d2.add(new Expansion(first.c)).sub(new Expansion(second.c));
    const left = new Expansion(4.0).mul(d2).mul(new Expansion(first.c));
    return left.sub(n.mul(n)).isZero();
}

/** 直线与圆是否在**存下来的二进制系数**上精确相切 过程函数 */
function exactLineContact(line, circle) {
    const a = new Expansion(line.a);
    const b = new Expansion(line.b);
    const d = a.mul(new Expansion(circle.a)).add(b.mul(new Expansion(circle.b)))
        .sub(new Expansion(line.c));
    const left = a.mul(a).add(b.mul(b)).mul(new Expansion(circle.c));
    return left.sub(d.mul(d)).isZero();
}

/** 点是否落在元素的**换算误差尺度**内（不是 EPS 判等） 过程函数 */
function robustIncident(p, e) {
    let residual, scale;
    if (e.type === TYPE_CIRCLE) {
        const x = p.x - e.a;
        const y = p.y - e.b;
        const d2 = x * x + y * y;
        residual = d2 - e.c;
        scale = d2 + Math.abs(e.c);
    } else {
        const ax = e.a * p.x;
        const by = e.b * p.y;
        residual = (ax + by) - e.c;
        scale = Math.abs(ax) + Math.abs(by) + Math.abs(e.c);
    }
    return isFinite(residual) && isFinite(scale) && Math.abs(residual) <= 16.0 * ROBUST_U * scale;
}

/** 点坐标是否都有限 过程函数 */
function robustFinite(p) {
    return isFinite(p.x) && isFinite(p.y);
}

/**
 * 由系数构造元素 过程函数
 * 圆：a,b 是圆心，c 是半径平方；直线/射线/线段：a·x + b·y = c
 */
function makeElementFromCoefficients(a, b, c, type, bound = NO_BOUND) {
    const element = {a, b, c, bound, type};
    if (type === TYPE_LINE) normalizeOriginal(element);
    return element;
}

/** 由两个点构造元素 过程函数（圆以 p1 为圆心、过 p2；直线/射线/线段过 p1、p2） */
function makeElementFromPoints(p1, p2, type, bound = NO_BOUND) {
    let element;
    if (type === TYPE_CIRCLE) {
        element = {a: p1.x, b: p1.y, c: SQ(p1.x - p2.x) + SQ(p1.y - p2.y), bound, type};
    } else {
        element = {
            a: p2.y - p1.y,
            b: p1.x - p2.x,
            c: p1.x * p2.y - p1.y * p2.x,
            bound,
            type,
        };
        normalizeOriginal(element);
    }
    element.a = CLEAN_ZERO(element.a);
    element.b = CLEAN_ZERO(element.b);
    element.c = CLEAN_ZERO(element.c);
    return element;
}

/**
 * 量化 过程函数
 * 把系数按容差归到整数格上，用于哈希分桶（同桶才做精确比较，避免漏判）
 */
function quantize(value) {
    const q = Math.floor(value / EPS);
    if (!isFinite(q)) return 0;
    if (q < -9007199254740991) return -9007199254740991;
    if (q > 9007199254740991) return 9007199254740991;
    return q;
}

/** 32 位混合 过程函数（桶哈希用；只要求运行内自洽，不要求与 C++ 位模式相同） */
function mix32(h, v) {
    let x = (v | 0) + 0x9e3779b9;
    x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
    x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
    x ^= x >>> 16;
    return ((h ^ x) + 0x9e3779b9 + (h << 6) + (h >>> 2)) | 0;
}

/** 点分桶键 过程函数 */
function pointBucketKey(p) {
    return quantize(p.x) + ',' + quantize(p.y);
}

/** 元素分桶键 过程函数（同桶内才做精确比较） */
function elementBucketKey(e) {
    return quantize(e.a) + ',' + quantize(e.b) + ',' + quantize(e.c) + ',' + e.type;
}

/** 元素桶哈希（数值版，用于开放寻址表） 过程函数 */
function elementBucketHash(e) {
    let h = mix32(0, quantize(e.a) | 0);
    h = mix32(h, quantize(e.b) | 0);
    h = mix32(h, quantize(e.c) | 0);
    return mix32(h, e.type) >>> 0;
}

/* ---------- 64 位散列：只在启用置换表时用到，用 BigInt 实现 splitmix64 ---------- */

const MASK64 = (1n << 64n) - 1n;
const GOLDEN64 = 0x9e3779b97f4a7c15n;
const C1_64 = 0xbf58476d1ce4e5b9n;
const C2_64 = 0x94d049bb133111ebn;

/** 64 位 splitmix64 过程函数 */
function splitMix64(v) {
    v = (v + GOLDEN64) & MASK64;
    v = ((v ^ (v >> 30n)) * C1_64) & MASK64;
    v = ((v ^ (v >> 27n)) * C2_64) & MASK64;
    return (v ^ (v >> 31n)) & MASK64;
}

/** double 的位模式 过程函数（用 DataView 取，等价于 C++ bit_cast<uint64_t>） */
const DOUBLE_BUFFER = new DataView(new ArrayBuffer(8));

function bitsOf(value) {
    DOUBLE_BUFFER.setFloat64(0, CLEAN_ZERO(value));
    return DOUBLE_BUFFER.getBigUint64(0);
}

/** 点的原始哈希 过程函数 */
function hashPointRaw(p, seed) {
    const h = splitMix64(seed ^ bitsOf(p.x));
    return splitMix64(h ^ bitsOf(p.y));
}

/** 元素的原始哈希 过程函数（射线/线段还要区分边界，见 bound） */
function hashElementRaw(e, seed) {
    let h = splitMix64(seed ^ BigInt(e.type));
    h = splitMix64(h ^ bitsOf(e.a));
    h = splitMix64(h ^ bitsOf(e.b));
    h = splitMix64(h ^ bitsOf(e.c));
    return splitMix64(h ^ BigInt(e.bound));
}

/* ---------- 操作键 / 候选 / 回滚标记 / 统计 ---------- */

/** 操作键：用于「相邻两步的偏序」对称剪枝，可比较大小 */
function makeOperationKey(element) {
    return {
        type: element.type,
        a: CLEAN_ZERO(element.a),
        b: CLEAN_ZERO(element.b),
        c: CLEAN_ZERO(element.c),
    };
}

/** 操作键比较：与 C++ 的 tuple<uint8_t,double,double,double> 字典序一致 */
function compareOperationKey(left, right) {
    if (left.type !== right.type) return left.type < right.type ? -1 : 1;
    if (left.a !== right.a) return left.a < right.a ? -1 : 1;
    if (left.b !== right.b) return left.b < right.b ? -1 : 1;
    if (left.c !== right.c) return left.c < right.c ? -1 : 1;
    return 0;
}

const TOOL_CIRCLE_IJ = 0; // 以 i 为圆心、过 j 作圆
const TOOL_CIRCLE_JI = 1; // 以 j 为圆心、过 i 作圆
const TOOL_LINE_IJ = 2;   // 过 i、j 作直线

/** 新建统计计数 过程函数 */
function makeSearchStats() {
    return {
        nodes: 0,
        rawCandidates: 0,
        uniqueCandidates: 0,
        duplicateCandidates: 0,
        existingCandidates: 0,
        symmetryPruned: 0,
        applied: 0,
        lowerBoundPruned: 0,
        transpositionPruned: 0,
        streamDuplicates: 0,
        streamDedupOverflow: 0,
        finalStepPruned: 0,
        exactReachabilityPruned: 0,
        goalElementLowerBoundPruned: 0,
        jointPointLowerBoundPruned: 0,
        forcedGoalTailNodes: 0,
        forcedPointTailPruned: 0,
        tailOneCandidates: 0,
        preApplyLowerBoundPruned: 0,
        prerequisitePreviewTested: 0,
        prerequisitePreviewPruned: 0,
        gridExactDuplicates: 0,
        maxPoints: 0,
        maxElements: 0,
    };
}

/** 合并统计 过程函数（并行路径用；单线程也能安全调用） */
function mergeSearchStats(dst, src) {
    Object.keys(src).forEach(key => {
        if (key === 'maxPoints' || key === 'maxElements') dst[key] = Math.max(dst[key], src[key]);
        else dst[key] += src[key];
    });
    return dst;
}

/* ---------- 图：已知点 + 已作元素 + 目标 ---------- */

class Graph {
    constructor() {
        this.points = [];
        this.pointBirth = [];   // 每个点在第几层被作出（0 = 给定）
        this.elements = [];
        this.bounds = [];       // 射线/线段的边界（起点、方向点）
        this.goalPoints = [];
        this.goalElements = [];
        this.initialElementCount = 0;

        // 网格直尺模式：允许的点域是闭矩形 [0,m] × [0,n]
        this.gridMode = false;
        this.gridFast = true;
        this.gridLinesReady = false;
        this.gridM = 0;
        this.gridN = 0;

        this.stateHash1 = 0x243f6a8885a308d3n;
        this.stateHash2 = 0x13198a2e03707344n;
        this.stateHashEnabled = false;
    }

    /** 深拷贝（结果收集与并行任务用） 过程函数 */
    clone() {
        const copy = new Graph();
        copy.points = this.points.map(p => ({x: p.x, y: p.y}));
        copy.pointBirth = this.pointBirth.slice();
        copy.elements = this.elements.map(e => ({...e}));
        copy.bounds = this.bounds.map(b => ({p1: {...b.p1}, p2: {...b.p2}}));
        copy.goalPoints = this.goalPoints.map(p => ({x: p.x, y: p.y}));
        copy.goalElements = this.goalElements.map(e => ({...e}));
        copy.initialElementCount = this.initialElementCount;
        copy.gridMode = this.gridMode;
        copy.gridFast = this.gridFast;
        copy.gridLinesReady = this.gridLinesReady;
        copy.gridM = this.gridM;
        copy.gridN = this.gridN;
        copy.stateHash1 = this.stateHash1;
        copy.stateHash2 = this.stateHash2;
        copy.stateHashEnabled = this.stateHashEnabled;
        return copy;
    }

    pointAllowed(p) {
        return !this.gridMode || (isFinite(p.x) && isFinite(p.y) &&
            p.x >= 0.0 && p.x <= this.gridM && p.y >= 0.0 && p.y <= this.gridN);
    }

    /** 是否为自动铺下的网格线 过程函数 */
    isAutomaticGridLine(e) {
        if (!this.gridMode || !this.gridLinesReady || EPS >= 0.5 || e.type !== TYPE_LINE) return false;
        if (e.a === 1.0 && e.b === 0.0) return e.c >= 0.0 && e.c <= this.gridM && Math.trunc(e.c) === e.c;
        if (e.a === 0.0 && e.b === 1.0) return e.c >= 0.0 && e.c <= this.gridN && Math.trunc(e.c) === e.c;
        return false;
    }

    togglePointHash(p) {
        if (!this.stateHashEnabled) return;
        this.stateHash1 ^= hashPointRaw(p, 0xa4093822299f31d0n);
        this.stateHash2 ^= hashPointRaw(p, 0x082efa98ec4e6c89n);
    }

    toggleElementHash(e) {
        if (!this.stateHashEnabled) return;
        this.stateHash1 ^= hashElementRaw(e, 0x452821e638d01377n);
        this.stateHash2 ^= hashElementRaw(e, 0xbe5466cf34e90c6cn);
    }

    /** 点是否落在元素的（含范围的）有效部分上 过程函数 */
    isInRange(e, p) {
        if (e.type === TYPE_LINE) return true;
        if (e.type === TYPE_RAY || e.type === TYPE_SEGMENT) {
            if (e.bound === NO_BOUND || e.bound >= this.bounds.length) return false;
            const bound = this.bounds[e.bound];
            if (e.type === TYPE_RAY) {
                const dotx = (bound.p1.x - p.x) * (bound.p1.x - bound.p2.x);
                const doty = (bound.p1.y - p.y) * (bound.p1.y - bound.p2.y);
                return dotx + doty > -EPS;
            }
            const dotx = (bound.p1.x - p.x) * (bound.p2.x - p.x);
            const doty = (bound.p1.y - p.y) * (bound.p2.y - p.y);
            return dotx + doty < EPS;
        }
        return false;
    }

    /**
     * 不确定接触时的产出规则 过程函数（直线与圆、圆与圆共用）
     * 先在**舍入误差**内找一个确实同时落在两个元素上的已知见证点（按存点顺序），
     * 找不到再看多项式在存下来的系数里是否精确为零 —— 是才产出 foot，否则一个点都不产
     * （对应 C++ 的 VisitUncertainContact）
     */
    visitUncertainContact(e1, e2, foot, uncertainty, exactZero, visitor) {
        if (!robustFinite(foot) || !isFinite(uncertainty)) return false;
        for (let i = 0; i < this.points.length; i++) {
            const p = this.points[i];
            const slack = uncertainty + 16.0 * ROBUST_U *
                Math.max(Math.abs(p.x), Math.abs(p.y), Math.abs(foot.x), Math.abs(foot.y));
            if (Math.abs(p.x - foot.x) <= slack && Math.abs(p.y - foot.y) <= slack &&
                robustIncident(p, e1) && robustIncident(p, e2)) return visitor(p);
        }
        return exactZero() && visitor(foot);
    }

    /**
     * 直线与圆的交点遍历 过程函数
     * visitor 返回 true 表示提前结束（与 C++ 版约定一致）
     * v12：判别式先和**换算误差界**比 —— 落进误差带就是「不确定接触」，
     * 不再用 EPS 判零后直接产出切点（那会把舍入造出来的假交点当成真的）
     */
    visitLineCircle(line, circle, visitor) {
        const denom = SQ(line.a) + SQ(line.b);
        if (!(denom > 0.0) || !(circle.c >= 0.0)) return false;
        const ax = line.a * circle.a;
        const by = line.b * circle.b;
        const dist = ax + by - line.c;
        const delta = denom * circle.c - SQ(dist);
        const scale = Math.abs(ax) + Math.abs(by) + Math.abs(line.c);
        const error = 32.0 * ROBUST_U *
            (denom * circle.c + Math.abs(dist) * scale + ROBUST_U * SQ(scale));
        if (!isFinite(delta) || !isFinite(error)) return false;
        const emit = p => robustFinite(p) && this.isInRange(line, p) && visitor(p);
        if (delta < -error) return false;
        if (delta <= error) {
            const foot = {x: circle.a - line.a * dist / denom, y: circle.b - line.b * dist / denom};
            return this.visitUncertainContact(line, circle, foot, Math.sqrt(error) / denom,
                () => exactLineContact(line, circle), emit);
        }
        // 良态交点：保留原来的算式与 p1 / p2 顺序（不再有 EPS 量级的判别式夹取）
        const root = Math.sqrt(delta);
        const p1 = {
            x: circle.a - (line.a * dist + line.b * root) / denom,
            y: circle.b - (line.b * dist - line.a * root) / denom,
        };
        const p2 = {
            x: circle.a - (line.a * dist - line.b * root) / denom,
            y: circle.b - (line.b * dist + line.a * root) / denom,
        };
        if (emit(p1)) return true;
        return emit(p2);
    }

    /**
     * 两个圆的交点遍历 过程函数（对应 C++ 的 VisitCircleCircle）
     * 用**局部**根轴方程（对平移稳定），同样区分良态交点与不确定接触
     */
    visitCircleCircle(e1, e2, visitor) {
        if (!(e1.c >= 0.0) || !(e2.c >= 0.0)) return false;
        const dx = e2.a - e1.a;
        const dy = e2.b - e1.b;
        const d2 = SQ(dx) + SQ(dy);
        if (!(d2 > 0.0) || !isFinite(d2)) return false;
        const n = d2 + (e1.c - e2.c);
        const product = 4.0 * d2 * e1.c;
        const delta = product - SQ(n);
        const scale = d2 + e1.c + e2.c;
        const error = 32.0 * ROBUST_U * (product + Math.abs(n) * scale + ROBUST_U * SQ(scale));
        if (!isFinite(delta) || !isFinite(error)) return false;
        if (delta < -error) return false;
        const along = n / (2.0 * d2);
        const foot = {x: e1.a + dx * along, y: e1.b + dy * along};
        if (delta <= error) {
            return this.visitUncertainContact(e1, e2, foot, Math.sqrt(error / d2) / 2.0,
                () => exactCircleContact(e1, e2), visitor);
        }
        // 良态且平移不大时：仍走原来的「全局根轴」写法，保持代表元算式与产点顺序
        const globalScale = SQ(e1.a) + SQ(e1.b) + SQ(e2.a) + SQ(e2.b);
        if (delta > 1024.0 * error && globalScale <= 16.0 * scale) {
            const a = 2.0 * (e1.a - e2.a);
            const b = 2.0 * (e1.b - e2.b);
            const c = SQ(e1.a) - SQ(e2.a) + SQ(e1.b) - SQ(e2.b) - e1.c + e2.c;
            const symmetricZero = c === 0.0 && Math.abs(e1.a) === Math.abs(e2.a) &&
                Math.abs(e1.b) === Math.abs(e2.b) && e1.c === e2.c;
            const reliableConstant = symmetricZero ||
                Math.abs(c) > 32.0 * ROBUST_U * (globalScale + e1.c + e2.c);
            if (reliableConstant && (b === 0.0 || !IS_ZERO(b)) &&
                (c === 0.0 || !IS_ZERO(c)) && (!IS_ZERO(a) || !IS_ZERO(b))) {
                const radical = makeElementFromCoefficients(a, b, c, TYPE_LINE);
                const denom = SQ(radical.a) + SQ(radical.b);
                const dist = radical.a * e1.a + radical.b * e1.b - radical.c;
                const oldDelta = denom * e1.c - SQ(dist);
                if (oldDelta > EPS &&
                    (radical.a !== 0.0 || a === 0.0) &&
                    (radical.c !== 0.0 || c === 0.0)) {
                    return this.visitLineCircle(radical, e1, visitor);
                }
            }
        }
        // 与旧版「规范化根轴法线」的符号一致，从而保持产点顺序
        const sign = (!IS_ZERO(2.0 * dy) ? dy : dx) < 0.0 ? -1.0 : 1.0;
        const across = sign * Math.sqrt(delta) / (2.0 * d2);
        const p1 = {x: foot.x - dy * across, y: foot.y + dx * across};
        const p2 = {x: foot.x + dy * across, y: foot.y - dx * across};
        if (robustFinite(p1) && visitor(p1)) return true;
        return robustFinite(p2) && visitor(p2);
    }

    /** 点是否已经是已知点 过程函数 */
    hasPoint(p) {
        if (this.gridMode && this.gridFast && this.gridLinesReady && EPS < 0.5 && this.pointAllowed(p) &&
            p.x === Math.trunc(p.x) && p.y === Math.trunc(p.y)) {
            return true; // 每个整数格点都已在初始时被认为是已知点
        }
        for (let i = 0; i < this.points.length; i++) {
            if (SAME_POINT(this.points[i], p)) return true;
        }
        return false;
    }

    /** 已存元素与 e 是否同一对象（射线只看起点与方向、线段不分端点顺序） 过程函数 */
    sameStoredElement(e, f) {
        if (!SAME_ELEMENT(e, f)) return false;
        if (e.type !== TYPE_RAY && e.type !== TYPE_SEGMENT) return true;
        if (e.bound === NO_BOUND || f.bound === NO_BOUND ||
            e.bound >= this.bounds.length || f.bound >= this.bounds.length) {
            return false;
        }
        const be = this.bounds[e.bound];
        const bf = this.bounds[f.bound];
        if (e.type === TYPE_SEGMENT) {
            return (SAME_POINT(be.p1, bf.p1) && SAME_POINT(be.p2, bf.p2)) ||
                   (SAME_POINT(be.p1, bf.p2) && SAME_POINT(be.p2, bf.p1));
        }
        if (!SAME_POINT(be.p1, bf.p1)) return false;
        const ex = be.p2.x - be.p1.x;
        const ey = be.p2.y - be.p1.y;
        const fx = bf.p2.x - bf.p1.x;
        const fy = bf.p2.y - bf.p1.y;
        return ex * fx + ey * fy > EPS;
    }

    /** 图里是否已有该元素 过程函数 */
    hasElement(e) {
        if (this.gridFast && this.isAutomaticGridLine(e)) return true;
        for (let i = 0; i < this.elements.length; i++) {
            if (this.sameStoredElement(this.elements[i], e)) return true;
        }
        return false;
    }

    /** 加入一个已知点 过程函数（已存在或越界都不加） */
    addPoint(p, birth) {
        if (!this.pointAllowed(p)) return false;
        if (this.gridMode && this.gridFast && this.gridLinesReady && EPS < 0.5 &&
            p.x === Math.trunc(p.x) && p.y === Math.trunc(p.y)) {
            return false; // 整数格点必然已是已知点，省一次线性扫描
        }
        for (let i = 0; i < this.points.length; i++) {
            if (SAME_POINT(this.points[i], p)) return false;
        }
        this.points.push(p);
        this.pointBirth.push(birth);
        this.togglePointHash(p);
        return true;
    }

    /** 点是否在元素上（含范围判断） 过程函数 */
    pointOnElement(p, e) {
        if (e.type === TYPE_CIRCLE) {
            return IS_ZERO(SQ(p.x - e.a) + SQ(p.y - e.b) - e.c);
        }
        if (!IS_ZERO(e.a * p.x + e.b * p.y - e.c)) return false;
        return this.isInRange(e, p);
    }

    /**
     * 遍历「落在 e 上的已知点」的索引 过程函数
     * C++ 版对直线/圆走 SSE2 两路并行，这里退化为逐点判定，结果一致
     */
    visitPointIncidences(e, visit) {
        for (let i = 0; i < this.points.length; i++) {
            if (this.pointOnElement(this.points[i], e)) visit(i);
        }
    }

    /** 不做网格过滤的求交遍历 过程函数 */
    visitUnclippedIntersections(e1, e2, visitor) {
        if (e1.type === TYPE_CIRCLE) {
            // 圆圆交给专有的局部根轴实现（v12 的 VisitCircleCircle）
            if (e2.type === TYPE_CIRCLE) return this.visitCircleCircle(e1, e2, visitor);
            return this.visitLineCircle(e2, e1, visitor);
        }
        if (e2.type === TYPE_CIRCLE) return this.visitLineCircle(e1, e2, visitor);
        const det = e1.a * e2.b - e1.b * e2.a;
        if (IS_ZERO(det)) return false;
        const p = {
            x: (e1.c * e2.b - e1.b * e2.c) / det,
            y: (e1.a * e2.c - e1.c * e2.a) / det,
        };
        return this.isInRange(e1, p) && this.isInRange(e2, p) && visitor(p);
    }

    /** 求交遍历（网格模式下交点必须落在允许区域内） 过程函数 */
    visitIntersections(e1, e2, visitor) {
        if (!this.gridMode) return this.visitUnclippedIntersections(e1, e2, visitor);
        return this.visitUnclippedIntersections(e1, e2, p => this.pointAllowed(p) && visitor(p));
    }

    /** 求交并把交点记为已知点 过程函数 */
    intersect(e1, e2, birth) {
        this.visitIntersections(e1, e2, p => {
            this.addPoint(p, birth);
            return false;
        });
    }

    getMark() {
        return {pointCount: this.points.length, elementCount: this.elements.length};
    }

    /** 确定这是新元素后加入：先与所有已存元素求交，再入表 过程函数 */
    applyKnownNew(e, birth) {
        for (let i = 0; i < this.elements.length; i++) this.intersect(e, this.elements[i], birth);
        this.elements.push(e);
        this.toggleElementHash(e);
    }

    /** 加入元素（已存在则返回 false） 过程函数 */
    apply(e, birth) {
        if (this.hasElement(e)) return false;
        this.applyKnownNew(e, birth);
        return true;
    }

    /** 开关状态哈希（只有启用置换表时才需要） 过程函数 */
    setStateHashingEnabled(enabled) {
        this.stateHashEnabled = enabled;
        this.stateHash1 = 0x243f6a8885a308d3n;
        this.stateHash2 = 0x13198a2e03707344n;
        if (!enabled) return;
        this.points.forEach(p => this.togglePointHash(p));
        this.elements.forEach(e => this.toggleElementHash(e));
    }

    /** 回滚到标记处 过程函数 */
    rollback(mark) {
        while (this.elements.length > mark.elementCount) {
            this.toggleElementHash(this.elements[this.elements.length - 1]);
            this.elements.pop();
        }
        while (this.points.length > mark.pointCount) {
            this.togglePointHash(this.points[this.points.length - 1]);
            this.points.pop();
            this.pointBirth.pop();
        }
    }

    /** 加入带边界的初始元素（射线 / 线段） 过程函数 */
    addInitialBounded(p1, p2, type) {
        const boundIndex = this.bounds.length;
        this.bounds.push({p1: {...p1}, p2: {...p2}});
        const element = makeElementFromPoints(p1, p2, type, boundIndex);
        if (!this.apply(element, 0)) {
            this.bounds.pop();
            return false;
        }
        return true;
    }

    /** 加入初始元素 过程函数 */
    addInitial(element) {
        return this.apply(element, 0);
    }

    /**
     * 铺下网格线（模式 3） 过程函数
     * 网格线及其格点都不计 E；快速路径按行优先顺序一次性生成格点，避免二次扫描
     */
    addAutomaticGridLines() {
        if (!this.gridMode || this.gridLinesReady) return;
        if (this.gridFast && EPS < 0.5 && this.elements.length === 0) {
            for (let x = 0; x <= this.gridM; x++) {
                const e = makeElementFromCoefficients(1, 0, x, TYPE_LINE);
                this.elements.push(e);
                this.toggleElementHash(e);
            }
            for (let y = 0; y <= this.gridN; y++) {
                const e = makeElementFromCoefficients(0, 1, y, TYPE_LINE);
                this.elements.push(e);
                this.toggleElementHash(e);
            }
            const explicitCount = this.points.length;
            for (let y = 0; y <= this.gridN; y++) {
                for (let x = 0; x <= this.gridM; x++) {
                    const p = {x: x, y: y};
                    let duplicate = false;
                    for (let i = 0; i < explicitCount; i++) {
                        if (SAME_POINT(this.points[i], p)) {
                            duplicate = true;
                            break;
                        }
                    }
                    if (!duplicate) {
                        this.points.push(p);
                        this.pointBirth.push(0);
                        this.togglePointHash(p);
                    }
                }
            }
        } else {
            for (let x = 0; x <= this.gridM; x++) this.addInitial(makeElementFromCoefficients(1, 0, x, TYPE_LINE));
            for (let y = 0; y <= this.gridN; y++) this.addInitial(makeElementFromCoefficients(0, 1, y, TYPE_LINE));
        }
        this.gridLinesReady = true;
    }

    /** 目标是否全部达成 过程函数 */
    goalsMet() {
        for (let i = 0; i < this.goalPoints.length; i++) {
            if (!this.hasPoint(this.goalPoints[i])) return false;
        }
        for (let i = 0; i < this.goalElements.length; i++) {
            if (!this.hasElement(this.goalElements[i])) return false;
        }
        return true;
    }

    /**
     * 目标优先级的候选排序权重 过程函数
     * 2 = 候选本身就是还缺的目标直线/圆；1 = 不是目标元素但过还缺的目标点；0 = 普通辅助作图。
     * 只改变搜索顺序，不剪掉任何候选
     */
    goalPriority(candidate) {
        for (let i = 0; i < this.goalElements.length; i++) {
            const goal = this.goalElements[i];
            if (SAME_ELEMENT(goal, candidate) && !this.hasElement(goal)) return 2;
        }
        for (let i = 0; i < this.goalPoints.length; i++) {
            const p = this.goalPoints[i];
            if (this.pointOnElement(p, candidate) && !this.hasPoint(p)) return 1;
        }
        return 0;
    }

    isGoalDirected(candidate) {
        return this.goalPriority(candidate) > 0;
    }

    hasMissingGoalPoints() {
        for (let i = 0; i < this.goalPoints.length; i++) {
            if (!this.hasPoint(this.goalPoints[i])) return true;
        }
        return false;
    }

    /** 还缺的目标元素个数（去重后）——每次作图最多新增一个元素，所以它是最严格的步数下界 */
    missingDistinctGoalElementCount() {
        let missing = 0;
        for (let i = 0; i < this.goalElements.length; i++) {
            const goal = this.goalElements[i];
            if (this.hasElement(goal)) continue;
            let duplicate = false;
            for (let j = 0; j < i; j++) {
                if (SAME_ELEMENT(this.goalElements[j], goal)) {
                    duplicate = true;
                    break;
                }
            }
            if (!duplicate) missing++;
        }
        return missing;
    }

    /** 当前有几个已存元素过这个点（最多数到 2） 过程函数 */
    existingSupportCount(p) {
        let count = 0;
        for (let i = 0; i < this.elements.length; i++) {
            if (this.pointOnElement(p, this.elements[i]) && ++count >= 2) break;
        }
        return count;
    }

    /**
     * 目标点合计需要的「辅助步数」下界 过程函数
     * 先为每个还缺的目标直线/圆各预留一步，剩下的步数要够给每个目标点补足两条经过它的元素
     */
    requiredAuxiliaryStepsForGoalPoints() {
        let lower = 0;
        const includeRequiredPoint = p => {
            if (this.hasPoint(p)) return;
            const existing = Math.min(2, this.existingSupportCount(p));
            let forcedTargets = 0;
            for (let gi = 0; gi < this.goalElements.length; gi++) {
                const goal = this.goalElements[gi];
                if (this.hasElement(goal) || !this.pointOnElement(p, goal)) continue;
                let duplicate = false;
                for (let j = 0; j < gi; j++) {
                    if (SAME_ELEMENT(this.goalElements[j], goal)) {
                        duplicate = true;
                        break;
                    }
                }
                if (!duplicate) forcedTargets++;
            }
            const need = Math.max(0, 2 - existing - forcedTargets);
            lower = Math.max(lower, need);
        };

        this.goalPoints.forEach(includeRequiredPoint);

        // 还缺的目标圆有个隐含前提：圆心必须先成为已知点（圆规操作是「圆心 → 圆上一点」）
        for (let i = 0; i < this.goalElements.length; i++) {
            const goal = this.goalElements[i];
            if (goal.type !== TYPE_CIRCLE || this.hasElement(goal)) continue;
            let duplicate = false;
            for (let j = 0; j < i; j++) {
                if (SAME_ELEMENT(this.goalElements[j], goal)) {
                    duplicate = true;
                    break;
                }
            }
            if (!duplicate) includeRequiredPoint({x: goal.a, y: goal.b});
        }
        return lower;
    }

    /** 收集「剩下的每一步都必须过它」的目标点索引 过程函数 */
    collectForcedTailPointIndices(remaining, out) {
        out.length = 0;
        if (remaining <= 0 || remaining > 2) return out;
        for (let i = 0; i < this.goalPoints.length; i++) {
            const p = this.goalPoints[i];
            if (this.hasPoint(p)) continue;
            const existing = Math.min(2, this.existingSupportCount(p));
            const need = Math.max(0, 2 - existing);
            // 只剩 1 步时：**所有**还没取得的目标点都是必经点 —— 那唯一的一个新元素必须同时过它们。
            // 原来的「支持数」算法把「同一条载线上的射线 + 付费延长直线」当成两个支持，
            // 于是这种点在只剩 1E 时被排除在必经集合外，反向单步尾部直接报无解（漏解；
            // 已验证的第 7 题 12E 做法就被这么误判过）。v9 修复 2，见 C++ geometry.hpp 的
            // CollectForcedTailPointIndices（`if (remaining == 1 || need == remaining)`）
            if (remaining === 1 || need === remaining) out.push(i);
        }
        return out;
    }

    /** 候选是否经过所有被强制的目标点 过程函数 */
    candidatePassesForcedTailPoints(candidate, forced) {
        for (let i = 0; i < forced.length; i++) {
            if (!this.pointOnElement(this.goalPoints[forced[i]], candidate)) return false;
        }
        return true;
    }

    /** 现在是否能直接作出至少一个还缺的目标元素 过程函数 */
    anyMissingGoalElementDrawableNow(toolType) {
        for (let gi = 0; gi < this.goalElements.length; gi++) {
            const goal = this.goalElements[gi];
            if (this.hasElement(goal)) continue;
            let duplicate = false;
            for (let j = 0; j < gi; j++) {
                if (SAME_ELEMENT(this.goalElements[j], goal)) {
                    duplicate = true;
                    break;
                }
            }
            if (duplicate) continue;

            if (goal.type === TYPE_LINE) {
                if (toolType === 0) continue;
                let hits = 0;
                for (let i = 0; i < this.points.length; i++) {
                    if (this.pointOnElement(this.points[i], goal) && ++hits >= 2) return true;
                }
            } else if (goal.type === TYPE_CIRCLE) {
                if (toolType === 1 || IS_ZERO(goal.c)) continue;
                let center = -1;
                for (let i = 0; i < this.points.length; i++) {
                    if (SAME_POINT(this.points[i], {x: goal.a, y: goal.b})) {
                        center = i;
                        break;
                    }
                }
                if (center < 0) continue;
                for (let i = 0; i < this.points.length; i++) {
                    if (i !== center && this.pointOnElement(this.points[i], goal)) return true;
                }
            }
        }
        return false;
    }

    /** 一步之内能补齐所有还缺的目标元素吗（严格必要条件） 过程函数 */
    missingGoalElementsDrawableInOneStep(toolType) {
        let missingGoal = null;
        for (let i = 0; i < this.goalElements.length; i++) {
            const goal = this.goalElements[i];
            if (this.hasElement(goal)) continue;
            let duplicate = false;
            for (let j = 0; j < i; j++) {
                if (SAME_ELEMENT(this.goalElements[j], goal)) {
                    duplicate = true;
                    break;
                }
            }
            if (duplicate) continue;
            if (missingGoal !== null) return false;
            missingGoal = goal;
        }
        if (missingGoal === null) return true;

        if (missingGoal.type === TYPE_LINE) {
            if (toolType === 0) return false;
            let onLine = 0;
            for (let i = 0; i < this.points.length; i++) {
                if (this.pointOnElement(this.points[i], missingGoal) && ++onLine >= 2) return true;
            }
            return false;
        }
        if (missingGoal.type === TYPE_CIRCLE) {
            if (toolType === 1 || IS_ZERO(missingGoal.c)) return false;
            const center = {x: missingGoal.a, y: missingGoal.b};
            let centerId = -1;
            for (let i = 0; i < this.points.length; i++) {
                if (SAME_POINT(this.points[i], center)) {
                    centerId = i;
                    break;
                }
            }
            if (centerId < 0) return false;
            for (let i = 0; i < this.points.length; i++) {
                if (i !== centerId && this.pointOnElement(this.points[i], missingGoal)) return true;
            }
            return false;
        }
        return false;
    }

    /** 由候选（两点 + 工具）造元素 过程函数 */
    makeCandidate(candidate) {
        const pi = this.points[candidate.i];
        const pj = this.points[candidate.j];
        if (candidate.tool === TOOL_CIRCLE_IJ) return makeElementFromPoints(pi, pj, TYPE_CIRCLE);
        if (candidate.tool === TOOL_CIRCLE_JI) return makeElementFromPoints(pj, pi, TYPE_CIRCLE);
        return makeElementFromPoints(pi, pj, TYPE_LINE);
    }
}
