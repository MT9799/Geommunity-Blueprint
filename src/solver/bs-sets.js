/**
 * bs-sets.js —— 搜索用的三个辅助表（移植自 bs_v8.cpp）
 *
 *   BoundedElementSet   按层去重候选（容量到顶就不再记录，但绝不丢候选，保证搜索完整）
 *   TranspositionTable  「这个状态在剩余 r 步内失败过」的记忆（只在关掉对称剪枝时启用）
 *   SolutionCollector   解收集器：按「元素集合」去重（无视顺序）、按需收集 N 个不同的解
 *   ExactGridLineCache  网格模式下的精确重复直线缓存
 */

/* global EPS, SAME_ELEMENT, elementBucketHash, elementBucketKey, splitMix64, MASK64 */

/** 候选去重表：开放寻址 + 层代号（每进一个节点就换一代，免清零） */
class BoundedElementSet {
    constructor() {
        this.slots = [];
        this.mask = 0;
        this.maxEntries = 0;
        this.used = 0;
        this.generation = 1;
    }

    configure(maxEntries) {
        this.maxEntries = maxEntries;
        this.slots = [];
        this.mask = 0;
        this.used = 0;
        this.generation = 1;
    }

    allocateOnFirstInsert() {
        if (this.maxEntries === 0 || this.slots.length) return;
        let capacity = 1;
        while (capacity < this.maxEntries * 2) capacity <<= 1;
        this.slots = new Array(capacity);
        for (let i = 0; i < capacity; i++) this.slots[i] = {a: 0, b: 0, c: 0, type: 0, generation: 0};
        this.mask = capacity - 1;
    }

    beginNode() {
        this.used = 0;
        if (!this.slots.length) return;
        this.generation++;
        if (this.generation > 0x7fffffff) {
            for (let i = 0; i < this.slots.length; i++) this.slots[i].generation = 0;
            this.generation = 1;
        }
    }

    /** 在当前节点的探针链里找同一几何元素，返回槽位下标或 -1 */
    findBucket(e) {
        if (!this.slots.length) return -1;
        let pos = elementBucketHash(e) & this.mask;
        for (let probe = 0; probe < this.slots.length; probe++) {
            const slot = this.slots[pos];
            if (slot.generation !== this.generation) return -1;
            if (SAME_ELEMENT(slot, e)) return pos;
            pos = (pos + 1) & this.mask;
        }
        return -1;
    }

    /**
     * 记录候选 过程函数
     * @returns {'new'|'duplicate'|'untracked'} new = 首次记录；duplicate = 本层重复；
     *          untracked = 表已满，这个候选不再记录（搜索仍然完整，只是可能重复展开）
     */
    insert(e) {
        if (this.maxEntries === 0) return 'untracked';
        this.allocateOnFirstInsert();
        if (this.findBucket(e) >= 0) return 'duplicate';
        if (this.used >= this.maxEntries) return 'untracked';

        let pos = elementBucketHash(e) & this.mask;
        for (let probe = 0; probe < this.slots.length; probe++) {
            const slot = this.slots[pos];
            if (slot.generation !== this.generation) {
                slot.a = e.a;
                slot.b = e.b;
                slot.c = e.c;
                slot.type = e.type;
                slot.generation = this.generation;
                this.used++;
                return 'new';
            }
            pos = (pos + 1) & this.mask;
        }
        return 'untracked';
    }
}

/** 失败状态记忆表。只在「关掉了对称剪枝」的单线程搜索里启用（与 C++ 版策略一致） */
class TranspositionTable {
    constructor() {
        this.entries = [];
        this.mask = 0;
        // 每个条目的估算字节数（JS 对象约 48 字节），用于把「预算字节数」换算成槽位数
        this.bytesPerEntry = 48;
    }

    configure(bytes) {
        if (bytes < this.bytesPerEntry * 1024) {
            this.entries = [];
            this.mask = 0;
            return;
        }
        let count = 1;
        const maxCount = Math.floor(bytes / this.bytesPerEntry);
        while ((count << 1) <= maxCount) count <<= 1;
        this.entries = new Array(count);
        for (let i = 0; i < count; i++) {
            this.entries[i] = {h1: 0n, h2: 0n, pointCount: 0, elementCount: 0, remaining: 0, valid: false};
        }
        this.mask = count - 1;
    }

    enabled() {
        return this.entries.length > 0;
    }

    bytes() {
        return this.entries.length * this.bytesPerEntry;
    }

    index(h1, h2) {
        return Number(splitMix64(h1 ^ ((h2 << 1n) & MASK64)) & BigInt(this.mask));
    }

    wasFailed(h1, h2, pointCount, elementCount, remaining) {
        if (!this.entries.length) return false;
        const entry = this.entries[this.index(h1, h2)];
        return entry.valid && entry.h1 === h1 && entry.h2 === h2 &&
               entry.pointCount === pointCount && entry.elementCount === elementCount &&
               entry.remaining >= remaining;
    }

    storeFailed(h1, h2, pointCount, elementCount, remaining) {
        if (!this.entries.length) return;
        const entry = this.entries[this.index(h1, h2)];
        if (entry.valid && entry.h1 === h1 && entry.h2 === h2 &&
            entry.pointCount === pointCount && entry.elementCount === elementCount) {
            entry.remaining = Math.max(entry.remaining, remaining);
            return;
        }
        entry.h1 = h1;
        entry.h2 = h2;
        entry.pointCount = pointCount;
        entry.elementCount = elementCount;
        entry.remaining = remaining;
        entry.valid = true;
    }
}

/** 解收集器：等到状态确实达成目标才动它，中途不做任何签名与分配 */
class SolutionCollector {
    constructor(requested) {
        this.requested = Math.max(1, requested);
        this.entries = [];
        this.successfulVisits = 0;
        this.duplicateVisits = 0;
    }

    /**
     * 两个「元素集合」是否相同（忽略顺序） 过程函数
     * 用二分图完美匹配来判断，避免依赖系数输入顺序、也避免量化边界漏判
     */
    static sameUnorderedSet(a, b) {
        if (a.length !== b.length) return false;
        const matched = new Array(b.length).fill(-1);
        const augment = (i) => {
            for (let j = 0; j < b.length; j++) {
                if (seen[j] || !SAME_ELEMENT(a[i], b[j])) continue;
                seen[j] = true;
                if (matched[j] < 0 || augment(matched[j])) {
                    matched[j] = i;
                    return true;
                }
            }
            return false;
        };
        const seen = new Array(b.length);
        for (let i = 0; i < a.length; i++) {
            seen.fill(false);
            if (!augment(i)) return false;
        }
        return true;
    }

    /**
     * 提交一个达成目标的解 过程函数
     * @returns {boolean} true 表示「已经收够要求的解数」，搜索可以停了
     */
    submit(graph, control) {
        if (this.entries.length >= this.requested) return true;
        this.successfulVisits++;
        const newElements = graph.elements.slice(graph.initialElementCount).map(e => ({...e}));
        const circles = newElements.filter(e => e.type === 0).length;
        for (const old of this.entries) {
            if (old.circles === circles && SolutionCollector.sameUnorderedSet(newElements, old.newElements)) {
                this.duplicateVisits++;
                return false;
            }
        }
        // 不预分配：搜不到解时一个结果都不占
        this.entries.push({graph: graph.clone(), newElements, circles});
        if (this.entries.length < this.requested) return false;
        if (control) {
            control.found = true; // 这里的 found 表示「已收够」，不是「第一次找到」
            control.stop = true;
        }
        return true;
    }

    count() {
        return this.entries.length;
    }
}

/** 网格模式下的精确重复直线缓存（按位模式比较，避免量化误差） */
class ExactGridLineCache {
    constructor() {
        this.slots = null;
        this.generation = 0;
    }

    beginNode() {
        this.generation++;
        if (this.generation > 0x7fffffff) {
            if (this.slots) this.slots.forEach(s => { s.generation = 0; });
            this.generation = 1;
        }
    }

    insert(e) {
        if (!this.slots) {
            this.slots = new Array(1024);
            for (let i = 0; i < 1024; i++) this.slots[i] = {a: 0n, b: 0n, c: 0n, generation: 0};
        }
        const bits = value => {
            const buffer = new DataView(new ArrayBuffer(8));
            buffer.setFloat64(0, value);
            return buffer.getBigUint64(0);
        };
        const a = bits(e.a), b = bits(e.b), c = bits(e.c);
        const rotl = (value, count) => ((value << BigInt(count)) | (value >> BigInt(64 - count))) & MASK64;
        const h = Number(splitMix64(a ^ rotl(b, 21) ^ rotl(c, 42)) & 1023n);
        const slot = this.slots[h];
        if (slot.generation === this.generation && slot.a === a && slot.b === b && slot.c === c) return false;
        slot.a = a; slot.b = b; slot.c = c; slot.generation = this.generation;
        return true;
    }
}
