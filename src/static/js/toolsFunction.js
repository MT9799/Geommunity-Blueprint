/* toolsFunction.js */

class ToolsFunction {
    /**
     * 无穷远点（gmt 的 EdgePoint）在画板里的代替距离（逻辑坐标单位）
     * 只在「无穷远点自己参与作图、又没走方向专用分支」时才会用到（见 edgePointUnit / lineCoordinateWithEdgePoint）：
     * Line[A,E]、CopyAngle、Segment[E,H] 都按精确方向算，不受这个距离影响；
     * 取 1e5 是折中——够远（方向误差 ~0.3%），又不会因为坐标太大让画布出现一大片灰色物体
     */
    static edgePointDistance = 1e6;

    /**
     * 无穷远点的方向 工具函数
     * gmt 的 EdgePoint[s,x] 只提供一个方向（沿 s 的正/负方向），
     * 用它作图时（Line[A,E] / CopyAngle / Segment[E,H]…）直接取这个单位方向，
     * 就不会因为「代替点」放得远近而影响精度，也不会把很大的坐标带进图形里
     * @param {Object} point 几何对象（不是无穷远点时返回 null）
     * @returns {{x: number, y: number} | null} 单位方向
     */
    static edgePointUnit(point) {
        const base = point && typeof point.getBase === 'function' ? point.getBase() : null;
        if (!base || base.type !== 'edgePoint') return null;
        const line = (base.bases || [])[0];
        const coordList = line && typeof line.getCoordinate === 'function' ? line.getCoordinate() : null;
        if (!coordList) return null;
        const [start, end] = coordList;
        const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
        if (length < 1e-12) return null;
        const sign = base.value ? 1 : -1;
        return {x: sign * (end[0] - start[0]) / length, y: sign * (end[1] - start[1]) / length};
    }

    /**
     * 带无穷远点的两点线的坐标 工具函数
     * 线 / 线段 / 射线的两个定义点里有一个是 EdgePoint 时：它给的是方向，
     * 换成「有限的那一端 + 方向 × 合理长度」——直线本来就无限延伸，线段 / 射线只需画够长，
     * 顺序仍按原来的定义点顺序（Segment[E,H] 的方向仍是 E→H，有限端在 H）
     * @param {Object} point1
     * @param {Object} point2
     * @returns {[[number, number], [number, number]] | null}
     */
    static lineCoordinateWithEdgePoint(point1, point2) {
        const unit1 = ToolsFunction.edgePointUnit(point1);
        const unit2 = ToolsFunction.edgePointUnit(point2);
        if (unit1 && unit2) return null;
        if (!unit1 && !unit2) return null;
        const length = 1000;
        const fix = unit1 ? point2 : point1;
        const unit = unit1 || unit2;
        const [x, y] = fix.getCoordinate();
        // 第一个定义点是无穷远点：线段从「有限点 - 方向 × 长度」到有限点
        return unit1 ? [[x - unit.x * length, y - unit.y * length], [x, y]] : [[x, y], [x + unit.x * length, y + unit.y * length]];
    }

    /**
     * 小数点舍入 工具函数
     * @param {number} number
     * @param {number} precision 精确至小数点后n位，的n值
     * @return {number}
     */
    static myRound(number, precision) {
        return Math.round(+number + "e" + precision) / Math.pow(10, precision);
    }
    
    /**
     * 计算直线与画布边界的交点 工具函数
     * @param {number[]} bag [startX, startY, endX, endY, canvasWidth, canvasHeight]
     * @param {Object} transform 当前画布变换参数
     * @return {{p1: {x: number, y: number}, p2: {x: number, y: number}}} 两个点的坐标
     */
    static getLineBounds(bag, transform) {
        const [startX, startY, endX, endY, canvasWidth, canvasHeight] = bag;
        const outCanvas = 20;
        
        const dx = endX - startX;
        const dy = endY - startY;
        const left = -outCanvas - transform.x / transform.scale;
        const right = (canvasWidth + outCanvas - transform.x) / transform.scale;
        const top = -outCanvas - transform.y / transform.scale;
        const down = (canvasHeight + outCanvas - transform.y) / transform.scale;
    
        // 处理垂直于 x 轴的直线（dx=0）
        if (dx === 0) {
            const x = startX;
            const top_ = {x, y: top};
            const bottom = {x, y: down};
            return {
                p1: top_,
                p2: bottom
            };
        }
        
        // 计算直线与画布两边的交点
        const tValues = [];
        // 与左边（x=0）的交点：t = (0 - startX)/dx
        tValues.push((left - startX) / dx);
        // 与右边（x=canvas.width）的交点：t = (canvas.width - startX)/dx
        tValues.push((right - startX) / dx);
        
        const intersections = tValues
            .map(t => ({
                x: startX + dx * t,
                y: startY + dy * t
                }));
        
        return {
            p1: intersections[0],
            p2: intersections[1]
        };
    }
    
    /**
     * 计算选中直线与画布边界的交点 工具函数
     * @param {number[]} bag [startX, startY, endX, endY, canvasWidth, canvasHeight]
     * @param {Object} transform 当前画布变换参数
     * @return {{p1: {x: number, y: number}, p2: {x: number, y: number}, 
     *  p3: {x: number, y: number}, p4: {x: number, y: number}, 
     *  p5: {x: number, y: number}, p6: {x: number, y: number}, 
     *  p7: {x: number, y: number}, p8: {x: number, y: number}}} 两组边界点对，两组偏移点对
     */
    static getChoiceLineBounds(bag, transform) {
        const [startX, startY, endX, endY, canvasWidth, canvasHeight] = bag;
        const outCanvas = 20;
        const offset = 6;
        
        const dx = endX - startX;
        const dy = endY - startY;
        const left = -outCanvas - transform.x / transform.scale;
        const right = (canvasWidth + outCanvas - transform.x) / transform.scale;
        const top = -outCanvas - transform.y / transform.scale;
        const down = (canvasHeight + outCanvas - transform.y) / transform.scale;
    
        // 处理垂直于 x 轴的直线（dx=0）
        if (dx === 0) {
            const x = startX;
            return {
                p1: {x: x + offset / transform.scale, y: top},
                p2: {x: x + offset / transform.scale, y: down},
                p3: {x: x - offset / transform.scale, y: top},
                p4: {x: x - offset / transform.scale, y: down},
                p5: {x: x + offset / transform.scale, y: startY},
                p6: {x: x - offset / transform.scale, y: startY},
                p7: {x: x + offset / transform.scale, y: endY},
                p8: {x: x - offset / transform.scale, y: endY},
            };
        }
        
        // 计算直线与画布两边的交点
        const tValues = [];
        // 与左边（x=0）的交点：t = (0 - startX)/dx
        tValues.push((left - startX) / dx);
        // 与右边（x=canvas.width）的交点：t = (canvas.width - startX)/dx
        tValues.push((right - startX) / dx);
        // 计算y轴上的偏移量
        const tmp = offset * dy / dx;
        const offsetY = Math.hypot(tmp, offset) / transform.scale;
        // 点偏移
        const pointOffsetY = offset * dx / Math.hypot(dx, dy);
        const pointOffsetX = -offset * dy / Math.hypot(dx, dy);
        
        const intersections = tValues
            .map(t => ({
                x: startX + dx * t,
                y: startY + dy * t
                }));
        
        const x1 = intersections[0].x;
        const y1 = intersections[0].y;
        const x2 = intersections[1].x;
        const y2 = intersections[1].y;
        
        return {
            p1: {x: x1, y: y1 + offsetY},
            p2: {x: x2, y: y2 + offsetY},
            p3: {x: x1, y: y1 - offsetY},
            p4: {x: x2, y: y2 - offsetY},
            p5: {x: startX + pointOffsetX, y: startY + pointOffsetY},
            p6: {x: startX - pointOffsetX, y: startY - pointOffsetY},
            p7: {x: endX + pointOffsetX, y: endY + pointOffsetY},
            p8: {x: endX - pointOffsetX, y: endY - pointOffsetY},
        };
    }
    
    /**
     * 小写字母表
     * @return {string[]}
     */
    static generateLowercaseLetters() {
        const lowercaseLetters = [];
        for (let i = 97; i <= 122; i++) {
            lowercaseLetters.push(String.fromCharCode(i));
        }
        return lowercaseLetters;
    }
    
    /**
     * ID转数值 工具函数
     * @param {string} id
     * @return {number} ID计数
     */
    static idToInt(id) {
        const tempId = id.toLowerCase();
        const lowercaseLetters = ToolsFunction.generateLowercaseLetters();
        
        const length = tempId.length;
        if (length === 1) {
            const index = lowercaseLetters.indexOf(tempId);
            return index + 1;
            
        }else if (length > 1) {
            const index = lowercaseLetters.indexOf(tempId.slice(0, 1));
            const number = Number(tempId.slice(1));
            return index + 1 + 26 * number;
        }
    }
    
    /**
     * 数值转ID 工具函数
     * @param {number} int
     * @param {boolean} lowerCase
     * @return {string} ID
     */
    static intToId(int, lowerCase) {
        // 转换
        let letter;
        const count = Math.floor((int - 1) / 26);
        const less = int % 26;
        const lowercaseLetters = ToolsFunction.generateLowercaseLetters();
        
        if (less === 0) {
            letter = "z";
        }else{
            letter = lowercaseLetters[less - 1];
        }
        
        if (!lowerCase) letter = letter.toUpperCase();
        
        if (!count) {
            return `${letter}`;
        }else{
            return `${letter}${count}`;
        }
    }
    
    /**
     * 计算点P3到直线P1P2的距离
     * @param {Object} p1 - 直线起点 {x: number, y: number}
     * @param {Object} p2 - 直线终点 {x: number, y: number}
     * @param {Object} p3 - 目标点 {x: number, y: number}
     * @returns {{flag: true, value: number} | {flag: false, information: string}} 点到直线的距离
     */
    static pointToLineDistance(p1, p2, p3) {
        // 参数校验
        if (!p1 || !p2 || !p3 || 
            typeof p1.x !== 'number' || typeof p1.y !== 'number' ||
            typeof p2.x !== 'number' || typeof p2.y !== 'number' ||
            typeof p3.x !== 'number' || typeof p3.y !== 'number') {
            return {flag: false, information: '参数必须为包含x和y属性的对象'};
        }
        
        // 检查P1和P2是否重合（直线长度为0）
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const lineLengthSquared = dx * dx + dy * dy;
        
        if (Math.abs(lineLengthSquared) < 1e-10) {
            return {flag: false, information: 'P1和P2重合，无法确定直线'};
        }
        
        // 使用向量叉积公式计算距离：|(P2-P1) × (P1-P3)| / |P2-P1|
        const crossProduct = Math.abs(dx * (p1.y - p3.y) - dy * (p1.x - p3.x));
        return {flag: true, value: crossProduct / Math.sqrt(lineLengthSquared)};
    }
    
    
    /**
     * 计算两条直线的交点坐标
     * @param {Object} p1 - 第一个点，包含x和y属性
     * @param {Object} p2 - 第二个点，包含x和y属性
     * @param {Object} p3 - 第三个点，包含x和y属性
     * @param {Object} p4 - 第四个点，包含x和y属性
     * @returns {{flag: true, value: {x, y}} | {flag: false, information: string}} 交点坐标对象 {x, y}，如果直线平行或重合则返回null
     */
    static lineIntersection(p1, p2, p3, p4) {
        const x1 = p1.x, y1 = p1.y;
        const x2 = p2.x, y2 = p2.y;
        const x3 = p3.x, y3 = p3.y;
        const x4 = p4.x, y4 = p4.y;
        
        // 计算直线方程的系数
        const A1 = y2 - y1;
        const B1 = x1 - x2;
        const C1 = x2 * y1 - x1 * y2;
        
        const A2 = y4 - y3;
        const B2 = x3 - x4;
        const C2 = x4 * y3 - x3 * y4;
        
        // 计算行列式
        const det = A1 * B2 - A2 * B1;
        
        // 处理直线平行或重合的情况（考虑浮点误差）
        if (Math.abs(det) < 1e-10) {
            return {flag: false, information: "直线平行或重合"};
        }
        
        // 计算交点坐标
        const x = (B1 * C2 - B2 * C1) / det;
        const y = (A2 * C1 - A1 * C2) / det;
        
        return {flag: true, value: {x, y}};
    }
    
    /**
     * 计算直线与圆的交点坐标
     * @param {Object} p1 - 直线第一个点，包含x和y属性
     * @param {Object} p2 - 直线第二个点，包含x和y属性
     * @param {Object} p3 - 圆心点，包含x和y属性
     * @param {Object} p4 - 圆上点，包含x和y属性
     * @returns {{count: number, value: Array}} 交点坐标数组，可能包含0、1或2个交点
     */
    static lineCircleIntersection(p1, p2, p3, p4) {
        // 计算圆的半径
        const radius = Math.sqrt(Math.pow(p4.x - p3.x, 2) + Math.pow(p4.y - p3.y, 2));
        
        // 直线方程参数：Ax + By + C = 0
        const A = p2.y - p1.y;
        const B = p1.x - p2.x;
        const C = p2.x * p1.y - p1.x * p2.y;
        
        // 圆心坐标
        const cx = p3.x;
        const cy = p3.y;
        
        // 计算圆心到直线的距离
        const distance = Math.abs(A * cx + B * cy + C) / Math.sqrt(A * A + B * B);
        
        // 处理无交点情况（直线与圆相离）
        if (distance > radius + 1e-10) {
            return ToolsFunction.formatIntersections([]);
        }
        
        // 处理相切情况（一个交点）
        if (Math.abs(distance - radius) < 1e-10) {
            // 计算垂足坐标（切点）
            const denominator = A * A + B * B;
            const x0 = (B * (B * cx - A * cy) - A * C) / denominator;
            const y0 = (A * (-B * cx + A * cy) - B * C) / denominator;
            return ToolsFunction.formatIntersections([{x: x0, y: y0}]);
        }
        
        // 处理相交情况（两个交点）
        // 计算垂足坐标
        const denominator = A * A + B * B;
        const x0 = (B * (B * cx - A * cy) - A * C) / denominator;
        const y0 = (A * (-B * cx + A * cy) - B * C) / denominator;
        
        // 计算半弦长：与下面圆圆的情况同理，相切时可能是极小的负数，先夹到 0 免得算出 NaN
        const chordHalfLength = Math.sqrt(Math.max(radius * radius - distance * distance, 0));
        
        // 计算单位方向向量
        const vecLength = Math.sqrt(A * A + B * B);
        const unitX = B / vecLength;
        const unitY = -A / vecLength;
        
        // 计算两个交点坐标
        const intersection1 = {
            x: x0 + unitX * chordHalfLength,
            y: y0 + unitY * chordHalfLength
        };
        
        const intersection2 = {
            x: x0 - unitX * chordHalfLength,
            y: y0 - unitY * chordHalfLength
        };
        
        // 编号约定（与 gmt 的 Intersect[对象1,对象2,x] 一致）：
        // 线圆交点按线的方向（第一个定义点 -> 第二个定义点）计数，value[0] 为先遇到的交点
        const directionX = p2.x - p1.x;
        const directionY = p2.y - p1.y;
        const project = coord => (coord.x - p1.x) * directionX + (coord.y - p1.y) * directionY;
        const results = [intersection1, intersection2].sort((a, b) => project(a) - project(b));
        
        return ToolsFunction.formatIntersections(results);
    }
    
    /**
     * 计算两个圆的交点坐标
     * @param {Object} p1 - 第一个圆的圆心，包含x和y属性
     * @param {Object} p2 - 第一个圆上的点，包含x和y属性
     * @param {Object} p3 - 第二个圆的圆心，包含x和y属性
     * @param {Object} p4 - 第二个圆上的点，包含x和y属性
     * @returns {{count: number, value: Array}} 交点坐标数组，可能包含0、1或2个交点
     */
    static circleCircleIntersection(p1, p2, p3, p4) {
        // 计算两个圆的半径
        const r1 = Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
        const r2 = Math.sqrt(Math.pow(p4.x - p3.x, 2) + Math.pow(p4.y - p3.y, 2));
        
        // 圆心坐标
        const x1 = p1.x, y1 = p1.y;
        const x2 = p3.x, y2 = p3.y;
        
        // 计算两圆心之间的距离
        const d = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
        
        // 处理无交点情况（相离或内含）
        if (d > r1 + r2 + 1e-10 || d < Math.abs(r1 - r2) - 1e-10) {
            return ToolsFunction.formatIntersections([]);
        }
        
        // 处理同心圆情况
        if (d < 1e-10 && Math.abs(r1 - r2) < 1e-10) {
            // 同心圆且半径相等，有无数交点，返回空数组
            return ToolsFunction.formatIntersections([]);
        }
        
        if (d < 1e-10) {
            // 同心圆但半径不同，无交点
            return ToolsFunction.formatIntersections([]);
        }
        
        // 计算交点连线到圆心1的距离
        const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
        
        // 计算交点连线的半长：相切时 r1² - a² 可能是极小的负数（浮点误差），
        // 直接开方会得到 NaN，交点就成了 (null, null) —— 先夹到 0（Malfatti's Problem 的 T 就是这样丢的）
        const h = Math.sqrt(Math.max(r1 * r1 - a * a, 0));
        
        // 计算中间点（两圆心连线与交点连线的交点）
        const x0 = x1 + a * (x2 - x1) / d;
        const y0 = y1 + a * (y2 - y1) / d;
        
        // 处理相切情况（一个交点）
        if (Math.abs(h) < 1e-10) {
            return ToolsFunction.formatIntersections([{x: x0, y: y0}]);
        }
        
        // 计算两个交点坐标
        // 编号约定（与 gmt 的 Intersect[对象1,对象2,x] 一致）：
        // 圆圆交点以对象1圆心 -> 对象2圆心的方向起逆时针（画布 y 轴朝下，视觉上的逆时针）计数，
        // value[0] 为逆时针侧的交点
        const intersection1 = {
            x: x0 + h * (y2 - y1) / d,
            y: y0 - h * (x2 - x1) / d
        };
        
        const intersection2 = {
            x: x0 - h * (y2 - y1) / d,
            y: y0 + h * (x2 - x1) / d
        };
        
        return ToolsFunction.formatIntersections([intersection1, intersection2]);
    }
    
    static formatIntersections(intersections) {
        if (intersections.length === 0) {
            return {count: 0};
        } else if (intersections.length === 1) {
            return {count: 1, value: intersections};
        } else {
            return {count: 2, value: intersections};
        }
    }

    /**
     * ID排序
     * @param {Object[]} list 实体对象列表
     * @returns {Object[]}
     */
    static idOrder(list) {
        const orderList = new Array();
        for (const item of list) {
            const id = item.getId();
            const idNumber = ToolsFunction.idToInt(id);
            let length = orderList.length - 1;
            if (length < 0) orderList.push(item)

            for (let i = 0; length - i >= 0; i++) {
                const element = orderList[length - i];
                const idNumber2 = ToolsFunction.idToInt(element.getId());
                if (idNumber > idNumber2) {
                    orderList.splice(length - i + 1, 0, item);
                    break;
                }
                if (length - i === 0) orderList.unshift(item);
            }
        }
        return orderList;
    }
    
    /**
     * 复制线段
     * 根据点p1, p2, p3，返回点p4满足p1p4与p2p3方向相同且相等
     * @param {{x: number, y: number}} p1
     * @param {{x: number, y: number}} p2
     * @param {{x: number, y: number}} p3
     * @returns {{x: number, y: number}} 输出点
     */
    static parallelogram(p1, p2, p3) {
        const deltaX = p3.x - p2.x;
        const deltaY = p3.y - p2.y;
        return {x: p1.x + deltaX, y: p1.y + deltaY};
    }
    
    /**
     * 垂直线段
     * 根据点p1, p2, p3，返回点p4满足p1p4为p2p3顺转90度
     * 画布 y 轴朝下，视觉上的「顺转」（顺时针）对应 (dx, dy) -> (-dy, dx)；
     * 这个方向决定 Intersect[垂线,圆,x] 的编号与 Linepoint[垂线,x] 的落点，必须与参考文档一致
     * @param {{x: number, y: number}} p1
     * @param {{x: number, y: number}} p2
     * @param {{x: number, y: number}} p3
     * @returns {{x: number, y: number}} 输出点
     */
    static perpendicular(p1, p2, p3) {
        const deltaX = p3.x - p2.x;
        const deltaY = p3.y - p2.y;
        return {x: p1.x - deltaY, y: p1.y + deltaX};
    }
    
    /**
     * 中点
     * @param {{x: number, y: number}} p1
     * @param {{x: number, y: number}} p2
     * @returns {{x: number, y: number}} 输出点
     */
    static middlePoint(p1, p2) {
        return {x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2};
    }
    
    /**
     * 垂直平分线
     * 根据点p1, p2返回点p3, p4，满足p1p2的中点p5与p3p4为同一个点，
     * 且p3为点p1绕p5旋转90度，p4为点p2绕p5选择90度
     * 与 perpendicular 同理：画布 y 轴朝下，「顺转90度」用 (dx, dy) -> (-dy, dx)，
     * 这样 Intersect[中垂线,圆,x] 的编号方向（参考文档：「起点在顺转90°处」）才对
     * @param {{x: number, y: number}} p1
     * @param {{x: number, y: number}} p2
     * @returns {[{x: number, y: number}, {x: number, y: number}]} 输出点对
     */
    static perpendicularBisector(p1, p2) {
        const middleX = (p1.x + p2.x) / 2;
        const middleY = (p1.y + p2.y) / 2;
        const deltaP1X = p1.x - middleX;
        const deltaP1Y = p1.y - middleY;
        const deltaP2X = p2.x - middleX;
        const deltaP2Y = p2.y - middleY;
        const p3 = {x: middleX - deltaP1Y, y: middleY + deltaP1X};
        const p4 = {x: middleX - deltaP2Y, y: middleY + deltaP2X};
        return [p3, p4];
    }
    
    /**
     * 两点长度
     * @param {{x: number, y: number}} p1
     * @param {{x: number, y: number}} p2
     * @returns {number}
     */
    static distance(p1, p2) {
        const deltaX = p1.x - p2.x;
        const deltaY = p1.y - p2.y;
        return Math.hypot(deltaX, deltaY);
    }
    
    /**
     * 三点角度
     * 返回角p1p2p3的角度，顶点为p2
     * @param {{x: number, y: number}} p1
     * @param {{x: number, y: number}} p2
     * @param {{x: number, y: number}} p3
     * @returns {number} 弧度制
     */
    static angle(p1, p2, p3) {
        const p1p2 = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        const p2p3 = Math.hypot(p3.x - p2.x, p3.y - p2.y);
        const p3p1 = Math.hypot(p1.x - p3.x, p1.y - p3.y);
        const cosP2 = (Math.pow(p1p2, 2) + Math.pow(p2p3, 2) - Math.pow(p3p1, 2)) / (2 * p1p2 * p2p3);
        const angleP2 = Math.acos(cosP2);
        return angleP2;
    }
    
    /**
     * 两点上的比例点
     * 根据p1p2和比例k返回点p3，满足p1p3=k*p1p2
     * @param {{x: number, y: number}} p1
     * @param {{x: number, y: number}} p2
     * @param {number} k 比例
     * @returns {{x: number, y: number}} p3
     */
    static scalePoint(p1, p2, k) {
        const deltaX = p2.x - p1.x;
        const deltaY = p2.y - p1.y;
        return {x: p1.x + k * deltaX, y: p1.y + k * deltaY};
    }
    
    /**
     * 角平分线
     * 根据点p1, p2, p3，返回点p4满足p4为角p1p2p3的角平分线与直线p1p3的交点
     * @param {{x: number, y: number}} p1
     * @param {{x: number, y: number}} p2
     * @param {{x: number, y: number}} p3
     * @returns {{flag: false, information: string} | {flag: true, value: {x: number, y: number}}} 输出点
     */
    static angleBisector(p1, p2, p3) {
        const p2p1 = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        const p2p3 = Math.hypot(p3.x - p2.x, p3.y - p2.y);
        // 除0检查
        if (p2p1 === 0) return {flag: false, information: "p2p1 === 0, 不能形成角平分线"};
        if (p2p3 === 0) return {flag: false, information: "p2p3 === 0, 不能形成角平分线"};
        const scale = p2p1 / p2p3;
        const tmp = scale + 1;
        if (tmp === 0) return {flag: false, information: "tmp === 0, 不能形成角平分线"};
        
        const k = scale / (scale + 1);
        const p4 = ToolsFunction.scalePoint(p1, p3, k);
        return {flag: true, value: p4};
    }
    
    /**
     * 外角平分线
     * 根据点p1, p2, p3，返回点p4满足p4为角p1p2p3的外角平分线与直线p1p3的交点
     * @param {{x: number, y: number}} p1
     * @param {{x: number, y: number}} p2
     * @param {{x: number, y: number}} p3
     * @returns {{flag: false, information: string} | {flag: true, value: {x: number, y: number}}} 输出点
     */
    static angleOutBisector(p1, p2, p3) {
        const p2p1 = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        const p2p3 = Math.hypot(p3.x - p2.x, p3.y - p2.y);
        // 除0检查
        if (p2p1 === 0) return {flag: false, information: "不能形成角平分线"};
        if (p2p3 === 0) return {flag: false, information: "不能形成角平分线"};
        const scale = p2p1 / p2p3;
        const tmp = scale - 1;
        if (tmp === 0) return {flag: false, information: "不能形成角平分线"};
        
        const k = scale / (scale - 1);
        const p4 = ToolsFunction.scalePoint(p1, p3, k);
        return {flag: true, value: p4};
    }
    
    /**
     * 3点圆
     * 根据点p1, p2, p3，返回外心
     * @param {{x: number, y: number}} p1
     * @param {{x: number, y: number}} p2
     * @param {{x: number, y: number}} p3
     * @returns {{flag: false, information: string} | {flag: true, value: {x: number, y: number}}} 输出点
     */
    static threePointsCircle(p1, p2, p3) {
        const [p4, p5] = ToolsFunction.perpendicularBisector(p1, p2);
        const [p6, p7] = ToolsFunction.perpendicularBisector(p1, p3);
        const flagValue = ToolsFunction.lineIntersection(p4, p5, p6, p7);
        
        if (flagValue.flag) {
            return {flag: true, value: flagValue.value};
        }else{
            return {flag: false, information: "3点共线"};
        }
    }
    
    /**
     * 计算与给定三角形正相似的三角形的第三个顶点
     * 已知三角形p1p2p3和三角形的前两个顶点p4,p5，求p6使得三角形p4p5p6与三角形p1p2p3正相似（对应顶点顺序：p1->p4, p2->p5, p3->p6）
     * @param {Object} p1 - 第一个三角形的第一个顶点，具有x和y属性
     * @param {Object} p2 - 第一个三角形的第二个顶点
     * @param {Object} p3 - 第一个三角形的第三个顶点
     * @param {Object} p4 - 第二个三角形的第一个顶点
     * @param {Object} p5 - 第二个三角形的第二个顶点
     * @returns {Object|null} 第二个三角形的第三个顶点p6，如果三角形退化则返回null
     */
    static findSimilarTriangleVertex(p1, p2, p3, p4, p5) {
        // 计算向量
        const v1 = { x: p2.x - p1.x, y: p2.y - p1.y };
        const v2 = { x: p3.x - p1.x, y: p3.y - p1.y };
        const u1 = { x: p5.x - p4.x, y: p5.y - p4.y };
    
        // 计算v1的长度
        const lenV1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y);
        if (lenV1 < 1e-10) {
            // 三角形p1p2p3退化，无法确定相似
            return null;
        }
    
        // 缩放因子
        const lenU1 = Math.sqrt(u1.x * u1.x + u1.y * u1.y);
        const scale = lenU1 / lenV1;
    
        // 旋转角度
        const angleV1 = Math.atan2(v1.y, v1.x);
        const angleU1 = Math.atan2(u1.y, u1.x);
        const rotation = angleU1 - angleV1;
    
        const cosR = Math.cos(rotation);
        const sinR = Math.sin(rotation);
    
        // 应用旋转和缩放到v2得到u2
        const u2 = {
            x: scale * (v2.x * cosR - v2.y * sinR),
            y: scale * (v2.x * sinR + v2.y * cosR)
        };
    
        // p6 = p4 + u2
        const p6 = { x: p4.x + u2.x, y: p4.y + u2.y };
        return p6;
    }
    
    /**
     * 切点
     * 根据点p1, 圆p2, p3，返回切点
     * 当切点为两个时，两个点的顺序为p1向p2逆时针
     * @param {{x: number, y: number}} p1
     * @param {{x: number, y: number}} p2
     * @param {{x: number, y: number}} p3
     * @returns {{count: number, value: Object[]}} 输出点
     */
    static tangent(p1, p2, p3) {
        const distance = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        const radius = Math.hypot(p3.x - p2.x, p3.y - p2.y);
        const diff = distance - radius;
        
        if (Math.abs(diff) < 1e-10) {
            // 在圆上
            const deltaX = p1.x - p2.x;
            const deltaY = p1.y - p2.y;
            const p4 = {x: p1.x + deltaY, y: p1.y - deltaX};
            return {count: 1, value: p4};
            
        }else if (diff > 0) {
            // 在圆外
            const tmpRadius = Math.sqrt((distance + radius) * (distance - radius));
            const tmp = {x: p1.x + tmpRadius, y: p1.y};
            const countValue = ToolsFunction.circleCircleIntersection(p1, tmp, p2, p3);
            if (countValue.count === 2) return {count: 2, value: countValue.value};
            
        }else{
            // 在圆内
            return {count: 0};
        }
    }
    
    /**
     * 反演点
     * 点p1, 圆p2, p3
     * @param {{x: number, y: number}} p1
     * @param {{x: number, y: number}} p2
     * @param {{x: number, y: number}} p3
     * @returns {{x: number, y: number} | null} 输出点
     */
    static inversion(p1, p2, p3) {
        const countValue = ToolsFunction.lineCircleIntersection(p1, p2, p2, p3);
        if (countValue.count !== 2) return null;
        
        const [p4, p5] = countValue.value;
        const p1p4 = Math.hypot(p1.x - p4.x, p1.y - p4.y);
        const p1p5 = Math.hypot(p1.x - p5.x, p1.y - p5.y);
        
        if (p1p5 === 0) return null;
        const scale = p1p4 / p1p5;
        const tmp = 1 + 1 / scale;
        if (tmp === 0) return null;
        
        const k = 1 / tmp;
        const p6 = ToolsFunction.scalePoint(p4, p5, k);
        return p6;
    }
    
    /**
     * 极线
     * 点p1, 圆p2, p3，返回极线与直线(p1, p2)的交点p4，和p2关于p4顺时针旋转90度的点p5
     * @param {{x: number, y: number}} p1
     * @param {{x: number, y: number}} p2
     * @param {{x: number, y: number}} p3
     * @returns {[{x: number, y: number}, {x: number, y: number}] | null} 输出点
     */
    static polarLine(p1, p2, p3) {
        const p4 = ToolsFunction.inversion(p1, p2, p3);
        if (!p4) return null;
        
        const deltaX = p2.x - p4.x;
        const deltaY = p2.y - p4.y;
        const p5 = {x: p4.x + deltaY, y: p4.y - deltaX};
        return [p4, p5];
    }
    
    /**
     * 极点
     * 直线p1, p2, 圆p3, p4
     * @param {{x: number, y: number}} p1
     * @param {{x: number, y: number}} p2
     * @param {{x: number, y: number}} p3
     * @param {{x: number, y: number}} p4
     * @returns {{x: number, y: number} | null} 输出点
     */
    static polarPoint(p1, p2, p3, p4) {
        const line1 = ToolsFunction.polarLine(p1, p3, p4);
        if (!line1) return null;
        const line2 = ToolsFunction.polarLine(p2, p3, p4);
        if (!line2) return null;
        const [p5, p6] = line1;
        const [p7, p8] = line2;
        const flagValue = ToolsFunction.lineIntersection(p5, p6, p7, p8);
        
        if (flagValue.flag) {
            return flagValue.value;
        }else{
            return null;
        }
    }
    
    /**
     * 返回圆上以画布x轴正方向，指定弧度的点的坐标
     * @param {{x: number, y: number}} p1 圆心
     * @param {{x: number, y: number}} p2 圆上的点
     * @param {number} value 弧度
     * @returns {{x: number, y: number}}
     */
    static radianToCoordinate(p1, p2, value) {
        const radius = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        const dx = radius * Math.cos(value);
        const dy = radius * Math.sin(value);
        return {x: p1.x + dx, y: p1.y + dy};
    }
    
    /**
     * 直线点吸附值
     * @param {{x: number, y: number}} p1 直线定义点
     * @param {{x: number, y: number}} p2 直线定义点
     * @param {{x: number, y: number}} p3 要吸附的坐标
     * @returns {number | null} 直线定义点的值
     */
    /**
     * 光标在线上的位置 → 该线的 Linepoint 参数（gmt 约定） 过程函数
     * 直线 / 线段 / 射线 / 垂线 / 平行线 / 切线…：参数就是「沿渲染两点的比例」（与导入端的 scalePoint 一致）；
     * 角平分线：gmt 约定是「以顶点为起点、每 100 单位长度算一个参数」，所以要换成 距离 / 100。
     * 不换的话，在制题器里画出来的这类点，导出时会比实际值小很多（导入端却是按 100 单位算的，
     * 于是「同一个图形，载入的导出正常、自己画的导出不对」）
     * @param {Object} element 线对象
     * @param {{x: number, y: number}} p1 渲染的第一点
     * @param {{x: number, y: number}} p2 渲染的第二点
     * @param {{x: number, y: number}} p3 光标位置
     * @returns {number}
     */
    static onlineValueOf(element, p1, p2, p3) {
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const lengthSquared = dx * dx + dy * dy;
        if (lengthSquared < 1e-20) return null;
        // 用**不夹紧**的投影比例：nearPointOnLine 会把比例夹到 [0,1]，
        // 而角平分线上的点常落在「渲染出来的那一小段」之外（渲染长度可能只有几十，
        // 点却在距顶点一百多的地方），夹紧后换算出的参数会变小 —— 一拖动点就跳到错误位置
        const proportion = ((p3.x - p1.x) * dx + (p3.y - p1.y) * dy) / lengthSquared;
        const length = Math.sqrt(lengthSquared);
        const baseType = element && element.getBase ? (element.getBase() || {}).type : null;
        // 每类线型的「参数 → 坐标」公式不同（见 updateOnlineCoordinate），这里逐类反解，
        // 否则制题器里画出来的点和载入关卡的点会落在不同的位置、导出也偏（这正是「同一样式，画的和载入的不一致」的根源）
        if (baseType === 'threePointAngleBisector' || baseType === 'twoLineAngleBisector') {
            // 1 个参数单位 = 基底长度（随角度变化）
            return proportion * length / ToolsFunction.angleBisectorBase(element, p1, p2);
        }
        if (baseType === 'perpendicular') {
            // 垂线：coord = p1 + (value - 1) * (p2 - p1)，所以 value = 比例 + 1
            return proportion + 1;
        }
        if (baseType === 'tangent') {
            // 切线：coord = 切点 + 方向 * 半径 * value，渲染点是 [外点, 切点]，
            // 于是 value = （点相对切点的距离）/ 半径
            const circle = (element.getBase()?.figure || [])[1];
            const circleCoord = circle && typeof circle.getCoordinate === 'function' ? circle.getCoordinate() : null;
            const radius = circleCoord ? Math.hypot(circleCoord[1][0] - circleCoord[0][0], circleCoord[1][1] - circleCoord[0][1]) : 0;
            if (radius < 1e-12) return proportion;
            return (proportion - 1) * length / radius;
        }
        // 直线 / 射线 / 线段 / 平行线等：coord = scalePoint(p1, p2, value)，value 就是比例
        return proportion;
        }

        /**
        * 角平分线的 Linepoint 参数基底长度 过程函数
        * 原版游戏的真实规则：过顶点作角平分线的垂线，比较**角的两条边上的定义点**到这条垂线的距离，
        * 再和画布 50 单位一起取三者中的最小值，它的两倍就是「1 个参数单位」对应的长度 ——
        * 两边都离得远时正好是 100，某一边离垂线只有 40 时就变成 80。
        * 角度很大时两条边向垂线靠拢，基底随之变小，于是同一个参数值对应的点到顶点距离会缩小
        * @param {Object} element 角平分线对象（三点 / 两线）
        * @param {{x: number, y: number}} vertex 角平分线的起点（顶点）
        * @param {{x: number, y: number}} directionPoint 角平分线上的另一点（定方向用）
        * @returns {number} 基底长度（1 个参数单位对应多少个画布单位）
        */
        static angleBisectorBase(element, vertex, directionPoint) {
        const length = Math.hypot(directionPoint.x - vertex.x, directionPoint.y - vertex.y);
        if (length < 1e-12) return 100;
        const unitX = (directionPoint.x - vertex.x) / length;
        const unitY = (directionPoint.y - vertex.y) / length;
        // 「到垂线的距离」= 该点与顶点连线在角平分线方向上的投影长度
        let shortest = 50;
        const figure = (element && element.getBase && element.getBase() || {}).figure || [];
        // 三点角平分线：figure = [一边上的点, 顶点, 另一边上的点]；
        // 两线角平分线没有「边上的点」，保持 100
        [figure[0], figure[2]].forEach(item => {
            const coord = item && typeof item.getCoordinate === 'function' ? item.getCoordinate() : null;
            if (!Array.isArray(coord) || typeof coord[0] !== 'number') return;
            const distance = Math.abs((coord[0] - vertex.x) * unitX + (coord[1] - vertex.y) * unitY);
            if (distance < shortest) shortest = distance;
        });
        return shortest * 2;
        }
    
    static nearPointOnLine(p1, p2, p3) {
        const p1p2 = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        const p2p3 = Math.hypot(p3.x - p2.x, p3.y - p2.y);
        const p3p1 = Math.hypot(p1.x - p3.x, p1.y - p3.y);
        const cosP1 = (Math.pow(p1p2, 2) + Math.pow(p3p1, 2) - Math.pow(p2p3, 2)) / (2 * p1p2 * p3p1);
        
        const projectionDistance = cosP1 * p3p1;
        if (p1p2 === 0) return null;
        const ratio = projectionDistance / p1p2;
        return ratio;
    }
    
    /**
     * 圆点吸附值
     * @param {{x: number, y: number}} p1 圆心
     * @param {{x: number, y: number}} p2 要吸附的坐标
     * @returns {number} 圆定义点的值
     */
    static nearPointOnCircle(p1, p2) {
        const radian = Math.atan2(p2.y - p1.y, p2.x - p1.x);
        return radian;
    }
    
    /**
     * 计算两条直线的交点坐标
     * @param {Object} line1
     * @param {Object} line2
     * @returns {{flag: true, value: {x, y}} | {flag: false, information: string}} 交点坐标对象 {x, y}，如果直线平行或重合则返回null
     */
    static lineIntersectionByGeometryObject(line1, line2) {
        const coordList1 = line1.getCoordinate();
        const coordList2 = line2.getCoordinate();
        const [x1, y1] = coordList1[0];
        const [x2, y2] = coordList1[1];
        const [x3, y3] = coordList2[0];
        const [x4, y4] = coordList2[1];
        const p1 = {x: x1, y: y1};
        const p2 = {x: x2, y: y2};
        const p3 = {x: x3, y: y3};
        const p4 = {x: x4, y: y4};
        return ToolsFunction.lineIntersection(p1, p2, p3, p4);
    }
    
    /**
     * 计算直线与圆的交点坐标
     * @param {Object} line
     * @param {Object} circle
     * @returns {{count: number, value: Array}} 交点坐标数组，可能包含0、1或2个交点
     */
    static lineCircleIntersectionByGeometryObject(line, circle) {
        const coordList1 = line.getCoordinate();
        const coordList2 = circle.getCoordinate();
        const [x1, y1] = coordList1[0];
        const [x2, y2] = coordList1[1];
        const [x3, y3] = coordList2[0];
        const [x4, y4] = coordList2[1];
        const p1 = {x: x1, y: y1};
        const p2 = {x: x2, y: y2};
        const p3 = {x: x3, y: y3};
        const p4 = {x: x4, y: y4};
        return ToolsFunction.lineCircleIntersection(p1, p2, p3, p4);
    }
    
    /**
     * 计算两个圆的交点坐标
     * @param {Object} circle1
     * @param {Object} circle2
     * @returns {{count: number, value: Array}} 交点坐标数组，可能包含0、1或2个交点
     */
    static circleCircleIntersectionByGeometryObject(circle1, circle2) {
        const coordList1 = circle1.getCoordinate();
        const coordList2 = circle2.getCoordinate();
        const [x1, y1] = coordList1[0];
        const [x2, y2] = coordList1[1];
        const [x3, y3] = coordList2[0];
        const [x4, y4] = coordList2[1];
        const p1 = {x: x1, y: y1};
        const p2 = {x: x2, y: y2};
        const p3 = {x: x3, y: y3};
        const p4 = {x: x4, y: y4};
        return ToolsFunction.circleCircleIntersection(p1, p2, p3, p4);
    }
    
    /**
     * 以基底更新交点坐标
     * @param {{type: string, bases: Object[], value: number}} define
     * @returns {{valid: boolean, coordinate: [x, y]}}
     */
    static updateIntersectionCoordinate(define) {
        const base = define.bases;
        const element1 = base[0];
        const element2 = base[1];
        if (!element1.getValid()) return {valid: false};
        if (!element2.getValid()) return {valid: false};
        
        const index = define.value || 0;
        let candidates = ToolsFunction.intersectionCandidates(element1, element2);
        if (!candidates.length) return {valid: false};
        // 取编号之前先按「是否落在对象范围内」过一遍：线段 / 射线上的交点只可能是范围内的那个
        // （Intersect[射线,圆,0] 指的是射线方向上的交点，射线反方向的候选不该占编号——
        //  不过滤的话 0 号会取到反向那个，再被范围检查判成失效，整个图形就画不出来）
        // 一个都不在范围内时保留原列表：编号照旧取，最后仍按「失效但不删除」处理，
        // 拖动图形使交点暂时跑到线外时不会跳到另一个交点上
        const inRange = candidates.filter(candidate => ToolsFunction.pointInElementRange(candidate.x, candidate.y, element1)
            && ToolsFunction.pointInElementRange(candidate.x, candidate.y, element2));
        if (inRange.length) candidates = inRange.map((candidate, i) => ({index: i, x: candidate.x, y: candidate.y}));
        // gmt 里 Intersect[a,b,x,已知点]：第四个参数是「已知的那个交点」，
        // 编号时先把它排掉 —— 不排的话编号会错位，取到已知点自己（得到重合的退化交点）
        const exclude = define.exclude;
        if (exclude && candidates.length > 1) {
            const coord = typeof exclude.getCoordinate === 'function' ? exclude.getCoordinate() : null;
            if (Array.isArray(coord) && typeof coord[0] === 'number') {
                const rest = candidates.filter(candidate => Math.hypot(candidate.x - coord[0], candidate.y - coord[1]) > 1e-6);
                if (rest.length) candidates = rest.map((candidate, i) => ({index: i, x: candidate.x, y: candidate.y}));
            }
        }
        
        // 线与圆 / 圆与圆：候选带「是不是与圆的定义点重合」的标记，
        // 编号按 原版游戏的实测规则（第一个 Intersect 取非定义点那个）来挑，见 pickIntersectionCandidate
        const type1 = element1.getType();
        const type2 = element2.getType();
        const isLineCircle = (type1 === "line" && type2 === "circle") || (type1 === "circle" && type2 === "line");
        const isCircleCircle = type1 === "circle" && type2 === "circle";
        if (isLineCircle || isCircleCircle) {
            const line = type1 === "line" ? element1 : element2;
            const circle = type1 === "circle" ? element1 : element2;
            let list = isCircleCircle
                ? ToolsFunction.circleCircleCandidateList(element1, element2)
                : ToolsFunction.lineCircleCandidateList(line, circle);
            // 先按「是否落在对象范围内」过一遍（线段 / 射线上的交点只可能是范围内的那个）
            const rangeOk = list.filter(candidate => ToolsFunction.pointInElementRange(candidate.x, candidate.y, element1)
                && ToolsFunction.pointInElementRange(candidate.x, candidate.y, element2));
            if (rangeOk.length) list = rangeOk;
            // gmt 的第四个参数（Intersect[a,b,x,已知点]）：先把已知的那个交点排掉，免得它占着编号
            const excludeCoord = exclude && typeof exclude.getCoordinate === 'function' ? exclude.getCoordinate() : null;
            if (excludeCoord && list.length > 1) {
                const rest = list.filter(candidate => Math.hypot(candidate.x - excludeCoord[0], candidate.y - excludeCoord[1]) > 1e-6);
                if (rest.length) list = rest;
            }
            const chosen = ToolsFunction.pickIntersectionCandidate(define, list, index);
            if (!chosen) return {valid: false};
            if (!ToolsFunction.pointInElementRange(chosen.x, chosen.y, element1)) return {valid: false};
            if (!ToolsFunction.pointInElementRange(chosen.x, chosen.y, element2)) return {valid: false};
            return {valid: true, coordinate: [chosen.x, chosen.y]};
        }
        
        // 只有一个交点时忽略编号，避免编号越界
        const target = candidates.length === 1 ? candidates[0] : (candidates[index] || candidates[0]);
        // 相交于线段、射线之外时该交点失效：对象保留（不显示），重新相交后自动恢复
        if (!ToolsFunction.pointInElementRange(target.x, target.y, element1)) return {valid: false};
        if (!ToolsFunction.pointInElementRange(target.x, target.y, element2)) return {valid: false};
        return {valid: true, coordinate: [target.x, target.y]};
    }
    
    /**
     * 圆的定义点坐标 过程函数
     * 「定义点」= 画圆时点的那两个点里的半径端点（Circle[A,B] 的 B）；取不到就返回 null
     * @param {Object} circle
     * @returns {[number, number]|null}
     */
    static definingPointCoordinate(circle) {
        const base = circle && circle.getBase && circle.getBase() || {};
        // 只认「两点圆」Circle[A,B]：它的半径端点是画圆时点出来的那个点，原版游戏的编号规则是针对它的。
        // 三点圆 Circle3[A,B,C]、圆规 Compass 这些没有「半径端点」这种定义点，
        // 硬把 figure[1] 当定义点会让编号规则误判（tri-peri-bisect-of-point 的 K 一移动就跳到 0 号位）
        if (base.type !== 'twoPoints') return null;
        const figure = base.figure || [];
        const item = figure[1];
        const coord = item && typeof item.getCoordinate === 'function' ? item.getCoordinate() : null;
        return Array.isArray(coord) && typeof coord[0] === 'number' ? coord : null;
    }
    
    /**
     * 线与圆的交点候选（按线的方向「第一定义点 -> 第二定义点」升序）
     * defining：该候选是否与**圆的定义点**重合（重合时 原版游戏的编号规则另有讲究，见 pickIntersectionCandidate）
     * @param {Object} line
     * @param {Object} circle
     * @returns {{x: number, y: number, defining: boolean}[]}
     */
    static lineCircleCandidateList(line, circle) {
        const countValue = ToolsFunction.lineCircleIntersectionByGeometryObject(line, circle);
        if (!countValue || !countValue.count) return [];
        const coord = ToolsFunction.definingPointCoordinate(circle);
        return countValue.value.map(candidate => ({
            x: candidate.x,
            y: candidate.y,
            defining: !!coord && Math.hypot(candidate.x - coord[0], candidate.y - coord[1]) < 1e-6,
        }));
    }
    
    /**
     * 线与圆的交点候选表（对外：预览 / 交互取点用）
     * 不带 defining 标记、也不做任何排除 —— 编号规则在 pickIntersectionCandidate 里处理
     * @param {Object} line
     * @param {Object} circle
     * @returns {{count: number, value: {x: number, y: number}[]}}
     */
    static lineCircleCandidates(line, circle) {
        const list = ToolsFunction.lineCircleCandidateList(line, circle);
        return {count: list.length, value: list.map(item => ({x: item.x, y: item.y}))};
    }
    
    /**
     * 圆与圆的交点候选（按连心线方向，第一圆心 -> 第二圆心，起逆时针升序）
     * defining：该候选是否与某个圆的定义点重合
     * @param {Object} circle1
     * @param {Object} circle2
     * @returns {{x: number, y: number, defining: boolean}[]}
     */
    static circleCircleCandidateList(circle1, circle2) {
        const countValue = ToolsFunction.circleCircleIntersectionByGeometryObject(circle1, circle2);
        if (!countValue || !countValue.count) return [];
        const coords = [ToolsFunction.definingPointCoordinate(circle1), ToolsFunction.definingPointCoordinate(circle2)]
            .filter(coord => !!coord);
        return countValue.value.map(candidate => ({
            x: candidate.x,
            y: candidate.y,
            defining: coords.some(coord => Math.hypot(candidate.x - coord[0], candidate.y - coord[1]) < 1e-6),
        }));
    }
    
    /**
     * 圆与圆的交点候选表（对外：预览 / 交互取点用）
     * @param {Object} circle1
     * @param {Object} circle2
     * @returns {{count: number, value: {x: number, y: number}[]}}
     */
    static circleCircleCandidates(circle1, circle2) {
        const list = ToolsFunction.circleCircleCandidateList(circle1, circle2);
        return {count: list.length, value: list.map(item => ({x: item.x, y: item.y}))};
    }
    
    /**
     * 同一对基底上、比自己先出现的交点有几个 过程函数
     * 原版游戏的编号规则要用到「我是这一对对象上的第几个交点」（见 pickIntersectionCandidate）
     * @param {{type: string, bases: Object[]}} define
     * @returns {number}
     */
    static intersectionSiblingCount(define) {
        if (typeof geometryManager === 'undefined' || !geometryManager || typeof geometryManager.getAllByOrder !== 'function') return 0;
        const [base1, base2] = define.bases || [];
        if (!base1 || !base2) return 0;
        const all = geometryManager.getAllByOrder();
        // 按仓库规模缓存：载入图形时同一对基底会被反复重算，不缓存就是 O(n²)（大关卡载入明显变慢的原因）
        if (define.siblingCount !== undefined && define.siblingCountTotal === all.length) return define.siblingCount;
        let count = 0;
        for (const item of all) {
            if (item.getType() !== 'point') continue;
            const base = item.getBase ? item.getBase() : null;
            if (!base || base.type !== 'intersection' || !Array.isArray(base.bases) || base.bases.length < 2) continue;
            if (base === define) {
                define.siblingCount = count;
                define.siblingCountTotal = all.length;
                return count;
            }
            const [one, two] = base.bases;
            if ((one === base1 && two === base2) || (one === base2 && two === base1)) count += 1;
        }
        // 没在仓库里找到自己（base 不是同一个引用）时按「第一个」处理
        define.siblingCount = 0;
        define.siblingCountTotal = all.length;
        return 0;
    }
    
    /**
     * 按 原版游戏的实测规则挑一个交点候选 过程函数
     * 规则（用户实测 8 组，B 在连心线左右两侧都试过）：
     *   · 同一对基底上的**第一个** Intersect：一律取「非定义点」那个候选（不管 index 写 0 还是 1）
     *   · **第二个及以后**：按 index 正常取（候选顺序按线的方向 / 连心线方向，所以会随几何位置而变）
     * 选中之后把「身份」（defining = 与圆的定义点重合的那个 / other = 另一个）记在 define 上，
     * 之后图形怎么拖动都跟着同一个身份 —— B 越过连心线时交点不会忽然跳到另一个点上
     * @param {{bases: Object[], value: number, candidateIdentity?: string}} define
     * @param {{x: number, y: number, defining: boolean}[]} list 候选表（已按方向升序）
     * @param {number} index
     * @returns {{x: number, y: number, defining: boolean}|null}
     */
    static pickIntersectionCandidate(define, list, index) {
        if (!list.length) return null;
        const defining = list.filter(item => item.defining);
        const others = list.filter(item => !item.defining);
        // 「身份」二分只在**恰好一个候选与定义点重合**时才成立（此时另一个必然是「非定义点」那个）。
        // 两个候选都不与定义点重合时（圆–线、圆–圆 的绝大多数情况），identity 记成 'other' 会把
        // 编号 1 硬拉到 0 号候选上 —— 表现为「一移动图形，交点就跳到另一个位置上」。
        const distinguishable = defining.length === 1 && others.length === 1;
        // 记住的身份优先：拖动图形时保持在同一个交点上
        if (distinguishable && define.candidateIdentity === 'defining') return defining[0];
        if (distinguishable && define.candidateIdentity === 'other') return others[0];
        const literal = list[index] || list[0];
        const first = ToolsFunction.intersectionSiblingCount(define) === 0;
        const chosen = first && literal.defining && others.length ? others[0] : literal;
        if (distinguishable) define.candidateIdentity = chosen.defining ? 'defining' : 'other';
        else delete define.candidateIdentity;
        return chosen;
    }
    
    /**
     * 两个对象的全部交点（带统一编号）
     * 编号约定与 gmt 的 Intersect[对象1,对象2,x] 一致：
     * 线与线只有 0 号；线与圆按线的方向（定义点1 -> 定义点2）计数；圆与圆按连心线方向逆时针计数
     * @param {Object} element1
     * @param {Object} element2
     * @returns {{index: number, x: number, y: number}[]}
     */
    static intersectionCandidates(element1, element2) {
        // 基底算不出来时没有交点可言（该交点按失效处理，不报错）
        if (!element1.getCoordinate() || !element2.getCoordinate()) return [];
        const element1Type = element1.getType();
        const element2Type = element2.getType();
        const toList = countValue => {
            if (!countValue || !countValue.count) return [];
            return countValue.value.map((coord, index) => ({index: index, x: coord.x, y: coord.y}));
        };
        // 线与圆：编号只看「线的方向」（第一定义点 -> 第二定义点）升序，与两个参数谁在前无关；
        // 需要去掉「已知点自己」时由 gmt 的第四个参数（Intersect[a,b,x,A?] → define.exclude）负责
        if (element1Type === "line" && element2Type === "line") {
            const flagValue = ToolsFunction.lineIntersectionByGeometryObject(element1, element2);
            if (!flagValue.flag) return [];
            return [{index: 0, x: flagValue.value.x, y: flagValue.value.y}];
        }
        if (element1Type === "line" && element2Type === "circle") {
            return toList(ToolsFunction.lineCircleCandidates(element1, element2));
        }
        if (element1Type === "circle" && element2Type === "line") {
            return toList(ToolsFunction.lineCircleCandidates(element2, element1));
        }
        if (element1Type === "circle" && element2Type === "circle") {
            return toList(ToolsFunction.circleCircleCandidates(element1, element2));
        }
        return [];
    }
    
    /**
     * 判断点是否落在元素的有效范围内
     * 线段、射线需要检查（相交于延长线上的交点无效），直线始终有效
     * @param {number} x
     * @param {number} y
     * @param {Object} element
     * @returns {boolean}
     */
    static pointInElementRange(x, y, element) {
        if (element.getType() !== "line") return true;
        const drawType = element.getDrawType();
        if (drawType !== "lineSegment" && drawType !== "ray") return true;
        const coordList = element.getCoordinate();
        if (!coordList) return true;
        const [point1, point2] = coordList;
        const vectorX = point2[0] - point1[0];
        const vectorY = point2[1] - point1[1];
        const lengthSquared = vectorX * vectorX + vectorY * vectorY;
        if (lengthSquared < 1e-20) return true;
        const projection = (x - point1[0]) * vectorX + (y - point1[1]) * vectorY;
        if (drawType === "lineSegment") return projection >= 0 && projection <= lengthSquared;
        return projection >= 0;
    }
    
    /**
     * 以基底更新线点坐标
     * @param {{type: string, bases: Object[], value: number}} define
     * @returns {[x, y]}
     */
    static updateOnlineCoordinate(define) {
        const [element] = define.bases;
        const elementType = element.getType();
        const value = define.value;
        const coordList = element.getCoordinate();
        // 基底算不出来时该点无法定位（调用方按失效处理）
        if (!coordList) return null;
        const [point1Coord, point2Coord] = coordList;
        const p1 = {x: point1Coord[0], y: point1Coord[1]};
        const p2 = {x: point2Coord[0], y: point2Coord[1]};
        
        let coord;
        if (elementType === "line") {
            // 角平分线（三点 / 两线）按参考文档「以顶点为起点、按方向与坐标系 100 单位长度倍数」取点：
            // 它的第二个定义点是角平分线与对边的交点，长度随图形变化，不能当作单位长
            const baseType = element.getBase()?.type;
            if (baseType === 'threePointAngleBisector' || baseType === 'twoLineAngleBisector') {
                const length = Math.hypot(p2.x - p1.x, p2.y - p1.y);
                // 参数「1 单位」的长度随图形变化（角度越大越小），见 angleBisectorBase
                const base = ToolsFunction.angleBisectorBase(element, p1, p2);
                coord = length > 0
                    ? {x: p1.x + (p2.x - p1.x) / length * value * base, y: p1.y + (p2.y - p1.y) / length * value * base}
                    : p1;
            }else if (baseType === 'perpendicular') {
                // 垂线的参数起点比平行线多退一个单位：Perp[A,s] 里 Linepoint[垂线,1] 才是定义点 A
                // （参数 0 在 A 沿垂线方向退一个单位长的地方，单位长仍是被垂直的线的定义点距离）。
                // 例：A=[-10,0]、B=[10,0]、Perp[A,Line[A,B]] 的 Linepoint 起点在 [-10,-20]、方向 +y、单位长 20
                coord = {x: p1.x + (value - 1) * (p2.x - p1.x), y: p1.y + (value - 1) * (p2.y - p1.y)};
            }else if (baseType === 'tangent') {
                // 切线：以切点为起点、按线的方向与切圆半径的倍数
                // 渲染出来的两个点是 [外点, 切点]（线的方向 = 外点 -> 切点），而起点在切点上，
                // 所以原点取 p2，方向取线的方向（p1 -> p2 的反向即 p2 - p1）
                const circle = (element.getBase()?.figure || [])[1];
                const circleCoord = circle && typeof circle.getCoordinate === 'function' ? circle.getCoordinate() : null;
                const radius = circleCoord ? Math.hypot(circleCoord[1][0] - circleCoord[0][0], circleCoord[1][1] - circleCoord[0][1]) : 0;
                const length = Math.hypot(p2.x - p1.x, p2.y - p1.y);
                coord = length > 0 && radius > 0
                    ? {x: p2.x + (p2.x - p1.x) / length * radius * value, y: p2.y + (p2.y - p1.y) / length * radius * value}
                    : p2;
            }else{
                coord = ToolsFunction.scalePoint(p1, p2, value);
            }
        }else if (elementType === "circle") {
            coord = ToolsFunction.radianToCoordinate(p1, p2, value);
        }
        if (!coord) return null;
        return [coord.x, coord.y];
    }

    /**
     * 更新点坐标
     * @param {{type: string, bases: Object[], value: number}} define
     * @returns {{type: string, coordinate: [x, y] | null}}
     */
    static updatePointCoordinate(define) {
        if (define.type === "none") return {type: 'keep', coordinate: null};
        if (define.type === "online") {
            const coord = ToolsFunction.updateOnlineCoordinate(define);
            if (!coord) return {type: 'invalid', coordinate: null};
            return {type: 'update', coordinate: coord};
        }else if (define.type === "intersection") {
            const validCoord = ToolsFunction.updateIntersectionCoordinate(define);
            if (validCoord.valid) {
                return {type: 'update', coordinate: validCoord.coordinate};
            }else{
                return {type: 'invalid', coordinate: null};
            }
        }else if (define.type === "middlePoint") {
            const [point1, point2] = define.bases;
            const [x1, y1] = point1.getCoordinate();
            const [x2, y2] = point2.getCoordinate();

            const p1 = {x: x1, y: y1};
            const p2 = {x: x2, y: y2};
            const coordList = ToolsFunction.middlePoint(p1, p2);
            return {type: 'update', coordinate: [coordList.x, coordList.y]};
        }else if (define.type === "center") {
            const [circle] = define.bases;
            const coordList = circle.getCoordinate();
            if (!coordList) return {type: 'invalid', coordinate: null};
            return {type: 'update', coordinate: coordList[0]};
        }else if (define.type === "edgePoint") {
            // 无穷远点（gmt 的 EdgePoint[s,x]：x=0 负方向、x=1 正方向）
            // 本工程没有「无穷远点」这种对象，用一个很远处的位置代替：方向准确（Line[A,E] 就是过 A 的平行线），
            // 距离取得足够远，既不会出现在视野里、也不会影响 Line[A,E]、CopyAngle 这类按方向作图的指令
            const [line] = define.bases;
            const coordList = line.getCoordinate();
            if (!coordList) return {type: 'invalid', coordinate: null};
            const [start, end] = coordList;
            const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
            if (length < 1e-12) return {type: 'invalid', coordinate: null};
            const sign = define.value ? 1 : -1;
            return {type: 'update', coordinate: [start[0] + sign * (end[0] - start[0]) / length * ToolsFunction.edgePointDistance, start[1] + sign * (end[1] - start[1]) / length * ToolsFunction.edgePointDistance]};
        }else if (define.type === "polarPoint") {
            // 极点：线 s 关于圆 c 的极点（与极线互为逆运算）
            const [line, circle] = define.bases;
            const lineCoord = line.getCoordinate();
            const circleCoord = circle.getCoordinate();
            if (!lineCoord || !circleCoord) return {type: 'invalid', coordinate: null};
            const p1 = {x: lineCoord[0][0], y: lineCoord[0][1]};
            const p2 = {x: lineCoord[1][0], y: lineCoord[1][1]};
            const p3 = {x: circleCoord[0][0], y: circleCoord[0][1]};
            const p4 = {x: circleCoord[1][0], y: circleCoord[1][1]};
            const point = ToolsFunction.polarPoint(p1, p2, p3, p4);
            if (!point) return {type: 'invalid', coordinate: null};
            return {type: 'update', coordinate: [point.x, point.y]};
        }
    }
    
    /**
     * 修改直线坐标
     * @param {{type: string, figure: Object[], value: number}} define
     * @returns {[[x1, y1], [x2, y2]] | null}
     */
    static updateLineCoordinate(define) {
        if (define.type === "none") return null;
        if (define.type === "twoPoints") {
            const [point1, point2] = define.figure;
            // 定义点里有一个是无远点（EdgePoint）时按精确方向取坐标，避免把很大的坐标带进图形
            const withEdgePoint = ToolsFunction.lineCoordinateWithEdgePoint(point1, point2);
            if (withEdgePoint) return withEdgePoint;
            const [x1, y1] = point1.getCoordinate();
            const [x2, y2] = point2.getCoordinate();
            return [[x1, y1], [x2, y2]];
        }else if (define.type === "parallel") {
            const [point, line] = define.figure;
            const [x1, y1] = point.getCoordinate();
            const coordList = line.getCoordinate();
            if (!coordList) return null;
            const [x2, y2] = coordList[0];
            const [x3, y3] = coordList[1];
            
            const p1 = {x: x1, y: y1};
            const p2 = {x: x2, y: y2};
            const p3 = {x: x3, y: y3};
            const coordList2 = ToolsFunction.parallelogram(p1, p2, p3);
            return [[x1, y1], [coordList2.x, coordList2.y]];
        }else if (define.type === "perpendicular") {
            const [point, line] = define.figure;
            const [x1, y1] = point.getCoordinate();
            const coordList = line.getCoordinate();
            if (!coordList) return null;
            const [x2, y2] = coordList[0];
            const [x3, y3] = coordList[1];
            
            const p1 = {x: x1, y: y1};
            const p2 = {x: x2, y: y2};
            const p3 = {x: x3, y: y3};
            const coordList2 = ToolsFunction.perpendicular(p1, p2, p3);
            return [[x1, y1], [coordList2.x, coordList2.y]];
        }else if (define.type === "perpendicularBisector") {
            const [point1, point2] = define.figure;
            const [x1, y1] = point1.getCoordinate();
            const [x2, y2] = point2.getCoordinate();
            
            const p1 = {x: x1, y: y1};
            const p2 = {x: x2, y: y2};
            const [coordList1, coordList2] = ToolsFunction.perpendicularBisector(p1, p2);
            return [[coordList1.x, coordList1.y], [coordList2.x, coordList2.y]];
        }else if (define.type === "threePointAngleBisector") {
            const [point1, point2, point3] = define.figure;
            const [x1, y1] = point1.getCoordinate();
            const [x2, y2] = point2.getCoordinate();
            const [x3, y3] = point3.getCoordinate();
            
            const p1 = {x: x1, y: y1};
            const p2 = {x: x2, y: y2};
            const p3 = {x: x3, y: y3};
            const flagValue = ToolsFunction.angleBisector(p1, p2, p3);
            if (!flagValue.flag) return null;
            const coordList = flagValue.value;
            return [[x2, y2], [coordList.x, coordList.y]];
        }else if (define.type === "tangent") {
            // 过 figure[0] 作 figure[1] 的切线：figure[0] 是点时是两条切线，是直线时是与它平行的两条切线
            const [target, circle] = define.figure;
            const coordList = circle.getCoordinate();
            if (!coordList) return null;
            const [cx, cy] = coordList[0];
            const [px, py] = coordList[1];
            const radius = Math.hypot(px - cx, py - cy);
            if (target.getType() === "point") {
                const [ax, ay] = target.getCoordinate();
                const distance = Math.hypot(ax - cx, ay - cy);
                if (distance <= radius + 1e-10) {
                    // 点在圆上：只有一条切线，方向与半径垂直；点在圆内：没有切线
                    if (Math.abs(distance - radius) > 1e-10) return null;
                    return [[ax, ay], [ax - (ay - cy), ay + (ax - cx)]];
                }
                const offset = Math.acos(radius / distance);
                // y 轴朝下：视觉上的逆时针对应 atan2 角度的减少方向；
                // 定义顺序是「外点 -> 切点」：线的方向从外点指向切点，编号（Intersect[...] 的 0/1）
                // 与别的工具求交时都按这个方向数，写反了会让整条构造链落到另一侧
                const angle = Math.atan2(ay - cy, ax - cx) + (define.value ? offset : -offset);
                const tangentX = cx + radius * Math.cos(angle);
                const tangentY = cy + radius * Math.sin(angle);
                return [[ax, ay], [tangentX, tangentY]];
            }
            const lineCoord = target.getCoordinate();
            if (!lineCoord) return null;
            const [lx1, ly1] = lineCoord[0];
            const [lx2, ly2] = lineCoord[1];
            const length = Math.hypot(lx2 - lx1, ly2 - ly1);
            if (length < 1e-20) return null;
            const normalX = -(ly2 - ly1) / length;
            const normalY = (lx2 - lx1) / length;
            const sign = define.value ? -1 : 1;
            const baseX = cx + sign * radius * normalX;
            const baseY = cy + sign * radius * normalY;
            return [[baseX, baseY], [baseX + (lx2 - lx1), baseY + (ly2 - ly1)]];
        }else if (define.type === "polarLine") {
            // 点关于圆的极线：与连心线垂直，到圆心距离为 r^2 / |CP|
            const [point, circle] = define.figure;
            const [ax, ay] = point.getCoordinate();
            const coordList = circle.getCoordinate();
            if (!coordList) return null;
            const [cx, cy] = coordList[0];
            const [px, py] = coordList[1];
            const radius = Math.hypot(px - cx, py - cy);
            const dx = ax - cx;
            const dy = ay - cy;
            const distanceSquared = dx * dx + dy * dy;
            if (distanceSquared < 1e-20) return null;
            const factor = (radius * radius) / distanceSquared;
            const baseX = cx + dx * factor;
            const baseY = cy + dy * factor;
            return [[baseX, baseY], [baseX - dy, baseY + dx]];
        }else if (define.type === "copyAngle") {
            // CopyAngle[A,B,C,D,E]：以 E 为顶点、ED 为始边，按 ∠ABC（从 BA 转到 BC 的方向与大小）作射线。
            // 例：CopyAngle[F,A,E,G,C] = 以 C 为顶点、CG 为始边，按 ∠FAE 的方向（AF -> AE）旋转 CG
            const [a, b, c, d, e] = define.figure;
            const [ax, ay] = a.getCoordinate();
            const [bx, by] = b.getCoordinate();
            const [cx, cy] = c.getCoordinate();
            const [dx, dy] = d.getCoordinate();
            const [ex, ey] = e.getCoordinate();
            // 角的两个边上的点里可能有无穷远点（CopyAngle[EdgePoint,…]，用方向当一条边）：取精确方向
            const unitA = ToolsFunction.edgePointUnit(a);
            const unitC = ToolsFunction.edgePointUnit(c);
            // 源角 = θ(BA) - θ(BC)（负的「从 BA 转到 BC」），所以这里要「减去」它才是顺时针/逆时针一致的方向
            const source = (unitA ? Math.atan2(unitA.y, unitA.x) : Math.atan2(ay - by, ax - bx)) - (unitC ? Math.atan2(unitC.y, unitC.x) : Math.atan2(cy - by, cx - bx));
            const angle = Math.atan2(dy - ey, dx - ex) - source;
            return [[ex, ey], [ex + Math.cos(angle) * 100, ey + Math.sin(angle) * 100]];
        }else if (define.type === "fixAngle") {
            // 以 figure[0] 为顶点、figure[1] 为始边方向，逆时针转过 value 度的射线
            const [vertex, start] = define.figure;
            const [ax, ay] = vertex.getCoordinate();
            const [bx, by] = start.getCoordinate();
            // y 轴朝下：视觉上的逆时针对应 atan2 角度的减少方向
            const angle = Math.atan2(by - ay, bx - ax) - define.value * Math.PI / 180;
            return [[ax, ay], [ax + Math.cos(angle) * 100, ay + Math.sin(angle) * 100]];
        }else if (define.type === "twoLineAngleBisector") {
            const [line1, line2] = define.figure;
            const coordList1 = line1.getCoordinate();
            const coordList2 = line2.getCoordinate();
            if (!coordList1 || !coordList2) return null;
            const [x1, y1] = coordList1[0];
            const [x2, y2] = coordList1[1];
            const [x3, y3] = coordList2[0];
            const [x4, y4] = coordList2[1];
            
            // 交点
            const p1 = {x: x1, y: y1};
            const p2 = {x: x2, y: y2};
            const p3 = {x: x3, y: y3};
            const p4 = {x: x4, y: y4};
            let flagValue;
            flagValue = ToolsFunction.lineIntersection(p1, p2, p3, p4);
            if (!flagValue.flag) {
                console.log(flagValue.information)
                return null;
            }
            const interCoord = flagValue.value;

            // 角平分线
            let line1Point = ToolsFunction.parallelogram(interCoord, p1, p2);
            let line2Point = ToolsFunction.parallelogram(interCoord, p3, p4);

            const value = define.value;
            if (value === 0) {
                flagValue = ToolsFunction.angleBisector(line1Point, interCoord, line2Point);
            }else if (value === 1) {
                flagValue = ToolsFunction.angleOutBisector(line1Point, interCoord, line2Point);
            }
            if (!flagValue.flag) {
                console.log(flagValue.information)
                return null;
            }
            const coordList = flagValue.value;
            return [[interCoord.x, interCoord.y], [coordList.x, coordList.y]];
        }
    }
    
    /**
     * 修改圆坐标
     * @param {{type: string, figure: Object[], value: number}} define
     * @returns {[[x1, y1], [x2, y2]] | null}
     */
    static updateCircleCoordinate(define) {
        if (define.type === "none") return null;
        if (define.type === "twoPoints") {
            const [center, point] = define.figure;
            const [x1, y1] = center.getCoordinate();
            const [x2, y2] = point.getCoordinate();
            return [[x1, y1], [x2, y2]];
        }else if (define.type === "compass") {
            const [point1, point2, point3] = define.figure;
            const [x1, y1] = point1.getCoordinate();
            const [x2, y2] = point2.getCoordinate();
            const [x3, y3] = point3.getCoordinate();

            const p1 = {x: x1, y: y1};
            const p2 = {x: x2, y: y2};
            const p3 = {x: x3, y: y3};
            const coordList2 = ToolsFunction.parallelogram(p1, p2, p3);
            return [[x3, y3], [coordList2.x, coordList2.y]];
        }else if (define.type === "copyCompass") {
            const [point, circle] = define.figure;
            const [x1, y1] = point.getCoordinate();
            const coordList = circle.getCoordinate();
            if (!coordList) return null;
            const [x2, y2] = coordList[0];
            const [x3, y3] = coordList[1];

            const p1 = {x: x1, y: y1};
            const p2 = {x: x2, y: y2};
            const p3 = {x: x3, y: y3};
            const coordList2 = ToolsFunction.parallelogram(p1, p2, p3);
            return [[x1, y1], [coordList2.x, coordList2.y]];
        }else if (define.type === "threePointCircle") {
            const [point1, point2, point3] = define.figure;
            const [x1, y1] = point1.getCoordinate();
            const [x2, y2] = point2.getCoordinate();
            const [x3, y3] = point3.getCoordinate();

            const p1 = {x: x1, y: y1};
            const p2 = {x: x2, y: y2};
            const p3 = {x: x3, y: y3};
            const flagValue = ToolsFunction.threePointsCircle(p1, p2, p3);
            if (!flagValue.flag) return null;
            const coordList = flagValue.value;
            return [[coordList.x, coordList.y], [x1, y1]];
        }
    }

    /**
     * 点同一判定
     * @param {Object} point1 
     * @param {Object} point2 
     * @returns {boolean}
     */
    static pointEquative(point1, point2) {
        const [x1, y1] = point1.getCoordinate();
        const [x2, y2] = point2.getCoordinate();
        
        if (Math.abs(x1 - x2) > 1e-10) return false; // 注意绝对值
        if (Math.abs(y1 - y2) > 1e-10) return false;
        return true;
    }

    /**
     * 直线同一判定
     * @param {Object} line1 
     * @param {Object} line2 
     * @returns {boolean}
     */
    static lineEquative(line1, line2) {
        const coordList1 = line1.getCoordinate();
        const coordList2 = line2.getCoordinate();
        const [x1, y1] = coordList1[0];
        const [x2, y2] = coordList1[1];
        const [x3, y3] = coordList2[0];
        const [x4, y4] = coordList2[1];
        
        const p1 = {x: x1, y: y1};
        const p2 = {x: x2, y: y2};
        const p3 = {x: x3, y: y3};
        const p4 = {x: x4, y: y4};
        const flagValue1 = ToolsFunction.pointToLineDistance(p1, p2, p3);
        if (!flagValue1.flag) return false;
        const distance1 = Math.abs(flagValue1.value);
        const flagValue2 = ToolsFunction.pointToLineDistance(p1, p2, p4);
        if (!flagValue2.flag) return false;
        const distance2 = Math.abs(flagValue2.value);

        let flagCount = 0;
        if (distance1 < 1e-10) flagCount++;
        if (distance2 < 1e-10) flagCount++;
        if (flagCount === 2) {
            return true;
        }else{
            return false;
        }
    }

    /**
     * 圆同一判定
     * @param {Object} circle1 
     * @param {Object} circle2 
     * @returns {boolean}
     */
    static circleEquative(circle1, circle2) {
        const coordList1 = circle1.getCoordinate();
        const coordList2 = circle2.getCoordinate();
        const [x1, y1] = coordList1[0];
        const [x2, y2] = coordList1[1];
        const [x3, y3] = coordList2[0];
        const [x4, y4] = coordList2[1];
        
        if (Math.abs(x1 - x3) > 1e-10) return false;
        if (Math.abs(y1 - y3) > 1e-10) return false;
        const distance1 = Math.hypot((x2 - x1), (y2 - y1));
        const distance2 = Math.hypot((x4 - x3), (y4 - y3));
        if (Math.abs(distance1 - distance2) > 1e-10) return false;
        return true;
    }
}
