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
        if (subTool === "moveView") {
            geometryManager.deleteTool(this.toolName);
            return;
        }
        // 按住 Ctrl / Cmd 点：加选（不先清空选中栏），见下面
        const multi = typeof window !== 'undefined' && !!window.multiSelectModifier;
        // 点 / 线 / 圆放在一起比距离：光标压着哪个就拖哪个
        //（原来点是「半径内有就先选」，于是光标明明压在线上，附近随便一个点也会把它抢走 ——
        // 与 near 的距离优先口径统一）
        const [pickedId] = geometryManager.near([x, y], ["point", "line", "circle"]);
        if (!pickedId) {
            // 点在空白处：清空选中栏（多选也一起清掉）
            if (!multi) geometryManager.deleteTool(this.toolName);
            return;
        }
        // 光标下是**已经在选中栏里**的对象：保留整条选中栏 —— 多选之后直接拖动就该一起走。
        // 原来这里进门先清空再重选，于是拖其中一个就把多选丢了、只剩它自己动
        const inSelection = geometryManager.ifIdInCache(this.toolName, pickedId);
        if (!multi && !inSelection) geometryManager.deleteTool(this.toolName);
        // 多选：再点一次已选中的就把它从选中栏里去掉，否则用下一个空闲键加进去
        //（选中栏是一张 map，键不同就能并存：choice、choice2…，与网格那一块同一个机制）
        if (multi) {
            // ifIdInCache 是（tool, id）两个参数：只传 id 时 tool 会拿到对象 id，永远为 false
            if (geometryManager.ifIdInCache(this.toolName, pickedId)) {
                geometryManager.deleteToolQuote(this.toolName, pickedId);
            }else{
                const used = Object.keys(geometryManager.choice?.[this.toolName] || {});
                const key = ['choice', 'choice2', 'choice3', 'choice4', 'choice5', 'choice6', 'choice7', 'choice8']
                    .find(name => !used.includes(name)) || `choice${used.length + 1}`;
                geometryManager.addToolObject(this.toolName, key, "quote", pickedId);
            }
            return;
        }
        const picked = geometryManager.get(pickedId);
        if (picked && picked.getType() === "point") {
            // 已经选着它：保持整条选中栏不动（拖动时整批一起走；取消选中有「点空白」与 Ctrl 点两途）
            if (inSelection) return;
            geometryManager.addToolObject(this.toolName, "choice", "quote", pickedId);
            return;
        }
        if (inSelection) return;
        // 网格当作一整块：点到任意一条格线就把整块都选上（样式一次改一整块）
        const gridIds = (typeof window.isGridObjectId === 'function' && window.isGridObjectId(pickedId)
            && typeof geometryElementLists !== 'undefined' && geometryElementLists.grid)
            ? [...geometryElementLists.grid].filter(id => /^gS[XY]\d+$/.test(id))
            : [];
        if (gridIds.length) {
            // 选中栏是一张 map：键不同就能并存（第一条用 choice，其余 choice2、choice3…）
            gridIds.forEach((id, index) => {
                geometryManager.addToolObject(this.toolName, index === 0 ? "choice" : `choice${index + 1}`, "quote", id);
            });
        }else{
            geometryManager.addToolObject(this.toolName, "choice", "quote", pickedId);
        }
    }
    
    /**
     * 图形的自由定义点 过程函数
     * 图形的定义点（base.figure）全是自由点（坐标为 none 的点）时，拖着图形就能整体平移：
     * 把这些定义点一起挪，依此作出的直线 / 线段 / 圆会跟着走
     * @param {Object} element 图形对象
     * @returns {Object[]} 可以一起平移的自由点；条件不满足时返回空数组
     */
    freeDefinitionPoints(element) {
        const figure = element.getBase?.()?.figure || [];
        if (!figure.length) return [];
        const allFreePoints = figure.every(item => item.getType() === 'point' && item.getBase?.()?.type === 'none');
        return allFreePoints ? figure : [];
    }
    
    /**
     * 选中栏里的全部对象 过程函数
     * 移动工具支持多选（Ctrl+A 全选、按住 Ctrl 点加选）：选中栏是一张 map，键不同就能并存
     * （choice / choice2 / choice3…，与网格那一块同一个机制）
     * @returns {Object[]}
     */
    selectedElements() {
        const dict = geometryManager.choice?.[this.toolName] || null;
        if (!dict) return [];
        const out = [];
        Object.values(dict).forEach(entry => {
            if (!entry || entry.type !== 'quote') return;
            const item = geometryManager.get(entry.quote);
            if (item) out.push(item);
        });
        return out;
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
    
        const choices = this.selectedElements();
        const choice = choices.length ? choices[0] : null;
    
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
        // 只选了一个点：照老口径把它直接放到光标处（点跟着光标走，比按位移跟手）
        if (choices.length === 1 && choice.getType() === "point") {
            const logicX = (x - transform.x) / transform.scale;
            const logicY = (y - transform.y) / transform.scale;
            // 先记下拖之前的坐标：移不动的东西（构造出来的交点、被约束住的点…）拖了也白拖，
            // 坐标没变就不算「移动过」，不该污染撤销/重做历史
            const before = choice.getCoordinate();
            geometryManager.modifyPointCoordinate(choice.getId(), logicX, logicY);
            const after = choice.getCoordinate();
            if (before && after && Math.hypot(after[0] - before[0], after[1] - before[1]) > 1e-9) this.movedFlag = true;
            return;
        }
        // 多选（Ctrl+A 全选 / 按住 Ctrl 点加选）与拖图形走同一条路：所有选中的点、
        // 以及定义点全是自由点的图形，一起按同样的位移平移。
        // 一个都动不了（构造出来的交点、被约束住的点、牵着别的图形的图形）时照旧拖画布
        const movingPoints = new Map();
        choices.forEach(item => {
            if (item.getType() === "point") {
                movingPoints.set(item.getId(), item);
            }else{
                this.freeDefinitionPoints(item).forEach(point => movingPoints.set(point.getId(), point));
            }
        });
        if (!movingPoints.size) {
            drawCanvas();
            return;
        }
        const deltaX = (x - preX) / transform.scale;
        const deltaY = (y - preY) / transform.scale;
        movingPoints.forEach(point => {
            const [pointX, pointY] = point.getCoordinate();
            geometryManager.modifyPointCoordinate(point.getId(), pointX + deltaX, pointY + deltaY);
        });
        preX = x;
        preY = y;
        if (deltaX || deltaY) this.movedFlag = true;
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
