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

const tangent = 'tangent';
const tangentParallel = 'tangentParallel';
const TANGENT_DEGENERATE_EPSILON = 1e-10;
class TangentConstructTool extends MixPointBaseToolTemplate {
    /**
     * @param {string} toolName
     */
    constructor(toolName) {
        super(toolName, 'tangent', 'line', 'tangent', 'circle');
        // 第二条切线的缓存键：第一条用模板的 goal（'tangent'），第二条另起一个名字
        this.secondTangentKey = 'tangent2';
        this.secondTangentDefine = {
            type: 'tangent',
            basesId: [],
            value: 1,
        };
        // 直线 + 圆：两次都只是「选一个图形」，交给 ExceptPointBaseToolTemplate
        // （模板调 create 时传的是「点在第几个图形上」，所以取图形要自己按 choice1 / choice2 取）
        this.parallelMode = new ExceptPointBaseToolTemplate(
            toolName,
            2,
            ["line", "circle"],
            () => this.createParallelTangents()
        );
    }
    /**
     * 切线工具
     * @param {string} type
     * @param {number} oriX 原x坐标
     * @param {number} oriY 原y坐标
     */
    toolEvent(type, oriX, oriY) {
        // 只有明确选了「平行于直线」才走那个模式：其余（含小项停留在工具名的页面）都是「过点作切线」
        if (subTool === tangentParallel) {
            this.parallelMode.toolEvent(type, oriX, oriY);
        }else{
            super.toolEvent(type, oriX, oriY);
        }
    }
    /**
     * 创建目标图形
     * 覆写模板：造出第一条切线后再补第二条；点在圆内时两条都不作
     */
    create() {
        if (this.completeStatus) return;
        this.completeStatus = true;
        const point = geometryManager.getToolKey(this.toolName, "point");
        const circle = geometryManager.getToolKey(this.toolName, this.exceptPoint);
        // 点在圆内没有切线：这条路径连第一条也不该落下来（不先拦，s1 会以空坐标进缓存）
        if (this.isPointInsideCircle(point, circle)) {
            geometryManager.deleteTool(this.toolName);
            return;
        }
        geometryManager.createGeometryElementInputTool(this.goalType, this.toolName, this.goal);
        const goal = geometryManager.getToolKey(this.toolName, this.goal);
        goal.modifyDefine(this.define, [point, circle]);
        this.createSecondTangent(point, circle, goal);
    }
    /**
     * 点是否严格落在圆内 过程函数
     * 判据是一维的（比的是「点到圆心的距离」与半径），不受两条切线夹角的敏感度影响
     * @param {Object} point 过点
     * @param {Object} circle 切圆
     * @returns {boolean}
     */
    isPointInsideCircle(point, circle) {
        const circleCoord = circle?.getCoordinate?.();
        const pointCoord = point?.getCoordinate?.();
        if (!Array.isArray(circleCoord) || !Array.isArray(pointCoord)) return false;
        const [cx, cy] = circleCoord[0];
        const radius = Math.hypot(circleCoord[1][0] - cx, circleCoord[1][1] - cy);
        const distance = Math.hypot(pointCoord[0] - cx, pointCoord[1] - cy);
        // 留出与判退化同一个量级的容差，别把「正好在圆上」误判成圆内
        return distance < radius - TANGENT_DEGENERATE_EPSILON;
    }
    /**
     * 创建第二条切线 过程函数
     * 与第一条同一次作图、同一个工具名下造出来，一起进缓存、一起 loadTool（于是只占一步、一起可撤销）
     * @param {Object} point 过点（figure[0]）
     * @param {Object} circle 切圆（figure[1]）
     * @param {Object} firstTangent 第一条切线（用来判两条是否重合）
     */
    createSecondTangent(point, circle, firstTangent) {
        geometryManager.createGeometryElementInputTool(this.goalType, this.toolName, this.secondTangentKey);
        const secondTangent = geometryManager.getToolKey(this.toolName, this.secondTangentKey);
        if (!secondTangent) return;
        this.setSecondTangent(secondTangent, point, circle, firstTangent);
    }
    /**
     * 按当前动点 / 切圆重挂第二条切线的定义 过程函数
     * 判退化并丢掉这一条（坐标为空、或与第一条重合）
     * @param {Object} secondTangent 第二条切线
     * @param {Object} point 过点
     * @param {Object} circle 切圆
     * @param {Object} firstTangent 第一条切线
     */
    setSecondTangent(secondTangent, point, circle, firstTangent) {
        // 修改定义时 modifyDefine 自己会更新坐标，具体几何在 ToolsFunction.updateLineCoordinate 的 tangent 分支
        secondTangent.modifyDefine(this.secondTangentDefine.type, [point, circle], this.secondTangentDefine.value);
        if (this.isDegenerateTangent(secondTangent, firstTangent)) {
            geometryManager.deleteToolKey(this.toolName, this.secondTangentKey);
        }
    }
    /**
     * 是不是退化的切线 过程函数
     * 坐标为空（点在圆内，没有切线）或与第一条重合（点在圆上）时为真
     * @param {Object} secondTangent 第二条切线
     * @param {Object} firstTangent 第一条切线
     * @returns {boolean}
     */
    isDegenerateTangent(secondTangent, firstTangent) {
        const coord = secondTangent.getCoordinate();
        if (!Array.isArray(coord) || !Array.isArray(coord[0])) return true;
        const firstCoord = firstTangent.getCoordinate();
        if (!Array.isArray(firstCoord) || !Array.isArray(firstCoord[0])) return false;
        return Math.abs(coord[0][0] - firstCoord[0][0]) < TANGENT_DEGENERATE_EPSILON
            && Math.abs(coord[0][1] - firstCoord[0][1]) < TANGENT_DEGENERATE_EPSILON
            && Math.abs(coord[1][0] - firstCoord[1][0]) < TANGENT_DEGENERATE_EPSILON
            && Math.abs(coord[1][1] - firstCoord[1][1]) < TANGENT_DEGENERATE_EPSILON;
    }
    /**
     * 移动缓存点
     * 模板负责第一条切线（含点 / 切圆还没配齐时先造一个 / 先撤一个的那些情况），
     * 这里补上：第二条切线的定义同步 + 把动点从圆上放回自由位置
     * @param {number} x
     * @param {number} y
     */
    movePoint(x, y) {
        super.movePoint(x, y);
        this.releasePointFromCircle(x, y);
        this.syncSecondTangentDefine();
    }
    /**
     * 把「过点」从切圆上放回自由位置 过程函数
     * @param {number} x
     * @param {number} y
     */
    releasePointFromCircle(x, y) {
        // 只有「切圆已选中、正在定过点」这一档会被模板吸附
        if (this.status !== 'point+') return;
        const point = geometryManager.getToolKey(this.toolName, 'point');
        if (!point) return;
        const base = point.getBase();
        if (!base || base.type !== 'online') return;
        const [circle] = base.bases || [];
        const target = geometryManager.getToolKey(this.toolName, this.exceptPoint);
        // 只撤「挂在切圆上」这一种吸附：吸在别的图形上就交给模板原样处理
        if (!circle || !target || circle.getId() !== target.getId()) return;
        point.clearBase();
        point.modifyCoordinate(x, y);
        const goal = geometryManager.getToolKey(this.toolName, this.goal);
        if (goal && goal.getBase().type === this.define) {
            goal.modifyDefine(this.define, [point, target]);
        }
    }
    /**
     * 同步第二条切线的定义 过程函数
     * 点与切圆都还在缓存里、第二条切线也没被丢掉时才同步（点在圆上 / 圆内时第二条不存在）
     */
    syncSecondTangentDefine() {
        const point = geometryManager.getToolKey(this.toolName, "point");
        const circle = geometryManager.getToolKey(this.toolName, this.exceptPoint);
        const secondTangent = geometryManager.getToolKey(this.toolName, this.secondTangentKey);
        if (!point || !circle || !secondTangent) return;
        secondTangent.modifyDefine(this.secondTangentDefine.type, [point, circle], this.secondTangentDefine.value);
    }
    /**
     * 平行的两条切线 过程函数
     */
    createParallelTangents() {
        const first = geometryManager.getToolKey(this.toolName, 'choice1');
        const second = geometryManager.getToolKey(this.toolName, 'choice2');
        if (!first || !second || first.getId() === second.getId()) return;
        // 两种取法都是一条线 + 一个圆，顺序无所谓
        const lineObject = first.getType() === 'line' ? first : second;
        const circleObject = first.getType() === 'line' ? second : first;
        if (lineObject.getType() !== 'line' || circleObject.getType() !== 'circle') return;
        ['tangent1', 'tangent2'].forEach((key, index) => {
            geometryManager.createGeometryElementInputTool(this.goalType, this.toolName, key);
            const goal = geometryManager.getToolKey(this.toolName, key);
            if (goal) goal.modifyDefine(this.define, [lineObject, circleObject], index);
        });
        // 查重：画布上已经有同一个图形就把这一笔整个作废（与 loadTool 的预检同一口径）
        const duplicated = ['tangent1', 'tangent2'].some(key => {
            const goal = geometryManager.getToolKey(this.toolName, key);
            return goal && geometryManager.findSameElement(goal);
        });
        if (duplicated) {
            geometryManager.deleteTool(this.toolName);
            return;
        }
        geometryManager.loadTool(this.toolName);
        // 触发存储事件（与模板里各工具一致）
        const event = new CustomEvent("storage", {
            detail: {
                type: this.toolName,
            },
        });
        window.dispatchEvent(event);
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
        // 同上：只有明确选了「圆心」才取圆心，其余（含 subTool 停留在工具名的关卡页）取两点中点
        if (subTool === 'circleCenter') {
            this.centerToolEvent(type, oriX, oriY);
        }else{
            this.middlePointMode.toolEvent(type, oriX, oriY);
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

// 「点两条线作角平分线」暂时关掉（见 #10）：这条路径与三点那套不兼容（两线角平分线的对象
// 也没法导出 gmt，见 board-tools.js 里 twoLineAngleBisector 的注释）。要恢复改成 true 即可
const TWO_LINE_BISECTOR_ENABLED = false;

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
        // 只有明确选了「两线」才走两线模式：关卡页没有小项切换按钮时 subTool 会停留在
        // 工具名（'angleBisector'），这时按三点模式处理，否则第一个点都点不出来。
        // 两线模式暂时关掉（见 TWO_LINE_BISECTOR_ENABLED）
        if (TWO_LINE_BISECTOR_ENABLED && subTool === 'twoLineAngleBisector') {
            this.twoLineAngleBisectorMode.toolEvent(type, oriX, oriY);
        }else{
            this.threePointAngleBisectorMode.toolEvent(type, oriX, oriY);
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
        
        // 三点圆规：第一、第二点之间的距离是半径，第三点是圆心 —— 圆心可以和半径端点重合
        // （以 A 为圆心、AB 为半径作圆），所以覆写成「第三个点允许与前面的点重复」
        this.threePointCompassMode.repeatPointAllowed = index => index === 3;
        

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
        // 同上：只有明确选了「复制圆」才走复制，其余（含 subTool 停留在工具名的关卡页）走三点圆规
        if (subTool === 'compassCopy') {
            this.copyCompassMode.toolEvent(type, oriX, oriY);
        }else{
            this.threePointCompassMode.toolEvent(type, oriX, oriY);
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

class FixedAngleConstructTool {
    constructor() {
        this.toolName = 'fixedAngle';
        this.maxStatus = 2;
        this.goal = "ray";
        this.goalType = "line";
        this.define = "fixAngle";
        this.dialogType = "number";
        this.drawType = "ray";
        
        this.lineMode = new PointBaseDialogToolTemplate(
            this.toolName,
            this.maxStatus,
            this.goal,
            this.goalType,
            this.define,
            this.dialogType,
            this.drawType,
            );
        // 取点顺序是「先角的一条边上的点、再顶点」，但定义里第一个点必须是顶点
        // （gmt 的 FixAngle[A,B,x] 里 A 是顶点、AB 是始边），所以这里把两个点倒过来
        this.lineMode.definePointList = () => [
            geometryManager.getToolKey(this.toolName, 'point2'),
            geometryManager.getToolKey(this.toolName, 'point1'),
        ];
    }
    
    /**
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
