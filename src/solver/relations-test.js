/**
 * relations-test.js —— 关系雷达判定内核的自检（`node src/solver/relations-test.js`）
 * 只在 Node 里跑：把 bs-relations.js 当普通脚本求值，喂构造好的画板快照，断言各类判定。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, 'bs-relations.js'), 'utf8');
const context = vm.createContext({console: console, Math: Math, Number: Number, Array: Array,
    Object: Object, Set: Set, Map: Map, JSON: JSON, isFinite: isFinite, Infinity: Infinity});
vm.runInContext(source + '\n;globalThis.GeoRelations = GeoRelations;', context);
const GeoRelations = context.GeoRelations;

let failures = 0;
function check(name, actual, expected) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (!ok) failures++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  预期 ${JSON.stringify(expected)} 实际 ${JSON.stringify(actual)}`}`);
}

/** 造一张画板快照（span 按坐标量级给 10，和画板里常见的图幅一致） */
function board(points, lines, circles) {
    return {span: 10, points: points, lines: lines || [], circles: circles || []};
}
const point = (id, x, y) => ({id: id, x: x, y: y});
const line = (id, x1, y1, x2, y2, drawType) => ({id: id, x1: x1, y1: y1, x2: x2, y2: y2, drawType: drawType || 'line'});
const circle = (id, cx, cy, r, centerId) => ({id: id, cx: cx, cy: cy, r: r, centerId: centerId || null});

// ① 共线：三点一线 + 一个离线的点
{
    const result = GeoRelations.scan(board([point('p1', 0, 0), point('p2', 1, 0), point('p3', 2, 0), point('p4', 0, 1)]),
        {kinds: {collinear: true}});
    check('① 共线三点', result.kind.collinear.map(entry => [entry.pointIds.join(','), entry.deviation]),
        [['p1,p2,p3', 0]]);
    // 画布上已经有一条直线串起这三点：共线一眼就看得到，不再报
    const withLine = GeoRelations.scan(board([point('p1', 0, 0), point('p2', 1, 0), point('p3', 2, 0), point('p4', 0, 1)],
        [line('g1', 0, 0, 2, 0)]), {kinds: {collinear: true}});
    check('① 共线：已有直线上的点忽略', withLine.kind.collinear.length, 0);
    // 线段：点全在它的范围里才算「已经在线上」；范围外的那点仍是一条关系
    const segment = GeoRelations.scan(board([point('p1', 0, 0), point('p2', 1, 0), point('p3', 2, 0), point('p4', 0, 1)],
        [line('g1', 0, 0, 1.5, 0, 'lineSegment')]), {kinds: {collinear: true}});
    check('① 共线：线段范围外仍有关系', segment.kind.collinear.length, 1);
}

// ② 共圆：单位圆上四点（最少点数默认 4）
{
    const result = GeoRelations.scan(board([point('c1', 1, 0), point('c2', 0, 1), point('c3', -1, 0), point('c4', 0, -1), point('c5', 3, 3)]),
        {kinds: {concyclic: true}});
    check('② 共圆四点', result.kind.concyclic.map(entry => entry.count), [4]);
    // 画布上已经有一个圆穿过这四点：共圆一眼就看得到，不再报
    const withCircle = GeoRelations.scan(board([point('c1', 1, 0), point('c2', 0, 1), point('c3', -1, 0), point('c4', 0, -1), point('c5', 3, 3)],
        [], [circle('g1', 0, 0, 1)]), {kinds: {concyclic: true}});
    check('② 共圆：已有圆上的点忽略', withCircle.kind.concyclic.length, 0);
}

// ③ 平行 / 垂直
{
    const result = GeoRelations.scan(board([], [
        line('h1', 0, 0, 1, 0),
        line('h2', 0, 1, 1, 1),
        line('v1', 0, 0, 0, 1),
    ]), {kinds: {parallel: true, perpendicular: true}});
    check('③ 平行线对', result.kind.parallel.map(entry => entry.lineIds.join('|')), ['h1|h2']);
    check('③ 垂直线对', result.kind.perpendicular.map(entry => entry.lineIds.join('|')).sort(), ['h1|v1', 'h2|v1'].sort());
}

// ④ 定点角：x 轴与 45° 线交于原点
{
    const result = GeoRelations.scan(board([point('o', 0, 0)], [
        line('x1', 0, 0, 1, 0),
        line('d45', 0, 0, 1, 1),
    ]), {kinds: {angle: true}});
    check('④ 45° 定点角', result.kind.angle.map(entry => [entry.vertexId, entry.degrees]), [['o', 45]]);
}

// ⑤ 线上比：0、1、3 三点，|AB|:|AC| = 1:3
{
    const result = GeoRelations.scan(board([point('a', 0, 0), point('b', 1, 0), point('c', 3, 0)]),
        {kinds: {collinear: false, ratio: true}, ratioSpec: '10,√10'});
    check('⑤ 线上比 1:3', result.kind.ratio.map(entry => entry.label), ['1:3']);
}

// ⑥ 等距中心：排除「本来就在同一个圆上」
{
    const points = [point('o', 0, 0), point('b', 1, 0), point('c', 0, 1)];
    const withoutCircle = GeoRelations.scan(board(points, [], []), {kinds: {equidistant: true}, minPoints: {equidistant: 2}});
    check('⑥ 等距中心（无圆）', withoutCircle.kind.equidistant.map(entry => entry.centerId + ':' + entry.pointIds.join(',')),
        ['o:b,c']);
    // 画布上已经有「圆心 o、半径 1」的圆：这两个点本来就都在它上面，不再重复报
    const withCircle = GeoRelations.scan(board(points, [], [circle('g1', 0, 0, 1, 'o')]),
        {kinds: {equidistant: true}, minPoints: {equidistant: 2}});
    check('⑥ 等距中心（排除已有圆）', withCircle.kind.equidistant.length, 0);
}

// ⑦ 角平分线：x 轴、y=x、y 轴交于原点
{
    const result = GeoRelations.scan(board([point('o', 0, 0)], [
        line('x1', 0, 0, 1, 0),
        line('bisect', 0, 0, 1, 1),
        line('y1', 0, 0, 0, 1),
    ]), {kinds: {bisector: true}});
    check('⑦ 角平分线', result.kind.bisector.map(entry => [entry.vertexId, entry.bisectorId, entry.lineIds.slice().sort().join(',')]),
        [['o', 'bisect', 'x1,y1']]);
}

// ⑧ 紧圆规：半径 2 的圆 + 距离为 2 的点对；该圆自己的「圆心 + 圆上一点」要被排除
{
    const points = [point('o', 0, 0), point('on', 2, 0), point('p', 5, 5), point('q', 5, 7)];
    const result = GeoRelations.scan(board(points, [], [circle('g1', 0, 0, 2, 'o')]),
        {kinds: {radius: true}});
    // 无序点对：正反两条是同一件事，只记一条（按点在画板上的次序定朝向）
    check('⑧ 紧圆规', result.kind.radius.map(entry => [entry.centerId, entry.throughId, entry.sourceCircleId]),
        [['p', 'q', 'g1']]);
    // 圆自己的「圆心 + 圆上一点」不看顺序：圆 AB 的半径不能拿来说「圆 BA 的半径取自圆 AB」
    const own = GeoRelations.scan(board([point('a', 0, 0), point('b', 2, 0), point('p', 5, 5), point('q', 5, 7)],
        [], [circle('g1', 0, 0, 2, 'a')]), {kinds: {radius: true}});
    check('⑧ 紧圆规：排除该圆自己的两点', own.kind.radius.map(entry => [entry.centerId, entry.throughId]), [['p', 'q']]);
}

// ⑨ 在线复算：移动点后关系失效 / 仍在容差内
{
    const scan = GeoRelations.scan(board([point('p1', 0, 0), point('p2', 1, 0), point('p3', 2, 0)]),
        {kinds: {collinear: true}});
    const overlay = {
        tolerance: 1e-7,
        span: scan.span,
        angleTolerance: scan.angleTolerance,
        entries: scan.kind.collinear,
    };
    const live = {p1: {kind: 'point', x: 0, y: 0}, p2: {kind: 'point', x: 1, y: 0}, p3: {kind: 'point', x: 2, y: 0}};
    const lookup = id => live[id] || null;
    const held = GeoRelations.evaluateOverlay(overlay, lookup);
    check('⑨ 复算：仍成立', [held.lines.length, held.stale.length], [1, 0]);
    live.p3 = {kind: 'point', x: 2, y: 0.5};   // 明显偏离
    const broken = GeoRelations.evaluateOverlay(overlay, lookup);
    check('⑨ 复算：已失效', [broken.lines.length, broken.stale.length], [0, 1]);
    live.p3 = {kind: 'point', x: 2, y: 1e-9};  // 在容差（1e-6）内
    const nudged = GeoRelations.evaluateOverlay(overlay, lookup);
    check('⑨ 复算：容差内跟着动', [nudged.lines.length, nudged.stale.length], [1, 0]);
    delete live.p2;                            // 对象被删
    const removed = GeoRelations.evaluateOverlay(overlay, lookup);
    check('⑨ 复算：对象被删', [removed.lines.length, removed.stale.length], [0, 1]);
}

// ⑩ 参数解析
{
    check('⑩ 角度表（逗号 / 区间 / 步长）',
        [GeoRelations.parseAngleList('15,30,45,60,75'), GeoRelations.parseAngleList('15..75:15'), GeoRelations.parseAngleList('22.5, 90')],
        [[15, 30, 45, 60, 75], [15, 30, 45, 60, 75], [22.5, 90]]);
    const table = GeoRelations.parseRatioSpec('10,√10', '');
    const has = label => table.some(entry => entry.label === label);
    check('⑩ 比值表：含 1:1 / 1:3 / 3:1 / √2:1', [has('1:1'), has('1:3'), has('3:1'), has('√2:1')], [true, true, true, true]);
    // 1..10 互质对 + √1..√10 互质对（两段各约 60 项，重合的会去重）
    check('⑩ 比值表：条数在一个合理量级', table.length > 60 && table.length <= 400, true);
    check('⑩ 比值表：√10..√10 只取一个值', GeoRelations.parseRatioSpec('√10..√10', '').length, 1);
}

console.log(failures ? `\n${failures} 项未通过` : '\n全部通过');
process.exit(failures ? 1 : 0);
