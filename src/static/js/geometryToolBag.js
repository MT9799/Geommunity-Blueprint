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
     * 点击 过程函数
     * @param {number} x
     * @param {number} y
     */
    clickEventFunctionPoint(x, y) {
        this.createPoint(x, y);
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
        geometryManager.loadTool("point");
        this.cachePointFlag = false;
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
        // 先吸附「离光标最近的那个交点」（附近图形两两求交，见 nearestIntersection）：
        // 不再只看最近的 2 个图形，避免光标下就有交点却取到附近别的图形组合在很远处的交点
        const snap = geometryManager.nearestIntersection(x, y);
        if (snap) {
            const snapPoint = geometryManager.createPoint(snap.x, snap.y);
            snapPoint.modifyBase("intersection", [snap.element1, snap.element2], snap.index);
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
                    pointObject.modifyBase("intersection", [element1, element2], 0);
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
                        pointObject.modifyBase("intersection", [element1, element2], index);
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
                        pointObject.modifyBase("intersection", [element1, element2], index);
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
                        pointObject.modifyBase("intersection", [element1, element2], index);
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
                        pointObject.modifyBase("intersection", [element1, element2], index);
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
                        pointObject.modifyBase("intersection", [element1, element2], index);
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
                        pointObject.modifyBase("intersection", [element1, element2], index);
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
            point.modifyBase("intersection", [snap.element1, snap.element2], snap.index);
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
                        let index = 0;
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
                        let index = 0;
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
                        let index = 0;
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
        if (subTool === 'style') {
            const x = (oriX - transform.x) / transform.scale;
            const y = (oriY - transform.y) / transform.scale;
            if (type === "click") {
                this.modifyLineStyle(x, y);
            }else if (type === "draw") {
                this.modifyLineStyle(x, y);
            }
        }else if (subTool === 'line') {
            this.lineMode.toolEvent(type, oriX, oriY);
        }
    }
    
    /**
     * 修改样式
     */
    modifyLineStyle(x, y) {
        const [id] = geometryManager.near([x, y], ['line']);
        if (!id) return;
        const line = geometryManager.get(id);
        line.modifyDrawType(this.toolName);
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
        if (subTool === 'style') {
            const x = (oriX - transform.x) / transform.scale;
            const y = (oriY - transform.y) / transform.scale;
            if (type === "click") {
                this.modifyLineStyle(x, y);
            }else if (type === "draw") {
                this.modifyLineStyle(x, y);
            }
        }else if (subTool === 'ray') {
            this.lineMode.toolEvent(type, oriX, oriY);
        }
    }
    
    /**
     * 修改样式
     */
    modifyLineStyle(x, y) {
        const [id] = geometryManager.near([x, y], ['line']);
        if (!id) return;
        const line = geometryManager.get(id);
        line.modifyDrawType(this.toolName);
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
        if (subTool === 'style') {
            const x = (oriX - transform.x) / transform.scale;
            const y = (oriY - transform.y) / transform.scale;
            if (type === "click") {
                this.modifyLineStyle(x, y);
            }else if (type === "draw") {
                this.modifyLineStyle(x, y);
            }
        }else if (subTool === 'lineSegment') {
            this.lineMode.toolEvent(type, oriX, oriY);
        }
    }
    
    /**
     * 修改样式
     */
    modifyLineStyle(x, y) {
        const [id] = geometryManager.near([x, y], ['line']);
        if (!id) return;
        const line = geometryManager.get(id);
        line.modifyDrawType(this.toolName);
    }
    
    /**
     * 清空
     */
    clear() {
        this.lineMode.clear();
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
        this.intersectionMode.toolEvent(type, oriX, oriY);
    }
    
    /**
     * 创建交点 过程函数
     * @param {number} [clickX] 选完两个对象时的点击位置（多个交点时用来确定取哪一个）
     * @param {number} [clickY]
     */
    createIntersection(clickX, clickY) {
        const element1 = geometryManager.getToolKey(this.toolName, "choice1");
        const element2 = geometryManager.getToolKey(this.toolName, "choice2");
        
        // 全部候选交点（编号与 gmt 的 Intersect[对象1,对象2,x] 一致）
        const candidates = ToolsFunction.intersectionCandidates(element1, element2);
        // 只保留落在有效范围内的交点：线段、射线之外的不算交点
        const valid = candidates.filter(item =>
            ToolsFunction.pointInElementRange(item.x, item.y, element1) &&
            ToolsFunction.pointInElementRange(item.x, item.y, element2));
        if (!valid.length) return;
        
        // 多个交点时取离点击处最近的那一个，其编号（index）即该交点的身份
        let target = valid[0];
        if (valid.length > 1 && Number.isFinite(clickX) && Number.isFinite(clickY)) {
            let minDistance = Infinity;
            valid.forEach(item => {
                const distance = Math.hypot(item.x - clickX, item.y - clickY);
                if (distance < minDistance) {
                    minDistance = distance;
                    target = item;
                }
            });
        }
        
        const point = geometryManager.createPoint(target.x, target.y);
        point.modifyBase("intersection", [element1, element2], target.index);
        element1.addSuperstructure(point);
        element2.addSuperstructure(point);
        geometryManager.addToolObject(this.toolName, "intersection", "append", point);
        
        geometryManager.loadTool(this.toolName);
    }
    
    /**
     * 清空
     */
    clear() {
        this.intersectionMode.clear();
    }
}
