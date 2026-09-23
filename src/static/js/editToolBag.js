/* editToolBag.js */

class MoveTool {
    constructor() {
        this.toolName = 'move';
    }

    /**
     * 移动工具操作 过程函数
     * @param {string} type
     * @param {number} x
     * @param {number} y
     */
    toolEvent(type, oriX, oriY) {
        const x = (oriX - transform.x) / transform.scale;
        const y = (oriY - transform.y) / transform.scale;
        
        if (type === "start") {
            this.startEventFunctionMove(x, y);
        }else if (type === "draw") {
            this.drawEventFunctionMove(oriX, oriY);
        }else if (type === "drawComplete") {
            this.drawCompleteEventFunctionMove();
        }
    }

    /**
     * 拖拽结束 过程函数
     * 拖拽点会改变图形坐标，把这一步记入撤销/重做历史（一次拖拽只记一次）
     */
    drawCompleteEventFunctionMove() {
        if (!this.movedFlag) return;
        this.movedFlag = false;
        // 触发存储事件
        const event = new CustomEvent("storage", {
            detail: {
                type: "move",
            },
        });
        window.dispatchEvent(event);
    }
    
    /**
     * 开始 过程函数
     * @param {number} x
     * @param {number} y
     */
    startEventFunctionMove(x, y) {
        geometryManager.deleteTool(this.toolName);
    
        if (subTool === "moveView") return;
        
        const [pointId] = geometryManager.near([x, y], ["point"]);
        if (pointId) {
            if (geometryManager.ifIdInCache(pointId)) {
                geometryManager.deleteToolQuote(pointId);
            }else{
                geometryManager.addToolObject(this.toolName, "choice", "quote", pointId);
            }
            return;
        }
        
        const [elementId] = geometryManager.near([x, y], ["line", "circle"]);
        if (elementId) {
            if (geometryManager.ifIdInCache(elementId)) {
                geometryManager.deleteToolQuote(elementId);
            }else{
                geometryManager.addToolObject(this.toolName, "choice", "quote", elementId);
            }
        }
    }
    
    /**
     * 拖拽 过程函数
     * @param {number} x
     * @param {number} y
     */
    drawEventFunctionMove(x, y) {
        if (subTool === "moveView") {
            drawCanvas();
            return;
        }
    
        const choice = geometryManager.getToolKey(this.toolName, "choice");
    
        function drawCanvas() {
            // 拖拽画布
            const currentDeltaX = x - preX;
            const currentDeltaY = y - preY;
            // 坑点：缩放的本质：缩放会放大物理像素的视觉效果，
            // 因此画布移动 Δx 自动对应为逻辑移动 Δx / scale。
            const currentX = (transform.x + currentDeltaX);
            const currentY = (transform.y + currentDeltaY);
            const currentScale = transform.scale;
            limitLoad(currentX, currentY, currentScale);
            preX = x;
            preY = y;
        }
    
        if (!choice) {
            drawCanvas();
            return;
        }
        
        const type = choice.getType();
        if (type !== "point") drawCanvas();
        // 拖拽点
        const logicX = (x - transform.x) / transform.scale;
        const logicY = (y - transform.y) / transform.scale;
        const id = choice.getId();
        // 先记下拖之前的坐标：移不动的东西（构造出来的交点、被约束住的点…）拖了也白拖，
        // 坐标没变就不算「移动过」，不该污染撤销/重做历史
        const before = choice.getCoordinate();
        geometryManager.modifyPointCoordinate(id, logicX, logicY);
        const after = choice.getCoordinate();
        if (type === "point" && before && after && Math.hypot(after[0] - before[0], after[1] - before[1]) > 1e-9) this.movedFlag = true;
    }

    /**
     * 清除
     */
    clear() {
        geometryManager.deleteTool(this.toolName);
    }
}

class EraserTool {
    constructor() {
        this.toolName = 'eraser';
    }

    // 橡皮擦工具事件
    toolEvent(type, oriX, oriY) {
        const x = (oriX - transform.x) / transform.scale;
        const y = (oriY - transform.y) / transform.scale;
    
        if (type === "click") {
            this.clickEventFunctionEraser(x, y);
        }else if (type === "draw") {
            this.drawEventFunctionEraser(x, y);
        }
    }
    
    /**
     * 点击
     * @param {number} x 
     * @param {number} y 
     */
    clickEventFunctionEraser(x, y) {
        this.deleteEraser(x, y);
    }
    
    /**
     * 拖拽
     * @param {number} x 
     * @param {number} y 
     */
    drawEventFunctionEraser(x, y) {
        this.deleteEraser(x, y);
    }
    
    /**
     * 删除
     * @param {number} x 
     * @param {number} y 
     */
    deleteEraser(x, y) {
        if (subTool === "choicePoint") {
            const [id] = geometryManager.near([x, y], ["point"]);
            if (!id) return;
            // 关卡自带的图形是题目的一部分，游玩时不允许擦掉
            if (typeof isProtectedElement === 'function' && isProtectedElement(id)) {
                if (typeof boardToast === 'function') boardToast('这是关卡给定的图形，不能删除');
                return;
            }
            geometryManager.deleteObject(id);
            // 触发存储事件
            const event = new CustomEvent("storage", {
                detail: {
                    type: "point",
                },
            });
            window.dispatchEvent(event);
        }else{
            const [id] = geometryManager.near([x, y], ["point", 'line', 'circle']);
            if (!id) return;
            // 关卡自带的图形是题目的一部分，游玩时不允许擦掉
            if (typeof isProtectedElement === 'function' && isProtectedElement(id)) {
                if (typeof boardToast === 'function') boardToast('这是关卡给定的图形，不能删除');
                return;
            }
            geometryManager.deleteObject(id);
            // 触发存储事件
            const event = new CustomEvent("storage", {
                detail: {
                    type: "point",
                },
            });
            window.dispatchEvent(event);
        }
    }
}
