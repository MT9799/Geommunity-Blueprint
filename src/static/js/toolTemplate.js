/*
toolEvent +
click +
draw +
drawComplete +
cancel +
createPoint +
create +
movePoint +
setDefine +
createLastPoint +
draw2Points +
clear +
*/

/**
 * 过某个点的所有线 / 圆 过程函数
 * 三条线交于一点时，那个点只有两个「基底」，但过它的图形有三个 ——
 * 所以按几何位置找（点在线上 / 点在圆上），而不是只看它的基底
 * @param {Object} point 点对象
 * @returns {Object[]} 过这个点的线 / 圆
 */
function figuresThroughPoint(point) {
    const coordinate = point.getCoordinate?.();
    if (!coordinate) return [];
    const [px, py] = coordinate;
    const eps = 1e-6;
    const hits = [];
    geometryManager.getAllByOrder().forEach(item => {
        const type = item.getType();
        if (type !== 'line' && type !== 'circle') return;
        if (item.getVisible && !item.getVisible()) return;
        if (item.getValid && !item.getValid()) return;
        const coord = item.getCoordinate?.();
        if (!coord || !coord[0] || !coord[1]) return;
        if (type === 'line') {
            const flag = ToolsFunction.pointToLineDistance({x: coord[0][0], y: coord[0][1]}, {x: coord[1][0], y: coord[1][1]}, {x: px, y: py});
            if (flag.flag && Math.abs(flag.value) < eps) hits.push(item);
        }else{
            const radius = Math.hypot(coord[1][0] - coord[0][0], coord[1][1] - coord[0][1]);
            if (Math.abs(Math.hypot(px - coord[0][0], py - coord[0][1]) - radius) < eps) hits.push(item);
        }
    });
    return hits;
}

/**
 * 把「经过光标下这个点的全部图形」挂进工具缓存（只为高亮） 过程函数
 * 按住拖动到某个点上、且有多于一个图形过这个点时，把这些图形一起点亮，
 * 这样一眼能看出这个点是怎么来的；所有作图工具共用这一份
 * @param {string} toolName 工具名
 * @param {string} pointId 光标下的点（不在点上时只清掉上一次的高亮引用）
 */
function highlightFiguresThroughPoint(toolName, pointId) {
    Object.keys(geometryManager.choice[toolName] || {})
        .filter(key => key.startsWith('through'))
        .forEach(key => geometryManager.deleteToolKey(toolName, key));
    const point = pointId ? geometryManager.get(pointId) : null;
    if (!point || (point.getType && point.getType() !== 'point')) return;
    const hits = figuresThroughPoint(point);
    // 只有一个图形过它时没什么可看的，不点亮
    if (hits.length < 2) return;
    hits.forEach((item, index) => {
        geometryManager.addToolObject(toolName, `through${index + 1}`, "quote", item.getId());
    });
}

class PointBaseToolTemplate {
    /**
     * 初始构造器
     * @param {string} toolName
     * @param {number} maxStatus
     * @param {string} goal
     * @param {string} goalType
     * @param {string} define
     * @param {string} [drawType = null]
     */
    constructor(toolName, maxStatus, goal, goalType, define, drawType = null) {
        this.cacheFlag = false;
        this.status = 0;
        this.startCoord;
        this.changedVerify;
        
        this.toolName = toolName;
        this.maxStatus = maxStatus;
        this.goal = goal;
        this.goalType = goalType;
        this.define = define;
        this.drawType = drawType;
    }
    
    /**
     * 工具事件
     * @param {string} type
     * @param {number} oriX 原x坐标
     * @param {number} oriY 原y坐标
     */
    toolEvent(type, oriX, oriY) {
        const x = (oriX - transform.x) / transform.scale;
        const y = (oriY - transform.y) / transform.scale;
        if (type === "start") {
            this.startCoord = [x, y];
        }else if (type === "click") {
            this.click(x, y);
        }else if (type === "draw") {
            this.draw(x, y);
        }else if (type === "drawComplete") {
            this.drawComplete();
        }else if (type === "cancel") {
            this.cancel();
        }
    }
    
    /**
     * 点击
     * @param {number} x
     * @param {number} y
     */
    click(x, y) {
        const [pointId] = geometryManager.near([x, y], ["point"]);
        if (pointId) {
            // 已经点过这个点：这个位置不允许重复时按「再点一次＝取消」处理（见 repeatPointAllowed）
            const repeated = geometryManager.ifIdInCache(this.toolName, pointId);
            if (repeated && !this.repeatPointAllowed(this.status + 1)) {
                geometryManager.deleteToolQuote(this.toolName, pointId)
                this.status--;
            }else{
                geometryManager.addToolObject(this.toolName, `point${this.status + 1}`, "quote", pointId);
                this.status++;
            }
        }else{
            this.createPoint(x, y);
            this.status++;
        }
        
        if (this.status >= this.maxStatus) {
            this.create();
            this.status = 0;
            geometryManager.loadTool(this.toolName);
            // 触发存储事件
            const event = new CustomEvent("storage", {
                detail: {
                    type: this.toolName,
                },
            });
            window.dispatchEvent(event);
        }
    }
    
    /**
     * 第 index 个点是否允许与前面已选的点重复 过程函数
     * 默认不允许（再点一次同一个点＝把它取消掉）；三点圆规覆写成「第三个点允许重复」——
     * 它的第三点是圆心，可以与定半径的那两个点重合（以 A 为圆心、AB 为半径作圆）
     * @param {number} index 正在选第几个点（从 1 起）
     * @returns {boolean}
     */
    repeatPointAllowed(index) {
        return false;
    }
    
    /**
     * 拖拽
     * @param {number} x
     * @param {number} y
     */
    draw(x, y) {
        if (!this.cacheFlag) {
            if (this.status + 1 < this.maxStatus) {
                this.draw2Points();
                this.status++;
                this.status++;
            }else if (this.status + 1 === this.maxStatus) {
                this.createLastPoint(x, y);
                this.status++;
            }
            if (this.status === this.maxStatus) this.create();
            this.cacheFlag = true;
        }
        this.movePoint(x, y);
        if (this.status === this.maxStatus) geometryManager.getToolKey(this.toolName, this.goal).updateCoordinate();
    }
    
    /**
     * 拖拽完成
     */
    drawComplete() {
        this.cacheFlag = false;
        if (this.status >= this.maxStatus) {
            this.status = 0;
            geometryManager.loadTool(this.toolName);
            // 触发存储事件
            const event = new CustomEvent("storage", {
                detail: {
                    type: this.toolName,
                },
            });
            window.dispatchEvent(event);
        }
    }
    
    /**
     * 取消
     */
    cancel() {
        if (this.cacheFlag) {
            geometryManager.deleteTool(this.toolName);
            this.cacheFlag = false;
            this.status = 0;
        }
    }
    
    /**
     * 创建固定点
     * @param {number} x
     * @param {number} y
     */
    createPoint(x, y) {
        let goalX = x, goalY = y, index = 0;
        // 先看光标附近最近的那个交点（附近图形两两求交，见 GeometryManager.nearestIntersection）：
        // 只看最近的两个图形会取到它们很远处的交点，光标下明明有交点也标不出来
        const snap = geometryManager.nearestIntersection(x, y);
        const exceptPoints = snap
            ? [snap.element1.getId(), snap.element2.getId()]
            : geometryManager.near([x, y], ["line", "circle"], 1);
        if (exceptPoints.length === 2) {
            const element1 = geometryManager.get(exceptPoints[0]);
            const element2 = geometryManager.get(exceptPoints[1]);
            if (element1.getType() === "line") {
                if (element2.getType() === "line") {
                    const flagValue = ToolsFunction.lineIntersectionByGeometryObject(element1, element2);
                    if (!flagValue) return;
                    const coord = flagValue.value;
                    goalX = coord.x;
                    goalY = coord.y;
                    
                }else if (element2.getType() === "circle") {
                    const countValue = ToolsFunction.lineCircleIntersectionByGeometryObject(element1, element2);
                    if (countValue.count === 0) return;
                    
                    if (countValue.count === 1) {
                        const [coord] = countValue.value;
                        goalX = coord.x;
                        goalY = coord.y;
                        
                    }else if (countValue.count === 2) {
                        const coord1 = countValue.value[0];
                        const coord2 = countValue.value[1];
                        const p3 = {x, y};
                        const distance1 = ToolsFunction.distance(coord1, p3);
                        const distance2 = ToolsFunction.distance(coord2, p3);
                        if (distance1 > distance2) index = 1;
                        
                        const coord = countValue.value[index];
                        goalX = coord.x;
                        goalY = coord.y;
                    }
                }
            }else if (element1.getType() === "circle") {
                if (element2.getType() === "line") {
                    const countValue = ToolsFunction.lineCircleIntersectionByGeometryObject(element2, element1);
                    if (countValue.count === 0) return;
                    
                    if (countValue.count === 1) {
                        const [coord] = countValue.value;
                        goalX = coord.x;
                        goalY = coord.y;
                        
                    }else if (countValue.count === 2) {
                        const coord1 = countValue.value[0];
                        const coord2 = countValue.value[1];
                        const p3 = {x, y};
                        const distance1 = ToolsFunction.distance(coord1, p3);
                        const distance2 = ToolsFunction.distance(coord2, p3);
                        if (distance1 > distance2) index = 1;
                        
                        const coord = countValue.value[index];
                        goalX = coord.x;
                        goalY = coord.y;
                        
                    }
                }else if (element2.getType() === "circle") {
                    const countValue = ToolsFunction.circleCircleIntersectionByGeometryObject(element1, element2);
                    if (countValue.count === 0) return;
                    
                    if (countValue.count === 1) {
                        const [coord] = countValue.value;
                        goalX = coord.x;
                        goalY = coord.y;
                        
                    }else if (countValue.count === 2) {
                        const coord1 = countValue.value[0];
                        const coord2 = countValue.value[1];
                        const p3 = {x, y};
                        const distance1 = ToolsFunction.distance(coord1, p3);
                        const distance2 = ToolsFunction.distance(coord2, p3);
                        if (distance1 > distance2) index = 1;
                        
                        const coord = countValue.value[index];
                        goalX = coord.x;
                        goalY = coord.y;
                    }
                }
            }
            
            const pointObject = geometryManager.createPoint(goalX, goalY);
            pointObject.modifyBase("intersection", [element1, element2], index);
            element1.addSuperstructure(pointObject);
            element2.addSuperstructure(pointObject);
            geometryManager.addToolObject(this.toolName, `point${this.status + 1}`, "append", pointObject);
            
        }else if (exceptPoints.length === 1) {
            let value;
            const item = geometryManager.get(exceptPoints[0]);
            if (item.getType() === "line") {
                const coordList = item.getCoordinate();
                const point1Coord = coordList[0];
                const point2Coord = coordList[1];
                const p1 = {x: point1Coord[0], y: point1Coord[1]};
                const p2 = {x: point2Coord[0], y: point2Coord[1]};
                const p3 = {x, y};
                
                value = ToolsFunction.onlineValueOf(item, p1, p2, p3);
                if (!value) return;
                const coord = ToolsFunction.onlineCoordinateOf(p1, p2, p3);
                goalX = coord.x;
                goalY = coord.y;
                
            }else if (item.getType() === "circle") {
                const coordList = item.getCoordinate();
                const point1Coord = coordList[0];
                const point2Coord = coordList[1];
                const p1 = {x: point1Coord[0], y: point1Coord[1]};
                const p2 = {x: point2Coord[0], y: point2Coord[1]};
                const p3 = {x, y};
                
                value = ToolsFunction.nearPointOnCircle(p1, p3);
                const coord = ToolsFunction.radianToCoordinate(p1, p2, value);
                goalX = coord.x;
                goalY = coord.y;
                
            }
            
            const pointObject = geometryManager.createPoint(goalX, goalY);
            const geometryObject = item;
            pointObject.modifyBase("online", [geometryObject], value);
            geometryObject.addSuperstructure(pointObject);
            geometryManager.addToolObject(this.toolName, `point${this.status + 1}`, "append", pointObject);
                
        }else if (exceptPoints.length === 0) {
            const pointObject = geometryManager.createPoint(goalX, goalY);
            geometryManager.addToolObject(this.toolName, `point${this.status + 1}`, "append", pointObject);
        }
    }
    
    /**
     * 创建目标图形
     */
    create() {
        geometryManager.createGeometryElementInputTool(this.goalType, this.toolName, this.goal);
        if (this.drawType) geometryManager.getToolKey(this.toolName, this.goal).modifyDrawType(this.drawType);
        this.setDefine();
    }
    
    /**
     * 移动缓存点
     * @param {number} x
     * @param {number} y
     */
    movePoint(x, y) {
        const [pointId] = geometryManager.near([x, y], ["point"]);
        // 光标压在一个已标出的交点上：经过它的每条线 / 每个圆都一起高亮
        // （按住拖动时每次移动都重算一次，离开交点自动撤掉）
        if (typeof highlightFiguresThroughPoint === 'function') highlightFiguresThroughPoint(this.toolName, pointId);
        if (pointId) {
            // 已经点过的点：默认跳过（不把同一个点引用两次）；
            // 三点圆规的圆心（第三个点）允许重复，那时照常切成引用
            if (geometryManager.ifIdInCache(this.toolName, pointId) && !this.repeatPointAllowed(this.status)) return;
            // 切换至引用
            geometryManager.modifyToolObject(this.toolName, `point${this.status}`, "quote", pointId);
            if (this.changedVerify !== "choice") {
                this.changedVerify = "choice";
                this.setDefine();
            }
        }else{
            // 从引用切换回创建，防干扰
            geometryManager.modifyToolObject(this.toolName, `point${this.status}`, "create", [x, y]);
            const point = geometryManager.getToolKey(this.toolName, `point${this.status}`);
            point.clearBase();
            let goalX = x, goalY = y, index = 0;
            // 与 createPoint 一致：先吸附光标附近最近的那个交点
            const snap = geometryManager.nearestIntersection(x, y);
            const exceptPoints = snap
                ? [snap.element1.getId(), snap.element2.getId()]
                : geometryManager.near([x, y], ["line", "circle"], 1);
            if (exceptPoints.length === 2) {
                geometryManager.deleteToolKey(this.toolName, "adsorb");
                
                const element1 = geometryManager.get(exceptPoints[0]);
                const element2 = geometryManager.get(exceptPoints[1]);
                if (element1.getType() === "line") {
                    if (element2.getType() === "line") {
                        const flagValue = ToolsFunction.lineIntersectionByGeometryObject(element1, element2);
                        if (!flagValue) return;
                        const coord = flagValue.value;
                        goalX = coord.x;
                        goalY = coord.y;
                        
                        point.modifyBase("intersection", [element1, element2], 0);
                        geometryManager.addToolObject(this.toolName, "inter1", "quote", exceptPoints[0]);
                        geometryManager.addToolObject(this.toolName, "inter2", "quote", exceptPoints[1]);
                    
                    }else if (element2.getType() === "circle") {
                        const countValue = ToolsFunction.lineCircleIntersectionByGeometryObject(element1, element2);
                        if (countValue.count === 0) return;
                        
                        if (countValue.count === 1) {
                            const [coord] = countValue.value;
                            goalX = coord.x;
                            goalY = coord.y;
                            
                            point.modifyBase("intersection", [element1, element2], 0);
                            geometryManager.addToolObject(this.toolName, "inter1", "quote", exceptPoints[0]);
                            geometryManager.addToolObject(this.toolName, "inter2", "quote", exceptPoints[1]);
                            
                        }else if (countValue.count === 2) {
                            const coord1 = countValue.value[0];
                            const coord2 = countValue.value[1];
                            const p3 = {x, y};
                            const distance1 = ToolsFunction.distance(coord1, p3);
                            const distance2 = ToolsFunction.distance(coord2, p3);
                            if (distance1 > distance2) index = 1;
                            
                            const coord = countValue.value[index];
                            goalX = coord.x;
                            goalY = coord.y;
                            
                            point.modifyBase("intersection", [element1, element2], index);
                            geometryManager.addToolObject(this.toolName, "inter1", "quote", exceptPoints[0]);
                            geometryManager.addToolObject(this.toolName, "inter2", "quote", exceptPoints[1]);
                            
                        }
                    }
                }else if (element1.getType() === "circle") {
                    if (element2.getType() === "line") {
                        const countValue = ToolsFunction.lineCircleIntersectionByGeometryObject(element2, element1);
                        if (countValue.count === 0) return;
                        
                        if (countValue.count === 1) {
                            const [coord] = countValue.value;
                            goalX = coord.x;
                            goalY = coord.y;
                            
                            point.modifyBase("intersection", [element1, element2], 0);
                            geometryManager.addToolObject(this.toolName, "inter1", "quote", exceptPoints[0]);
                            geometryManager.addToolObject(this.toolName, "inter2", "quote", exceptPoints[1]);
                            
                        }else if (countValue.count === 2) {
                            const coord1 = countValue.value[0];
                            const coord2 = countValue.value[1];
                            const p3 = {x, y};
                            const distance1 = ToolsFunction.distance(coord1, p3);
                            const distance2 = ToolsFunction.distance(coord2, p3);
                            if (distance1 > distance2) index = 1;
                            
                            const coord = countValue.value[index];
                            goalX = coord.x;
                            goalY = coord.y;
                            
                            point.modifyBase("intersection", [element1, element2], index);
                            geometryManager.addToolObject(this.toolName, "inter1", "quote", exceptPoints[0]);
                            geometryManager.addToolObject(this.toolName, "inter2", "quote", exceptPoints[1]);
                            
                        }
                    }else if (element2.getType() === "circle") {
                        const countValue = ToolsFunction.circleCircleIntersectionByGeometryObject(element1, element2);
                        if (countValue.count === 0) return;
                        
                        if (countValue.count === 1) {
                            const [coord] = countValue.value;
                            goalX = coord.x;
                            goalY = coord.y;
                            
                            point.modifyBase("intersection", [element1, element2], 0);
                            geometryManager.addToolObject(this.toolName, "inter1", "quote", exceptPoints[0]);
                            geometryManager.addToolObject(this.toolName, "inter2", "quote", exceptPoints[1]);
                            
                        }else if (countValue.count === 2) {
                            const coord1 = countValue.value[0];
                            const coord2 = countValue.value[1];
                            const p3 = {x, y};
                            const distance1 = ToolsFunction.distance(coord1, p3);
                            const distance2 = ToolsFunction.distance(coord2, p3);
                            if (distance1 > distance2) index = 1;
                            
                            const coord = countValue.value[index];
                            goalX = coord.x;
                            goalY = coord.y;
                            
                            point.modifyBase("intersection", [element1, element2], index);
                            geometryManager.addToolObject(this.toolName, "inter1", "quote", exceptPoints[0]);
                            geometryManager.addToolObject(this.toolName, "inter2", "quote", exceptPoints[1]);
                            
                        }
                    }
                }
            }else if (exceptPoints.length === 1) {
                geometryManager.deleteToolKey(this.toolName, "inter1");
                geometryManager.deleteToolKey(this.toolName, "inter2");
                let value;
                const item = geometryManager.get(exceptPoints[0]);
                if (item.getType() === "line") {
                    const coordList = item.getCoordinate();
                    const point1Coord = coordList[0];
                    const point2Coord = coordList[1];
                    const p1 = {x: point1Coord[0], y: point1Coord[1]};
                    const p2 = {x: point2Coord[0], y: point2Coord[1]};
                    const p3 = {x, y};
                    
                    value = ToolsFunction.onlineValueOf(item, p1, p2, p3);
                    if (!value) return;
                    const coord = ToolsFunction.onlineCoordinateOf(p1, p2, p3);
                    goalX = coord.x;
                    goalY = coord.y;
                    
                    const geometryObject = item;
                    point.modifyBase("online", [geometryObject], value);
                    geometryManager.addToolObject(this.toolName, "adsorb", "quote", exceptPoints[0]);
                    
                }else if (item.getType() === "circle") {
                    const coordList = item.getCoordinate();
                    const point1Coord = coordList[0];
                    const point2Coord = coordList[1];
                    const p1 = {x: point1Coord[0], y: point1Coord[1]};
                    const p2 = {x: point2Coord[0], y: point2Coord[1]};
                    const p3 = {x, y};
                    
                    value = ToolsFunction.nearPointOnCircle(p1, p3);
                    const coord = ToolsFunction.radianToCoordinate(p1, p2, value);
                    goalX = coord.x;
                    goalY = coord.y;
                    
                    const geometryObject = item;
                    point.modifyBase("online", [geometryObject], value);
                    geometryManager.addToolObject(this.toolName, "adsorb", "quote", exceptPoints[0]);
                }
            }else if (exceptPoints.length === 0) {
                geometryManager.deleteToolKey(this.toolName, "inter1");
                geometryManager.deleteToolKey(this.toolName, "inter2");
                geometryManager.deleteToolKey(this.toolName, "adsorb");
            }
            
            geometryManager.modifyToolObject(this.toolName, `point${this.status}`, "create", [goalX, goalY]);
            if (this.changedVerify !== "move") {
                this.changedVerify = "move";
                this.setDefine();
            }
        }
    }
    
    /**
     * 配置定义点
     */
    setDefine() {
        if (this.status < this.maxStatus) return;
        
        const pointList = [];
        for (let i = 1; i <= this.maxStatus; i++) {
            pointList.push(geometryManager.getToolKey(this.toolName, `point${i}`));
        }
        const goal = geometryManager.getToolKey(this.toolName, this.goal)
        if (goal.getType() === "point") {
            goal.modifyBase(this.define, pointList);
        }else{
            goal.modifyDefine(this.define, pointList);
        }
    }
    
    /**
     * 创建最后点
     */
    createLastPoint(x, y) {
        // 用当前指针位置建点，而不是按下位置（startCoord）：
        // 拖动过程中 movePoint 里有若干 early-return（光标下是缓存里已有点、附近两图形没有有效交点等），
        // 用按下位置建的点就会留在原地不动 —— 看上去「即将创建的点」离光标很远
        const coord = Number.isFinite(x) && Number.isFinite(y) ? [x, y] : this.startCoord;
        geometryManager.addToolObject(this.toolName, `point${this.status + 1}`, "create", coord);
    }
    
    /**
     * 创建2点
     */
    draw2Points() {
        const [x, y] = this.startCoord;
        const [pointId] = geometryManager.near([x, y], ["point"]);
        if (pointId) {
            geometryManager.addToolObject(this.toolName, `point${this.status + 1}`, "quote", pointId);
        }else{
            this.createPoint(x, y);
        }
        geometryManager.addToolObject(this.toolName, `point${this.status + 2}`, "create", [x, y]);
    }
    
    /**
     * 清空
     */
    clear() {
        geometryManager.deleteTool(this.toolName);
        this.cacheFlag = false;
        this.status = 0;
    }
}


class PointBaseDialogToolTemplate {
    /**
     * 初始构造器
     * @param {string} toolName
     * @param {number} maxStatus            // 有几个状态点才会完成构造
     * @param {string} goal                 // 输入对话框的目标图形
     * @param {string} goalType
     * @param {string} define               // 定义 点对目标的约束
     * @param {string} type                 // 对话框的输入类型
     * @param {string} [drawType = null]
     */
    constructor(
        toolName, 
        maxStatus, 
        goal, 
        goalType, 
        define, 
        type, 
        drawType = null
    ) {
        this.cacheFlag = false;
        this.status = 0;
        this.startCoord;
        this.changedVerify;
        
        this.toolName = toolName;
        this.maxStatus = maxStatus;
        this.goal = goal;
        this.goalType = goalType;
        this.define = define;
        this.type = type;
        this.drawType = drawType;
    }
    
    /**
     * 工具事件
     * @param {string} type
     * @param {number} oriX 原x坐标
     * @param {number} oriY 原y坐标
     */
    toolEvent(type, oriX, oriY) {
        const x = (oriX - transform.x) / transform.scale;
        const y = (oriY - transform.y) / transform.scale;
        if (type === "start") {
            this.startCoord = [x, y];
        }else if (type === "click") {
            this.click(x, y);
        }else if (type === "draw") {
            this.draw(x, y);
        }else if (type === "drawComplete") {
            this.drawComplete();
        }else if (type === "cancel") {
            this.cancel();
        }
    }
    
    /**
     * 点击
     * @param {number} x
     * @param {number} y
     */
    click(x, y) {
        const [pointId] = geometryManager.near([x, y], ["point"]);
        if (pointId) {
            // 已经点过这个点：这个位置不允许重复时按「再点一次＝取消」处理（见 repeatPointAllowed）
            const repeated = geometryManager.ifIdInCache(this.toolName, pointId);
            if (repeated && !this.repeatPointAllowed(this.status + 1)) {
                geometryManager.deleteToolQuote(this.toolName, pointId)
                this.status--;
            }else{
                geometryManager.addToolObject(this.toolName, `point${this.status + 1}`, "quote", pointId);
                this.status++;
            }
        }else{
            this.createPoint(x, y);
            this.status++;
        }
        
        if (this.status >= this.maxStatus) {
            this.constructionCompleted();
        }
    }
    
    /**
     * 第 index 个点是否允许与前面已选的点重复 过程函数
     * 默认不允许（再点一次同一个点＝把它取消掉）；三点圆规覆写成「第三个点允许重复」——
     * 它的第三点是圆心，可以与定半径的那两个点重合（以 A 为圆心、AB 为半径作圆）
     * @param {number} index 正在选第几个点（从 1 起）
     * @returns {boolean}
     */
    repeatPointAllowed(index) {
        return false;
    }
    
    /**
     * 拖拽
     * @param {number} x
     * @param {number} y
     */
    draw(x, y) {
        if (!this.cacheFlag) {
            if (this.status + 1 < this.maxStatus) {
                this.draw2Points();
                this.status++;
                this.status++;
            }else if (this.status + 1 === this.maxStatus) {
                this.createLastPoint(x, y);
                this.status++;
            }
            this.cacheFlag = true;
        }
        this.movePoint(x, y);
    }
    
    /**
     * 拖拽完成
     */
    drawComplete() {
        this.cacheFlag = false;
        if (this.status >= this.maxStatus) {
            this.constructionCompleted();
        }
    }

    constructionCompleted() {
        let dialogTitle = "";
        if (this.type === "number") {
            dialogTitle = t('board.inputNumber');
        }
        else if (this.type === "string") {
            dialogTitle = t('board.inputString');
        }
        // 数字型输入（定值角）：空着或不是数字时「确定」按不动，与「带标签给定」的输入框一样
        const options = {};
        if (this.type === "number") {
            options.valid = text => String(text).trim() !== '' && Number.isFinite(Number(String(text).trim()));
        }
        // 点「取消」就当作废这次作图：清掉工具缓存（含刚临时创建的点）与半成品状态，
        // 否则画布上还留着那两个点，工具也还停在「已取点」的状态
        options.onCancel = () => {
            geometryManager.deleteTool(this.toolName);
            this.status = 0;
            this.cacheFlag = false;
            if (typeof drawContent === 'function') drawContent();
            if (typeof refreshToolFloating === 'function') refreshToolFloating();
            if (typeof refreshStorageButton === 'function') refreshStorageButton();
        };
        boardInput(dialogTitle, "", "", value => {
            let newValue = value;
            if (this.type === "number") {
                newValue = parseFloat(value);
            };

            this.create(newValue);
            this.status = 0;
            geometryManager.loadTool(this.toolName);
            // 目标图形已经接线完成，这里必须立刻重绘：数字框是异步的，
            // 点完两个点时那次 drawContent 早就跑完了，不补一次要等下次操作才看得到图形
            if (typeof drawContent === 'function') drawContent();
            // 触发存储事件
            const event = new CustomEvent("storage", {
                detail: {
                    type: this.toolName,
                },
            });
            window.dispatchEvent(event);
        }, options);
    }
    
    /**
     * 取消
     */
    cancel() {
        if (this.cacheFlag) {
            geometryManager.deleteTool(this.toolName);
            this.cacheFlag = false;
            this.status = 0;
        }
    }
    
    /**
     * 创建固定点
     * @param {number} x
     * @param {number} y
     */
    createPoint(x, y) {
        let goalX = x, goalY = y, index = 0;
        // 先看光标附近最近的那个交点（附近图形两两求交，见 GeometryManager.nearestIntersection）：
        // 只看最近的两个图形会取到它们很远处的交点，光标下明明有交点也标不出来
        const snap = geometryManager.nearestIntersection(x, y);
        const exceptPoints = snap
            ? [snap.element1.getId(), snap.element2.getId()]
            : geometryManager.near([x, y], ["line", "circle"], 1);
        if (exceptPoints.length === 2) {
            const element1 = geometryManager.get(exceptPoints[0]);
            const element2 = geometryManager.get(exceptPoints[1]);
            if (element1.getType() === "line") {
                if (element2.getType() === "line") {
                    const flagValue = ToolsFunction.lineIntersectionByGeometryObject(element1, element2);
                    if (!flagValue) return;
                    const coord = flagValue.value;
                    goalX = coord.x;
                    goalY = coord.y;
                    
                }else if (element2.getType() === "circle") {
                    const countValue = ToolsFunction.lineCircleIntersectionByGeometryObject(element1, element2);
                    if (countValue.count === 0) return;
                    
                    if (countValue.count === 1) {
                        const [coord] = countValue.value;
                        goalX = coord.x;
                        goalY = coord.y;
                        
                    }else if (countValue.count === 2) {
                        const coord1 = countValue.value[0];
                        const coord2 = countValue.value[1];
                        const p3 = {x, y};
                        const distance1 = ToolsFunction.distance(coord1, p3);
                        const distance2 = ToolsFunction.distance(coord2, p3);
                        if (distance1 > distance2) index = 1;
                        
                        const coord = countValue.value[index];
                        goalX = coord.x;
                        goalY = coord.y;
                    }
                }
            }else if (element1.getType() === "circle") {
                if (element2.getType() === "line") {
                    const countValue = ToolsFunction.lineCircleIntersectionByGeometryObject(element2, element1);
                    if (countValue.count === 0) return;
                    
                    if (countValue.count === 1) {
                        const [coord] = countValue.value;
                        goalX = coord.x;
                        goalY = coord.y;
                        
                    }else if (countValue.count === 2) {
                        const coord1 = countValue.value[0];
                        const coord2 = countValue.value[1];
                        const p3 = {x, y};
                        const distance1 = ToolsFunction.distance(coord1, p3);
                        const distance2 = ToolsFunction.distance(coord2, p3);
                        if (distance1 > distance2) index = 1;
                        
                        const coord = countValue.value[index];
                        goalX = coord.x;
                        goalY = coord.y;
                        
                    }
                }else if (element2.getType() === "circle") {
                    const countValue = ToolsFunction.circleCircleIntersectionByGeometryObject(element1, element2);
                    if (countValue.count === 0) return;
                    
                    if (countValue.count === 1) {
                        const [coord] = countValue.value;
                        goalX = coord.x;
                        goalY = coord.y;
                        
                    }else if (countValue.count === 2) {
                        const coord1 = countValue.value[0];
                        const coord2 = countValue.value[1];
                        const p3 = {x, y};
                        const distance1 = ToolsFunction.distance(coord1, p3);
                        const distance2 = ToolsFunction.distance(coord2, p3);
                        if (distance1 > distance2) index = 1;
                        
                        const coord = countValue.value[index];
                        goalX = coord.x;
                        goalY = coord.y;
                    }
                }
            }
            
            const pointObject = geometryManager.createPoint(goalX, goalY);
            pointObject.modifyBase("intersection", [element1, element2], index);
            element1.addSuperstructure(pointObject);
            element2.addSuperstructure(pointObject);
            geometryManager.addToolObject(this.toolName, `point${this.status + 1}`, "append", pointObject);
            
        }else if (exceptPoints.length === 1) {
            let value;
            const item = geometryManager.get(exceptPoints[0]);
            if (item.getType() === "line") {
                const coordList = item.getCoordinate();
                const point1Coord = coordList[0];
                const point2Coord = coordList[1];
                const p1 = {x: point1Coord[0], y: point1Coord[1]};
                const p2 = {x: point2Coord[0], y: point2Coord[1]};
                const p3 = {x, y};
                
                value = ToolsFunction.onlineValueOf(item, p1, p2, p3);
                if (!value) return;
                const coord = ToolsFunction.onlineCoordinateOf(p1, p2, p3);
                goalX = coord.x;
                goalY = coord.y;
                
            }else if (item.getType() === "circle") {
                const coordList = item.getCoordinate();
                const point1Coord = coordList[0];
                const point2Coord = coordList[1];
                const p1 = {x: point1Coord[0], y: point1Coord[1]};
                const p2 = {x: point2Coord[0], y: point2Coord[1]};
                const p3 = {x, y};
                
                value = ToolsFunction.nearPointOnCircle(p1, p3);
                const coord = ToolsFunction.radianToCoordinate(p1, p2, value);
                goalX = coord.x;
                goalY = coord.y;
                
            }
            
            const pointObject = geometryManager.createPoint(goalX, goalY);
            const geometryObject = item;
            pointObject.modifyBase("online", [geometryObject], value);
            geometryObject.addSuperstructure(pointObject);
            geometryManager.addToolObject(this.toolName, `point${this.status + 1}`, "append", pointObject);
                
        }else if (exceptPoints.length === 0) {
            const pointObject = geometryManager.createPoint(goalX, goalY);
            geometryManager.addToolObject(this.toolName, `point${this.status + 1}`, "append", pointObject);
        }
    }
    
    /**
     * 创建目标图形
     * @param {any} value 
     */
    create(value) {
        if (typeof value !== this.type) throw new Error("exception.pointBaseDialogToolTemplateTypeException");

        geometryManager.createGeometryElementInputTool(this.goalType, this.toolName, this.goal);
        if (this.drawType) geometryManager.getToolKey(this.toolName, this.goal).modifyDrawType(this.drawType);
        this.setDefine(value);
    }
    
    /**
     * 移动缓存点
     * @param {number} x
     * @param {number} y
     */
    movePoint(x, y) {
        const [pointId] = geometryManager.near([x, y], ["point"]);
        // 光标压在一个已标出的交点上：经过它的每条线 / 每个圆都一起高亮
        // （按住拖动时每次移动都重算一次，离开交点自动撤掉）
        if (typeof highlightFiguresThroughPoint === 'function') highlightFiguresThroughPoint(this.toolName, pointId);
        if (pointId) {
            // 已经点过的点：默认跳过（不把同一个点引用两次）；
            // 三点圆规的圆心（第三个点）允许重复，那时照常切成引用
            if (geometryManager.ifIdInCache(this.toolName, pointId) && !this.repeatPointAllowed(this.status)) return;
            // 切换至引用
            geometryManager.modifyToolObject(this.toolName, `point${this.status}`, "quote", pointId);
            if (this.changedVerify !== "choice") {
                this.changedVerify = "choice";
            }
        }else{
            // 从引用切换回创建，防干扰
            geometryManager.modifyToolObject(this.toolName, `point${this.status}`, "create", [x, y]);
            const point = geometryManager.getToolKey(this.toolName, `point${this.status}`);
            point.clearBase();
            let goalX = x, goalY = y, index = 0;
            // 与 createPoint 一致：先吸附光标附近最近的那个交点
            const snap = geometryManager.nearestIntersection(x, y);
            const exceptPoints = snap
                ? [snap.element1.getId(), snap.element2.getId()]
                : geometryManager.near([x, y], ["line", "circle"], 1);
            if (exceptPoints.length === 2) {
                geometryManager.deleteToolKey(this.toolName, "adsorb");
                
                const element1 = geometryManager.get(exceptPoints[0]);
                const element2 = geometryManager.get(exceptPoints[1]);
                if (element1.getType() === "line") {
                    if (element2.getType() === "line") {
                        const flagValue = ToolsFunction.lineIntersectionByGeometryObject(element1, element2);
                        if (!flagValue) return;
                        const coord = flagValue.value;
                        goalX = coord.x;
                        goalY = coord.y;
                        
                        point.modifyBase("intersection", [element1, element2], 0);
                        geometryManager.addToolObject(this.toolName, "inter1", "quote", exceptPoints[0]);
                        geometryManager.addToolObject(this.toolName, "inter2", "quote", exceptPoints[1]);
                    
                    }else if (element2.getType() === "circle") {
                        const countValue = ToolsFunction.lineCircleIntersectionByGeometryObject(element1, element2);
                        if (countValue.count === 0) return;
                        
                        if (countValue.count === 1) {
                            const [coord] = countValue.value;
                            goalX = coord.x;
                            goalY = coord.y;
                            
                            point.modifyBase("intersection", [element1, element2], 0);
                            geometryManager.addToolObject(this.toolName, "inter1", "quote", exceptPoints[0]);
                            geometryManager.addToolObject(this.toolName, "inter2", "quote", exceptPoints[1]);
                            
                        }else if (countValue.count === 2) {
                            const coord1 = countValue.value[0];
                            const coord2 = countValue.value[1];
                            const p3 = {x, y};
                            const distance1 = ToolsFunction.distance(coord1, p3);
                            const distance2 = ToolsFunction.distance(coord2, p3);
                            if (distance1 > distance2) index = 1;
                            
                            const coord = countValue.value[index];
                            goalX = coord.x;
                            goalY = coord.y;
                            
                            point.modifyBase("intersection", [element1, element2], index);
                            geometryManager.addToolObject(this.toolName, "inter1", "quote", exceptPoints[0]);
                            geometryManager.addToolObject(this.toolName, "inter2", "quote", exceptPoints[1]);
                            
                        }
                    }
                }else if (element1.getType() === "circle") {
                    if (element2.getType() === "line") {
                        const countValue = ToolsFunction.lineCircleIntersectionByGeometryObject(element2, element1);
                        if (countValue.count === 0) return;
                        
                        if (countValue.count === 1) {
                            const [coord] = countValue.value;
                            goalX = coord.x;
                            goalY = coord.y;
                            
                            point.modifyBase("intersection", [element1, element2], 0);
                            geometryManager.addToolObject(this.toolName, "inter1", "quote", exceptPoints[0]);
                            geometryManager.addToolObject(this.toolName, "inter2", "quote", exceptPoints[1]);
                            
                        }else if (countValue.count === 2) {
                            const coord1 = countValue.value[0];
                            const coord2 = countValue.value[1];
                            const p3 = {x, y};
                            const distance1 = ToolsFunction.distance(coord1, p3);
                            const distance2 = ToolsFunction.distance(coord2, p3);
                            if (distance1 > distance2) index = 1;
                            
                            const coord = countValue.value[index];
                            goalX = coord.x;
                            goalY = coord.y;
                            
                            point.modifyBase("intersection", [element1, element2], index);
                            geometryManager.addToolObject(this.toolName, "inter1", "quote", exceptPoints[0]);
                            geometryManager.addToolObject(this.toolName, "inter2", "quote", exceptPoints[1]);
                            
                        }
                    }else if (element2.getType() === "circle") {
                        const countValue = ToolsFunction.circleCircleIntersectionByGeometryObject(element1, element2);
                        if (countValue.count === 0) return;
                        
                        if (countValue.count === 1) {
                            const [coord] = countValue.value;
                            goalX = coord.x;
                            goalY = coord.y;
                            
                            point.modifyBase("intersection", [element1, element2], 0);
                            geometryManager.addToolObject(this.toolName, "inter1", "quote", exceptPoints[0]);
                            geometryManager.addToolObject(this.toolName, "inter2", "quote", exceptPoints[1]);
                            
                        }else if (countValue.count === 2) {
                            const coord1 = countValue.value[0];
                            const coord2 = countValue.value[1];
                            const p3 = {x, y};
                            const distance1 = ToolsFunction.distance(coord1, p3);
                            const distance2 = ToolsFunction.distance(coord2, p3);
                            if (distance1 > distance2) index = 1;
                            
                            const coord = countValue.value[index];
                            goalX = coord.x;
                            goalY = coord.y;
                            
                            point.modifyBase("intersection", [element1, element2], index);
                            geometryManager.addToolObject(this.toolName, "inter1", "quote", exceptPoints[0]);
                            geometryManager.addToolObject(this.toolName, "inter2", "quote", exceptPoints[1]);
                            
                        }
                    }
                }
            }else if (exceptPoints.length === 1) {
                geometryManager.deleteToolKey(this.toolName, "inter1");
                geometryManager.deleteToolKey(this.toolName, "inter2");
                let value;
                const item = geometryManager.get(exceptPoints[0]);
                if (item.getType() === "line") {
                    const coordList = item.getCoordinate();
                    const point1Coord = coordList[0];
                    const point2Coord = coordList[1];
                    const p1 = {x: point1Coord[0], y: point1Coord[1]};
                    const p2 = {x: point2Coord[0], y: point2Coord[1]};
                    const p3 = {x, y};
                    
                    value = ToolsFunction.onlineValueOf(item, p1, p2, p3);
                    if (!value) return;
                    const coord = ToolsFunction.onlineCoordinateOf(p1, p2, p3);
                    goalX = coord.x;
                    goalY = coord.y;
                    
                    const geometryObject = item;
                    point.modifyBase("online", [geometryObject], value);
                    geometryManager.addToolObject(this.toolName, "adsorb", "quote", exceptPoints[0]);
                    
                }else if (item.getType() === "circle") {
                    const coordList = item.getCoordinate();
                    const point1Coord = coordList[0];
                    const point2Coord = coordList[1];
                    const p1 = {x: point1Coord[0], y: point1Coord[1]};
                    const p2 = {x: point2Coord[0], y: point2Coord[1]};
                    const p3 = {x, y};
                    
                    value = ToolsFunction.nearPointOnCircle(p1, p3);
                    const coord = ToolsFunction.radianToCoordinate(p1, p2, value);
                    goalX = coord.x;
                    goalY = coord.y;
                    
                    const geometryObject = item;
                    point.modifyBase("online", [geometryObject], value);
                    geometryManager.addToolObject(this.toolName, "adsorb", "quote", exceptPoints[0]);
                }
            }else if (exceptPoints.length === 0) {
                geometryManager.deleteToolKey(this.toolName, "inter1");
                geometryManager.deleteToolKey(this.toolName, "inter2");
                geometryManager.deleteToolKey(this.toolName, "adsorb");
            }
            
            geometryManager.modifyToolObject(this.toolName, `point${this.status}`, "create", [goalX, goalY]);
            if (this.changedVerify !== "move") {
                this.changedVerify = "move";
            }
        }
    }
    
    /**
     * 定义点的排列顺序 过程函数
     * 默认按取点顺序；定值角覆写成 [顶点, 边上点]（它取点是先边上点、后顶点，
     * 但定义里第一个点必须是顶点 —— gmt 的 FixAngle[A,B,x] 里 A 是顶点）
     * @returns {Object[]}
     */
    definePointList() {
        const pointList = [];
        for (let i = 1; i <= this.maxStatus; i++) {
            pointList.push(geometryManager.getToolKey(this.toolName, `point${i}`));
        }
        return pointList;
    }

    /**
     * 配置定义点
     * @param {any} value 
     */
    setDefine(value) {
        if (this.status < this.maxStatus) return;
        
        const pointList = this.definePointList();
        const goal = geometryManager.getToolKey(this.toolName, this.goal)
        if (goal.getType() === "point") {
            goal.modifyBase(this.define, pointList, value);
        }else{
            goal.modifyDefine(this.define, pointList, value);
        }
    }
    
    /**
     * 创建最后点
     */
    createLastPoint(x, y) {
        // 用当前指针位置建点，而不是按下位置（startCoord）：
        // 拖动过程中 movePoint 里有若干 early-return（光标下是缓存里已有点、附近两图形没有有效交点等），
        // 用按下位置建的点就会留在原地不动 —— 看上去「即将创建的点」离光标很远
        const coord = Number.isFinite(x) && Number.isFinite(y) ? [x, y] : this.startCoord;
        geometryManager.addToolObject(this.toolName, `point${this.status + 1}`, "create", coord);
    }
    
    /**
     * 创建2点
     */
    draw2Points() {
        const [x, y] = this.startCoord;
        const [pointId] = geometryManager.near([x, y], ["point"]);
        if (pointId) {
            geometryManager.addToolObject(this.toolName, `point${this.status + 1}`, "quote", pointId);
        }else{
            this.createPoint(x, y);
        }
        geometryManager.addToolObject(this.toolName, `point${this.status + 2}`, "create", [x, y]);
    }
    
    /**
     * 清空
     */
    clear() {
        geometryManager.deleteTool(this.toolName);
        this.cacheFlag = false;
        this.status = 0;
    }
}



/*
toolEvent +
click +
draw +
drawComplete +
cancel +
createPoint +
create +
movePoint +
createLastPoint +
draw2Points +
check +
clear +
*/

class ExceptPointBaseToolTemplate {
    /**
     * 初始构造器
     * @param {string} toolName
     * @param {number} maxStatus
     * @param {string[]} exceptPointList
     * @param {function} createFunction
     */
    constructor(toolName, maxStatus, exceptPointList, createFunction) {
        this.cacheFlag = false;
        this.status = 0;
        this.startCoord;
        this.createFlag = false;
        
        this.toolName = toolName;
        this.maxStatus = maxStatus;
        this.exceptPointList = exceptPointList;
        this.create = createFunction;
    }
    
    /**
     * 工具事件
     * @param {string} type
     * @param {number} oriX 原x坐标
     * @param {number} oriY 原y坐标
     */
    toolEvent(type, oriX, oriY) {
        const x = (oriX - transform.x) / transform.scale;
        const y = (oriY - transform.y) / transform.scale;
        if (type === "start") {
            this.startCoord = [x, y];
        }else if (type === "click") {
            this.click(x, y);
        }else if (type === "draw") {
            this.draw(x, y);
        }else if (type === "drawComplete") {
            this.drawComplete(x, y);
        }else if (type === "cancel") {
            this.cancel();
        }
    }
    
    /**
     * 点击
     * @param {number} x
     * @param {number} y
     */
    click(x, y) {
        const [id] = geometryManager.near([x, y], this.exceptPointList);
        if (!id) {
            this.clear();
            return;
        }
        
        if (geometryManager.ifIdInCache(this.toolName, id)) {
            geometryManager.deleteToolQuote(this.toolName, id);
            this.status--;
        }else{
            geometryManager.addToolObject(this.toolName, `choice${this.status + 1}`, "quote", id);
            this.status++;
        }
    
        if (this.status >= this.maxStatus) {
            this.status = 0;
            // 传入点击位置：交点工具用它确定多个交点中取哪一个
            this.create(x, y);
            // 触发存储事件
            const event = new CustomEvent("storage", {
                detail: {
                    type: this.toolName,
                },
            });
            window.dispatchEvent(event);
        }
    }
    
    /**
     * 拖拽
     * @param {number} x
     * @param {number} y
     */
    draw(x, y) {
        if (!this.cacheFlag) {
            if (this.status + 1 < this.maxStatus) {
                this.draw2Points();
                this.status++;
                this.status++;
            }else if (this.status + 1 === this.maxStatus) {
                this.createLastPoint(x, y);
                this.status++;
            }
            this.cacheFlag = true;
        }
        this.movePoint(x, y);
    }
    
    /**
     * 拖拽完成
     */
    drawComplete() {
        this.cacheFlag = false;
        if (this.status >= this.maxStatus) {
            this.status = 0;
            // 重复性检查
            this.check();
        }
    }
    
    /**
     * 取消
     */
    cancel() {
        if (this.cacheFlag) {
            geometryManager.deleteTool(this.toolName);
            this.cacheFlag = false;
            this.status = 0;
        }
    }
    
    /**
     * 移动标记点
     * @param {number} x
     * @param {number} y
     */
    movePoint(x, y) {
        let goalX = x, goalY = y;
        
        const exceptPoints = geometryManager.near([x, y], ["line", "circle"]);
        if (exceptPoints.length === 1) {
            const item = geometryManager.get(exceptPoints[0]);
            if (item.getType() === "line") {
                const coordList = item.getCoordinate();
                const point1Coord = coordList[0];
                const point2Coord = coordList[1];
                const p1 = {x: point1Coord[0], y: point1Coord[1]};
                const p2 = {x: point2Coord[0], y: point2Coord[1]};
                const p3 = {x, y};
                
                const value = ToolsFunction.onlineValueOf(item, p1, p2, p3);
                if (!value) return;
                const coord = ToolsFunction.onlineCoordinateOf(p1, p2, p3);
                goalX = coord.x;
                goalY = coord.y;
                
                geometryManager.addToolObject(this.toolName, `choice${this.status}`, "quote", exceptPoints[0]);
                
            }else if (item.getType() === "circle") {
                const coordList = item.getCoordinate();
                const point1Coord = coordList[0];
                const point2Coord = coordList[1];
                const p1 = {x: point1Coord[0], y: point1Coord[1]};
                const p2 = {x: point2Coord[0], y: point2Coord[1]};
                const p3 = {x, y};
                
                const value = ToolsFunction.nearPointOnCircle(p1, p3);
                const coord = ToolsFunction.radianToCoordinate(p1, p2, value);
                goalX = coord.x;
                goalY = coord.y;
                
                geometryManager.addToolObject(this.toolName, `choice${this.status}`, "quote", exceptPoints[0]);
            }
        }else if (exceptPoints.length === 0) {
            geometryManager.deleteToolKey(this.toolName, `choice${this.status}`);
        }
        
        geometryManager.modifyToolObject(this.toolName, `choicePoint${this.status}`, "create", [goalX, goalY]);
    }
    
    /**
     * 创建标记点
     */
    createPoint(x, y) {
        geometryManager.addToolObject(this.toolName, `choicePoint${this.status + 1}`, 'create', [x, y]);
        const [id] = geometryManager.near([x, y], this.exceptPointList);
        if (id) geometryManager.addToolObject(this.toolName, `choice${this.status + 1}`, "quote", id);
    }
    
    /**
     * 创建最后标记点
     */
    createLastPoint(x, y) {
        // 同上：用当前指针位置，避免 movePoint 提前返回时留在按下处
        const coord = Number.isFinite(x) && Number.isFinite(y) ? [x, y] : this.startCoord;
        geometryManager.addToolObject(this.toolName, `choicePoint${this.maxStatus}`, 'create', coord);
    }
    
    /**
     * 创建2标记点
     */
    draw2Points() {
        const [x, y] = this.startCoord;
        this.createPoint(x, y);
        geometryManager.addToolObject(this.toolName, `choicePoint${this.status + 2}`, 'create', [0, 0]);
    }
    
    /**
     * 检查并添加
     */
    check() {
        const set = new Set([]);
        for (let i = 1; i <= this.maxStatus; i++) {
            if (!geometryManager.ifToolKeyInCache(this.toolName, `choice${i}`)) {
                this.clear();
                return;
            }
            const element = geometryManager.getToolKey(this.toolName, `choice${i}`);
            set.add(element.getId());
        }
        
        if (set.size < this.maxStatus) {
            // 重复
            this.clear();
        }else{
            for (let i = 1; i <= this.maxStatus; i++) {
                geometryManager.deleteToolKey(this.toolName, `choicePoint${i}`);
            }
            this.create();
            geometryManager.loadTool(this.toolName);
            // 触发存储事件
            const event = new CustomEvent("storage", {
                detail: {
                    type: this.toolName,
                },
            });
            window.dispatchEvent(event);
        }
    }
    
    /**
     * 清空
     */
    clear() {
        geometryManager.deleteTool(this.toolName);
        this.cacheFlag = false;
        this.status = 0;
    }
}



/*
toolEvent +
click +
draw +
drawComplete +
cancel +
clickPoint +
createPoint +
create +
movePoint +
createLastPoint +
draw2Points +
verifyLoad +
clear +
*/

class MixPointBaseToolTemplate {
    /**
     * 初始构造器
     * @param {string} toolName
     * @param {string} goal
     * @param {string} goalType
     * @param {string} define
     * @param {string} exceptPoint
     */
    constructor(toolName, goal, goalType, define, exceptPoint) {
        this.cacheFlag = false;
        this.status = "none";
        this.startCoord;
        this.changedVerify;
        this.completeStatus = false;
        
        this.toolName = toolName;
        this.goal = goal;
        this.goalType = goalType;
        this.define = define;
        this.exceptPoint = exceptPoint;
    }
    
    /**
     * 工具事件
     * @param {string} type
     * @param {number} oriX 原x坐标
     * @param {number} oriY 原y坐标
     */
    toolEvent(type, oriX, oriY) {
        const x = (oriX - transform.x) / transform.scale;
        const y = (oriY - transform.y) / transform.scale;
        if (type === "start") {
            this.startCoord = [x, y];
        }else if (type === "click") {
            this.click(x, y);
        }else if (type === "draw") {
            this.draw(x, y);
        }else if (type === "drawComplete") {
            this.drawComplete(x, y);
        }else if (type === "cancel") {
            this.cancel();
        }
    }
    
    /**
     * 点击
     * @param {number} x
     * @param {number} y
     */
    click(x, y) {
        this.clickPoint(x, y);
        if (this.completeStatus) this.verifyLoad();
    }
    
    /**
     * 拖拽
     * @param {number} x
     * @param {number} y
     */
    draw(x, y) {
        if (!this.cacheFlag) {
            if (this.status === 'none') {
                // draw2Points 返回 false 表示「这一下只是选中了一条线，点还没造」：
                // 这时不置 cacheFlag，等下一帧（指针真的动了）再造点
                if (this.draw2Points() === false) return;
            }else if (this.status === 'point+' || this.status === '+point') {
                this.createLastPoint(x, y);
            }
            this.cacheFlag = true;
        }
        this.movePoint(x, y);
        if (this.completeStatus) geometryManager.getToolKey(this.toolName, this.goal).updateCoordinate();
    }
    
    /**
     * 拖拽完成
     */
    drawComplete() {
        this.cacheFlag = false;
        this.verifyLoad();
    }
    
    /**
     * 取消
     */
    cancel() {
        if (this.cacheFlag) {
            geometryManager.deleteTool(this.toolName);
            this.cacheFlag = false;
            this.status = 'none';
            this.completeStatus = false;
        }
    }

    /**
     * 点点
     * @param {number} x 
     * @param {number} y 
     */
    clickPoint(x, y) {
        const [exceptPointId] = geometryManager.near([x, y], [this.exceptPoint]);
        const [pointId] = geometryManager.near([x, y], ["point"]);
        
        // 状态为主
        if (this.status === 'none') {
            if (pointId) {
                geometryManager.addToolObject(this.toolName, "point", "quote", pointId);
                this.status = 'point+';
            }else if (exceptPointId) {
                geometryManager.addToolObject(this.toolName, this.exceptPoint, "quote", exceptPointId);
                this.status = '+point';
            }else{
                this.createPoint(x, y);
                this.status = 'point+';
            }
        }else if (this.status === 'point+') {
            if (exceptPointId) {
                geometryManager.addToolObject(this.toolName, this.exceptPoint, "quote", exceptPointId);
                this.create();
            }else if (pointId) {
                geometryManager.deleteToolQuote(this.toolName, pointId)
                this.status = 'none';
            }
        }else if (this.status === '+point') {
            if (pointId) {
                geometryManager.addToolObject(this.toolName, "point", "quote", pointId);
                this.create();
            }else if (geometryManager.nearestIntersection(x, y)) {
                // 点在「还没标出来的交点」上：先在那儿造一个交点，再继续作图。
                // 不先判这一条会落到下面的 exceptPointId 分支 —— 光标下正好压着线（交点必然压着线），
                // 于是被当成「又点了一次线」，整个作图反而被取消
                this.createPoint(x, y);
                this.create();
            }else if (exceptPointId) {
                // 点在图形上 —— **包括刚选中的那条线 / 那个圆本身**：先在这个图形上取个点，再接着作图。
                // 之前只在点是「别的图形」时才取点，点在已选中的线上则被当成「又点了一次」而取消，
                // 于是垂线 / 平行线选完线之后，没法直接在这条线上取点作图（取消选中请用浮层的清空）
                this.createPoint(x, y);
                this.create();
            }else{
                this.createPoint(x, y);
                this.create();
            }
        }
    }
    
    /**
     * 创建点
     * @param {number} x
     * @param {number} y
     */
    createPoint(x, y) {
        let goalX = x, goalY = y;
        // 与上面一致：先吸附光标附近最近的那个交点
        const snap = geometryManager.nearestIntersection(x, y);
        const exceptPoints = snap
            ? [snap.element1.getId(), snap.element2.getId()]
            : geometryManager.near([x, y], ["line", "circle"], 1);
        if (exceptPoints.length === 2) {
            let index = 0;
            
            const element1 = geometryManager.get(exceptPoints[0]);
            const element2 = geometryManager.get(exceptPoints[1]);
            if (element1.getType() === "line") {
                if (element2.getType() === "line") {
                    const flagValue = ToolsFunction.lineIntersectionByGeometryObject(element1, element2);
                    if (!flagValue) return;
                    const coord = flagValue.value;
                    goalX = coord.x;
                    goalY = coord.y;
                    
                
                }else if (element2.getType() === "circle") {
                    const countValue = ToolsFunction.lineCircleIntersectionByGeometryObject(element1, element2);
                    if (countValue.count === 0) return;
                    
                    if (countValue.count === 1) {
                        const [coord] = countValue.value;
                        goalX = coord.x;
                        goalY = coord.y;
                        
                        
                    }else if (countValue.count === 2) {
                        const coord1 = countValue.value[0];
                        const coord2 = countValue.value[1];
                        const p3 = {x, y};
                        const distance1 = ToolsFunction.distance(coord1, p3);
                        const distance2 = ToolsFunction.distance(coord2, p3);
                        if (distance1 > distance2) index = 1;
                        
                        const coord = countValue.value[index];
                        goalX = coord.x;
                        goalY = coord.y;
                        
                        
                    }
                }
            }else if (element1.getType() === "circle") {
                if (element2.getType() === "line") {
                    const countValue = ToolsFunction.lineCircleIntersectionByGeometryObject(element2, element1);
                    if (countValue.count === 0) return;
                    
                    if (countValue.count === 1) {
                        const [coord] = countValue.value;
                        goalX = coord.x;
                        goalY = coord.y;
                        
                        
                    }else if (countValue.count === 2) {
                        const coord1 = countValue.value[0];
                        const coord2 = countValue.value[1];
                        const p3 = {x, y};
                        const distance1 = ToolsFunction.distance(coord1, p3);
                        const distance2 = ToolsFunction.distance(coord2, p3);
                        if (distance1 > distance2) index = 1;
                        
                        const coord = countValue.value[index];
                        goalX = coord.x;
                        goalY = coord.y;
                        
                        
                    }
                }else if (element2.getType() === "circle") {
                    const countValue = ToolsFunction.circleCircleIntersectionByGeometryObject(element1, element2);
                    if (countValue.count === 0) return;
                    
                    if (countValue.count === 1) {
                        const [coord] = countValue.value;
                        goalX = coord.x;
                        goalY = coord.y;
                        
                        
                    }else if (countValue.count === 2) {
                        const coord1 = countValue.value[0];
                        const coord2 = countValue.value[1];
                        const p3 = {x, y};
                        const distance1 = ToolsFunction.distance(coord1, p3);
                        const distance2 = ToolsFunction.distance(coord2, p3);
                        if (distance1 > distance2) index = 1;
                        
                        const coord = countValue.value[index];
                        goalX = coord.x;
                        goalY = coord.y;
                        
                    }
                }
            }
            
            const pointObject = geometryManager.createPoint(goalX, goalY);
            pointObject.modifyBase("intersection", [element1, element2], index);
            element1.addSuperstructure(pointObject);
            element2.addSuperstructure(pointObject);
            geometryManager.addToolObject(this.toolName, "point", "append", pointObject);

        }else if (exceptPoints.length === 1) {
            let value;
            
            const item = geometryManager.get(exceptPoints[0]);
            if (item.getType() === "line") {
                const coordList = item.getCoordinate();
                const point1Coord = coordList[0];
                const point2Coord = coordList[1];
                const p1 = {x: point1Coord[0], y: point1Coord[1]};
                const p2 = {x: point2Coord[0], y: point2Coord[1]};
                const p3 = {x, y};
                
                value = ToolsFunction.onlineValueOf(item, p1, p2, p3);
                if (!value) return;
                const coord = ToolsFunction.onlineCoordinateOf(p1, p2, p3);
                goalX = coord.x;
                goalY = coord.y;
                
                
            }else if (item.getType() === "circle") {
                const coordList = item.getCoordinate();
                const point1Coord = coordList[0];
                const point2Coord = coordList[1];
                const p1 = {x: point1Coord[0], y: point1Coord[1]};
                const p2 = {x: point2Coord[0], y: point2Coord[1]};
                const p3 = {x, y};
                
                value = ToolsFunction.nearPointOnCircle(p1, p3);
                const coord = ToolsFunction.radianToCoordinate(p1, p2, value);
                goalX = coord.x;
                goalY = coord.y;
                
            }
            
            const pointObject = geometryManager.createPoint(goalX, goalY);
            const geometryObject = item;
            pointObject.modifyBase("online", [geometryObject], value);
            geometryObject.addSuperstructure(pointObject);
            geometryManager.addToolObject(this.toolName, "point", "append", pointObject);
                
        }else if (exceptPoints.length === 0) {
            const pointObject = geometryManager.createPoint(goalX, goalY);
            geometryManager.addToolObject(this.toolName, "point", "append", pointObject);
        }
    }
    
    /**
     * 创建目标图形
     */
    create() {
        if (this.completeStatus) return;
        this.completeStatus = true;
        
        const point = geometryManager.getToolKey(this.toolName, "point");
        const exceptPoint = geometryManager.getToolKey(this.toolName, this.exceptPoint);
        geometryManager.createGeometryElementInputTool(this.goalType, this.toolName, this.goal);
        const goal = geometryManager.getToolKey(this.toolName, this.goal);
        goal.modifyDefine(this.define, [point, exceptPoint]);
    }
    
    /**
     * 把「经过光标下这个交点的全部图形」一起挂进缓存（只为高亮） 过程函数
     * 看不出这个交点到底属于哪几个图形；这里把交点的两个基底都取出来一起高亮
     * @param {string} pointId 光标下的点（不是交点时只清掉这组高亮引用）
     */
    highlightThroughFigures(pointId) {
        if (typeof highlightFiguresThroughPoint === 'function') highlightFiguresThroughPoint(this.toolName, pointId);
    }

    /**
     * 移动缓存点
     * @param {number} x
     * @param {number} y
     */
    movePoint(x, y) {
        const [pointId] = geometryManager.near([x, y], ["point"]);
        const [exceptPointId] = geometryManager.near([x, y], [this.exceptPoint]);
        let point;
        if (this.status === "point+") {
            point = geometryManager.getToolKey(this.toolName, 'point2');
        }else if (this.status === "+point") {
            point = geometryManager.getToolKey(this.toolName, 'point');
        }
        let goalX = x, goalY = y;
        
        if (this.status === '+point') {
            // 点还没造出来（刚选中那条线、指针还没动开）：先别作出目标图形，
            // 否则会凭空冒出一条过按下点的垂线 / 平行线
            if (!geometryManager.getToolKey(this.toolName, 'point')) return;
            // 目标点
            this.create();
            if (pointId) {
                // 吸附已有点
                if (geometryManager.ifIdInCache(this.toolName, pointId)) return;
                
                geometryManager.modifyToolObject(this.toolName, "point", "quote", pointId);
                // 光标压在一个已标出的交点上：经过它的每条线 / 每个圆都一起高亮
                this.highlightThroughFigures(pointId);
                if (this.changedVerify !== "choice") {
                    this.changedVerify = "choice";
                    const point = geometryManager.getToolKey(this.toolName, "point");
                    const exceptPoint = geometryManager.getToolKey(this.toolName, this.exceptPoint);
                    geometryManager.getToolKey(this.toolName, this.goal).modifyDefine(this.define, [point, exceptPoint]);
                }
            }else{
                // 光标没压在点上：清掉上一次的「过交点图形」高亮
                this.highlightThroughFigures(null);
                // 刷新防引用混乱
                geometryManager.modifyToolObject(this.toolName, "point", "create", [x, y]);
                point = geometryManager.getToolKey(this.toolName, 'point');
                // 与前面几处一致：先吸附光标附近最近的那个交点
                const snap = geometryManager.nearestIntersection(x, y);
                const exceptPoints = snap
                    ? [snap.element1.getId(), snap.element2.getId()]
                    : geometryManager.near([x, y], ["line", "circle"], 1);
                if (exceptPoints.length === 2) {
                    // 吸附交点
                    geometryManager.deleteToolKey(this.toolName, "adsorb");
                    point.clearBase();
                    let index = 0;
                    
                    const element1 = geometryManager.get(exceptPoints[0]);
                    const element2 = geometryManager.get(exceptPoints[1]);
                    if (element1.getType() === "line") {
                        if (element2.getType() === "line") {
                            const flagValue = ToolsFunction.lineIntersectionByGeometryObject(element1, element2);
                            if (!flagValue) return;
                            const coord = flagValue.value;
                            goalX = coord.x;
                            goalY = coord.y;
                            
                        
                        }else if (element2.getType() === "circle") {
                            const countValue = ToolsFunction.lineCircleIntersectionByGeometryObject(element1, element2);
                            if (countValue.count === 0) return;
                            
                            if (countValue.count === 1) {
                                const [coord] = countValue.value;
                                goalX = coord.x;
                                goalY = coord.y;
                                
                                
                            }else if (countValue.count === 2) {
                                const coord1 = countValue.value[0];
                                const coord2 = countValue.value[1];
                                const p3 = {x, y};
                                const distance1 = ToolsFunction.distance(coord1, p3);
                                const distance2 = ToolsFunction.distance(coord2, p3);
                                if (distance1 > distance2) index = 1;
                                
                                const coord = countValue.value[index];
                                goalX = coord.x;
                                goalY = coord.y;
                                
                                
                            }
                        }
                    }else if (element1.getType() === "circle") {
                        if (element2.getType() === "line") {
                            const countValue = ToolsFunction.lineCircleIntersectionByGeometryObject(element2, element1);
                            if (countValue.count === 0) return;
                            
                            if (countValue.count === 1) {
                                const [coord] = countValue.value;
                                goalX = coord.x;
                                goalY = coord.y;
                                
                                
                            }else if (countValue.count === 2) {
                                const coord1 = countValue.value[0];
                                const coord2 = countValue.value[1];
                                const p3 = {x, y};
                                const distance1 = ToolsFunction.distance(coord1, p3);
                                const distance2 = ToolsFunction.distance(coord2, p3);
                                if (distance1 > distance2) index = 1;
                                
                                const coord = countValue.value[index];
                                goalX = coord.x;
                                goalY = coord.y;
                                
                                
                            }
                        }else if (element2.getType() === "circle") {
                            const countValue = ToolsFunction.circleCircleIntersectionByGeometryObject(element1, element2);
                            if (countValue.count === 0) return;
                            
                            if (countValue.count === 1) {
                                const [coord] = countValue.value;
                                goalX = coord.x;
                                goalY = coord.y;
                                
                                
                            }else if (countValue.count === 2) {
                                const coord1 = countValue.value[0];
                                const coord2 = countValue.value[1];
                                const p3 = {x, y};
                                const distance1 = ToolsFunction.distance(coord1, p3);
                                const distance2 = ToolsFunction.distance(coord2, p3);
                                if (distance1 > distance2) index = 1;
                                
                                const coord = countValue.value[index];
                                goalX = coord.x;
                                goalY = coord.y;
                                
                                
                            }
                        }
                    }
                    
                    point.modifyBase("intersection", [element1, element2], index);
                    geometryManager.addToolObject(this.toolName, "inter1", "quote", exceptPoints[0]);
                    geometryManager.addToolObject(this.toolName, "inter2", "quote", exceptPoints[1]);
                                
                }else if (exceptPoints.length === 1) {
                    // 吸附对象上
                    geometryManager.deleteToolKey(this.toolName, "inter1");
                    geometryManager.deleteToolKey(this.toolName, "inter2");
                    point.clearBase();
                    let value;
                    
                    const item = geometryManager.get(exceptPoints[0]);
                    if (item.getType() === "line") {
                        const coordList = item.getCoordinate();
                        const point1Coord = coordList[0];
                        const point2Coord = coordList[1];
                        const p1 = {x: point1Coord[0], y: point1Coord[1]};
                        const p2 = {x: point2Coord[0], y: point2Coord[1]};
                        const p3 = {x, y};
                        
                        value = ToolsFunction.onlineValueOf(item, p1, p2, p3);
                        if (!value) return;
                        const coord = ToolsFunction.onlineCoordinateOf(p1, p2, p3);
                        goalX = coord.x;
                        goalY = coord.y;
                        
                        
                    }else if (item.getType() === "circle") {
                        const coordList = item.getCoordinate();
                        const point1Coord = coordList[0];
                        const point2Coord = coordList[1];
                        const p1 = {x: point1Coord[0], y: point1Coord[1]};
                        const p2 = {x: point2Coord[0], y: point2Coord[1]};
                        const p3 = {x, y};
                        
                        value = ToolsFunction.nearPointOnCircle(p1, p3);
                        const coord = ToolsFunction.radianToCoordinate(p1, p2, value);
                        goalX = coord.x;
                        goalY = coord.y;
                        
                    }
                    
                    const geometryObject = item;
                    point.modifyBase("online", [geometryObject], value);
                    geometryManager.addToolObject(this.toolName, "adsorb", "quote", exceptPoints[0]);
                    
                }else if (exceptPoints.length === 0) {
                    // 独立点
                    geometryManager.deleteToolKey(this.toolName, "inter1");
                    geometryManager.deleteToolKey(this.toolName, "inter2");
                    geometryManager.deleteToolKey(this.toolName, "adsorb");
                    point.clearBase();
                }
                
                if (this.changedVerify !== "move") {
                    this.changedVerify = "move";
                    const point = geometryManager.getToolKey(this.toolName, "point");
                    const exceptPoint = geometryManager.getToolKey(this.toolName, this.exceptPoint);
                    geometryManager.getToolKey(this.toolName, this.goal).modifyDefine(this.define, [point, exceptPoint]);
                }
            }
        }else if (this.status === 'point+'){
            // 吸附到非点目标对象上
            if (exceptPointId) {
                
                let value;
                
                const item = geometryManager.get(exceptPointId);
                if (item.getType() === "line") {
                    const coordList = item.getCoordinate();
                    const point1Coord = coordList[0];
                    const point2Coord = coordList[1];
                    const p1 = {x: point1Coord[0], y: point1Coord[1]};
                    const p2 = {x: point2Coord[0], y: point2Coord[1]};
                    const p3 = {x, y};
                    
                    value = ToolsFunction.onlineValueOf(item, p1, p2, p3);
                    if (!value) return;
                    const coord = ToolsFunction.onlineCoordinateOf(p1, p2, p3);
                    goalX = coord.x;
                    goalY = coord.y;
                    
                    
                }else if (item.getType() === "circle") {
                    const coordList = item.getCoordinate();
                    const point1Coord = coordList[0];
                    const point2Coord = coordList[1];
                    const p1 = {x: point1Coord[0], y: point1Coord[1]};
                    const p2 = {x: point2Coord[0], y: point2Coord[1]};
                    const p3 = {x, y};
                    
                    value = ToolsFunction.nearPointOnCircle(p1, p3);
                    const coord = ToolsFunction.radianToCoordinate(p1, p2, value);
                    goalX = coord.x;
                    goalY = coord.y;
                    
                }
                
                geometryManager.addToolObject(this.toolName, this.exceptPoint, 'quote', exceptPointId);

                if (this.completeStatus) {
                    const point = geometryManager.getToolKey(this.toolName, "point");
                    const exceptPoint = geometryManager.getToolKey(this.toolName, this.exceptPoint);
                    geometryManager.getToolKey(this.toolName, this.goal).modifyDefine(this.define, [point, exceptPoint]);
                }else{
                    this.create();
                }
            }else{
                geometryManager.deleteToolKey(this.toolName, this.exceptPoint);
                geometryManager.deleteToolKey(this.toolName, this.goal);
                this.completeStatus = false;
            }
        }

        point.modifyCoordinate(goalX, goalY);
    }
    
    /**
     * 创建第2点
     */
    createLastPoint(x, y) {
        // 同上：用当前指针位置，避免 movePoint 提前返回时留在按下处
        const coord = Number.isFinite(x) && Number.isFinite(y) ? [x, y] : this.startCoord;
        if (this.status === "point+") {
            geometryManager.addToolObject(this.toolName, "point2", "create", coord);
        }else if (this.status === "+point") {
            geometryManager.addToolObject(this.toolName, "point", "create", coord);
        }
    }
    
    /**
     * 创建2点
     */
    draw2Points() {
        const [x, y] = this.startCoord;
        const before = this.status;
        this.clickPoint(x, y);
        // 第一次按下就落在「垂线 / 平行线要选的那条线」上：这一下只当作「选中这条线」，
        // 不在按下位置立刻造点。否则按下（哪怕只是想点一下）的瞬间目标图形就被 create() 出来，
        // 会冒出一条过按下点的垂线预览，而且跟「指针移动过才给预览」的规则相矛盾。
        // 这里返回 false：draw() 保留 cacheFlag = false，下一帧（指针真的移动过）
        // 由 createLastPoint(x, y) 在光标处造点，再作出目标图形
        if (before === "none" && this.status === "+point") return false;
        if (this.status === "point+") {
            geometryManager.addToolObject(this.toolName, "point2", "create", [x, y]);
        }else if (this.status === "+point") {
            geometryManager.addToolObject(this.toolName, "point", "create", [x, y]);
        }
    }

    /**
     * 验证并添加缓存
     */
    verifyLoad() {
        if (this.completeStatus) {
            geometryManager.deleteToolKey(this.toolName, 'point2');
            geometryManager.loadTool(this.toolName);
            // 触发存储事件
            const event = new CustomEvent("storage", {
                detail: {
                    type: this.toolName,
                },
            });
            window.dispatchEvent(event);
        }else{
            geometryManager.deleteTool(this.toolName);
        }
        this.status = 'none';
        this.completeStatus = false;
    }
    
    /**
     * 清空
     */
    clear() {
        geometryManager.deleteTool(this.toolName);
        this.cacheFlag = false;
        this.status = 'none';
        this.completeStatus = false;
    }
}