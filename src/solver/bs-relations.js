/**
 * bs-relations.js —— 关系雷达的判定内核（移植自 GeoSolver Pro V3 的「全域扫描」，见其 index.html 的 startAngleScan）
 *
 * 职责只有两件：
 *   ① `scan(board, options)`：给一张**画板快照**，按勾选的类别找出隐含关系（共线 / 共圆 / 平行垂直 /
 *      定点角 / 线上比 / 等距中心 / 角平分线 / 紧圆规）；
 *   ② `evaluateOverlay(overlay, lookup)`：拿扫描时存下的**对象 id**，按每个 id 现在的坐标重算一遍
 *      —— 于是画布上的紫色高亮能跟着图形走动；算不出来的（对象被删 / 关系已不成立）报成 stale。
 *
 * 移植时改掉的地方（对着原版逐条）：
 *   · 容差：原版写死绝对 1e-7。这里一律**相对图幅**（见 TOLERANCE_LEVELS），并且判定量都用长度 /
 *     无量纲量比较（点到线取垂距、角取夹角、比值取距离比），不拿未归一化的系数比大小。
 *   · 只**判定与描述**：不插入任何点、不改动画布（原版会给等距/共圆的结果补算圆心，那属于「新点」）。
 *   · 等距中心排除「本来就在同一个圆上」：圆心与半径都落在某个已有圆的误差带里时，这条等距关系
 *     已经由那个圆给出来了（尺规里圆就是「圆心 + 圆上一点」），不再重复报。
 *   · 共圆聚类沿用原版的好设计（三点定圆 → 量化键 → 排序 → 一维游标合并），但额外汇总**已有圆**
 *     上的点，并把量化分桶拆开的同一条线 / 同一个圆在收尾处合并。
 *   · 点数多时按预算限流（truncated 标记），不做无上限的 O(N³) 组合。
 *
 * 本文件同时被页面（<script>）与以后 worker 里的启发式打分（importScripts）使用：
 * 因此**不依赖任何全局**（页面全局与内核全局都不能用），对外只留 `GeoRelations` 这一个名字。
 */

const GeoRelations = (function () {
    /** 关系类别 */
    const KIND = {
        collinear: 'collinear',
        concyclic: 'concyclic',
        parallel: 'parallel',
        perpendicular: 'perpendicular',
        angle: 'angle',
        ratio: 'ratio',
        equidistant: 'equidistant',
        bisector: 'bisector',
        radius: 'radius',
    };
    /** 容差档位：相对图幅的比例（实际长度容差 = 比例 × 图幅） */
    const TOLERANCE_LEVELS = {strict: 1e-9, normal: 1e-7, loose: 1e-5};
    /** 角度容差（度），与上面三档对应（长度容差换算不成角度，单独给一套） */
    const ANGLE_TOLERANCE = {strict: 1e-3, normal: 0.01, loose: 0.1};
    /** 定点角默认查哪些角（与面板里的默认值一致） */
    const DEFAULT_ANGLES = [15, 30, 45, 60, 75];
    /** 线上比默认范围：1..10 : 1..10 与 √1..√10 : √1..√10 */
    const DEFAULT_RATIO_SPEC = '10,√10';
    // 预算（防止画板上一堆点时组合爆炸；超了就置 truncated，面板会提示「结果可能不全」）
    const MAX_CARRIER_PAIRS = 8000;      // 共线：任两点连线的上限（约 126 个点）
    const MAX_CONCYCLIC_POINTS = 60;     // 共圆：三点组合的点数上限
    const MAX_RADIUS_COMBOS = 200000;    // 紧圆规：点对 × 圆 的上限
    const MAX_RADIUS_FACTOR = 1e6;       // 共圆：半径超过 图幅 × 这个数 当「近乎直线」丢掉
    const MAX_RESULTS_PER_KIND = 400;    // 每类的硬上限（面板还能再调小）
    const ARC_RADIUS_RATIO = 0.12;       // 角 / 角平分线的弧半径 = 图幅 × 这个比例
    /**
     * 这几类在画布上画成**虚线**
     * 共线 / 共圆 / 等距中心说的都是「一串点落在同一个东西上」，画实线会跟画布上本来就有的
     * 那条线 / 那个圆混在一起；虚线一眼就能看出这是雷达标出来的
     */
    const DASHED_KINDS = {collinear: true, concyclic: true, equidistant: true, ratio: true};

    /* ------------------------------------------------------------------
     * 基础数学（都只看长度与无量纲量）
     * ------------------------------------------------------------------ */

    /** 由两点造直线（未归一化方向 + 长度） 过程函数 */
    function makeLine(x1, y1, x2, y2) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        return {px: x1, py: y1, dx: dx, dy: dy, length: Math.hypot(dx, dy)};
    }

    /** 点到直线的垂距 过程函数（单位与坐标一致） */
    function offsetToLine(line, x, y) {
        return Math.abs(line.dx * (y - line.py) - line.dy * (x - line.px)) / (line.length || 1);
    }

    /** 两方向夹角的余弦绝对值 过程函数（0..1，线与线取锐角） */
    function absCos(first, second) {
        const firstLength = Math.hypot(first.dx, first.dy);
        const secondLength = Math.hypot(second.dx, second.dy);
        if (!(firstLength > 0) || !(secondLength > 0)) return 1;
        const dot = first.dx * second.dx + first.dy * second.dy;
        return Math.min(1, Math.abs(dot) / (firstLength * secondLength));
    }

    /** 两方向的夹角（度，取锐角 0..90） 过程函数 */
    function acuteDegrees(first, second) {
        return Math.acos(absCos(first, second)) * 180 / Math.PI;
    }

    /** 两点距离 过程函数 */
    function distance(first, second) {
        return Math.hypot(first.x - second.x, first.y - second.y);
    }

    /**
     * 两条载线是不是同一条 过程函数（方向平行 + 位置重合）
     * 用来判断「这组共线点其实已经落在画布上某条已有的直线上了」
     */
    function sameCarrier(first, second, tol, tolLength) {
        if (!(first.length > 0) || !(second.length > 0)) return false;
        const cross = Math.abs(first.dx * second.dy - first.dy * second.dx) / (first.length * second.length);
        return cross <= tol && offsetToLine(first, second.px, second.py) <= tolLength;
    }

    /**
     * 点是否落在「有范围」的线段 / 射线里 过程函数
     * 直线恒真；射线要求投影参数 t ≥ 0；线段要求 0 ≤ t ≤ 1
     * （容差用长度容差折算：把 t 的容许范围放宽 tolLength / 线段长）
     */
    function inRangeOf(line, x, y, drawType, tolLength) {
        if (drawType !== 'ray' && drawType !== 'lineSegment') return true;
        const lengthSquared = line.dx * line.dx + line.dy * line.dy;
        if (!(lengthSquared > 0)) return false;
        const t = ((x - line.px) * line.dx + (y - line.py) * line.dy) / lengthSquared;
        const slack = tolLength / Math.max(line.length, tolLength);
        if (drawType === 'ray') return t >= -slack;
        return t >= -slack && t <= 1 + slack;
    }

    /** 三点定圆 过程函数（共线 / 退化时给 null） */
    function circumcircle(a, b, c) {
        const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
        if (!(Math.abs(d) > 0)) return null;
        const aa = a.x * a.x + a.y * a.y;
        const bb = b.x * b.x + b.y * b.y;
        const cc = c.x * c.x + c.y * c.y;
        const cx = (aa * (b.y - c.y) + bb * (c.y - a.y) + cc * (a.y - b.y)) / d;
        const cy = (aa * (c.x - b.x) + bb * (a.x - c.x) + cc * (b.x - a.x)) / d;
        const r = Math.hypot(a.x - cx, a.y - cy);
        if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(r)) return null;
        return {cx: cx, cy: cy, r: r};
    }

    /** 一串点按载线方向排序 过程函数（线上比要按沿线次序取距离） */
    function sortAlongLine(points, members, line) {
        const ux = line.dx / (line.length || 1);
        const uy = line.dy / (line.length || 1);
        return members.slice().sort((i, j) =>
            (points[i].x - line.px) * ux + (points[i].y - line.py) * uy
            - ((points[j].x - line.px) * ux + (points[j].y - line.py) * uy));
    }

    /* ------------------------------------------------------------------
     * 参数解析（面板里的文本框 → 可用的表）
     * ------------------------------------------------------------------ */

    /**
     * 解析角度表 过程函数
     * 支持：`15,30,45`（逗号分隔）、`15..75:15`（起点..终点:步长）、`22.5`（小数）、
     * 分隔符也认中文逗号 / 、 / ；。全部不合法时用 fallback
     * @returns {number[]} 去重后的角度（0 < 角度 < 180）
     */
    function parseAngleList(text, fallback) {
        const values = [];
        String(text === undefined || text === null ? '' : text).split(/[,，、;；]/).forEach(part => {
            const chunk = part.trim();
            if (!chunk) return;
            const range = chunk.match(/^(-?\d+(?:\.\d+)?)\s*(?:\.\.|~|至|-)\s*(-?\d+(?:\.\d+)?)(?:\s*[:：]\s*(\d+(?:\.\d+)?))?$/);
            if (range) {
                const from = Number(range[1]);
                const to = Number(range[2]);
                const step = Math.abs(Number(range[3])) || 1;
                if (!(step > 0) || !(to >= from)) return;
                for (let value = from; value <= to + 1e-9 && values.length < 720; value += step) values.push(value);
                return;
            }
            const single = Number(chunk);
            if (Number.isFinite(single)) values.push(single);
        });
        const unique = [];
        values.forEach(value => {
            const rounded = Math.round(value * 1e6) / 1e6;
            if (rounded > 0 && rounded < 180 && !unique.includes(rounded)) unique.push(rounded);
        });
        return unique.length ? unique : fallback.slice();
    }

    /**
     * 解析一侧的比值写法 过程函数
     *   n      → {1, 2, …, n}          （例：10 就是 1 到 10，前面也可以写 `<`）
     *   √n     → {√1, √2, …, √n}       （例：√10）
     *   a..b   → {a, a+1, …, b}
     *   a..b:s → 上面那串改步长 s
     *   单值   → 小数、`√小数`、以及 `a..a` 这种一头一尾相同的写法（写 1..1 就是只有 1）
     * @returns {{value: number, label: string}[]}
     */
    function parseRatioSide(chunk) {
        const text = String(chunk || '').trim().replace(/^[<≤]/, '');
        if (!text) return [];
        /** 一个数值的标签（整数就不带小数点） */
        const labelOf = value => String(Math.abs(value - Math.round(value)) <= 1e-12 ? Math.round(value) : value);
        /** 一个根号项的标签（√1 直接写 1，读着更清楚） */
        const rootLabel = inner => (Math.abs(inner - 1) <= 1e-12 ? '1' : `√${labelOf(inner)}`);
        const single = raw => {
            const root = raw.match(/^√\s*(\d+(?:\.\d+)?)$/);
            if (root) return {value: Math.sqrt(Number(root[1])), label: rootLabel(Number(root[1]))};
            const number = Number(raw);
            return Number.isFinite(number) && number > 0 ? {value: number, label: labelOf(number)} : null;
        };
        const rootOf = raw => {
            const match = raw.match(/^√\s*(\d+(?:\.\d+)?)$/);
            return match ? Number(match[1]) : null;
        };
        // `a..b[:步长]`：两端都带 √ 时按**根号里的序号**走（√2..√10 = √2、√3、…、√10）
        const range = text.match(/^(√?\s*\d+(?:\.\d+)?)\s*(?:\.\.|~|至)\s*(√?\s*\d+(?:\.\d+)?)(?:\s*[:：]\s*(\d+(?:\.\d+)?))?$/);
        if (range) {
            const step = Math.abs(Number(range[3]) || 1) || 1;
            const fromRoot = rootOf(range[1]);
            const toRoot = rootOf(range[2]);
            const sides = [];
            if (fromRoot !== null && toRoot !== null) {
                if (!(toRoot >= fromRoot)) return [];
                for (let index = fromRoot; index <= toRoot + 1e-9 && sides.length < 720; index += step) {
                    sides.push({value: Math.sqrt(index), label: rootLabel(index)});
                }
                return sides;
            }
            const from = single(range[1]);
            const to = single(range[2]);
            if (!from || !to || !(to.value >= from.value)) return [];
            for (let value = from.value; value <= to.value + 1e-9 && sides.length < 720; value += step) {
                sides.push({value: value, label: labelOf(value)});
            }
            return sides;
        }
        // 单个正整数表示 1..n（√n 则 √1..√n）—— 与面板默认值 10,√10 的口径一致
        const rootTop = rootOf(text);
        if (rootTop !== null && Number.isInteger(rootTop)) {
            return Array.from({length: rootTop}, (item, index) => ({value: Math.sqrt(index + 1), label: rootLabel(index + 1)}));
        }
        const intTop = text.match(/^(\d+)$/);
        if (intTop) {
            const top = Number(intTop[1]);
            return Array.from({length: top}, (item, index) => ({value: index + 1, label: labelOf(index + 1)}));
        }
        const value = single(text);
        return value ? [value] : [];
    }

    /**
     * 解析线上比的写法 过程函数
     * 一段 = 一侧，或 `左:右`；多段用逗号分隔；**只写一侧就表示两边相同**：
     *   `10`        = 10:10（1..10 比 1..10）
     *   `√10`       = √10:√10
     *   `10,√10`    = 上面两组（面板默认值）
     *   `1..5:2..6` = 左右不同的范围
     * 每对同时给出正反两个方向（`a/b` 与 `b/a`），于是判定时不用再判方向
     * @returns {{value: number, label: string}[]} 去重后的比值表（value = 分子 / 分母）
     */
    function parseRatioSpec(text, fallbackText) {
        const source = String(text === undefined || text === null ? '' : text).trim() || fallbackText;
        const table = [];
        const seen = new Set();
        const push = (value, label) => {
            if (!(value > 0) || !Number.isFinite(value)) return;
            const key = value.toFixed(9);
            if (seen.has(key)) return;
            seen.add(key);
            table.push({value: value, label: label});
        };
        String(source).split(/[,，;；]/).forEach(part => {
            const chunk = part.trim();
            if (!chunk) return;
            const sides = chunk.split(/[:：]/);
            const left = parseRatioSide(sides[0]);
            const right = sides.length > 1 ? parseRatioSide(sides.slice(1).join(':')) : left;
            if (!left.length || !right.length) return;
            left.forEach(a => right.forEach(b => {
                push(a.value / b.value, `${a.label}:${b.label}`);
                push(b.value / a.value, `${b.label}:${a.label}`);
            }));
        });
        return table.length ? table : parseRatioSpec('', DEFAULT_RATIO_SPEC);
    }

    /* ------------------------------------------------------------------
     * 八类扫描
     * ------------------------------------------------------------------ */

    /**
     * 共线扫描 过程函数
     * 载线 = 任意两点的连线（去重后每条线看一遍）。
     * **忽略本来就落在画布上某条已有直线 / 射线 / 线段上的点组**：那条线已经在画布上，
     * 共线这件事一眼就看得到，不算「隐含关系」（与等距中心排除已有圆的口径一致）。
     * 结果按点数降序，被更大的组包含的小组丢掉（量化分桶会把同一条线拆成两桶）
     */
    function scanCollinear(board, tol, tolLength, minPoints, stats) {
        const points = board.points;
        const carriers = [];
        // 任意两点的连线：点数多时按预算截断（只取前若干个点）
        let limit = points.length;
        while (limit > 2 && limit * (limit - 1) / 2 > MAX_CARRIER_PAIRS) limit--;
        if (limit < points.length) stats.truncated = true;
        for (let i = 0; i < limit; i++) {
            for (let j = i + 1; j < limit; j++) {
                if (distance(points[i], points[j]) <= tolLength) continue;
                carriers.push(makeLine(points[i].x, points[i].y, points[j].x, points[j].y));
            }
        }
        // 载线去重：按（单位法向 + 到原点有向距离）量化成桶
        const unique = [];
        const buckets = new Set();
        carriers.forEach(carrier => {
            const key = lineKey(carrier, tolLength);
            if (buckets.has(key)) return;
            buckets.add(key);
            unique.push(carrier);
        });
        /** 这组点是不是已经落在某条已有直线 / 射线 / 线段上（含射线 / 线段的范围） */
        const alreadyOnBoard = (carrier, members) => board.lines.some(line => {
            const existing = makeLine(line.x1, line.y1, line.x2, line.y2);
            if (!sameCarrier(carrier, existing, tol, tolLength)) return false;
            return members.every(i => inRangeOf(existing, points[i].x, points[i].y, line.drawType, tolLength));
        });
        // 每条载线收集落在其上的点
        const groups = [];
        unique.forEach(carrier => {
            const members = [];
            for (let i = 0; i < points.length; i++) {
                if (offsetToLine(carrier, points[i].x, points[i].y) > tolLength) continue;
                members.push(i);
            }
            if (members.length < minPoints) return;
            if (alreadyOnBoard(carrier, members)) return;   // 画布上那条线已经把它们串起来了
            let deviation = 0;
            members.forEach(i => { deviation = Math.max(deviation, offsetToLine(carrier, points[i].x, points[i].y)); });
            groups.push({members: members, line: carrier, deviation: deviation});
        });
        groups.sort((a, b) => b.members.length - a.members.length);
        const kept = [];
        const signatures = new Set();
        groups.forEach(group => {
            const signature = group.members.join(',');
            if (signatures.has(signature)) return;
            if (kept.some(existing => group.members.every(i => existing.members.indexOf(i) >= 0))) return;
            signatures.add(signature);
            kept.push(group);
        });
        return kept;
    }

    /** 载线的量化键 过程函数（单位法向定方向，有向距离定位置） */
    function lineKey(line, tolLength) {
        const length = line.length || 1;
        let nx = line.dy / length;
        let ny = -line.dx / length;
        let c = -(nx * line.px + ny * line.py);
        // 法向定一个固定朝向，共线但方向相反的两条线才算同一条
        if (nx < 0 || (nx === 0 && ny < 0)) {
            nx = -nx;
            ny = -ny;
            c = -c;
        }
        const step = tolLength || 1e-12;
        return `${Math.round(nx / step)},${Math.round(ny / step)},${Math.round(c / step)}`;
    }

    /**
     * 共圆扫描 过程函数
     * ① 画布上已有的圆：直接数上面的点
     * ② 三点定圆 → 量化键 → 排序 → 一维游标合并（原版的 O(N³ log N) 聚类）
     * ③ 收尾：把「量化落在桶边界」拆开的同簇合并掉
     */
    function scanConcyclic(board, tolLength, minPoints, stats) {
        const points = board.points;
        const groups = [];
        let limit = points.length;
        if (limit > MAX_CONCYCLIC_POINTS) {
            limit = MAX_CONCYCLIC_POINTS;
            stats.truncated = true;
        }
        const triples = [];
        for (let i = 0; i < limit - 2; i++) {
            for (let j = i + 1; j < limit - 1; j++) {
                for (let k = j + 1; k < limit; k++) {
                    const circle = circumcircle(points[i], points[j], points[k]);
                    // 近乎直线的大圆不算（原版也是这么滤的）
                    if (!circle || !(circle.r <= board.span * MAX_RADIUS_FACTOR)) continue;
                    triples.push({circle: circle, members: [i, j, k]});
                }
            }
        }
        triples.sort((a, b) => a.circle.cx - b.circle.cx || a.circle.cy - b.circle.cy || a.circle.r - b.circle.r);
        for (let i = 0; i < triples.length; i++) {
            const seed = triples[i];
            const members = seed.members.slice();
            let j = i + 1;
            for (; j < triples.length; j++) {
                const other = triples[j];
                if (Math.abs(other.circle.cx - seed.circle.cx) > tolLength
                    || Math.abs(other.circle.cy - seed.circle.cy) > tolLength
                    || Math.abs(other.circle.r - seed.circle.r) > tolLength) break;
                other.members.forEach(index => { if (members.indexOf(index) < 0) members.push(index); });
            }
            i = j - 1;
            if (members.length >= minPoints) {
                groups.push({members: members, cx: seed.circle.cx, cy: seed.circle.cy, r: seed.circle.r});
            }
        }
        // 同一簇在量化桶边界上被拆开 → 贪心再合一次（同圆心同半径就并）
        const merged = [];
        groups.forEach(group => {
            const host = merged.find(other => Math.abs(other.cx - group.cx) <= tolLength
                && Math.abs(other.cy - group.cy) <= tolLength && Math.abs(other.r - group.r) <= tolLength);
            if (!host) {
                merged.push({members: group.members.slice(), cx: group.cx, cy: group.cy, r: group.r});
                return;
            }
            group.members.forEach(index => { if (host.members.indexOf(index) < 0) host.members.push(index); });
        });
        // **忽略本来就落在画布上某个已有圆上的点组**：那个圆已经在画布上，共圆一眼就看得到
        const alreadyOnCircle = group => board.circles.some(circle => Math.abs(circle.cx - group.cx) <= tolLength
            && Math.abs(circle.cy - group.cy) <= tolLength && Math.abs(circle.r - group.r) <= tolLength);
        const kept = [];
        merged.sort((a, b) => b.members.length - a.members.length);
        merged.forEach(group => {
            if (alreadyOnCircle(group)) return;
            if (kept.some(existing => group.members.every(i => existing.members.indexOf(i) >= 0))) return;
            kept.push(group);
        });
        return kept;
    }

    /** 平行 / 垂直扫描 过程函数（线对，方向看单位化后的叉积 / 点积） */
    function scanParallelism(board, tol, stats) {
        const parallel = [];
        const perpendicular = [];
        for (let i = 0; i < board.lines.length; i++) {
            for (let j = i + 1; j < board.lines.length; j++) {
                const first = board.lines[i];
                const second = board.lines[j];
                const u = makeLine(first.x1, first.y1, first.x2, first.y2);
                const v = makeLine(second.x1, second.y1, second.x2, second.y2);
                if (!(u.length > 0) || !(v.length > 0)) continue;
                const cross = Math.abs(u.dx * v.dy - u.dy * v.dx) / (u.length * v.length);
                const dot = Math.abs(u.dx * v.dx + u.dy * v.dy) / (u.length * v.length);
                // 同一条线（平行且重合）不算「平行关系」：那是重复图形
                const same = cross <= tol && offsetToLine(u, second.x1, second.y1) <= tol * board.span;
                if (same) continue;
                if (cross <= tol) parallel.push({first: first.id, second: second.id, deviation: cross});
                else if (dot <= tol) perpendicular.push({first: first.id, second: second.id, deviation: dot});
            }
        }
        return {parallel: parallel, perpendicular: perpendicular};
    }

    /** 定点角扫描 过程函数（顶点 + 过它的两条线，取锐角 / 钝角与目标表比对） */
    function scanAngle(board, tolLength, targets, angleTolerance) {
        const found = [];
        board.points.forEach(vertex => {
            const through = board.lines.filter(line => {
                const carrier = makeLine(line.x1, line.y1, line.x2, line.y2);
                return carrier.length > 0 && offsetToLine(carrier, vertex.x, vertex.y) <= tolLength;
            });
            for (let i = 0; i < through.length - 1; i++) {
                for (let j = i + 1; j < through.length; j++) {
                    const u = makeLine(through[i].x1, through[i].y1, through[i].x2, through[i].y2);
                    const v = makeLine(through[j].x1, through[j].y1, through[j].x2, through[j].y2);
                    const acute = acuteDegrees(u, v);
                    if (!(acute > angleTolerance)) continue;      // 两条线重合 / 几乎同向
                    const obtuse = 180 - acute;
                    let best = null;
                    targets.forEach(target => {
                        const delta = Math.min(Math.abs(acute - target), Math.abs(obtuse - target));
                        if (delta <= angleTolerance && (!best || delta < best.deviation)) best = {target: target, deviation: delta};
                    });
                    if (best) {
                        found.push({vertexId: vertex.id, firstId: through[i].id, secondId: through[j].id,
                            degrees: best.target, measured: acute, deviation: best.deviation});
                    }
                }
            }
        });
        return found;
    }

    /**
     * 角平分线扫描 过程函数
     * 过同一顶点的三条线里，中间那条把另两条的夹角分成两半
     * （原版比的是 |cos| 的差；这里比角度差，免得夹角趋近 0 / 180 时判不出）
     */
    function scanBisector(board, tolLength, angleTolerance) {
        const found = [];
        const signatures = new Set();
        board.points.forEach(vertex => {
            const through = board.lines.filter(line => {
                const carrier = makeLine(line.x1, line.y1, line.x2, line.y2);
                return carrier.length > 0 && offsetToLine(carrier, vertex.x, vertex.y) <= tolLength;
            });
            for (let i = 0; i < through.length - 2; i++) {
                for (let j = i + 1; j < through.length - 1; j++) {
                    for (let k = j + 1; k < through.length; k++) {
                        const triple = [through[i], through[j], through[k]];
                        for (let middle = 0; middle < 3; middle++) {
                            const sides = triple.filter((line, index) => index !== middle);
                            const bisect = triple[middle];
                            const first = acuteDegrees(makeLine(sides[0].x1, sides[0].y1, sides[0].x2, sides[0].y2),
                                makeLine(bisect.x1, bisect.y1, bisect.x2, bisect.y2));
                            const second = acuteDegrees(makeLine(sides[1].x1, sides[1].y1, sides[1].x2, sides[1].y2),
                                makeLine(bisect.x1, bisect.y1, bisect.x2, bisect.y2));
                            if (!(first > angleTolerance) || Math.abs(first - second) > angleTolerance) continue;
                            // 同一组三条线换一个「中间那条」还可能再中一次，按（被平分的线 + 两侧）去重
                            const signature = `${bisect.id}|${sides.map(line => line.id).sort().join(',')}`;
                            if (signatures.has(signature)) continue;
                            signatures.add(signature);
                            found.push({vertexId: vertex.id, bisectorId: bisect.id,
                                sideIds: [sides[0].id, sides[1].id], degrees: first, deviation: Math.abs(first - second)});
                        }
                    }
                }
            }
        });
        return found;
    }

    /**
     * 线上比扫描 过程函数
     * 只看**共线三点**里共享起点的两段：|AB| : |AC|（原版也是这个口径），A 沿线排在最前
     * 匹配容差按两段的误差传下去：|Δ| ≤ 2·容差·(1+v) / |AC|
     */
    function scanRatio(board, tolLength, groups, table, stats) {
        const found = [];
        groups.forEach(group => {
            const members = sortAlongLine(board.points, group.members, group.line);
            for (let a = 0; a < members.length - 2; a++) {
                for (let b = a + 1; b < members.length - 1; b++) {
                    for (let c = b + 1; c < members.length; c++) {
                        const first = board.points[members[a]];
                        const second = board.points[members[b]];
                        const third = board.points[members[c]];
                        const near = distance(first, second);
                        const far = distance(first, third);
                        if (far <= tolLength) continue;
                        const value = near / far;
                        let best = null;
                        table.forEach(entry => {
                            const delta = Math.abs(value - entry.value);
                            if (delta <= 2 * tolLength * (1 + entry.value) / far && (!best || delta < best.deviation)) {
                                best = {label: entry.label, deviation: delta};
                            }
                        });
                        if (!best) continue;
                        found.push({pointIds: [first.id, second.id, third.id], label: best.label,
                            value: value, deviation: best.deviation});
                    }
                }
            }
        });
        return found;
    }

    /**
     * 等距中心扫描 过程函数
     * 以每个已知点为心，把其余点按到它的距离分组；每组 ≥ minPoints 个点就算一条
     * 排除「本来就在同一个圆上」：圆心与半径都落在某个已有圆的误差带里 ——
     * 那条等距关系已经由那个圆给出来了（尺规里圆就是「圆心 + 圆上一点」）。
     * 不加原版那条「组内点不得与圆心共线」的过滤：中点（C 在 PQ 之间、|CP|=|CQ|）本身是有用的关系
     */
    function scanEquidistant(board, tolLength, minPoints) {
        const points = board.points;
        const found = [];
        for (let ci = 0; ci < points.length; ci++) {
            const center = points[ci];
            const groups = [];
            for (let pi = 0; pi < points.length; pi++) {
                if (pi === ci) continue;
                const radius = distance(center, points[pi]);
                if (radius <= tolLength) continue;
                const group = groups.find(item => Math.abs(item.radius - radius) <= tolLength);
                if (group) {
                    group.members.push(pi);
                    // 动态平均，免得浮点误差单向漂移（原版的做法）
                    group.radius = (group.radius * (group.members.length - 1) + radius) / group.members.length;
                } else {
                    groups.push({radius: radius, members: [pi]});
                }
            }
            groups.forEach(group => {
                if (group.members.length < minPoints) return;
                const materialized = board.circles.some(circle =>
                    Math.abs(circle.cx - center.x) <= tolLength && Math.abs(circle.cy - center.y) <= tolLength
                    && Math.abs(circle.r - group.radius) <= tolLength);
                if (materialized) return;
                let deviation = 0;
                group.members.forEach(index => {
                    deviation = Math.max(deviation, Math.abs(distance(center, points[index]) - group.radius));
                });
                found.push({centerId: center.id, pointIds: group.members.map(index => points[index].id),
                    radius: group.radius, deviation: deviation});
            });
        }
        return found;
    }

    /**
     * 紧圆规扫描 过程函数
     * 枚举**无序**点对 {P, Q} 与每个圆：|PQ| 等于该圆半径 ⇒ 圆规可以把这个半径搬到这两个点上
     * （以 P 为心过 Q、或以 Q 为心过 P 都行 —— 是同一件事，只记一条，按点在画板上的次序定朝向）
     * 排除：
     *   · 该圆自己的「圆心 + 圆上一点」——**按坐标判定、不看顺序**：这对点无论谁当圆心，
     *     说的都还是这个圆本身（「圆 BA 的半径取自圆 AB」就属于这一类）
     *   · 以 P 为心、半径 |PQ| 的圆画布上已经存在（这一刀已经下过了）
     */
    function scanRadius(board, tolLength, stats) {
        const found = [];
        let combos = 0;
        for (let ci = 0; ci < board.circles.length; ci++) {
            const source = board.circles[ci];
            if (!(source.r > tolLength)) continue;
            const sourceCenter = {x: source.cx, y: source.cy};
            const atCenter = p => distance(p, sourceCenter) <= tolLength;
            const onSource = p => Math.abs(distance(p, sourceCenter) - source.r) <= tolLength;
            for (let i = 0; i < board.points.length; i++) {
                const center = board.points[i];
                for (let j = i + 1; j < board.points.length; j++) {
                    combos++;
                    if (combos > MAX_RADIUS_COMBOS) {
                        stats.truncated = true;
                        return found;
                    }
                    const through = board.points[j];
                    const radius = distance(center, through);
                    if (Math.abs(radius - source.r) > tolLength) continue;
                    // 该圆自己的「圆心 + 圆上一点」
                    if ((atCenter(center) && onSource(through)) || (atCenter(through) && onSource(center))) continue;
                    // 已经存在同一个圆（同心同半径）
                    const existing = board.circles.some(circle =>
                        Math.abs(circle.cx - center.x) <= tolLength && Math.abs(circle.cy - center.y) <= tolLength
                        && Math.abs(circle.r - radius) <= tolLength);
                    if (existing) continue;
                    found.push({centerId: center.id, throughId: through.id, sourceCircleId: source.id,
                        radius: radius, deviation: Math.abs(radius - source.r)});
                }
            }
        }
        return found;
    }

    /* ------------------------------------------------------------------
     * 组装：scan
     * ------------------------------------------------------------------ */

    /** 默认选项 过程函数（面板的默认值就是这一套：只勾前 3 项） */
    function defaultOptions() {
        return {
            tolerance: 'normal',
            kinds: {
                collinear: true, concyclic: true, parallel: true, perpendicular: true,
                angle: false, ratio: false, equidistant: false, bisector: false, radius: false,
            },
            minPoints: {collinear: 3, concyclic: 4, equidistant: 2},
            angles: DEFAULT_ANGLES.slice(),
            angleSpec: DEFAULT_ANGLES.join(','),
            angleTolerance: null,          // null = 按容差档位取（见 ANGLE_TOLERANCE）
            ratioSpec: DEFAULT_RATIO_SPEC,
            maxResults: 200,
        };
    }

    /** 合并选项 过程函数 */
    function mergeOptions(options) {
        const base = defaultOptions();
        if (!options) return base;
        const merged = Object.assign(base, options);
        merged.kinds = Object.assign(base.kinds, options.kinds || {});
        merged.minPoints = Object.assign(base.minPoints, options.minPoints || {});
        return merged;
    }

    /** 条目排序键 过程函数：先按偏差，再按规模（越小越相关） */
    function sortEntries(entries, sizeOf) {
        entries.sort((a, b) => (a.deviation || 0) - (b.deviation || 0) || sizeOf(b) - sizeOf(a));
        return entries;
    }

    /**
     * 合并重合点 过程函数
     * 同一处落了多个点（精确重合或误差内重合）时只留**最早创建**的那个（数组里最靠前），
     * 否则雷达会把同一个点反复算进共线 / 线上比 / 等距… 里，虚标一堆几乎相同的关系
     * @param {Object} board 扫描用的画板快照（会就地替换 points）
     * @param {number} tolLength 长度容差（重合判定用，与全雷达一致）
     */
    function dedupeCoincidentPoints(board, tolLength) {
        const source = board.points || [];
        const kept = [];
        source.forEach(point => {
            if (!kept.some(canon => distance(canon, point) <= tolLength)) kept.push(point);
        });
        board.points = kept;
    }

    /**
     * 扫一遍画板快照 过程函数
     * @param {Object} board {span, points:[{id,x,y}], lines:[{id,x1,y1,x2,y2,drawType}], circles:[{id,cx,cy,r,centerId}]}
     * @param {Object} [options] 见 defaultOptions
     * @returns {Object} {kind: {类别: 条目[]}, count, truncated, tolerance, span, angleTolerance}
     */
    function scan(board, options) {
        const opts = mergeOptions(options);
        const tolerance = TOLERANCE_LEVELS[opts.tolerance] || TOLERANCE_LEVELS.normal;
        const tolLength = tolerance * board.span;
        const angleTolerance = opts.angleTolerance === null || opts.angleTolerance === undefined
            ? (ANGLE_TOLERANCE[opts.tolerance] || ANGLE_TOLERANCE.normal)
            : opts.angleTolerance;
        // 先合并重合点：同一处的多个点当成一个（保留最早创建的），免得后面各种扫描重复计入
        dedupeCoincidentPoints(board, tolLength);
        const stats = {truncated: false};
        const kinds = {};
        // 共线组无论勾没勾都要算：线上比就架在它上面
        const collinearGroups = (opts.kinds.collinear || opts.kinds.ratio)
            ? scanCollinear(board, tolerance, tolLength, opts.minPoints.collinear, stats)
            : [];
        const limit = Math.max(1, opts.maxResults | 0);
        const push = (kind, entries, sizeOf) => {
            sortEntries(entries, sizeOf);
            if (entries.length > limit) {
                entries.length = limit;
                stats.truncated = true;
            }
            kinds[kind] = entries;
        };

        if (opts.kinds.collinear) {
            push(KIND.collinear, collinearGroups.map(group => ({
                kind: KIND.collinear,
                pointIds: group.members.map(index => board.points[index].id),
                count: group.members.length,
                deviation: group.deviation,
            })), entry => entry.count);
        }
        if (opts.kinds.concyclic) {
            push(KIND.concyclic, scanConcyclic(board, tolLength, opts.minPoints.concyclic, stats).map(group => ({
                kind: KIND.concyclic,
                pointIds: group.members.map(index => board.points[index].id),
                count: group.members.length,
                radius: group.r,
                deviation: 0,
            })), entry => entry.count);
        }
        if (opts.kinds.parallel || opts.kinds.perpendicular) {
            const pair = scanParallelism(board, tolerance, stats);
            if (opts.kinds.parallel) {
                push(KIND.parallel, pair.parallel.map(item => ({
                    kind: KIND.parallel, lineIds: [item.first, item.second], deviation: item.deviation,
                })), () => 0);
            }
            if (opts.kinds.perpendicular) {
                push(KIND.perpendicular, pair.perpendicular.map(item => ({
                    kind: KIND.perpendicular, lineIds: [item.first, item.second], deviation: item.deviation,
                })), () => 0);
            }
        }
        if (opts.kinds.angle) {
            push(KIND.angle, scanAngle(board, tolLength, opts.angles, angleTolerance).map(item => ({
                kind: KIND.angle, vertexId: item.vertexId, lineIds: [item.firstId, item.secondId],
                degrees: item.degrees, measured: item.measured, deviation: item.deviation,
            })), () => 0);
        }
        if (opts.kinds.ratio && collinearGroups.length) {
            const table = parseRatioSpec(opts.ratioSpec, DEFAULT_RATIO_SPEC);
            push(KIND.ratio, scanRatio(board, tolLength, collinearGroups, table, stats).map(item => ({
                kind: KIND.ratio, pointIds: item.pointIds, label: item.label,
                value: item.value, deviation: item.deviation,
            })), () => 0);
        }
        if (opts.kinds.equidistant) {
            push(KIND.equidistant, scanEquidistant(board, tolLength, opts.minPoints.equidistant).map(item => ({
                kind: KIND.equidistant, centerId: item.centerId, pointIds: item.pointIds,
                count: item.pointIds.length + 1, radius: item.radius, deviation: item.deviation,
            })), entry => entry.count);
        }
        if (opts.kinds.bisector) {
            push(KIND.bisector, scanBisector(board, tolLength, angleTolerance).map(item => ({
                kind: KIND.bisector, vertexId: item.vertexId, bisectorId: item.bisectorId,
                lineIds: item.sideIds, degrees: item.degrees, deviation: item.deviation,
            })), () => 0);
        }
        if (opts.kinds.radius) {
            push(KIND.radius, scanRadius(board, tolLength, stats).map(item => ({
                kind: KIND.radius, centerId: item.centerId, throughId: item.throughId,
                sourceCircleId: item.sourceCircleId, radius: item.radius, deviation: item.deviation,
            })), () => 0);
        }

        let count = 0;
        Object.keys(kinds).forEach(kind => { count += kinds[kind].length; });
        return {
            kind: kinds,
            count: count,
            truncated: stats.truncated,
            tolerance: tolerance,
            angleTolerance: angleTolerance,
            span: board.span,
        };
    }

    /* ------------------------------------------------------------------
     * 按 id 在线复算：evaluateOverlay
     * ------------------------------------------------------------------ */

    /** 取一个对象现在的几何 过程函数（lookup 由页面给：画布对象 → 坐标） */
    function pointOf(lookup, id) {
        const item = lookup(id);
        if (!item || item.kind !== 'point') return null;
        return Number.isFinite(item.x) && Number.isFinite(item.y) ? item : null;
    }

    function circleOf(lookup, id) {
        const item = lookup(id);
        if (!item || item.kind !== 'circle') return null;
        return item.r > 0 && Number.isFinite(item.cx) && Number.isFinite(item.cy) ? item : null;
    }

    /** 线对象 → 支撑线上的两点（拿活坐标） 过程函数 */
    function lineOf(lookup, id) {
        const item = lookup(id);
        if (!item || item.kind !== 'line') return null;
        const line = makeLine(item.x1, item.y1, item.x2, item.y2);
        if (!(line.length > 0)) return null;
        return {item: item, line: line};
    }

    /**
     * 一条关系现在长什么样 过程函数
     * @returns {Object|null} 画法（lines / circles / arcs / points），null 表示已失效
     */
    function evaluateEntry(entry, lookup, tolerance, tolLength, angleTolerance, arcRadius) {
        const out = {lines: [], circles: [], arcs: [], points: []};
        if (entry.kind === KIND.collinear) {
            // 关系说的是「这**一组**点共线」：任何一个点没了（删掉 / 变无效）整条关系就不成立，
            // 不能拿剩下两个点硬画一条线（任意两点都共线，那样画出来是假的）
            const points = (entry.pointIds || []).map(id => pointOf(lookup, id));
            const live = points.filter(Boolean);
            if (!live.length || live.length !== points.length) return null;
            const line = makeLine(live[0].x, live[0].y, live[1].x, live[1].y);
            if (!(line.length > tolLength)) return null;
            const off = p => offsetToLine(line, p.x, p.y);
            if (live.some(p => off(p) > tolLength)) return null;
            live.forEach(p => out.points.push({x: p.x, y: p.y}));
            out.lines.push({x1: line.px, y1: line.py, x2: line.px + line.dx, y2: line.py + line.dy});
            return out;
        }
        if (entry.kind === KIND.concyclic || entry.kind === KIND.equidistant) {
            // 同共线：点集少一个就不再是原来那条关系
            const points = (entry.pointIds || []).map(id => pointOf(lookup, id));
            const live = points.filter(Boolean);
            if (!live.length || live.length !== points.length) return null;
            live.forEach(p => out.points.push({x: p.x, y: p.y}));
            if (entry.kind === KIND.concyclic) {
                // 圆本身不是画布对象（画布上已有的圆已经被排除了）：按当前坐标重算外接圆
                const circle = live.length >= 3 ? circumcircle(live[0], live[1], live[2]) : null;
                if (!circle) return null;
                if (live.some(p => Math.abs(distance(p, {x: circle.cx, y: circle.cy}) - circle.r) > tolLength)) return null;
                out.circles.push({cx: circle.cx, cy: circle.cy, r: circle.r});
                return out;
            }
            const center = pointOf(lookup, entry.centerId);
            if (!center) return null;
            const radius = distance(center, live[0]);
            if (!(radius > tolLength)) return null;
            if (live.some(p => Math.abs(distance(center, p) - radius) > tolLength)) return null;
            out.points.push({x: center.x, y: center.y});
            out.circles.push({cx: center.x, cy: center.y, r: radius});
            return out;
        }
        if (entry.kind === KIND.parallel || entry.kind === KIND.perpendicular) {
            const first = lineOf(lookup, entry.lineIds[0]);
            const second = lineOf(lookup, entry.lineIds[1]);
            if (!first || !second) return null;
            const cross = Math.abs(first.line.dx * second.line.dy - first.line.dy * second.line.dx)
                / (first.line.length * second.line.length);
            const dot = Math.abs(first.line.dx * second.line.dx + first.line.dy * second.line.dy)
                / (first.line.length * second.line.length);
            // 叉积 / 点积是**无量纲**的（sin / cos），所以和比例容差比，不与长度容差比
            const value = entry.kind === KIND.parallel ? cross : dot;
            if (value > tolerance) return null;
            [first, second].forEach(item => out.lines.push({
                x1: item.line.px, y1: item.line.py,
                x2: item.line.px + item.line.dx, y2: item.line.py + item.line.dy,
            }));
            return out;
        }
        if (entry.kind === KIND.angle || entry.kind === KIND.bisector) {
            const vertex = pointOf(lookup, entry.vertexId);
            const first = lineOf(lookup, entry.lineIds[0]);
            const second = lineOf(lookup, entry.lineIds[1]);
            if (!vertex || !first || !second) return null;
            if (offsetToLine(first.line, vertex.x, vertex.y) > tolLength) return null;
            if (offsetToLine(second.line, vertex.x, vertex.y) > tolLength) return null;
            out.points.push({x: vertex.x, y: vertex.y});
            if (entry.kind === KIND.bisector) {
                const bisector = lineOf(lookup, entry.bisectorId);
                if (!bisector || offsetToLine(bisector.line, vertex.x, vertex.y) > tolLength) return null;
                const sideA = acuteDegrees(first.line, bisector.line);
                const sideB = acuteDegrees(second.line, bisector.line);
                if (Math.abs(sideA - sideB) > angleTolerance) return null;
                out.lines.push({x1: bisector.line.px, y1: bisector.line.py,
                    x2: bisector.line.px + bisector.line.dx, y2: bisector.line.py + bisector.line.dy});
                out.arcs.push(arcBetween(vertex, first.line, second.line, sideA + sideB, arcRadius));
                return out;
            }
            const acute = acuteDegrees(first.line, second.line);
            const target = entry.degrees;
            if (Math.min(Math.abs(acute - target), Math.abs(180 - acute - target)) > angleTolerance) return null;
            out.arcs.push(arcBetween(vertex, first.line, second.line, target, arcRadius));
            return out;
        }
        if (entry.kind === KIND.ratio) {
            const points = (entry.pointIds || []).map(id => pointOf(lookup, id));
            if (points.some(point => !point)) return null;
            const near = distance(points[0], points[1]);
            const far = distance(points[0], points[2]);
            if (!(far > tolLength)) return null;
            if (Math.abs(near / far - entry.value) > 2 * tolLength * (1 + entry.value) / far) return null;
            points.forEach(point => out.points.push({x: point.x, y: point.y}));
            // 只连两点之间的线段，不画成无限直线
            out.lines.push({x1: points[0].x, y1: points[0].y, x2: points[1].x, y2: points[1].y, segment: true});
            out.lines.push({x1: points[0].x, y1: points[0].y, x2: points[2].x, y2: points[2].y, segment: true});
            return out;
        }
        if (entry.kind === KIND.radius) {
            const center = pointOf(lookup, entry.centerId);
            const through = pointOf(lookup, entry.throughId);
            const source = circleOf(lookup, entry.sourceCircleId);
            if (!center || !through || !source) return null;
            const radius = distance(center, through);
            if (Math.abs(radius - source.r) > tolLength) return null;
            out.points.push({x: center.x, y: center.y});
            // 两点确定的复制圆画虚线
            out.circles.push({cx: center.x, cy: center.y, r: radius, dashed: true});
            // 提供半径的那个源圆画实线（条目级 dashed 为 false，这里不带 dashed 即实线）
            out.circles.push({cx: source.cx, cy: source.cy, r: source.r});
            return out;
        }
        return null;
    }

    /**
     * 顶点处两条线之间的弧 过程函数
     * 取两条线各自的**一个方向**（同一侧的画法更自然：先按四个方向试，取张角最接近 target 的那对）
     */
    function arcBetween(vertex, firstLine, secondLine, target, radius) {
        const directions = [firstLine, {px: firstLine.px, py: firstLine.py, dx: -firstLine.dx, dy: -firstLine.dy},
            secondLine, {px: secondLine.px, py: secondLine.py, dx: -secondLine.dx, dy: -secondLine.dy}];
        let best = null;
        for (let i = 0; i < 2; i++) {
            for (let j = 2; j < 4; j++) {
                const from = Math.atan2(directions[i].dy, directions[i].dx);
                const to = Math.atan2(directions[j].dy, directions[j].dx);
                let delta = to - from;
                while (delta > Math.PI) delta -= Math.PI * 2;
                while (delta < -Math.PI) delta += Math.PI * 2;
                const degrees = Math.abs(delta) * 180 / Math.PI;
                const deltaWant = Math.abs(degrees - target);
                if (!best || deltaWant < best.missing) best = {from: from, delta: delta, missing: deltaWant};
            }
        }
        return {cx: vertex.x, cy: vertex.y, r: radius, from: best.from, delta: best.delta};
    }

    /**
     * 一遍算出「现在该画成什么样」 过程函数
     * @param {Object} overlay 扫描结果（scan 的返回值 + 勾选中的条目下标）
     * @param {Function} lookup id → {kind:'point'|'line'|'circle', …}，拿不到给 null
     * @returns {Object} {lines, circles, arcs, points, stale:[条目下标]}
     */
    function evaluateOverlay(overlay, lookup) {
        const out = {lines: [], circles: [], arcs: [], points: [], stale: []};
        if (!overlay || !overlay.entries || !overlay.entries.length) return out;
        const tolerance = overlay.tolerance || TOLERANCE_LEVELS.normal;
        const tolLength = tolerance * Math.max(overlay.span || 1, 1);
        const angleTolerance = overlay.angleTolerance || ANGLE_TOLERANCE.normal;
        const arcRadius = Math.max(overlay.span || 1, 1) * ARC_RADIUS_RATIO;
        overlay.entries.forEach((entry, index) => {
            let drawn = null;
            try {
                drawn = evaluateEntry(entry, lookup, tolerance, tolLength, angleTolerance, arcRadius);
            } catch (error) {
                drawn = null;
            }
            if (!drawn) {
                out.stale.push(index);
                return;
            }
            const dashed = DASHED_KINDS[entry.kind] === true;
            drawn.lines.forEach(line => out.lines.push(Object.assign({dashed: dashed}, line)));
            drawn.circles.forEach(circle => out.circles.push(Object.assign({dashed: dashed}, circle)));
            drawn.arcs.forEach(arc => out.arcs.push(arc));
            drawn.points.forEach(point => out.points.push(point));
        });
        return out;
    }

    return {
        KIND: KIND,
        TOLERANCE_LEVELS: TOLERANCE_LEVELS,
        ANGLE_TOLERANCE: ANGLE_TOLERANCE,
        DEFAULT_ANGLES: DEFAULT_ANGLES,
        DEFAULT_RATIO_SPEC: DEFAULT_RATIO_SPEC,
        defaultOptions: defaultOptions,
        parseAngleList: parseAngleList,
        parseRatioSpec: parseRatioSpec,
        scan: scan,
        evaluateOverlay: evaluateOverlay,
    };
})();
