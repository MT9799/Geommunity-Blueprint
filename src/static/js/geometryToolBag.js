/* geometryToolBag.js */

class PointTool {
    constructor() {
        this.cachePointFlag = false;
        this.toolName = 'point';
    }

    /**
     * 点工具 过程函数
     * @param {string} type
     * @param {number} oriX 原x坐标
     * @param {number} oriY 原y坐标
     */
    toolEvent(type, oriX, oriY) {
        const x = (oriX - transform.x) / transform.scale;
        const y = (oriY - transform.y) / transform.scale;
        if (type === "click") {
            this.clickEventFunctionPoint(x, y);
        }else if (type === "draw") {
            this.drawEventFunctionPoint(x, y);
        }else if (type === "drawComplete") {
            this.drawCompleteEventFunctionPoint(x, y);
        }else if (type === "cancel") {
            this.cancelEventFunctionPoint();
        }
    }
    
    /**
     * 这个位置是否已经有个可见的点 过程函数
     * 点工具不再往已经有点的位置造点：别的作图工具遇到已有点都是「引用」它，不新建
     * （见 ExceptPointBaseToolTemplate.click），点工具以前不看已有点，于是在已经标出的交点
     * 上点一下还会再叠一个点上去。口径与直线 / 圆的去重（findSameElement）、交点工具的
     * 「不在已经有点的位置重复作点」一致：**隐藏的点不算**（near 本身就跳过隐藏与失效的对象）
     * @param {number} x 逻辑坐标（已经过 snapCursorPosition 吸附）
     * @param {number} y
     * @returns {boolean}
     */
    pointExistsAt(x, y) {
        return geometryManager.near([x, y], ["point"], 1).length > 0;
    }
    
    /**
     * 点击 过程函数
     * @param {number} x
     * @param {number} y
     */
    clickEventFunctionPoint(x, y) {
        // 落点已经有点（光标吸附到那个点上）：这次点一下什么也不作。
        // 仍照常发存储事件 —— 置位后 storage 监听会跳过撤销历史与步数（L / E），
        // 与「图形画布上已经有了」走同一条通道
        if (this.pointExistsAt(x, y)) {
            geometryManager.duplicatedFlag = true;
        }else{
            this.createPoint(x, y);
        }
        // 触发存储事件
        const event = new CustomEvent("storage", {
            detail: {
                type: "point",
            },
        });
        window.dispatchEvent(event);
    }
    
    /**
     * 拖拽 过程函数
     * @param {number} x
     * @param {number} y
     */
    drawEventFunctionPoint(x, y) {
        if (!this.cachePointFlag) {
            this.createPointCache(x, y);
            this.cachePointFlag = true;
        }
        this.moveCachePoint(x, y);
    }
    
    /**
     * 拖拽完成 过程函数
     * @param {number} x
     * @param {number} y
     */
    drawCompleteEventFunctionPoint(x, y) {
        // 拖着点工具落到已经有点的位置：这次拖动作废（草稿擦掉，不记历史 / 步数），
        // 位置取「即将落下的那个点」——拖动时它已经吸附过，见 moveCachePoint
        const cache = geometryManager.getToolKey(this.toolName, "cache");
        const coordinate = cache && typeof cache.getCoordinate === 'function' ? cache.getCoordinate() : null;
        const dropped = Array.isArray(coordinate) && this.pointExistsAt(coordinate[0], coordinate[1]);
        if (dropped) {
            this.cancelEventFunctionPoint();
            geometryManager.duplicatedFlag = true;
        }else{
            geometryManager.loadTool("point");
            this.cachePointFlag = false;
        }
        // 触发存储事件
        const event = new CustomEvent("storage", {
            detail: {
                type: "point",
            },
        });
        window.dispatchEvent(event);
    }
    
    /**
     * 取消 过程函数
     */
    cancelEventFunctionPoint() {
        if (this.cachePointFlag) {
            geometryManager.deleteTool("point");
            this.cachePointFlag = false;
        }
    }
    
    /**
     * 创建点 过程函数
     * @param {number} x
     * @param {number} y
     */
    createPoint(x, y) {
        let goalX = x,
            goalY = y;
        // 光标下压着一个隐藏的点对象（图形的定义点常常是隐藏的）：把它显示出来，
        // 别再在它旁边叠一个几乎重合的新点（同一条规则，见 revealHiddenPoint / nearestHiddenPoint）。
        // 显示不出来时（游玩模式里隐藏是关卡语义、网格辅助点、或压根没藏着）就按普通取点往下走
        const hiddenUnder = nearestHiddenPoint(x, y);
        if (hiddenUnder && revealHiddenPoint(hiddenUnder)) return;
        // 先吸附「离光标最近的那个交点」（附近图形两两求交，见 nearestIntersection）：
        // 不再只看最近的 2 个图形，避免光标下就有交点却取到附近别的图形组合在很远处的交点
        const snap = geometryManager.nearestIntersection(x, y);
        if (snap) {
            // 吸附到的那个交点上已经有个**点对象**（多半是图形的定义点，而且常常是隐藏的，
            // 所以 pointExistsAt 那边看不见它）：这个位置在 gmt 的编号规则里就是「已知交点」，
            // 编号时会先把它排掉 —— 硬建出来的点只会落到**另一个候选**上，
            // 表现就是「预览吸在这儿、点下去却在那儿」，两个候选离得越近越明显。
            // 不再新建（与 pointExistsAt 同一口径），但要**把它显示出来**：
            // 「点在有隐藏交点的位置就显示它」那条规则，点工具这一路也照办（见 revealHiddenPoint）
            const hidden = pointAtPosition(snap.x, snap.y);
            // 网格自己的辅助点（格点位置上的小点径黑点）不算「这儿已经有点了」：
            // 照常作出一个真正的交点，但不要把那个小黑点显示出来（见 #4）。
            // 显示不出来时（游玩模式）也照常作出这个交点
            if (hidden && !isGridOwnedId(hidden.getId()) && revealHiddenPoint(hidden)) return;
            const snapPoint = geometryManager.createPoint(snap.x, snap.y);
            applyIntersectionBase(snapPoint, snap);
            snap.element1.addSuperstructure(snapPoint);
            snap.element2.addSuperstructure(snapPoint);
            geometryManager.addObject(snapPoint);
            return;
        }
        // 没有交点时最多只吸附到一个图形上（下面 2 个图形的分支已不再使用）
        const exceptPoints = geometryManager.near([x, y], ["line", "circle"], 1);
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
                    
                    const pointObject = geometryManager.createPoint(goalX, goalY);
                    applyIntersectionBase(pointObject, {x: goalX, y: goalY, element1: element1, element2: element2, index: 0});
                    element1.addSuperstructure(pointObject);
                    element2.addSuperstructure(pointObject);
                    geometryManager.addObject(pointObject);
                
                }else if (element2.getType() === "circle") {
                    const countValue = ToolsFunction.lineCircleIntersectionByGeometryObject(element1, element2);
                    if (countValue.count === 0) return;
                    
                    if (countValue.count === 1) {
                        const [coord] = countValue.value;
                        goalX = coord.x;
                        goalY = coord.y;
                        
                        const pointObject = geometryManager.createPoint(goalX, goalY);
                        applyIntersectionBase(pointObject, {x: goalX, y: goalY, element1: element1, element2: element2, index: index});
                        element1.addSuperstructure(pointObject);
                        element2.addSuperstructure(pointObject);
                        geometryManager.addObject(pointObject);
                        
                    }else if (countValue.count === 2) {
                        const coord1 = countValue.value[0];
                        const coord2 = countValue.value[1];
                        const p3 = {x, y};
                        const distance1 = ToolsFunction.distance(coord1, p3);
                        const distance2 = ToolsFunction.distance(coord2, p3);
                        let index = 0;
                        if (distance1 > distance2) index = 1;
                        
                        const coord = countValue.value[index];
                        goalX = coord.x;
                        goalY = coord.y;
                        
                        const pointObject = geometryManager.createPoint(goalX, goalY);
                        applyIntersectionBase(pointObject, {x: goalX, y: goalY, element1: element1, element2: element2, index: index});
                        element1.addSuperstructure(pointObject);
                        element2.addSuperstructure(pointObject);
                        geometryManager.addObject(pointObject);
                        
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
                        
                        const pointObject = geometryManager.createPoint(goalX, goalY);
                        applyIntersectionBase(pointObject, {x: goalX, y: goalY, element1: element1, element2: element2, index: index});
                        element1.addSuperstructure(pointObject);
                        element2.addSuperstructure(pointObject);
                        geometryManager.addObject(pointObject);
                        
                    }else if (countValue.count === 2) {
                        const coord1 = countValue.value[0];
                        const coord2 = countValue.value[1];
                        const p3 = {x, y};
                        const distance1 = ToolsFunction.distance(coord1, p3);
                        const distance2 = ToolsFunction.distance(coord2, p3);
                        let index = 0;
                        if (distance1 > distance2) index = 1;
                        
                        const coord = countValue.value[index];
                        goalX = coord.x;
                        goalY = coord.y;
                        
                        const pointObject = geometryManager.createPoint(goalX, goalY);
                        applyIntersectionBase(pointObject, {x: goalX, y: goalY, element1: element1, element2: element2, index: index});
                        element1.addSuperstructure(pointObject);
                        element2.addSuperstructure(pointObject);
                        geometryManager.addObject(pointObject);
                        
                    }
                }else if (element2.getType() === "circle") {
                    const countValue = ToolsFunction.circleCircleIntersectionByGeometryObject(element1, element2);
                    if (countValue.count === 0) return;
                    
                    if (countValue.count === 1) {
                        const [coord] = countValue.value;
                        goalX = coord.x;
                        goalY = coord.y;
                        
                        const pointObject = geometryManager.createPoint(goalX, goalY);
                        applyIntersectionBase(pointObject, {x: goalX, y: goalY, element1: element1, element2: element2, index: index});
                        element1.addSuperstructure(pointObject);
                        element2.addSuperstructure(pointObject);
                        geometryManager.addObject(pointObject);
                        
                    }else if (countValue.count === 2) {
                        const coord1 = countValue.value[0];
                        const coord2 = countValue.value[1];
                        const p3 = {x, y};
                        const distance1 = ToolsFunction.distance(coord1, p3);
                        const distance2 = ToolsFunction.distance(coord2, p3);
                        let index = 0;
                        if (distance1 > distance2) index = 1;
                        
                        const coord = countValue.value[index];
                        goalX = coord.x;
                        goalY = coord.y;
                        
                        const pointObject = geometryManager.createPoint(goalX, goalY);
                        applyIntersectionBase(pointObject, {x: goalX, y: goalY, element1: element1, element2: element2, index: index});
                        element1.addSuperstructure(pointObject);
                        element2.addSuperstructure(pointObject);
                        geometryManager.addObject(pointObject);
                    }
                }
            }
            
        }else if (exceptPoints.length === 1) {
            
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
                const coord = ToolsFunction.scalePoint(p1, p2, value);
                goalX = coord.x;
                goalY = coord.y;
                
                const pointObject = geometryManager.createPoint(goalX, goalY);
                const geometryObject = item;
                pointObject.modifyBase("online", [geometryObject], value);
                geometryObject.addSuperstructure(pointObject);
                geometryManager.addObject(pointObject);
                
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
                
                const pointObject = geometryManager.createPoint(goalX, goalY);
                const geometryObject = item;
                pointObject.modifyBase("online", [geometryObject], value);
                geometryObject.addSuperstructure(pointObject);
                geometryManager.addObject(pointObject);
            }
        }else if (exceptPoints.length === 0) {
            const pointObject = geometryManager.createPoint(goalX, goalY);
            geometryManager.addObject(pointObject);
        }
    }
    
    /**
     * 创建缓存点 过程函数
     * @param {number} x
     * @param {number} y
     */
    createPointCache(x, y) {
        geometryManager.addToolObject(this.toolName, "cache", "create", [x, y]);
    }
    
    /**
     * 移动缓存点 过程函数
     * @param {number} x
     * @param {number} y
     */
    moveCachePoint(x, y) {
        const point = geometryManager.getToolKey(this.toolName, "cache");
        const id = point.getId();
        let goalX = x,
            goalY = y;
        // 与 createPoint 一致：预览时也先吸附「离光标最近的那个交点」
        const snap = geometryManager.nearestIntersection(x, y);
        if (snap) {
            geometryManager.deleteToolKey(this.toolName, "adsorb");
            point.clearBase();
            applyIntersectionBase(point, snap);
            geometryManager.addToolObject(this.toolName, "inter1", "quote", snap.element1.getId());
            geometryManager.addToolObject(this.toolName, "inter2", "quote", snap.element2.getId());
            geometryManager.modifyToolObject(this.toolName, "cache", "create", [snap.x, snap.y]);
            return;
        }
        const exceptPoints = geometryManager.near([x, y], ["line", "circle"], 1);
        if (exceptPoints.length === 2) {
            geometryManager.deleteToolKey(this.toolName, "adsorb");
            point.clearBase();
            
            const element1 = geometryManager.get(exceptPoints[0]);
            const element2 = geometryManager.get(exceptPoints[1]);
            if (element1.getType() === "line") {
                if (element2.getType() === "line") {
                    const flagValue = ToolsFunction.lineIntersectionByGeometryObject(element1, element2);
                    if (!flagValue) return;
                    const coord = flagValue.value;
                    goalX = coord.x;
                    goalY = coord.y;
                    
                    applyIntersectionBase(point, {x: goalX, y: goalY, element1: element1, element2: element2, index: 0});
                    geometryManager.addToolObject(this.toolName, "inter1", "quote", exceptPoints[0]);
                    geometryManager.addToolObject(this.toolName, "inter2", "quote", exceptPoints[1]);
                
                }else if (element2.getType() === "circle") {
                    const countValue = ToolsFunction.lineCircleIntersectionByGeometryObject(element1, element2);
                    if (countValue.count === 0) return;
                    
                    if (countValue.count === 1) {
                        const [coord] = countValue.value;
                        goalX = coord.x;
                        goalY = coord.y;
                        
                        applyIntersectionBase(point, {x: goalX, y: goalY, element1: element1, element2: element2, index: 0});
                        geometryManager.addToolObject(this.toolName, "inter1", "quote", exceptPoints[0]);
                        geometryManager.addToolObject(this.toolName, "inter2", "quote", exceptPoints[1]);
                        
                    }else if (countValue.count === 2) {
                        const coord1 = countValue.value[0];
                        const coord2 = countValue.value[1];
                        const p3 = {x, y};
                        const distance1 = ToolsFunction.distance(coord1, p3);
                        const distance2 = ToolsFunction.distance(coord2, p3);
                        let index = 0;
                        if (distance1 > distance2) index = 1;
                        
                        const coord = countValue.value[index];
                        goalX = coord.x;
                        goalY = coord.y;
                        
                        applyIntersectionBase(point, {x: goalX, y: goalY, element1: element1, element2: element2, index: index});
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
                        
                        applyIntersectionBase(point, {x: goalX, y: goalY, element1: element1, element2: element2, index: 0});
                        geometryManager.addToolObject(this.toolName, "inter1", "quote", exceptPoints[0]);
                        geometryManager.addToolObject(this.toolName, "inter2", "quote", exceptPoints[1]);
                        
                    }else if (countValue.count === 2) {
                        const coord1 = countValue.value[0];
                        const coord2 = countValue.value[1];
                        const p3 = {x, y};
                        const distance1 = ToolsFunction.distance(coord1, p3);
                        const distance2 = ToolsFunction.distance(coord2, p3);
                        let index = 0;
                        if (distance1 > distance2) index = 1;
                        
                        const coord = countValue.value[index];
                        goalX = coord.x;
                        goalY = coord.y;
                        
                        applyIntersectionBase(point, {x: goalX, y: goalY, element1: element1, element2: element2, index: index});
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
                        
                        applyIntersectionBase(point, {x: goalX, y: goalY, element1: element1, element2: element2, index: 0});
                        geometryManager.addToolObject(this.toolName, "inter1", "quote", exceptPoints[0]);
                        geometryManager.addToolObject(this.toolName, "inter2", "quote", exceptPoints[1]);
                        
                    }else if (countValue.count === 2) {
                        const coord1 = countValue.value[0];
                        const coord2 = countValue.value[1];
                        const p3 = {x, y};
                        const distance1 = ToolsFunction.distance(coord1, p3);
                        const distance2 = ToolsFunction.distance(coord2, p3);
                        let index = 0;
                        if (distance1 > distance2) index = 1;
                        
                        const coord = countValue.value[index];
                        goalX = coord.x;
                        goalY = coord.y;
                        
                        applyIntersectionBase(point, {x: goalX, y: goalY, element1: element1, element2: element2, index: index});
                        geometryManager.addToolObject(this.toolName, "inter1", "quote", exceptPoints[0]);
                        geometryManager.addToolObject(this.toolName, "inter2", "quote", exceptPoints[1]);
                        
                    }
                }
            }
            
        }else if (exceptPoints.length === 1) {
            geometryManager.deleteToolKey(this.toolName, "inter1");
            geometryManager.deleteToolKey(this.toolName, "inter2");
            point.clearBase();
            
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
                const coord = ToolsFunction.scalePoint(p1, p2, value);
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
                
                const value = ToolsFunction.nearPointOnCircle(p1, p3);
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
            point.clearBase();
        }
        geometryManager.modifyToolObject(this.toolName, "cache", "create", [goalX, goalY]);
    }
    
    /**
     * 清空
     */
    clear() {
        geometryManager.deleteTool(this.toolName);
        this.cachePointFlag = false;
    }
}

class LineTool {
    constructor() {
        this.toolName = 'line';
        this.maxStatus = 2;
        this.goal = "line";
        this.goalType = "line";
        this.define = "twoPoints";
        this.drawType = "line";
        
        this.lineMode = new PointBaseToolTemplate(
            this.toolName,
            this.maxStatus,
            this.goal,
            this.goalType,
            this.define,
            this.drawType
            );
    }
    
    /**
     * 直线工具
     * @param {string} type
     * @param {number} oriX 原x坐标
     * @param {number} oriY 原y坐标
     */
    toolEvent(type, oriX, oriY) {
        this.lineMode.toolEvent(type, oriX, oriY);
    }
    
    /**
     * 清空
     */
    clear() {
        this.lineMode.clear();
    }
}

class RayTool {
    constructor() {
        this.toolName = 'ray';
        this.maxStatus = 2;
        this.goal = "ray";
        this.goalType = "line";
        this.define = "twoPoints";
        this.drawType = "ray";
        
        this.lineMode = new PointBaseToolTemplate(
            this.toolName,
            this.maxStatus,
            this.goal,
            this.goalType,
            this.define,
            this.drawType
            );
    }
    
    /**
     * 射线工具
     * @param {string} type
     * @param {number} oriX 原x坐标
     * @param {number} oriY 原y坐标
     */
    toolEvent(type, oriX, oriY) {
        this.lineMode.toolEvent(type, oriX, oriY);
    }
    
    /**
     * 清空
     */
    clear() {
        this.lineMode.clear();
    }
}

class LineSegmentTool {
    constructor() {
        this.toolName = 'lineSegment';
        this.maxStatus = 2;
        this.goal = "lineSegment";
        this.goalType = "line";
        this.define = "twoPoints";
        this.drawType = "lineSegment";
        
        this.lineMode = new PointBaseToolTemplate(
            this.toolName,
            this.maxStatus,
            this.goal,
            this.goalType,
            this.define,
            this.drawType,
            );
    }
    
    /**
     * 线段工具
     * @param {string} type
     * @param {number} oriX 原x坐标
     * @param {number} oriY 原y坐标
     */
    toolEvent(type, oriX, oriY) {
        this.lineMode.toolEvent(type, oriX, oriY);
    }
    
    /**
     * 清空
     */
    clear() {
        this.lineMode.clear();
    }
}

class LineTypeTool {
    constructor() {
        this.toolName = 'lineType';
    }

    /**
     * 切换线类型 过程函数
     * 点一下画布上的直线 / 射线 / 线段，就把它的类型换成下一种（直线 → 射线 → 线段 → 直线）。
     * （三个线工具里各有一份死代码，已合并到这里）
     * @param {string} type
     * @param {number} oriX 原x坐标
     * @param {number} oriY 原y坐标
     */
    toolEvent(type, oriX, oriY) {
        if (type !== "click") return;
        const x = (oriX - transform.x) / transform.scale;
        const y = (oriY - transform.y) / transform.scale;
        // 点 / 线 / 圆放在一起比距离：光标压在点（比如交点）上时就不该去换它下面那条线的类型
        //（以前这里只取线，于是在交点上点一下会把 s1 的线型换掉）
        const [id] = geometryManager.near([x, y], ['point', 'line', 'circle']);
        if (!id) return;
        const line = geometryManager.get(id);
        // 只处理线：点和圆不是这一档的对象（取到了就什么也不做，不再顺延到别的线上）
        if (!line || line.getType() !== 'line') return;
        // 只有「两点定的直线 / 射线 / 线段」能换类型：垂线、平行线、角平分线、定值角
        // 这些构造出来的线换了类型没有意义
        if (line.getBase()?.type !== 'twoPoints') return;
        // 网格当作一整块：格线始终是线段，不给换线型
        if (typeof window.isGridObjectId === 'function' && window.isGridObjectId(line.getId())) return;
        const order = ['line', 'ray', 'lineSegment'];
        const index = order.indexOf(line.getDrawType());
        line.modifyDrawType(order[(index + 1) % order.length]);
        // 触发存储事件：换类型可以撤销
        const event = new CustomEvent("storage", {
            detail: {
                type: "lineType",
            },
        });
        window.dispatchEvent(event);
    }

    /**
     * 清空
     */
    clear() {
        geometryManager.deleteTool(this.toolName);
    }
}

class CircleTool {
    constructor() {
        this.toolName = 'circle';
        this.maxStatus = 2;
        this.goal = "circle";
        this.goalType = "circle";
        this.define = "twoPoints";
        
        this.circleMode = new PointBaseToolTemplate(
            this.toolName,
            this.maxStatus,
            this.goal,
            this.goalType,
            this.define
            );
    }
    
    /**
     * 圆工具
     * @param {string} type
     * @param {number} oriX 原x坐标
     * @param {number} oriY 原y坐标
     */
    toolEvent(type, oriX, oriY) {
        this.circleMode.toolEvent(type, oriX, oriY);
    }
    
    /**
     * 清空
     */
    clear() {
        this.circleMode.clear();
    }
}

/**
 * 这个位置是不是已经有点了 过程函数
 * 交点工具的快捷路径（点交叉处直接取交点）与「选两个图形」两条路都调它：
 * 相交处已经有点时（不论那是交点、线上点、中点还是给定的自由点）都不再重复造一个交点。
 * **隐藏的点不算**：与线 / 圆的去重（findSameElement）口径一致 —— 那个位置只剩隐藏的点时，
 * 交点照旧能作出来（隐藏＝不显示、不挡着新图形落在同一个位置；可见性变化不影响这里之外的编号逻辑）。
 * 写成模块级函数而不是类方法：createIntersection 是作为回调传给模板的（未绑定），里面的 this 是模板
 * @param {number} x 逻辑 x
 * @param {number} y 逻辑 y
 * @returns {boolean}
 */
function hasPointAtPosition(x, y) {
    return geometryManager.getAllByOrder().some(item => {
        if (item.getType() !== 'point') return false;
        if (!item.getVisible()) return false;
        const coord = item.getCoordinate?.();
        if (!coord) return false;
        return Math.hypot(coord[0] - x, coord[1] - y) < 1e-6;
    });
}

/**
 * 同一个位置上的点 过程函数
 * 与 hasPointAtPosition 的区别：要把那个点本身拿出来 —— 导出 gmt 时
 * `Intersect[图形1,图形2,x,已知点]` 的第四个参数要用它的 id 指代
 * @param {number} x 逻辑 x
 * @param {number} y 逻辑 y
 * @returns {Object|null}
 */
function pointAtPosition(x, y) {
    return geometryManager.getAllByOrder().find(item => {
        if (item.getType() !== 'point') return false;
        const coord = item.getCoordinate?.();
        if (!coord) return false;
        return Math.hypot(coord[0] - x, coord[1] - y) < 1e-6;
    }) || null;
}

/**
 * 是不是游玩页（关卡游玩 / 试玩） 过程函数
 * 这两页里「隐藏」是**关卡自己的语义**（隐藏的给定图形、图形自己的内部定义点…），
 * 不是玩家随手藏起来的东西。
 * 判据用游玩页独有的 isGivenObject / isProtectedElement（显示规则与可删性都按关卡来，
 * 画板 / 制题器 / 求解器没有这两个）—— 没有全局 mode 可用：那几页的 mode 只在各自闭包里
 * @returns {boolean}
 */
function isPlayMode() {
    return typeof window.isGivenObject === 'function' || typeof window.isProtectedElement === 'function';
}

/**
 * 「顺手」作出的东西 常量
 * 非点 / 交点工具取点时，会把光标下的隐藏交点显示出来（revealed），或者现作一个交点（created）——
 * 这些都不是用户要的「这一笔」，而是寄生在当前这一步作图里的副产品：
 *   · 这一步画完了：它们已经随快照并进那一格历史（见 index.js / playPage 的 storage），忘掉即可；
 *   · 这一步被撤销（半成品撤销，见 cancelPendingToolDraw）：它们必须原样退回去，
 *     否则会留下一个撤不掉的点（它没有自己的历史格）
 */
const incidentalDrawEffects = [];
/**
 * 记一笔「顺手」的效果 过程函数
 * @param {{kind: 'created'|'revealed', id: string}} effect
 */
function rememberIncidentalDrawEffect(effect) {
    if (effect && effect.id) incidentalDrawEffects.push(effect);
}
/**
 * 这一步作图画完了：效果已进历史，忘掉它们 过程函数（不回收对象）
 */
window.clearIncidentalDrawEffects = () => {
    incidentalDrawEffects.length = 0;
};
/**
 * 半成品被撤销：把「顺手」的效果退回去 过程函数
 * 现作出来的交点删掉，顺手显示出来的交点重新藏起来（连带同步「隐藏」集合）
 * @returns {boolean} 是否确实退回了什么
 */
window.revertIncidentalDrawEffects = () => {
    if (!incidentalDrawEffects.length) return false;
    // 后进先出：先作出来的点在后作出来的点下面，倒着退更稳（删对象会连带它的子对象）
    [...incidentalDrawEffects].reverse().forEach(effect => {
        const object = geometryManager.get(effect.id);
        if (!object) return;
        if (effect.kind === 'created') {
            geometryManager.deleteObject(effect.id);
            return;
        }
        if (typeof object.modifyVisible === 'function' && object.getVisible()) {
            object.modifyVisible(false);
            if (typeof geometryElementLists !== 'undefined' && geometryElementLists.hidden) {
                geometryElementLists.hidden.add(effect.id);
            }
        }
    });
    incidentalDrawEffects.length = 0;
    return true;
};

/**
 * 让一个点显示出来 过程函数
 * 隐藏的点对象（图形的定义点常常是隐藏的）在画布上看不见、也进不了 near 的吸附范围 ——
 * 点工具点上去时就该把它显示出来，而不是什么也不做
 * 除了对象自身的可见性，还要同步「隐藏」标记集合：元素一览的隐藏档位、导出 gmt 的 hidden= 行都读它
 * @param {Object} point 点对象
 * @param {boolean} [ownStep] 这一下点击本身就是「在这儿放一个点」（点工具 / 交点工具）：
 *        那么显示出来这件事要自己占一格历史；其它工具取点时顺手显示的点，
 *        跟着它那一步作图一起撤回（所以这时不发存储事件）
 * @returns {boolean} 是不是真的从隐藏变成了可见
 */
function revealHiddenPoint(point, ownStep = false) {
    if (!point || typeof point.getVisible !== 'function' || point.getVisible()) return false;
    // 游玩模式里不翻出隐藏点：关卡把某些点藏起来有它自己的用意（给定里的隐藏对象、图形的内部
    // 定义点…），点一下就显示会和关卡那套隐藏规则打架 —— 显示出来又被收回去，看着像「点了没反应」。
    // 这里直接返回 false，调用方会按普通取点往下走：照常作出一个新点（见 PointTool.createPoint）
    if (isPlayMode()) return false;
    if (typeof point.modifyVisible === 'function') point.modifyVisible(true);
    if (typeof geometryElementLists !== 'undefined' && geometryElementLists.hidden) {
        geometryElementLists.hidden.delete(point.getId());
    }
    // 「在这儿放一个点」的那一路上，显示出来自己占一格历史：否则这个点会并进**下一个动作**的
    // 快照里，撤回那个动作时把它一起撤掉
    if (ownStep) {
        if (typeof notifyStorageChange === 'function') notifyStorageChange('point');
    }else{
        // 别人顺手显示的点：记一笔，这一步被撤销时要重新藏回去（见 revertIncidentalDrawEffects）
        rememberIncidentalDrawEffect({kind: 'revealed', id: point.getId()});
    }
    return true;
}

/**
 * 这个 id 是不是网格自己的对象 过程函数
 * 网格是一整套作图对象（辅助点、格线、以及滚出来的圆与垂线）：它不能被单独标记，
 * 也不能被「点击显示隐藏交点」这条规则点出来（那些辅助点是小点径黑点，露出来只是噪声）
 * @param {string} id
 * @returns {boolean}
 */
function isGridOwnedId(id) {
    return !!id && typeof window.isGridObjectId === 'function' && window.isGridObjectId(id);
}

/**
 * 光标附近的隐藏点 过程函数
 * near 只看可见对象（隐藏的定义点它看不见），所以这里自己扫一遍：吸附范围内取最近的一个
 * @param {number} x 逻辑坐标
 * @param {number} y 逻辑坐标
 * @returns {Object|null}
 */
function nearestHiddenPoint(x, y) {
    const scale = (typeof transform !== 'undefined' && transform.scale) || 1;
    const limit = 15 / scale;
    let best = null;
    geometryManager.getAllByOrder().forEach(item => {
        if (item.getType() !== 'point' || item.getVisible()) return;
        // 网格自己的辅助点（生成网格时滚出来的那些小点径黑点）不算：点出来只是噪声（见 #4）
        if (isGridOwnedId(item.getId())) return;
        if (typeof item.getValid === 'function' && !item.getValid()) return;
        const coord = item.getCoordinate?.();
        if (!coord) return;
        const distance = Math.hypot(coord[0] - x, coord[1] - y);
        if (distance > limit) return;
        if (!best || distance < best.distance) best = {point: item, distance: distance};
    });
    return best ? best.point : null;
}

/**
 * 把某个位置上的「隐藏交点」显示出来 过程函数（逻辑坐标）
 * 点工具、交点工具、以及别的工具取点时「顺手点的点」都走这里：
 *   · 那个位置上**已经有点对象**（多半是图形的定义点、而且隐藏着）→ 直接让它可见，不再叠一个；
 *   · 还没有 → 作出这个交点并登记它所在的两个图形（拖动时跟着交点走，与交点工具口径一致）。
 * 落库用 addObject 且**不发 storage 事件**：于是这一下寄生在当前这一步作图里 ——
 * 不会多出一格撤销历史、也不额外计 L / E（点 / 交点本来就是 0L 0E）。
 * @param {number} x 逻辑坐标
 * @param {number} y 逻辑坐标
 * @returns {boolean} 这一下是否显示（或作出了）一个交点
 */
function revealHiddenIntersection(x, y, ownStep = false) {
    const snap = geometryManager.nearestIntersection(x, y);
    // 网格自己的交点（就是格点）不参与：交点在格线上时，点出来的会是生成网格用的辅助点
    // （小点径黑点，见 #4）。真实图形的交点照旧
    if (!snap || isGridOwnedId(snap.element1 && snap.element1.getId())
        || isGridOwnedId(snap.element2 && snap.element2.getId())) return false;
    const existing = pointAtPosition(snap.x, snap.y);
    if (existing) {
        // 这个位置上已经有点（多半是隐藏的定义点）：能显示出来才算这一下有用
        // （游玩模式里不翻隐藏点，这里就会返回 false，工具照常自己作点）
        return revealHiddenPoint(existing, ownStep);
    }
    // 这个位置上没点，但画布上已经有**别的点**落在吸附范围内时不要再造 —— 玩家这一下很可能就是
    // 想选那个点（作图工具选已有点、或是想把它拖走），而不是在它旁边多插一个交点。
    // nearestIntersection 找的是「离光标最近的任意两条图形的交点」，不限于点中的那两条：
    // 于是一条经过已有点附近的图形与另一条图形相交时，点已有点会顺手在几像素外造出一个交点
    // （「不仅选中已有点、还在很近的相交位置建了点」）。
    // 交点上原本就有个点对象时也不该造（与点工具那一句同一口径，见 PointTool.createPoint）：
    // 那个位置在 gmt 的编号规则里就是「已知交点」，硬建出来的点还会落到另一个候选上。
    // 隐藏点算不算「已有」？算 —— pointAtPosition 不看可见性，这里的口径跟它保持一致：
    // 上面能显示就显示，显示不出来（游玩模式）也不叠一个重合的新点。
    //
    // **只在触屏上认这一条**（见 canvas.js 的 pointerIsTouch）：手指落点粗，十几像素外的
    // 已有点很可能就是玩家想选的那个；鼠标精确得多，光标压在相交处就是想在那儿作交点，
    // 旁边有点也不该挡掉它（预览那边 board-tools.js 的 landingPickOf 用同一条件，两边始终一致）
    if (typeof pointerIsTouch === 'function' && pointerIsTouch()
        && geometryManager.near([x, y], ["point"], 1).length) return false;
    const point = geometryManager.createPoint(snap.x, snap.y);
    applyIntersectionBase(point, snap);
    snap.element1.addSuperstructure(point);
    snap.element2.addSuperstructure(point);
    geometryManager.addObject(point);
    // 同 revealHiddenPoint：只有「这一下本来就是放个点」才自己占一格历史，
    // 其它工具顺手作出的交点跟着它那一步作图一起撤回（见 #「顺手造的交点」）
    if (ownStep) {
        if (typeof notifyStorageChange === 'function') notifyStorageChange('point');
    }else{
        // 顺手作出的交点：记一笔，这一步被撤销时把它删掉（见 revertIncidentalDrawEffects）
        rememberIncidentalDrawEffect({kind: 'created', id: point.getId()});
    }
    return true;
}

/**
 * 点击时先把光标下的隐藏交点显示出来 过程函数（画布坐标）
 * 在工具处理这次点击**之前**调用：工具随后取点时会直接引用这个点（quote），不会再叠一个重合的点；
 * 非点工具 / 交点工具也照常往下走它们自己的这一步。移动 / 橡皮 / 样式刷 / 线型不取点，不参与
 * @param {number} oriX 画布坐标
 * @param {number} oriY 画布坐标
 * @returns {boolean}
 */
function revealHiddenIntersectionAtClick(oriX, oriY) {
    if (typeof tool !== 'string' || typeof transform === 'undefined') return false;
    if (tool === 'move' || tool === 'eraser' || tool === 'styleBrush' || tool === 'lineType') return false;
    // 点工具 / 交点工具这一下本来就是「在这儿放个点」：显示 / 作出的点自己占一格历史。
    // 其它工具（直线、圆、构造类…）随后会完成自己那一步，那个点跟着那一步一起撤回
    const ownStep = tool === 'point' || tool === 'intersection';
    return revealHiddenIntersection((oriX - transform.x) / transform.scale,
        (oriY - transform.y) / transform.scale, ownStep);
}

/**
 * 图形的定义点 过程函数
 * 「定义点」＝画这个图形时点出来的那些点：`Circle[A,B]` 是 A、B，`Line[D,C]` 是 D、C，
 * 基底里是图形时（垂线、复制圆…）不再往里找 —— 与 `ToolsFunction.definingPointCoordinate` 的口径一致，
 * 只认这一层「这个图形是用哪些点作出来的」
 * @param {Object[]} elements
 * @returns {Set<string>} 这些点自己的 id
 */
function definingPointIds(elements) {
    const ids = new Set();
    for (const element of elements) {
        const base = element && typeof element.getBase === 'function' ? element.getBase() : null;
        const figure = base && Array.isArray(base.figure) ? base.figure : [];
        for (const item of figure) {
            if (item && typeof item.getType === 'function' && item.getType() === 'point') ids.add(item.getId());
        }
    }
    return ids;
}

/**
 * 这一对图形上的「已知交点」 过程函数
 * 某个候选位置上有个**定义点**时（如 `Circle[A,B]` 的半径端点 B 本身就是两圆的公共点、
 * 或者直线就是过那个点作出来的），那个点就是已知交点：记到 define.exclude 上，
 * **另一个交点因此有了固定身份** —— 拖动时不会滑到已知点上，导出 gmt 时也会写成
 * `Intersect[图形1,图形2,-,已知点]`（如「圆 AB 上有 C、直线 DC」时 C 就是这个点）。
 * 只有「画图形时就用到的点」（见 definingPointIds）才算：**用交点工具后来标出来的那个交点不算** ——
 * 标记一对图形的两个交点时，第二个不会把第一个记成已知交点（否则导出 gmt 会写成
 * `Intersect[图形1,图形2,-,刚标出来的交点]`，指代的是自己作出来的点，不是题面的已知条件）。
 * 两个候选上都有定义点时不写（例如圆与圆的公共半径端点，写了指代不清）
 * @param {Object[]} candidates 候选交点
 * @param {Object} element1
 * @param {Object} element2
 * @returns {Object|null}
 */
function knownIntersectionPoint(candidates, element1, element2) {
    // 线与线只有一个候选，没有「另一个交点」可言，不写第四个参数
    if (!candidates || candidates.length < 2) return null;
    const defining = definingPointIds([element1, element2]);
    const found = candidates.map(candidate => pointAtPosition(candidate.x, candidate.y))
        .filter(point => !!point && defining.has(point.getId()));
    return found.length === 1 ? found[0] : null;
}

/**
 * 给「吸附到交点上造出来的点」定基底 过程函数
 * 点工具、以及各作图模板里「光标吸附到交点就顺手造一个交点」的地方都走它，与交点工具口径一致：
 * 另一个候选位置上是**图形的定义点**时（见 knownIntersectionPoint），那个点记成已知交点（define.exclude），
 * 于是这个交点有了固定身份（拖动时不会滑到那个点上），导出 gmt 写成 Intersect[图形1,图形2,-,已知点]
 * @param {Object} point 要落基底的点对象
 * @param {{x: number, y: number, element1: Object, element2: Object, index: number}} snap
 *        交点的位置与所在的两个图形（点工具来自 nearestIntersection，模板里是自己算的）
 */
function applyIntersectionBase(point, snap) {
    const candidates = ToolsFunction.intersectionCandidates(snap.element1, snap.element2);
    const known = knownIntersectionPoint(candidates, snap.element1, snap.element2);
    const numbering = candidatesWithoutKnown(candidates, known);
    point.modifyBase("intersection", [snap.element1, snap.element2], candidateIndexOf(numbering, snap, snap.index), known);
}

/**
 * 排除已知交点之后的候选表 过程函数
 * 与 updateIntersectionCoordinate 的编号口径一致：编号是在**排除已知点之后**的表里数的
 * @param {Object[]} candidates
 * @param {Object|null} known
 * @returns {Object[]}
 */
function candidatesWithoutKnown(candidates, known) {
    if (!known || typeof known.getCoordinate !== 'function') return candidates;
    const coord = known.getCoordinate();
    if (!Array.isArray(coord) || typeof coord[0] !== 'number') return candidates;
    const rest = candidates.filter(candidate => Math.hypot(candidate.x - coord[0], candidate.y - coord[1]) > 1e-6);
    return rest.length ? rest : candidates;
}

/**
 * 候选在某张表里的编号 过程函数
 * @param {Object[]} list 编号用的表（已排除已知点的）
 * @param {{x: number, y: number}} target
 * @param {number} fallback 表里找不到时用原来的编号
 * @returns {number}
 */
function candidateIndexOf(list, target, fallback) {
    const index = list.findIndex(candidate => Math.hypot(candidate.x - target.x, candidate.y - target.y) < 1e-6);
    return index >= 0 ? index : fallback;
}

class IntersectionTool {
    constructor() {
        this.toolName = 'intersection';
        this.maxStatus = 2;
        this.exceptPointList = ["line", "circle"];
        
        this.intersectionMode = new ExceptPointBaseToolTemplate(
            this.toolName,
            this.maxStatus,
            this.exceptPointList,
            this.createIntersection
            );
    }
    
    /**
     * 交点工具
     * @param {string} type
     * @param {number} oriX 原x坐标
     * @param {number} oriY 原y坐标
     */
    toolEvent(type, oriX, oriY) {
        // 直接点在「两个图形相交的位置」上时，不必先选两个图形：就地作出这个交点
        // （euclidea 的手感：交点工具点交叉处＝取这个交点）。否则点一下只会选中其中一个图形。
        // 但**已经选了第一个图形（choice1）时不能走这条捷径**：那一下就是在选第二个图形，
        // 走了捷径就只标出光标下最近的那一个，另一半交点永远标不出来（见 createIntersection）
        const pending = geometryManager.ifToolInCache(this.toolName);
        if (type === "click" && !pending && this.createIntersectionAtCursor(oriX, oriY)) return;
        this.intersectionMode.toolEvent(type, oriX, oriY);
    }
    
    /**
     * 光标正落在某个交点上时直接作出它 过程函数
     * @param {number} oriX 画布坐标
     * @param {number} oriY 画布坐标
     * @returns {boolean} 是否作出了交点
     */
    createIntersectionAtCursor(oriX, oriY) {
        const x = (oriX - transform.x) / transform.scale;
        const y = (oriY - transform.y) / transform.scale;
        const snap = geometryManager.nearestIntersection(x, y);
        if (!snap) return false;
        // 这一次点击就是「要这个交点」，先把选了一半的对象丢掉
        geometryManager.deleteTool(this.toolName);
        // 这个位置已经有点了（交点 / 线上点 / 给定点都算）就不再重复作
        //（这一下点击仍然算数，不改选中状态）
        if (hasPointAtPosition(snap.x, snap.y)) return true;
        const point = geometryManager.createPoint(snap.x, snap.y);
        // 基底走统一入口：另一个候选上已经有点时（如圆上已有 C、直线过 C）自动记成已知交点，
        // 这个交点于是有自己的身份（不会滑到 C 上），导出时写成 Intersect[图形1,图形2,-,C]
        applyIntersectionBase(point, snap);
        snap.element1.addSuperstructure(point);
        snap.element2.addSuperstructure(point);
        geometryManager.addToolObject(this.toolName, "intersection", "append", point);
        geometryManager.loadTool(this.toolName);
        // 触发存储事件
        const event = new CustomEvent("storage", {
            detail: {
                type: this.toolName,
            },
        });
        window.dispatchEvent(event);
        return true;
    }
    
    /**
     * 创建交点 过程函数
     * 选完两个图形就把范围内存在的交点一次全部标出，所以用不到点击位置（模板仍会传进来，忽略即可）
     */
    createIntersection() {
        const element1 = geometryManager.getToolKey(this.toolName, "choice1");
        const element2 = geometryManager.getToolKey(this.toolName, "choice2");
        // 无论作不作出交点，这两下点击都算用完：缓存必须清掉，
        // 否则点了两个不相交的图形会一直卡在「两个都选中」的状态
        const clearChoice = () => geometryManager.deleteTool(this.toolName);
        // 这一次没标出任何交点（两图形不相交 / 候选交点全在线段、射线的范围之外 /
        // 相交处已经有别的点了）：与「图形画布上已经有了」同样处理 —— 置位这个标记，
        // storage 监听会跳过撤销历史（游玩模式也不记步数，L / E 不变）。
        // 模板在 create() 之后一定会发 storage 事件（见 ExceptPointBaseToolTemplate.click / check），
        // 标记随即被 takeDuplicatedFlag() 取走，不会留到下一次作图
        const markNothingCreated = () => { geometryManager.duplicatedFlag = true; };
        if (!element1 || !element2) { clearChoice(); markNothingCreated(); return; }
        
        // 全部候选交点（编号与 gmt 的 Intersect[对象1,对象2,x] 一致）
        const candidates = ToolsFunction.intersectionCandidates(element1, element2);
        // 只保留落在有效范围内的交点：线段、射线之外的不算交点
        const valid = candidates.filter(item =>
            ToolsFunction.pointInElementRange(item.x, item.y, element1) &&
            ToolsFunction.pointInElementRange(item.x, item.y, element2));
        if (!valid.length) { clearChoice(); markNothingCreated(); return; }
        
        // 圆 × 线 / 圆 × 圆 最多有 2 个交点：选完两个图形就一次把范围内存在的交点都标出来。
        // 编号一定要用候选在**原始候选表**里的位置（item.index），不能重新数「范围内第几个」：
        // 线段 / 射线缩短使某个候选跑到范围外时，它在原始表里仍占着自己的编号，这里写 0 的话
        // 这个点就换到另一个交点上去了。用 item.index 也与「点交叉处直接取交点」那条捷径一致
        //（nearestIntersection 返回的同样是 candidate.index，范围过滤只决定能不能取、不重编号）
        const targets = valid;
        
        let created = 0;
        targets.forEach(item => {
            // 这个位置已经有点了（交点 / 线上点 / 中点 / 给定点都算）就不再重复作
            if (hasPointAtPosition(item.x, item.y)) return;
            const point = geometryManager.createPoint(item.x, item.y);
            // 基底走统一入口：候选位置上已经有别的点（给定点 / 圆上的点 / 别的交点…）时
            // 自动记成已知交点 —— 造出来的是「另一个交点」，身份因此固定、导出写成 `-,已知点`
            applyIntersectionBase(point, {x: item.x, y: item.y, element1: element1, element2: element2, index: item.index});
            element1.addSuperstructure(point);
            element2.addSuperstructure(point);
            // 直接落到画布，不走工具缓存：一次要造两个交点时，
            // 缓存里同一个 id / 提交逻辑只会留下最后一个（实测无论换不换键都只出一个）
            geometryManager.addObject(point);
            created += 1;
        });
        // 所有候选处都已经有点了：同样不该占一格历史
        if (!created) markNothingCreated();
        // 选中缓存（choice1 / choice2）清掉，与走完一次作图后的状态一致
        geometryManager.deleteTool(this.toolName);
    }
    
    /**
     * 清空
     */
    clear() {
        this.intersectionMode.clear();
    }
}

class StyleBrushTool {
    constructor() {
        this.toolName = 'styleBrush';
        // 样式来源（首次点中的图形）：它的颜色 / 粗细 / 标签显示会被复制到之后点到的图形上
        this.sourceId = null;
    }

    /**
     * 样式刷 过程函数
     * @param {string} type
     * @param {number} oriX 原x坐标
     * @param {number} oriY 原y坐标
     */
    toolEvent(type, oriX, oriY) {
        if (type !== "click") return;
        const x = (oriX - transform.x) / transform.scale;
        const y = (oriY - transform.y) / transform.scale;
        // 浮动栏里切到「隐藏刷」时隐藏对象，其余情况复制样式
        if (typeof subTool !== 'undefined' && subTool === 'brushHidden') {
            this.hideEventFunction(x, y);
            return;
        }
        this.clickEventFunctionStyleBrush(x, y);
    }

    /**
     * 隐藏刷 过程函数
     * 点到的图形直接隐藏：隐藏后不再绘制（canvas.js 的绘制循环都跳过不可见对象），
     * 也点不到它（near 会跳过不可见对象）。要恢复可以撤销，或到「元素一览 → 隐藏」档里找
     * @param {number} x
     * @param {number} y
     */
    hideEventFunction(x, y) {
        const [id] = geometryManager.near([x, y], ["point", "line", "circle"]);
        if (!id) return;
        // 网格当作一整块：隐藏刷刷不动它
        if (typeof window.isGridObjectId === 'function' && window.isGridObjectId(id)) return;
        const item = geometryManager.get(id);
        if (!item || !item.getVisible()) return;
        item.modifyVisible(false);
        // 与元素一览的「隐藏」档保持同步：撤销 / 导出 / 存读档都认这个集合
        if (typeof geometryElementLists !== 'undefined' && geometryElementLists.hidden) geometryElementLists.hidden.add(id);
        // 不留选中项：对象已经藏起来了，浮动栏的「清空选择」也就不该亮（此时并没有选中什么）
        geometryManager.deleteTool(this.toolName);
        this.notifyStorage();
    }

    /**
     * 点击 过程函数
     * 第一次点中的图形当样式来源；之后点到的图形把来源的样式复制过去，选中状态挪到它身上；
     * 再点一次来源就取消选中（切换工具也会清掉，见 tool.js 的 clearPendingToolChoice）
     * @param {number} x
     * @param {number} y
     */
    clickEventFunctionStyleBrush(x, y) {
        const [id] = geometryManager.near([x, y], ["point", "line", "circle"]);
        // 点在空白处不算数：只有切换工具 / 再点来源才取消选中
        if (!id) return;
        // 网格当作一整块：既不能当样式来源，也不能被样式刷刷
        if (typeof window.isGridObjectId === 'function' && window.isGridObjectId(id)) return;
        // 来源被删掉了（撤销 / 删除对象）：这一步点的对象就当作新来源
        if (this.sourceId && !geometryManager.get(this.sourceId)) this.sourceId = null;
        if (id === this.sourceId) {
            this.clear();
            this.notifyStorage();
            return;
        }
        if (this.sourceId) {
            this.applyStyleTo(id);
            // 目标用另一个键：这样「样式来源」的选中标记不会被顶掉，来源与目标一起高亮
            geometryManager.addToolObject(this.toolName, "choice", "quote", id);
        } else {
            this.sourceId = id;
            geometryManager.addToolObject(this.toolName, "source", "quote", id);
        }
        this.notifyStorage();
    }

    /**
     * 把来源图形的样式复制到目标图形 过程函数
     * @param {string} id 目标图形
     */
    applyStyleTo(id) {
        const source = geometryManager.get(this.sourceId);
        const target = geometryManager.get(id);
        if (!source || !target) return;
        // 来源要是「给定 / 可移动点 / 所求」这类被标记的图形（画布上是黑 / 金、标签由标记决定），
        // getColor() / getShowName() 给的是**标记显示值**，照抄就把黑色刷到目标上了。
        // 标记之前的原样式由 boardGmt.ownStyleOf 记着（见 board-tools.js 的 markedStyles），
        // 它在对象没被标记时返回 null，那时照旧读对象本身
        const own = typeof window.boardGmt?.ownStyleOf === 'function'
            ? window.boardGmt.ownStyleOf(this.sourceId) : null;
        target.modifyColor(own ? own.color : source.getColor());
        target.modifyWidth(source.getWidth());
        target.modifyShowName(own ? own.showName : source.getShowName());
        // 虚线（线 / 圆的样式）一并复制；点没有虚线，复制过去就是关闭
        target.modifyDashed(source.getDashed());
    }

    /**
     * 记一步撤销 / 重做历史 过程函数
     * 选来源、每刷一次样式、取消选中各算一步：可以一次次撤回，
     * 连「选中来源」那一步也能撤回（撤销会重建对象并清掉工具缓存，选中状态随之消失）
     */
    notifyStorage() {
        if (typeof notifyStorageChange === 'function') {
            notifyStorageChange('style');
            return;
        }
        window.dispatchEvent(new CustomEvent("storage", {detail: {type: "style"}}));
    }

    /**
     * 清除
     */
    clear() {
        geometryManager.deleteTool(this.toolName);
        this.sourceId = null;
    }
}
