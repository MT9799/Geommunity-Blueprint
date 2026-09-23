/* constructToolBag.js */

class ParallelConstructTool {
    constructor() {
        this.toolName = "parallelLine";
        this.goal = "parallelLine";
        this.goalType = "line";
        this.define = "parallel";
        this.exceptPoint = "line";
        
        this.parallelMode = new MixPointBaseToolTemplate(
            this.toolName,
            this.goal,
            this.goalType,
            this.define,
            this.exceptPoint
            );
    }
    
    /**
     * 平行线工具
     * @param {string} type
     * @param {number} oriX 原x坐标
     * @param {number} oriY 原y坐标
     */
    toolEvent(type, oriX, oriY) {
        this.parallelMode.toolEvent(type, oriX, oriY);
    }
    
    /**
     * 清空
     */
    clear() {
        this.parallelMode.clear();
    }
}

class PerpendicularConstructTool {
    constructor() {
        this.toolName = "perpendicularLine";
        this.goal = "perpendicularLine";
        this.goalType = "line";
        this.define = "perpendicular";
        this.exceptPoint = "line";
        
        this.perpendicularMode = new MixPointBaseToolTemplate(
            this.toolName,
            this.goal,
            this.goalType,
            this.define,
            this.exceptPoint
            );
    }
    
    /**
     * 垂线工具
     * @param {string} type
     * @param {number} oriX 原x坐标
     * @param {number} oriY 原y坐标
     */
    toolEvent(type, oriX, oriY) {
        this.perpendicularMode.toolEvent(type, oriX, oriY);
    }
    
    /**
     * 清空
     */
    clear() {
        this.perpendicularMode.clear();
    }
}

class PerpendicularBisectorConstructTool {
    constructor() {
        this.toolName = 'perpendicularBisector';
        this.maxStatus = 2;
        this.goal = "perpendicularBisector";
        this.goalType = "line";
        this.define = "perpendicularBisector";
        
        this.perpendicularBisectorMode = new PointBaseToolTemplate(
            this.toolName,
            this.maxStatus,
            this.goal,
            this.goalType,
            this.define
            );
    }
    
    /**
     * 垂直平分线工具
     * @param {string} type
     * @param {number} oriX 原x坐标
     * @param {number} oriY 原y坐标
     */
    toolEvent(type, oriX, oriY) {
        this.perpendicularBisectorMode.toolEvent(type, oriX, oriY);
    }
    
    /**
     * 清空
     */
    clear() {
        this.perpendicularBisectorMode.clear();
    }
}

class MiddlePointConstructTool {
    constructor() {
        this.cacheFlag = false;
        
        this.toolName = 'middlePoint';
        this.maxStatus = 2;
        this.goal = "middlePoint";
        this.goalType = "point";
        this.define = "middlePoint";
        
        this.middlePointMode = new PointBaseToolTemplate(
            this.toolName,
            this.maxStatus,
            this.goal,
            this.goalType,
            this.define
            );
    }
    
    /**
     * 中点工具
     * @param {string} type
     * @param {number} oriX 原x坐标
     * @param {number} oriY 原y坐标
     */
    toolEvent(type, oriX, oriY) {
        if (subTool === 'twoPointsMiddlePoint') {
            this.middlePointMode.toolEvent(type, oriX, oriY);
        }else if (subTool === 'circleCenter') {
            this.centerToolEvent(type, oriX, oriY);
        }
    }
    
    /**
     * 圆心工具
     * @param {string} type
     * @param {number} oriX 原x坐标
     * @param {number} oriY 原y坐标
     */
    centerToolEvent(type, oriX, oriY) {
        const x = (oriX - transform.x) / transform.scale;
        const y = (oriY - transform.y) / transform.scale;
        if (type === "click") {
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
        this.createCenter(x, y);
    }
    
    /**
     * 拖拽
     * @param {number} x
     * @param {number} y
     */
    draw(x, y) {
        if (!this.cacheFlag) {
            const center = geometryManager.createPoint(0, 0);
            center.modifyValid(false);
            geometryManager.addToolObject(this.toolName, 'center', 'append', center);
            geometryManager.addToolObject(this.toolName, 'choicePoint', 'create', [x, y]);
            this.cacheFlag = true;
        }
        this.moveChoicePoint(x, y);
    }
    
    /**
     * 拖拽完成
     */
    drawComplete() {
        this.cacheFlag = false;
        if (geometryManager.ifToolKeyInCache(this.toolName, 'circle')) {
            geometryManager.deleteToolKey(this.toolName, 'choicePoint');
            geometryManager.loadTool(this.toolName);
            // 触发存储事件
            const event = new CustomEvent("storage", {
                detail: {
                    type: 'center',
                },
            });
            window.dispatchEvent(event);
        }else{
            geometryManager.deleteTool(this.toolName);
        }
    }
    
    /**
     * 取消
     */
    cancel() {
        if (this.cacheFlag) {
            geometryManager.deleteTool(this.toolName);
            this.cacheFlag = false;
        }
    }
    
    /**
     * 创建圆心
     */
    createCenter(x, y){
        const [elementId] = geometryManager.near([x, y], ['circle']);
        if (!elementId) return;
        const element = geometryManager.get(elementId);
        if (element) {
            const coordList = element.getCoordinate();
            const [x, y] = coordList[0];
            const center = geometryManager.createPoint(x, y);
            center.modifyBase("center", [element]);
            element.addSuperstructure(center);
            geometryManager.addObject(center);
            // 触发存储事件
            const event = new CustomEvent("storage", {
                detail: {
                    type: 'center',
                },
            });
            window.dispatchEvent(event);
        }
    }

    /**
     * 移动选择点
     */
    moveChoicePoint(x, y) {
        let goalX = x,
            goalY = y;
        
        const exceptPoints = geometryManager.near([x, y], ["circle"]);
        if (exceptPoints.length === 1) {
            const point = geometryManager.getToolKey(this.toolName, 'choicePoint');
            if (point) point.clearBase();
            
            const item = geometryManager.get(exceptPoints[0]);
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
            const center = geometryManager.getToolKey(this.toolName, 'center');
            center.modifyValid(true);
            center.modifyCoordinate(point1Coord[0], point1Coord[1]);
            center.modifyBase("center", [geometryObject]);
            geometryManager.addToolObject(this.toolName, "circle", "quote", exceptPoints[0]);
        }else if (exceptPoints.length === 0) {
            geometryManager.deleteToolKey(this.toolName, "circle");
            const center = geometryManager.getToolKey(this.toolName, 'center');
            if (center) center.modifyValid(false);
            const point = geometryManager.getToolKey(this.toolName, 'choicePoint');
            if (point) point.clearBase();
        }
        
        geometryManager.modifyToolObject(this.toolName, "choicePoint", "create", [goalX, goalY]);
    }
    
    /**
     * 清空
     */
    clear() {
        geometryManager.deleteTool(this.toolName);
        this.cacheFlag = false;
        this.middlePointMode.clear();
    }
}

class ThreePointCircleConstructTool {
    constructor() {
        this.toolName = 'threePointCircle';
        this.maxStatus = 3;
        this.goal = "threePointCircle";
        this.goalType = "circle";
        this.define = "threePointCircle";
        
        this.threePointCircleMode = new PointBaseToolTemplate(
            this.toolName,
            this.maxStatus,
            this.goal,
            this.goalType,
            this.define
            );
    }
    
    /**
     * 三点圆工具
     * @param {string} type
     * @param {number} oriX 原x坐标
     * @param {number} oriY 原y坐标
     */
    toolEvent(type, oriX, oriY) {
        this.threePointCircleMode.toolEvent(type, oriX, oriY);
    }
    
    /**
     * 清空
     */
    clear() {
        this.threePointCircleMode.clear();
    }
}

class AngleBisectorConstructTool {
    constructor() {
        this.toolName = 'angleBisector';
        this.threePointModeMaxStatus = 3;
        this.goal = "angleBisector";
        this.goalType = "line";
        this.define = "threePointAngleBisector";
        
        this.twoLineModeMaxStatus = 2;
        this.exceptPointList = ["line"];
        
        this.threePointAngleBisectorMode = new PointBaseToolTemplate(
            this.toolName,
            this.threePointModeMaxStatus,
            this.goal,
            this.goalType,
            this.define
            );
        
        this.twoLineAngleBisectorMode = new ExceptPointBaseToolTemplate(
            this.toolName,
            this.twoLineModeMaxStatus,
            this.exceptPointList,
            this.createDoubleAngleBisector
            );
        
    }
    
    /**
     * 角平分线工具
     * @param {string} type
     * @param {number} oriX 原x坐标
     * @param {number} oriY 原y坐标
     */
    toolEvent(type, oriX, oriY) {
        if (subTool === 'threePointAngleBisector') {
            this.threePointAngleBisectorMode.toolEvent(type, oriX, oriY);
        }else if (subTool === 'angleBisector') {
            this.twoLineAngleBisectorMode.toolEvent(type, oriX, oriY);
        }
    }
    
    /**
     * 创建内外角平分线
     */
    createDoubleAngleBisector() {
        const line1 = geometryManager.getToolKey(this.toolName, "choice1");
        const line2 = geometryManager.getToolKey(this.toolName, "choice2");
        geometryManager.createGeometryElementInputTool("line", this.toolName, 'angleBisector1');
        geometryManager.createGeometryElementInputTool("line", this.toolName, 'angleBisector2');
        const angleBisector1 = geometryManager.getToolKey(this.toolName, 'angleBisector1');
        angleBisector1.modifyDefine("twoLineAngleBisector", [line1, line2], 0);
        const angleBisector2 = geometryManager.getToolKey(this.toolName, 'angleBisector2');
        angleBisector2.modifyDefine("twoLineAngleBisector", [line1, line2], 1);
        geometryManager.loadTool(this.toolName);
    }
    
    /**
     * 清空
     */
    clear() {
        this.threePointAngleBisectorMode.clear();
        this.twoLineAngleBisectorMode.clear();
    }
}

class CompassConstructTool {
    constructor() {
        this.toolName = 'compass';
        this.threePointModeMaxStatus = 3;
        this.goal = "compass";
        this.goalType = "circle";
        this.define = "compass";
        
        this.copyCompassDefine = "copyCompass";
        this.exceptPoint = "circle";
        
        
        this.threePointCompassMode = new PointBaseToolTemplate(
            this.toolName,
            this.threePointModeMaxStatus,
            this.goal,
            this.goalType,
            this.define
            );
        

        this.copyCompassMode = new MixPointBaseToolTemplate(
            this.toolName,
            this.goal,
            this.goalType,
            this.copyCompassDefine,
            this.exceptPoint
            );
        
    }
    
    /**
     * 圆规工具
     * @param {string} type
     * @param {number} oriX 原x坐标
     * @param {number} oriY 原y坐标
     */
    toolEvent(type, oriX, oriY) {
        if (subTool === 'threePointCompass') {
            this.threePointCompassMode.toolEvent(type, oriX, oriY);
        }else if (subTool === 'compassCopy') {
            this.copyCompassMode.toolEvent(type, oriX, oriY);
        }
    }
    
    /**
     * 清空
     */
    clear() {
        this.threePointCompassMode.clear();
        this.copyCompassMode.clear();
    }
    
}
