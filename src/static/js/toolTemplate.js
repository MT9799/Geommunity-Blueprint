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
            if (geometryManager.ifIdInCache(this.toolName, pointId)) {
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
                this.createLastPoint();
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
                const coord = ToolsFunction.scalePoint(p1, p2, value);
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
        if (pointId) {
            if (geometryManager.ifIdInCache(this.toolName, pointId)) return;
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
    createLastPoint() {
        const [x, y] = this.startCoord;
        geometryManager.addToolObject(this.toolName, `point${this.status + 1}`, "create", [x, y]);
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
                this.createLastPoint();
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
                const coord = ToolsFunction.scalePoint(p1, p2, value);
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
    createLastPoint() {
        const [x, y] = this.startCoord;
        geometryManager.addToolObject(this.toolName, `choicePoint${this.maxStatus}`, 'create', [x, y]);
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
                this.draw2Points();
            }else if (this.status === 'point+' || this.status === '+point') {
                this.createLastPoint();
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
                geometryManager.deleteToolQuote(this.toolName, exceptPointId)
                this.status = 'none';
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
                const coord = ToolsFunction.scalePoint(p1, p2, value);
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
            // 目标点
            this.create();
            if (pointId) {
                // 吸附已有点
                if (geometryManager.ifIdInCache(this.toolName, pointId)) return;
                
                geometryManager.modifyToolObject(this.toolName, "point", "quote", pointId);
                if (this.changedVerify !== "choice") {
                    this.changedVerify = "choice";
                    const point = geometryManager.getToolKey(this.toolName, "point");
                    const exceptPoint = geometryManager.getToolKey(this.toolName, this.exceptPoint);
                    geometryManager.getToolKey(this.toolName, this.goal).modifyDefine(this.define, [point, exceptPoint]);
                }
            }else{
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
                        const coord = ToolsFunction.scalePoint(p1, p2, value);
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
                    const coord = ToolsFunction.scalePoint(p1, p2, value);
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
    createLastPoint() {
        const [x, y] = this.startCoord;
        if (this.status === "point+") {
            geometryManager.addToolObject(this.toolName, "point2", "create", [x, y]);
        }else if (this.status === "+point") {
            geometryManager.addToolObject(this.toolName, "point", "create", [x, y]);
        }
    }
    
    /**
     * 创建2点
     */
    draw2Points() {
        const [x, y] = this.startCoord;
        this.clickPoint(x, y);
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