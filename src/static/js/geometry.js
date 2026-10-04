/**
 * 几何对象模块
 * @module geometry
 */

/**
 * 几何对象
 * @class
 */
class GeometryElement {
    /**
     * @param {string} id
     * this.superstructure = {id: Object}
     */
    constructor(id) {
        this.id = id;
        this.name = id;
        this.type;
        this.superstructure = new Object();
        this.visible = true;
        this.valid = true;
        this.color = "#191919";
        this.showName = false;
        this.width = 1;
        // 虚线：只有直线与圆用得上（点在样式面板里没有这个开关），各模式默认关闭
        this.dashed = false;
    }
    
    /**
     * 添加上层构造
     * @param {Object} geometryElement
     */
    addSuperstructure(geometryElement) {
        const id = geometryElement.getId();
        this.superstructure[id] = geometryElement;
    }
    
    /**
     * 删去上层构造
     * @param {string} id
     */
    deleteSuperstructure(id) {
        delete this.superstructure[id];
    }
    
    /**
     * 清空上层构造
     */
    clearSuperstructure() {
        this.superstructure = new Object();
    }
    
    /**
     * 返回上层构造
     * 返回Array()形式
     */
    getSuperstructure() {
        return Object.values(this.superstructure);
    }
    
    /**
     * 修改名称
     * @param {string} name
     */
    modifyName(name) {
        this.name = name;
    }
    
    /**
     * 修改ID
     * @param {string} id
     */
    modifyId(id) {
        this.id = id;
    }
    
    /**
     * 修改可视
     * @param {boolean} bool
     */
    modifyVisible(bool) {
        this.visible = bool;
    }
    
    /**
     * 修改有效性
     * @param {boolean} bool
     */
    modifyValid(bool) {
        this.valid = bool;
    }

    /**
     * 修改颜色
     * @param {string} color
     */
    modifyColor(color) {
        this.color = color;
    }

    /**
     * 修改显示标签
     * @param {boolean} bool
     */
    modifyShowName(bool) {
        this.showName = bool;
    }

    /**
     * 修改粗细（点的大小、线圆的粗细），默认 1
     * @param {number} width
     */
    modifyWidth(width) {
        this.width = width;
    }

    /**
     * 修改虚线（直线与圆），默认 false
     * @param {boolean} bool
     */
    modifyDashed(bool) {
        this.dashed = !!bool;
    }

    /**
     * 访问ID
     * @returns {string} ID
     */
    getId() {
        return this.id;
    }
        
    /**
     * 访问名称
     * @returns {string} 名称
     */
    getName() {
        return this.name;
    }
    
    /**
     * 访问类型
     * @returns {string} 类型
     */
    getType() {
        return this.type;
    }
    
    /**
     * 访问可视
     * @returns {boolean}
     */
    getVisible() {
        return this.visible;
    }
    
    /**
     * 访问有效性
     * @returns {boolean}
     */
    getValid() {
        return this.valid;
    }
    
    /**
     * 访问颜色
     * @returns {string}
     */
    getColor() {
        return this.color;
    }
    
    /**
     * 访问显示名称
     * @returns {boolean}
     */
    getShowName() {
        return this.showName;
    }

    /**
     * 访问粗细
     * @returns {number}
     */
    getWidth() {
        return this.width;
    }

    /**
     * 访问虚线
     * @returns {boolean}
     */
    getDashed() {
        return !!this.dashed;
    }
}

/**
 * 点类
 * @class
 */
class Point extends GeometryElement {
    /**
     * @param {string} objectId
     * @param {number} x
     * @param {number} y
     * this.base {type = string, bases = Object[], value = number}
     */
    constructor(id, x, y) {
        super(id);
        this.x = x;
        this.y = y;
        this.type = "point";
        this.base = {type: 'none'};
    }
    
    /**
     * 修改坐标
     * @param {number} x
     * @param {number} y
     */
    modifyCoordinate(x, y) {
        this.x = x;
        this.y = y;
    }
    
    /**
     * 修改基底
     * @param {string} type 
     * @param {Object[]} geometryElements
     * @param {number} [value=0] 
     */
    modifyBase(type, geometryElements, value = 0, exclude = null) {
        // 基底换了就要换上层引用：新基底登记「本点依赖它」，旧基底撤掉登记。
        // 与 Line / Circle.modifyDefine 同一口径 —— 少了这步，拖动基底时本点不在更新链里，
        // 位置就不会实时刷新（各工具原先只能各自手写 addSuperstructure，漏一个就漏一处）
        // 载入时基底可能还没接上（appendStorage 里 this.get(id) 取不到就是 undefined），
        // 这类空位一律跳过 —— 旧代码只是不登记，不能在这里抛错
        if (Array.isArray(this.base.bases)) {
            for (const item of this.base.bases) item?.deleteSuperstructure?.(this.id);
        }
        this.base.type = type;
        this.base.bases = geometryElements;
        this.base.value = value;
        // 交点编号时要排除的已知点（gmt 里 Intersect[a,b,x,已知点] 的第四个参数）
        this.base.exclude = exclude || null;
        if (Array.isArray(geometryElements)) {
            for (const item of geometryElements) item?.addSuperstructure?.(this);
        }
        
        // 更新坐标
        this.updateCoordinate();
    }
    
    /**
     * 访问坐标
     * @returns {[x, y]} 坐标
     */
    getCoordinate() {
        return [this.x, this.y];
    }
    
    /**
     * 返回基底
     */
    getBase() {
        return this.base;
    }
    
    /**
     * 获取字典形式
     * @returns {key: value}
     */
    getDict() {
        const dict = {};
        dict.id = this.id;
        dict.name = this.name;
        dict.type = this.type;
        dict.showName = this.showName;
        dict.superstructureId = Object.keys(this.superstructure);
        dict.visible = this.visible;
        dict.valid = this.valid;
        dict.color = this.color;
        dict.width = this.width;
        dict.x = this.x;
        dict.y = this.y;
        dict.base = {type: this.base.type};
        if (this.base.type !== "none") {
            const basesId = [];
            this.base.bases.forEach((item) => basesId.push(item.getId()));
            dict.base.basesId = basesId;
            dict.base.value = this.base.value;
            // 交点编号时排除的已知点也要记下来，撤销/存读档后编号才不会错位
            if (this.base.exclude) dict.base.excludeId = this.base.exclude.getId();
        }
        return dict;
    }
    
    /**
     * 清空基底
     */
    clearBase() {
        // 变回自由点：先把旧基底上的上层引用撤掉，免得拖动旧基底时还来更新这个已经独立的点
        if (Array.isArray(this.base.bases)) {
            for (const item of this.base.bases) item?.deleteSuperstructure?.(this.id);
        }
        this.base = {type: 'none'};
    }
    
    /**
     * 更新坐标
     */
    updateCoordinate() {
        const typeCoordinate = ToolsFunction.updatePointCoordinate(this.base);
        const type = typeCoordinate?.type;
        
        if (type === "keep") {
            return;
        }else if (type === "update") {
            [this.x, this.y] = typeCoordinate.coordinate;
        }else if (type === "invalid") {
            this.valid = false;
        }
    }
}

/**
 * 直线类
 * @class
 */
class Line extends GeometryElement {
    /**
     * @param {string} objectId
     * this.coordinate = [[x1, y1], [x2, y2]]
     * this.base = {type: string, figure: Object[], value: number = 0}
     * 
     * type: twoPoints, figure: [Point, Point]
     * type: parallel, figure: [Point, Line]
     * type: perpendicularBisector, figure: [Point, Point]
     */
    constructor(id) {
        super(id);
        this.coordinate;
        this.type = "line";
        this.base = {type: 'none'};
        this.drawType = 'line';
    }
    
    /**
     * 访问定义图形
     * @returns {Object[]}
     */
    getDefine() {
        return this.base.figure;
    }
    
    /**
     * 返回基底
     */
    getBase() {
        return this.base;
    }
    
    /**
     * 访问坐标
     * @returns {[[x1, y1], [x2, y2]]}
     */
    getCoordinate() {
        return this.coordinate;
    }

    /**
     * 访问绘制类型
     * @returns {'line' | 'ray' | 'lineSegment'} 
     */
    getDrawType() {
        return this.drawType;
    }
    
    /**
     * 获取字典形式
     * @returns {key: value}
     */
    getDict() {
        const dict = {};
        dict.id = this.id;
        dict.name = this.name;
        dict.type = this.type;
        dict.showName = this.showName;
        dict.superstructureId = Object.keys(this.superstructure);
        dict.visible = this.visible;
        dict.valid = this.valid;
        dict.color = this.color;
        dict.width = this.width;
        dict.dashed = this.dashed;
        dict.coordinate = this.coordinate;
        dict.base = {type: this.base.type};
        if (this.base.type !== "none") {
            const basesId = [];
            this.base.figure.forEach((item) => basesId.push(item.getId()));
            dict.base.basesId = basesId;
            dict.base.value = this.base.value;
        }
        dict.drawType = this.drawType;
        return dict;
    }
    
    /**
     * 修改定义图形
     * @param {string} type
     * @param {Object[]} figures
     * @param {number} [value=0] 
     */
    modifyDefine(type, figures, value = 0) {
        this.base.type = type;
        this.base.value = value;
        
        // 删除原基底的上层引用，添加新基底的上层引用
        // （载入时基底可能是 undefined，跳过这类空位，别在接基底的过程中抛错）
        if (this.base.figure) for (const item of this.base.figure) item?.deleteSuperstructure?.(this.id);
        this.base.figure = figures;
        for (const item of figures) item?.addSuperstructure?.(this);
        
        // 更新坐标
        this.updateCoordinate();
    }

    /**
     * 修改绘制类型
     * @param {'line' | 'ray' | 'lineSegment'} drawType
     */
    modifyDrawType(drawType) {
        this.drawType = drawType;
    }

    /**
     * 更新直线两点坐标
     */
    updateCoordinate() {
        this.coordinate = ToolsFunction.updateLineCoordinate(this.base);
    }
}

/**
 * 圆类
 * @class
 */
class Circle extends GeometryElement {
    /**
     * @param {string} objectId
     * this.coordinate = [[x1, y1], [x2, y2]] = [center, point]
     * this.base = {type: string, figure: Object[], value: number = 0}
     * 
     * type: twoPoints, figure: [Point, Point]
     * type: threePoints, figure: [Point, Point, Point]
     */
    constructor(id) {
        super(id);
        this.coordinate;
        this.type = "circle";
        this.base = {type: 'none'};
    }
    
    /**
     * 访问定义图形
     * @returns {Object[]}
     */
    getDefine() {
        return this.base.figure;
    }
    
    /**
     * 返回基底
     */
    getBase() {
        return this.base;
    }
    
    /**
     * 访问坐标
     * @returns {[[x1, y1], [x2, y2]]}
     */
    getCoordinate() {
        return this.coordinate;
    }
    
    /**
     * 获取字典形式
     * @returns {key: value}
     */
    getDict() {
        const dict = {};
        dict.id = this.id;
        dict.name = this.name;
        dict.type = this.type;
        dict.showName = this.showName;
        dict.superstructureId = Object.keys(this.superstructure);
        dict.visible = this.visible;
        dict.valid = this.valid;
        dict.color = this.color;
        dict.width = this.width;
        dict.dashed = this.dashed;
        dict.coordinate = this.coordinate;
        dict.base = {type: this.base.type};
        if (this.base.type !== "none") {
            const basesId = [];
            this.base.figure.forEach((item) => basesId.push(item.getId()));
            dict.base.basesId = basesId;
            dict.base.value = this.base.value;
        }
        return dict;
    }
    
    /**
     * 修改定义图形
     * @param {string} type
     * @param {Object[]} figures
     * @param {number} [value=0] 
     */
    modifyDefine(type, figures, value = 0) {
        this.base.type = type;
        this.base.value = value;
        
        // 删除原基底的上层引用，添加新基底的上层引用
        // （载入时基底可能是 undefined，跳过这类空位，别在接基底的过程中抛错）
        if (this.base.figure) for (const item of this.base.figure) item?.deleteSuperstructure?.(this.id);
        this.base.figure = figures;
        for (const item of figures) item?.addSuperstructure?.(this);
        
        // 更新坐标
        this.updateCoordinate();
    }
    
    /**
     * 更新圆两点坐标
     */
    updateCoordinate() {
        this.coordinate = ToolsFunction.updateCircleCoordinate(this.base);
    }
}

/**
 * 几何对象管理器类
 * @class
 */
class GeometryElementManager {
    /**
     * 数据格式
     * this.repository = {id: Object}
     * this.counter = {type: number}
     * this.choice = {tool: {key: {type: string, quote: string, create: Object}}}
     * this.transfrom = {x: number, y: number, scale: number}
     */
    constructor() {
        this.repository = new Object();
        this.counter = {"total": 0};
        this.choice = new Object();
        // 上一次作图没有产生任何新图形：图形画布上已经有了（loadTool 里置位），
        // 或交点工具没标出交点（两图形不相交 / 候选全在范围外 / 相交处已经有点了，见 createIntersection）。
        // storage 监听取走它，跳过撤销历史与步数（L / E）
        this.duplicatedFlag = false;
        this.transform = {x: 0, y: 0, scale: 1};
        this.geometryStyle = {point: {colorChoice: "auto", color: "#191919"}, 
            line: {colorChoice: "auto", color: "#191919", dashed: false}, 
            circle: {colorChoice: "auto", color: "#191919", dashed: false}
        };
        this.geometryElementLists = {
            hidden: new Set(),
            initial: new Set(),
            named: new Set(),
            name: new Set(),
            movepoints: new Set(),
            result: new Set(),
            resultShown: new Set(),
            explore: new Set(),
        };
    }
    
    /**
     * 访问总计
     * @returns {number} 几何对象数量总计
     */
    getObjectTotal() {
        return this.counter["total"];
    }
    
    /**
     * 访问类型总计
     * @param {string} objectType 指定类型
     * @returns {number} 指定类型几何对象数量总计
     */
    getTypeCount(objectType) {
        return this.counter[objectType];
    }
    
    /**
     * 类型计数增加 私有方法
     * @param {string} objectType 指定类型
     */
    #counterAdd(objectType) {
        this.counter["total"]++;
        if (!this.counter.hasOwnProperty(objectType)) {
            this.counter[objectType] = 1;
        }else{
            this.counter[objectType]++;
        }
    }
    
    /**
     * 类型计数减少 私有方法
     * @param {string} objectType 指定类型
     */
    #counterDelete(objectType) {
        if (!this.counter.hasOwnProperty(objectType)) return;
        
        this.counter["total"] -= 1;
        const typeNum = this.counter[objectType];
        if (typeNum === 1) {
            Reflect.deleteProperty(this.counter, objectType);
        }else{
            this.counter[objectType] -= 1;
        }
    }
    
    /**
     * 从ID获取对象
     * @param {string} id
     * @returns {Object} 指定对象
     */
    get(id) {
        let object;
        object = this.repository[id];
        return object;
    }
    
    /**
     * 以类型返回所有对象
     * Object()
     * @param {string} currentTool 当前工具
     * @returns {{exceptPoints: Object[], exceptPointsCache: Object[], points: Object[], pointsCache: [], choice: Object[]}}
     */
    getAllByType(currentTool = "none") {
        const dict = new Object();
        const points = new Array();
        const exceptPoints = new Array();
        const resultPoints = new Array();
        const pointsCache = new Array();
        const exceptPointsCache = new Array();
        const resultexceptPoints = new Array();
        const choice = new Array();
        
        // 画在最上面的一层：所求判定 / 所求显示 / 探索显示的图形。
        // 关卡作出解后，这些金色图形要压在玩家自己画的图形之上，否则会被盖住看不清
        const isOnResultLayer = id => {
            if (geometryElementLists.result?.has(id) || geometryElementLists.explore?.has(id)) return true;
            for (let index = 1; index <= 20; index++) {
                const key = index === 1 ? 'resultShown' : `resultShown${index}`;
                if (geometryElementLists[key]?.has(id)) return true;
            }
            return false;
        };
        // 实有对象
        let list = Object.values(this.repository);
        list.forEach((element) => {
            const type = element.getType();
            if (type === "point") {
                const id = element.getId();
                if (isOnResultLayer(id)) {
                    resultPoints.push(element);
                }else{
                    points.push(element);
                }
            }else{
                const id = element.getId();
                if (isOnResultLayer(id)) {
                    resultexceptPoints.push(element);
                }else{
                    exceptPoints.push(element);
                }
            }
        });
        
        if (Object.keys(this.choice).includes(currentTool)) {
            const list = Object.values(this.choice[currentTool]);
            list.forEach((item) => {
                if (item.type === "create") {
                    const type = item.create.getType();
                    if (type === "point") {
                        pointsCache.push(item.create);
                    }else{
                        exceptPointsCache.push(item.create);
                    }
                }else{
                    const element = this.get(item.quote);
                    choice.push(element);
                }
            });
        }
        
        dict['exceptPoints'] = exceptPoints;
        dict['exceptPointsCache'] = exceptPointsCache;
        dict['points'] = points;
        dict['pointsCache'] = pointsCache;
        dict['resultPoints'] = resultPoints;
        dict['resultexceptPoints'] = resultexceptPoints;
        dict["choice"] = choice;
        
        return dict;
    }
    
    /**
     * 以顺序返回所有实在对象
     * Array()
     * @returns {Object[]}
     */
    getAllByOrder() {
        return Object.values(this.repository);
    }
    
    /**
     * 按当前配色方案给对象上样式色 过程函数
     * auto：线上点红、构造点灰；autoPlayMode：自由点（坐标点 / 线上点）红，构造点与线圆灰
     * 注意它依赖 base.type，所以反序列化时要等基础图元接好再调一次，否则点会被当成自由点全涂红
     * @param {Object} object
     */
    applyAutoStyle(object) {
        const type = object.getType();
        if (type === "point") {
            const choice = this.geometryStyle.point.colorChoice;
            const baseType = object.getBase?.().type;
            if (choice === "auto") {
                if (baseType === "online") {
                    object.modifyColor("#ff0000");
                }else if (baseType === "intersection" || baseType === "middlePoint" || baseType === "center") {
                    object.modifyColor("#808080");
                }
                // 默认显示标签，可在「配置点样式」中关闭
                object.modifyShowName(this.geometryStyle.point.showName !== false);
            }else if (choice === "autoPlayMode") {
                if (baseType === "none" || baseType === "online") {
                    object.modifyColor("#ff0000");
                }else if (baseType === "intersection" || baseType === "middlePoint" || baseType === "center") {
                    object.modifyColor("#808080");
                }
            }
        }else if (type === "line") {
            if (this.geometryStyle.line.colorChoice === "autoPlayMode") object.modifyColor("#808080");
        }else if (type === "circle") {
            if (this.geometryStyle.circle.colorChoice === "autoPlayMode") object.modifyColor("#808080");
        }
    }

    /**
     * 添加对象
     * @param {Object} object
     */
    addObject(object) {
        // 对象信息
        let id = object.getId();
        const type = object.getType();
        
        // id查重
        if (Object.keys(this.repository).includes(id)) {
            // 存在重复id，需要变更（按它自己的类型接着往下取名：线段就是 S 开头那种）
            id = type === "point" ? this.getId("point")
                : this.getId(type, "none", object.getDrawType ? object.getDrawType() : null);
            object.modifyId(id);
            object.modifyName(id);
        }
        
        // 改变样式
        this.applyAutoStyle(object);
        
        // 添加对象
        this.repository[id] = object;
        // 增加计数器
        this.#counterAdd(type);
        // 后置修补依赖链：对象在**工具缓存**里造出来时就已经登记过一次（模板里紧跟 createPoint 的那两句），
        // 而那时它的名字可能还是临时的 —— createPoint 取名只看得到仓库（createPoint 调 getId 时没带工具名），
        // 同一个「半成品」里第二次取点会拿到与第一次相同的名字，于是按 id 为键的 superstructure
        // 会把前一个对象的登记**覆盖**掉；名字随后在 addObject 的查重里才改成正式的（E、F…）。
        // 表现就是「拖动时某个派生点卡住不动，撤回一次（按快照重建依赖链）后又好了」。
        // 这里用**最终 id** 再登记一次：既补回被覆盖的那条，也保证键与对象一致（幂等，重复登记无害）
        const base = typeof object.getBase === 'function' ? object.getBase() : null;
        if (base) {
            [base.bases, base.figure].filter(Array.isArray).flat().forEach(parent => {
                if (parent && typeof parent.addSuperstructure === 'function') parent.addSuperstructure(object);
            });
        }
    }
    
    /**
     * 删除对象
     * @param {string} objectId 指定ID
     */
    deleteObject(objectId) {
        // 网格当作一整块、不能删：要撤掉网格请用「撤销」（那是生成网格那一步）。
        // 生成 / 改大小时由 board-tools 临时放行（window.gridAllowDelete）
        if (!window.gridAllowDelete && typeof window.isGridObjectId === 'function' && window.isGridObjectId(objectId)) return;
        let deleteList = new Array();
        let visitedList = new Array();
        deleteList.unshift(objectId);
        visitedList.push(objectId);

        while (deleteList.length) {
            // 取
            const currentElementId = deleteList.pop();
            const currentElement = this.get(currentElementId);
            if (!currentElement) continue;
            const objectType = currentElement.getType();

            // 生成
            const superstructures = currentElement.getSuperstructure();
            for (const element of superstructures) {
                const id = element.getId();
                if (!visitedList.includes(id)) {
                    visitedList.push(id);
                    deleteList.unshift(id);
                }
            }

            // 删除
            delete this.repository[currentElementId];
            // 删除缓存
            for (const tool of Object.keys(this.choice)) {
                this.deleteToolQuote(tool, currentElementId);
            }
            // 删除其基底的上层引用
            // 一律把基底表里能取到的都撤一遍：点的基底不止「线上点 / 交点」两种
            //（中点 / 圆心 / 无穷远点 / 极点也登记过，见 Point.modifyBase），
            // 而且残缺快照里基底可能是 undefined —— 那种一律跳过，别在删除过程中抛错
            if (objectType === "point") {
                const bases = currentElement.getBase().bases || [];
                bases.forEach(item => item?.deleteSuperstructure?.(currentElementId));
            }else if (objectType === "line" || objectType === "circle") {
                const defines = currentElement.getDefine();
                (defines || []).forEach((item) => item?.deleteSuperstructure?.(currentElementId));
            }
            // 减少计数器
            this.#counterDelete(objectType);
        }
    }
    
    /**
     * 查询存在性
     * @param {string} id 指定ID
     * @return {boolean}
     */
    ifIdIn(id) {
        return Object.keys(this.repository).includes(id);
    }
    
    /**
     * 查询缓存存在性
     * @param {string} tool
     * @param {string} id
     * @return {boolean}
     */
    ifIdInCache(tool, id) {
        // 检查存在性
        if (!Object.keys(this.choice).includes(tool)) return false;
        
        for (const item of Object.values(this.choice[tool])) {
            if (item.type === "quote") {
                if (item.quote === id) return true;
            }else{
                const itemId = item.create.getId();
                if (itemId === id) return true;
            }
        }
        
        return false;
    }
    
    /**
     * 删除所有对象
     */
    deleteAll() {
        this.repository = new Object();
        this.counter = {"total": 0};
        this.choice = new Object();
    }
    
    /**
     * 清空指定工具的所有缓存对象
     * @param {string} tool
     */
    deleteTool(tool) {
        // 检查存在性
        if (!Object.keys(this.choice).includes(tool)) return;
        delete this.choice[tool];
    }

    /**
     * 查询工具缓存存在性
     * @param {string} tool
     * @returns {boolean}
     */
    ifToolInCache(tool) {
        return Object.keys(this.choice).includes(tool);
    }
    
    /**
     * 查询工具键缓存存在性
     * @param {string} tool
     * @param {string} key
     * @returns {boolean}
     */
    ifToolKeyInCache(tool, key) {
        if (Object.keys(this.choice).includes(tool)) {
            return Object.keys(this.choice[tool]).includes(key);
        }else{
            return false;
        }
        
    }
    
    /**
     * 添加缓存对象
     * 可以存已有对象的ID，用于工具选择已有点，避免对象不一致
     * @param {string} tool
     * @param {string} key
     * @param {string} type
     * @param {any} value 
     */
    addToolObject(tool, key, type, value) {
        // 如果没有创建缓存空间，就创一个
        if (!Object.keys(this.choice).includes(tool)) {
            this.choice[tool] = new Object;
        }

        // 添加缓存
        if (type === 'quote') {
            const tmp = {type: 'quote', quote: value, create: null};
            this.choice[tool][key] = tmp;
        }else if (type === 'create'){
            const point = this.createPoint(value[0], value[1]);
            if (this.ifIdInCache(tool, point.getId())) {
                const id = this.getId("point", tool);
                point.modifyId(id);
                point.modifyName(id);
            }
            const tmp = {type: 'create', quote: null, create: point};
            this.choice[tool][key] = tmp;
        }else if (type === 'append'){
            if (this.ifIdInCache(tool, value.getId())) {
                let id;
                id = value.getType() === "point" ? this.getId("point", tool)
                    : this.getId(value.getType(), tool, value.getDrawType ? value.getDrawType() : null);
                value.modifyId(id);
                value.modifyName(id);
            }
            const tmp = {type: 'create', quote: null, create: value};
            this.choice[tool][key] = tmp;
        }
    }

    /**
     * 修改可变缓存对象
     * @param {string} tool
     * @param {string} key
     * @param {string} type
     * @param {any} value 
     */
    modifyToolObject(tool, key, type, value) {
        // 如果没有创建缓存空间，就创一个
        if (!Object.keys(this.choice).includes(tool)) {
            this.choice[tool] = new Object;
        }

        // 修改
        if (type === 'quote') {
            this.choice[tool][key]["type"] = "quote";
            this.choice[tool][key]["quote"] = value;
        }else if (type === 'create'){
            if (this.choice[tool][key].create) {
                const point = this.choice[tool][key]['create'];
                point.modifyCoordinate(value[0], value[1]);
            }else{
                // 没有就创建
                const point = this.createPoint(value[0], value[1]);
                if (this.ifIdInCache(tool, point.getId())) {
                    const id = this.getId("point", tool);
                    point.modifyId(id);
                    point.modifyName(id);
                }
                this.choice[tool][key].create = point;
            }
            this.choice[tool][key].type = "create";
        }
    }
    
    /**
     * 返回指定工具的指定对象
     * @param {string} tool
     * @param {string} key
     * @return {Object | null}
     */
    getToolKey(tool, key) {
        // 检查存在性
        if (!Object.keys(this.choice).includes(tool)) return null;
        if (!Object.keys(this.choice[tool]).includes(key)) return null;
        
        // 转换实体对象
        let object;
        if (this.choice[tool][key]["type"] === "quote") {
            object = this.get(this.choice[tool][key]["quote"]);
        }else if (this.choice[tool][key]["type"] === "create") {
            object = this.choice[tool][key]["create"];
        }else{
            return null;
        }
        return object;
    }
    
    /**
     * 删除对象引用
     * @param {string} tool
     * @param {string} id
     */
    deleteToolQuote(tool, id) {
        // 检查存在性
        if (!Object.keys(this.choice).includes(tool)) return;

        // 删除
        let key;
        for (const [index, item] of Object.entries(this.choice[tool])) {
            if (item.type === "quote") {
                if (item.quote === id) {
                    key = index;
                    break;
                }
            }
        }
        if (key) delete this.choice[tool][key];
    }
    
    /**
     * 删除对象指定键
     * @param {string} tool
     * @param {string} key
     */
    deleteToolKey(tool, key) {
        // 检查存在性
        if (!Object.keys(this.choice).includes(tool)) return;
        if (!Object.keys(this.choice[tool]).includes(key)) return;
        // 删除
        delete this.choice[tool][key];
    }
    
    /**
     * 画布上是否已经有同一个图形 过程函数
     * 判定只看图形本身、不看它是怎么作出来的：过 a 上一点作 a 的平行线，作出的还是 a；
     * 以 A 为圆心、AB 为半径作的圆，也等于画布上已经有的那个圆。
     * 只比线与圆（点的重复交给「引用已有点」那套），只看可见、有效的图形
     * @param {Object} element
     * @returns {Object|null} 画布上那个同一个图形
     */
    findSameElement(element) {
        if (!element || typeof element.getType !== 'function') return null;
        const type = element.getType();
        if (type !== 'line' && type !== 'circle') return null;
        if (typeof element.updateCoordinate === 'function') element.updateCoordinate();
        for (const other of Object.values(this.repository)) {
            if (!other || other === element) continue;
            if (other.getType() !== type) continue;
            if (!other.getValid() || !other.getVisible()) continue;
            if (type === 'line') {
                if (ToolsFunction.sameLineElement(element, other)) return other;
            }else if (ToolsFunction.sameCircleElement(element, other)) {
                return other;
            }
        }
        return null;
    }

    /**
     * 取走「上一次作图没有产生新图形」的标记 过程函数
     * 两种来源：落图形前先问一遍画布上有没有同一个图形（有就把这次作图整个作废）；
     * 或交点工具选完两个图形后没标出任何交点。
     * storage 监听靠这个标记跳过撤销历史与步数（L/E）计数
     * @returns {boolean}
     */
    takeDuplicatedFlag() {
        const flag = this.duplicatedFlag === true;
        this.duplicatedFlag = false;
        return flag;
    }

    /**
     * 保存指定工具的所有缓存对象
     * @param {string} tool
     */
    loadTool(tool) {
        // 检查存在性
        if (!Object.keys(this.choice).includes(tool)) return;
        
        const elements = Object.values(this.choice[tool]);
        // 预检：这次要作出的图形画布上已经有了 → 整次作图作废（半成品点也不落）
        if (elements.some(element => element.type === 'create' && this.findSameElement(element.create))) {
            this.duplicatedFlag = true;
            this.deleteTool(tool);
            return;
        }
        
        // 保存
        for (const element of elements) {
            // 缓存对象为ID形式，说明是引用已存在的对象，跳过
            if (element.type === 'create') {
                // 「谁依赖谁」由 Point.modifyBase / Line·Circle.modifyDefine 自己登记，这里只把对象收进仓库
                this.addObject(element.create);
            }
        }
        
        // 删除
        this.deleteTool(tool);
    }
    
    /**
     * 删除所有缓存对象
     */
    deleteAllCache() {
        this.choice = new Object();
    }
    
    /**
     * 光标附近最近的交点
     * 做法与「取最近的 2 个图形再求交」不同：先把光标附近的线与圆全部取出来两两求交，
     * 再挑离光标最近的那个候选。后者会因为「最近的 2 个图形」不一定是光标下相交的那一对，
     * 而取到它们在很远处的交点（光标下明明有交点却标不出来），前者不会。
     * @param {number} x
     * @param {number} y
     * @param {number} [tolerance] 允许的距离（画布坐标，默认与 near 的吸附范围一致）
     * @returns {{x: number, y: number, element1: Object, element2: Object, index: number, distance: number}|null}
     */
    nearestIntersection(x, y, tolerance) {
        const limit = tolerance || 15 / this.transform.scale;
        // 附近的线与圆（near 只在吸附范围内返回，最多取 12 个，够覆盖实际叠图）。
        // 这里按原范围认网格线：格线与格线的交点是格点，网格题里要照 15px 吸附（gridReach: 1），
        // 不受 near 对网格收紧的那一半影响
        const ids = this.near([x, y], ["line", "circle"], 12, [], {gridReach: 1});
        let best = null;
        for (let i = 0; i < ids.length; i++) {
            for (let j = i + 1; j < ids.length; j++) {
                const element1 = this.get(ids[i]);
                const element2 = this.get(ids[j]);
                if (!element1 || !element2) continue;
                ToolsFunction.intersectionCandidates(element1, element2).forEach(candidate => {
                    // 线段 / 射线之外的交点不算
                    if (!ToolsFunction.pointInElementRange(candidate.x, candidate.y, element1)) return;
                    if (!ToolsFunction.pointInElementRange(candidate.x, candidate.y, element2)) return;
                    const distance = Math.hypot(candidate.x - x, candidate.y - y);
                    if (distance > limit) return;
                    if (!best || distance < best.distance) {
                        best = {
                            x: candidate.x,
                            y: candidate.y,
                            element1: element1,
                            element2: element2,
                            index: candidate.index,
                            distance: distance,
                        };
                    }
                });
            }
        }
        return best;
    }

    /**
     * 根据坐标返回附近对象
     * @param {[number, number]} coord xy坐标
     * @param {string[]} types 类型表单
     * @param {number} maxQuote 最大取数
     * @param {string[]} ignore 以id忽略表单
     * @param {{gridReach?: number}} [options] gridReach：网格对象的吸附范围倍数（默认 0.5）
     * @return {string[]} id表单
     */
    near(coord, types, maxQuote = 1, ignore = [], options = {}) {
        const minDistance = 15 / this.transform.scale;
        // 网格是背景、又是一大片铺满画布的图形：它的吸附范围比普通图形收紧一半 ——
        // 离格线还差十几像素的点击不该被格线抢走（按原范围认格点交点时由调用方传 gridReach: 1）
        const gridReach = typeof options.gridReach === 'number' ? options.gridReach : 0.5;
        const isGridElement = element => typeof window.isGridObjectId === 'function'
            && window.isGridObjectId(element.getId());
        const container = new Array();
        const [x, y] = coord;
        const all = Object.values(this.repository);
   
        const scan = elementList => {
            for (const element of elementList) {
                if (container.length >= maxQuote) return;
                if (!element.getValid()) continue;
                if (!element.getVisible()) continue;
                
                const type = element.getType();
                if (!types.includes(type)) continue;
                
                const reach = isGridElement(element) ? minDistance * gridReach : minDistance;
                const id = type === "point" ? nearPoint(x, y, element, reach)
                    : type === "line" ? nearLine(x, y, element, reach)
                    : type === "circle" ? nearCircle(x, y, element, reach)
                    : undefined;
                if (ignore.includes(id)) continue;
                if (id) container.push(id);
            }
        };
        // 优先级（叠在一起时优先选范围更小、更靠上层的那个）：
        // 先点（交点这类点常常正压在直线 / 圆上），再线段、射线、直线，最后圆；
        // 同一档位里**后画的先被选到** —— 后画的图形盖在先画的上面，选中的也该是看得见的那个。
        // 原来每一档都按插入顺序扫、先命中的返回，于是两条重叠的线段永远只能选到先画的那条。
        // order 就是作图顺序，取它反向比较即可
        const order = new Map(all.map((element, index) => [element, index]));
        if (types.includes("point")) {
            const points = all.filter(element => element.getType() === "point");
            // 同一个位置压着好几个点时：先选自由点（能拖得动的那种，base.type === 'none'），
            // 其余按作图倒序（后画的先被选到）。绘制顺序不在这里管，照旧按作图顺序画
            const isFree = element => element.getBase()?.type === 'none' ? 1 : 0;
            points.sort((a, b) => {
                const freeA = isFree(a);
                const freeB = isFree(b);
                if (freeA !== freeB) return freeB - freeA;
                return order.get(b) - order.get(a);
            });
            scan(points);
        }
        if (types.includes("line")) {
            // 网格是背景：与格线「重合」或「交叉」时优先选用户自己画的线段 / 射线 / 直线，
            // 否则点在（压在格线上的）自己的图形上会选中后面的网格（见移动工具）。
            // 用户线之间按 线段 → 射线 → 直线（范围小的优先），同一档里后画的优先，
            // 网格的一律排在线族最末（只有附近确实没有用户线时才轮得到网格，网格照旧可点可改）
            const lines = all.filter(element => element.getType() === "line");
            const lineRank = element => {
                const drawType = element.getDrawType();
                const base = drawType === 'lineSegment' ? 0 : drawType === 'ray' ? 1 : 2;
                return isGridElement(element) ? base + 3 : base;
            };
            lines.sort((one, two) => lineRank(one) - lineRank(two) || order.get(two) - order.get(one));
            scan(lines);
        }
        if (types.includes("circle")) {
            // 圆同理：叠在一起时取后画的那个
            const circles = all.filter(element => element.getType() === "circle");
            circles.sort((one, two) => order.get(two) - order.get(one));
            scan(circles);
        }
        return container;
        
        
        function nearPoint(x, y, element, minDistance) {
            const [pointX, pointY] = element.getCoordinate();
            const dx = x - pointX;
            const dy = y - pointY;
            const distance = Math.sqrt(dx*dx + dy*dy);
    
            if (distance < minDistance) {
                const id = element.getId();
                return id;
            }
        }
        function nearLine(x, y, element, minDistance) {
            const coordList = element.getCoordinate();
            const [pointX1, pointY1] = coordList[0];
            const [pointX2, pointY2] = coordList[1];

            const p1 = {x: pointX1, y: pointY1};
            const p2 = {x: pointX2, y: pointY2};
            const p3 = {x, y};
            const result = ToolsFunction.pointToLineDistance(p1, p2, p3);
            if (!result.flag) return null;
            const distance = result.value;
            if (distance >= minDistance) return null;

            // 线段 / 射线只在自己那一段上算命中：点在延长线上时留给同一条直线去命中，
            // 否则点直线（线段之外的部分）会被线段 / 射线抢走
            const drawType = element.getDrawType();
            if (drawType === 'lineSegment' || drawType === 'ray') {
                const dx = p2.x - p1.x;
                const dy = p2.y - p1.y;
                const lengthSquared = dx * dx + dy * dy;
                if (lengthSquared > 1e-10) {
                    // 命中点在 p1→p2 方向上的投影比例，端点多留一点容差，贴着端点也能选中
                    const t = ((x - p1.x) * dx + (y - p1.y) * dy) / lengthSquared;
                    const slack = minDistance / Math.sqrt(lengthSquared);
                    const outside = drawType === 'lineSegment' ? (t < -slack || t > 1 + slack) : t < -slack;
                    if (outside) return null;
                }
            }
            const id = element.getId();
            return id;
        }
        function nearCircle(x, y, element, minDistance) {
            const coordList = element.getCoordinate();
            const [centerX, centerY] = coordList[0];
            const [pointX, pointY] = coordList[1];
            
            const radius = Math.hypot((centerX - pointX), (centerY - pointY));
            const distance = Math.hypot((centerX - x), (centerY - y));
            
            if (radius - minDistance < distance && distance < radius + minDistance) {
                const id = element.getId();
                return id;
            }
        }
    }
    
    /**
     * ID生成器
     * 名字按 gmt 的写法来：点 A..Z / A1..Z1…，直线与射线 s1、s2…，线段 S1、S2…，圆 c1、c2…；
     * 已经占着的名字（画布上的、工具缓存里这次刚作出的）一律跳过去（见 ToolsFunction.nextIdOf）
     * @param {"point" | "line" | "circle" | "other"} type other 是老写法，按直线处理
     * @param {string} tool
     * @param {"line" | "ray" | "lineSegment"} [drawType] 直线的绘制类型（线段要 S 开头的名字）
     * @return {string} ID
     */
    getId(type, tool = "none", drawType = null) {
        // 已经占着的名字：画布上的对象 + **所有**工具缓存里这次刚作出的 —— 只查「本工具」不够：
        // createPoint / createLine 这些工厂是从半成品里取名的（取点时还不知道属于哪个工具），
        // 于是同一个作图里第二次取点会拿到与第一次相同的名字，名字要等 addObject 查重时才改正，
        // 而按 id 为键的依赖链（superstructure）在改正之前就登记好了 —— 表现就是
        // 「拖动时某个派生点卡住不动，撤回一次（按快照重建）后又好了」（见 addObject 里的后置修补）
        const taken = new Set(Object.keys(this.repository));
        Object.values(this.choice).forEach(entries => {
            Object.values(entries || {}).forEach(item => {
                if (item && item.type === "create" && item.create) taken.add(item.create.getId());
            });
        });
        let kind = "line";
        if (type === "point") kind = "point";
        else if (type === "circle") kind = "circle";
        else if (drawType === "lineSegment") kind = "segment";
        return ToolsFunction.nextIdOf(kind, taken) || (type === "point" ? "A" : "s1");
    }
    
    /**
     * 点对象工厂
     * @param {number} x
     * @param {number} y
     * @return {Object} 返回点对象
     */
    createPoint(x, y) {
        const id = this.getId("point");
        const pointObject = new Point(id, x, y);
        const style = this.geometryStyle.point;
        if (style.colorChoice === "color") {
            pointObject.modifyColor(style.color);
        }else if (style.colorChoice === "autoPlayMode") {
            pointObject.modifyColor("#808080");
        }
        pointObject.modifyWidth(style.width || 1);
        if (style.showName) pointObject.modifyShowName(true);
        return pointObject;
    }
    
    /**
     * 直线对象工厂
     * @param {string} type
     * @param {Object[]} define
     * @param {number} [value=0] 
     * @return {Object} 返回直线对象
     */
    createLine(type, define, value = 0, drawType = null) {
        const id = this.getId("line", "none", drawType);
        const lineObject = new Line(id);
        lineObject.modifyDefine(type, define, value);
        const lineStyle = this.geometryStyle.line;
        if (lineStyle.colorChoice === "color") {
            lineObject.modifyColor(lineStyle.color);
        }else if (lineStyle.colorChoice === "autoPlayMode") {
            lineObject.modifyColor("#808080");
        }
        return lineObject;
    }
    
    /**
     * 圆对象工厂
     * @param {string} type
     * @param {Object[]} define
     * @param {number} [value=0] 
     * @return {Object} 返回圆对象
     */
    createCircle(type, define, value = 0) {
        const id = this.getId("circle");
        const circleObject = new Circle(id);
        circleObject.modifyDefine(type, define, value);
        const circleStyle = this.geometryStyle.circle;
        if (circleStyle.colorChoice === "color") {
            circleObject.modifyColor(circleStyle.color);
        }else if (circleStyle.colorChoice === "autoPlayMode") {
            circleObject.modifyColor("#808080");
        }
        return circleObject;
    }

    /**
     * 创建几何元素对接工具
     * @param {string} type 几何元素类型，有'point', 'line', 'circle'
     * @param {string} tool
     * @param {string} key
     */
    createGeometryElementInputTool(type, tool, key, drawType = null) {
        if (type === "point") {
            const id = this.getId("point", tool);
            const pointObject = new Point(id, 0, 0);
            const style = this.geometryStyle.point;
            if (style.colorChoice === "color") {
                pointObject.modifyColor(style.color);
            }else if (style.colorChoice === "autoPlayMode") {
                pointObject.modifyColor("#808080");
            }
            pointObject.modifyWidth(style.width || 1);
            if (style.showName) pointObject.modifyShowName(true);
            this.addToolObject(tool, key, "append", pointObject);
        }else if (type === "line") {
            // 线段的名字是 S1、S2…，直线 / 射线是 s1、s2…：要看这一笔画的是哪一种
            const id = this.getId("line", tool, drawType);
            const lineObject = new Line(id);
            if (drawType) lineObject.modifyDrawType(drawType);
            const style = this.geometryStyle.line;
            if (style.colorChoice === "color") {
                lineObject.modifyColor(style.color);
            }else if (style.colorChoice === "autoPlayMode") {
                lineObject.modifyColor("#808080");
            }
            lineObject.modifyWidth(style.width || 1);
            lineObject.modifyDashed(!!style.dashed);
            if (style.showName) lineObject.modifyShowName(true);
            this.addToolObject(tool, key, "append", lineObject);
        }else if (type === "circle") {
            const id = this.getId("circle", tool);
            const circleObject = new Circle(id);
            const style = this.geometryStyle.circle;
            if (style.colorChoice === "color") {
                circleObject.modifyColor(style.color);
            }else if (style.colorChoice === "autoPlayMode") {
                circleObject.modifyColor("#808080");
            }
            circleObject.modifyWidth(style.width || 1);
            circleObject.modifyDashed(!!style.dashed);
            if (style.showName) circleObject.modifyShowName(true);
            this.addToolObject(tool, key, "append", circleObject);
        }
    }
    
    /**
     * 遍历更新上层建筑
     * @param {Object} element 几何对象 - 可以是点、线、圆
     */
    #updateSuperstructureChain(element) {
        const queue = new Array();
        const visitedId = new Set(); // 添加对象时验证
        const rangeId = new Set();
        const processedId = new Set();
        
        // 确定遍历范围，性能优化
        queue.unshift(element);
        while (queue.length) {
            // 取
            const currentElement = queue.pop();
            // 生成
            const superstructures = currentElement.getSuperstructure();
            superstructures.forEach((item) => {
                const id = item.getId();
                if (!rangeId.has(id)) {
                    queue.unshift(item);
                    rangeId.add(id);
                }
            });
        }
        
        // 跳过当前对象的修改
        const superstructures = element.getSuperstructure();
        superstructures.forEach((item) => {
            queue.unshift(item);
            visitedId.add(item.getId());
        });
        while (queue.length) {
            // 取
            const currentElement = queue.pop();
            const currentElementId = currentElement.getId();
            // 修改当前对象
            const type = currentElement.getType();
            if (type === "point") {
                const base = currentElement.getBase();
                // 延迟更新：基底在本次范围内、却还没重算完的点先让位（与线 / 圆同一套守卫）。
                // 交点、线上点、中点、圆心、无穷远点、极点的基底都可能是链条上游，
                // 不排队就会拿旧坐标算出新位置
                if (base.type !== 'none' && Array.isArray(base.bases)) {
                    const basePending = base.bases.some(item => {
                        const id = item && typeof item.getId === 'function' ? item.getId() : null;
                        return !!id && rangeId.has(id) && !processedId.has(id);
                    });
                    if (basePending) {
                        queue.unshift(currentElement);
                        continue;
                    }
                }
                // 更新点坐标和有效性
                if (base.type === 'none') {
                    // 自由点：坐标由调用方（拖动 / 详情面板）直接改写，这里不用管
                }else if (base.type === 'intersection') {
                    const [base1, base2] = base.bases;
                    // 更新
                    let valid1 = false, valid2 = false;
                    
                    const validCoord = ToolsFunction.updateIntersectionCoordinate(base);
                    valid1 = validCoord.valid;
                    if (valid1) {
                        const [x, y] = validCoord.coordinate;
                        currentElement.modifyCoordinate(x, y)
                    }
                    if (base1.getValid() && base2.getValid()) valid2 = true;
                    
                    if (valid1 && valid2) {
                        currentElement.modifyValid(true);
                    }else{
                        currentElement.modifyValid(false);
                    }
                }else{
                    // 其余基底（线上点 / 中点 / 圆心 / 无穷远点 / 极点…）统一走 updatePointCoordinate：
                    // 它本来就认全部点基底，不必在这里逐个类型抄一遍 —— 原先只列了四种，
                    // 无穷远点与极点进了链也不重算，于是「一部分图形不随动点更新」
                    const result = ToolsFunction.updatePointCoordinate(base);
                    if (result) {
                        // 基底有一个失效（或算不出来）就整个失效，坐标保留原位，基底恢复后自动回来
                        const basesValid = (base.bases || []).every(item => item.getValid());
                        if (result.type === 'update' && basesValid) {
                            currentElement.modifyCoordinate(result.coordinate[0], result.coordinate[1]);
                            currentElement.modifyValid(true);
                        }else{
                            currentElement.modifyValid(false);
                        }
                    }
                }
            }else if (type === "line" || type === "circle") {
                const defines = currentElement.getDefine();
                // 延迟更新
                let delay = false;
                for (const item of defines) {
                    if (!rangeId.has(item.getId())) continue;
                    if (!processedId.has(item.getId())) {
                        delay = true;
                        break;
                    }
                }
                if (delay) {
                    queue.unshift(currentElement);
                    continue;
                }
                
                // 更新
                let valid = true;
                for (const item of defines) {
                    if (!item.getValid()) {
                        valid = false;
                        break;
                    }
                }
                if (valid) {
                    currentElement.updateCoordinate();
                    currentElement.modifyValid(true);
                }else{
                    currentElement.modifyValid(false);
                }
            }
            // 生成
            const superstructures = currentElement.getSuperstructure();
            superstructures.forEach((item) => {
                const id = item.getId();
                if (!visitedId.has(id)) {
                    queue.unshift(item);
                    visitedId.add(id);
                }
            });
            processedId.add(currentElementId);
        }
    }
    
    /**
     * 修改点坐标
     * @param {string} id
     * @param {number} x
     * @param {number} y
     */
    modifyPointCoordinate(id, x, y) {
        const point = this.get(id);
        if (point.getType() !== "point") return;
        
        if (point.getBase().type === 'none') {
            point.modifyCoordinate(x, y);
            this.#updateSuperstructureChain(point);
        }else if (point.getBase().type === 'online') {
            const [element] = point.getBase().bases;
            let modifyX = x,
                modifyY = y;
            if (element.getType() === "line") {
                const [point1Coord, point2Coord] = element.getCoordinate();
                const p1 = {x: point1Coord[0], y: point1Coord[1]};
                const p2 = {x: point2Coord[0], y: point2Coord[1]};
                const p3 = {x, y};
                
                // 坐标用「不夹紧的比例」（scalePoint 就是按比例取点的；nearPointOnLine 会把比例夹到
                // [0,1]，角平分线上的点常在这一小段之外，夹紧后就拖不动了），
                // 存进基底的参数用 onlineValueOf 换算成 gmt 约定（角平分线每 100 单位一个参数）。
                // 两者不能混用：拿换算后的参数去 scalePoint，点会直接落到错误位置
                const stepX = p2.x - p1.x;
                const stepY = p2.y - p1.y;
                const stepLengthSquared = stepX * stepX + stepY * stepY;
                if (stepLengthSquared < 1e-20) return;
                const proportion = ((p3.x - p1.x) * stepX + (p3.y - p1.y) * stepY) / stepLengthSquared;
                const coord = ToolsFunction.scalePoint(p1, p2, proportion);
                modifyX = coord.x;
                modifyY = coord.y;
                point.modifyBase("online", [element], ToolsFunction.onlineValueOf(element, p1, p2, p3));
            }else if (element.getType() === "circle") {
                const [point1Coord, point2Coord] = element.getCoordinate();
                const p1 = {x: point1Coord[0], y: point1Coord[1]};
                const p2 = {x: point2Coord[0], y: point2Coord[1]};
                const p3 = {x, y};
                
                const value = ToolsFunction.nearPointOnCircle(p1, p3);
                const coord = ToolsFunction.radianToCoordinate(p1, p2, value);
                modifyX = coord.x;
                modifyY = coord.y;
                point.modifyBase("online", [element], value);
            }
            point.modifyCoordinate(modifyX, modifyY);
            this.#updateSuperstructureChain(point);
        }
    }
    
    /**
     * 存储
     * 就存在工具缓存里 —— 于是保存记录 / 记一步历史这类读操作会把选中的对象悄悄清掉
     * （典型现象：选中图形后在「调整对象样式」面板里改一下，选中就没了）。
     * 载入 / 清空画布那条路会走 deleteAll()，那里仍然会把缓存一起清掉
     * @returns {dict[]}
     */
    toStorage() {
        const copy = [];
        for (const value of Object.values(this.repository)) {
            copy.push(value.getDict());
        }
        return copy;
    }
    
    /**
     * 加载存储
     * @param {dict[]} elements
     */
    loadStorage(elements) {
        this.deleteAll();
        this.appendStorage(elements);
    }

    /**
     * 追加一批元素（不清空画布） 过程函数
     * 与 loadStorage 走同一套三步：反序列化 → 接基底 → 上样式色；
     * 区别只在不清空画布、样式色也只刷这次加进来的那批（见生成网格）
     * @param {dict[]} elements
     */
    appendStorage(elements) {
        // 1.反序列化为元素
        for (const item of elements) {
            const element = deserialization(item);
            this.addObject(element);
        }

        // 2.添加元素间连接
        // 快照本身残缺时（基底的 id 在仓库里找不到 —— 旧版本把网格按对象逐步记档、切出来的
        // 半套网格就是这样），这类对象接不上定义，接下去只会读出 undefined 的坐标
        // （悬停命中 / 求交会一路抛错），所以连同依赖它们的对象一起清掉，让画布停在能用的那部分
        const brokenIds = [];
        for (const item of elements) {
            const bases = item.base;
            const basesType = bases.type;

            if (basesType === 'none') continue;
            const id = item.id;
            const currentElement = this.get(id);
            const currentElementType = item.type;
            const objectList = [];
            bases.basesId.forEach((id) => {
                objectList.push(this.get(id));
            });
            if (objectList.some(element => !element)) {
                brokenIds.push(id);
                continue;
            }
            if (currentElementType === 'point') {
                // 第四个参数指定的「已知交点」也一并还原，编号时用它排掉重合的那个
                // （依赖登记在 modifyBase 里做，见 Point.modifyBase）
                currentElement.modifyBase(basesType, objectList, bases.value, bases.excludeId ? this.get(bases.excludeId) : null);
            }else if (currentElementType === 'line' || currentElementType === 'circle') {
                currentElement.modifyDefine(basesType, objectList, bases.value);
            }
        }

        // 2.5 清掉基底残缺的对象（连同由它们作出来的对象）
        if (brokenIds.length) {
            const allowDelete = window.gridAllowDelete;
            // 网格平时不可删（见删除守卫），这里是在清残缺对象，临时放行
            window.gridAllowDelete = true;
            brokenIds.forEach(id => { if (this.get(id)) this.deleteObject(id); });
            window.gridAllowDelete = allowDelete;
        }

        // 3.基础图元接好之后再上一次样式色：addObject 时 base 还没接上，
        // 点会被当成自由点统统涂红（交点 / 中点 / 圆心本来该是灰的）。
        // appendStorage 只刷这次加进来的那批，画布上原有的对象不动
        elements.forEach(item => {
            const element = this.get(item.id);
            if (element) this.applyAutoStyle(element);
        });

        function deserialization(elementDict) {
            const type = elementDict.type;
            const id = elementDict.id;
            const name = elementDict.name;
            const visible = elementDict.visible;
            const valid = elementDict.valid;
            const color = elementDict.color;
            const showName = elementDict.showName;
            const width = elementDict.width;
            
            let element;
            if (type === 'point') {
                const x = elementDict.x;
                const y = elementDict.y;
                element = new Point(id, x, y);
            }else if (type === 'line') {
                element = new Line(id);
                element.modifyDrawType(elementDict.drawType);
            }else if (type === 'circle') {
                element = new Circle(id);
            }

            element.modifyName(name);
            element.modifyVisible(visible);
            element.modifyValid(valid);
            element.modifyShowName(showName);
            element.modifyColor(color);
            element.modifyWidth(width || 1);
            element.modifyDashed(!!elementDict.dashed);
            return element;
        }
    }
}

/**
 * 应用元素一览详情里某个输入框的改动 过程函数
 * 名称 / x / y / 基底值 / 颜色都在这里改；调用方只管重绘与记一步历史
 * @param {Object} target 触发 change 的输入框（id 形如 item-<元素id>-<字段>-input）
 * @returns {string|null} 记录历史用的类型（'name' | 'move' | 'style'）；没改动 / 非法输入返回 null
 */
function applyGeometryItemInput(target) {
    const matched = target?.id?.match(/^item-(.+)-(name|x|y|base-value|color)-input$/);
    if (!matched) return null;
    const [, id, field] = matched;
    const element = geometryManager.get(id);
    if (!element) return null;

    // 颜色
    if (field === 'color') {
        element.modifyColor(target.value);
        return 'style';
    }

    // 名称：重名的话给重名那个加 1 / 2 / 3…（见 renameGeometryElement）
    if (field === 'name') {
        const name = String(target.value || '').trim();
        if (!name || name === element.getName()) {
            target.value = element.getName();
            return null;
        }
        renameGeometryElement(id, name);
        return 'name';
    }

    // 坐标：只有自由点能移动；线上点会被投影回线上（见 modifyPointCoordinate）
    if (field === 'x' || field === 'y') {
        const coord = element.getCoordinate();
        const value = Number(target.value);
        if (element.getType() !== 'point' || !Array.isArray(coord) || !Number.isFinite(value)) {
            if (Array.isArray(coord)) target.value = field === 'x' ? coord[0] : coord[1];
            return null;
        }
        geometryManager.modifyPointCoordinate(id,
            field === 'x' ? value : coord[0],
            field === 'y' ? value : coord[1]);
        const now = element.getCoordinate();
        target.value = field === 'x' ? now[0] : now[1];
        return 'move';
    }

    // 基底值：线上点的参数 / 交点取第几个（自由点、中点、圆心没有可改的值）
    const base = typeof element.getBase === 'function' ? element.getBase() : null;
    const value = Number(target.value);
    const changeable = base && element.getType() === 'point'
        && base.type !== 'none' && base.type !== 'middlePoint' && base.type !== 'center';
    if (!changeable || !Number.isFinite(value)) {
        if (base) target.value = base.value;
        return null;
    }
    element.modifyBase(base.type, base.bases, value, base.exclude);
    // 改完再借已知坐标走一次「移动点」：让上层建筑跟着重算
    const coord = element.getCoordinate();
    if (Array.isArray(coord) && typeof coord[0] === 'number') {
        geometryManager.modifyPointCoordinate(id, coord[0], coord[1]);
    }
    return 'move';
}

/**
 * 显示用的数字 过程函数
 * @param {number} value
 * @returns {string}
 */
function displayNumber(value) {
    if (!Number.isFinite(value)) return '—';
    return String(value);
}

/**
 * 直线的斜率文字 过程函数（竖直线的斜率写成 ∞）
 */
function lineSlopeText(coord) {
    // 退化对象（基点失效 / 基底还没接上）没有坐标：显示成「—」，别把一览与详情整块打断
    if (!coord) return '—';
    const [p1, p2] = coord;
    if (Math.abs(p2[0] - p1[0]) < 1e-9) return '∞（竖直）';
    return displayNumber((p2[1] - p1[1]) / (p2[0] - p1[0]));
}

/**
 * 直线的截距文字 过程函数（竖直线的 y 轴截距不存在）
 */
function lineInterceptText(coord) {
    if (!coord) return '—';
    const [p1, p2] = coord;
    if (Math.abs(p2[0] - p1[0]) < 1e-9) return '—';
    const k = (p2[1] - p1[1]) / (p2[0] - p1[0]);
    return displayNumber(p1[1] - k * p1[0]);
}

/**
 * 圆的圆心文字 过程函数
 */
function circleCenterText(coord) {
    if (!coord) return '—';
    return `(${displayNumber(coord[0][0])}, ${displayNumber(coord[0][1])})`;
}

/**
 * 圆的半径文字 过程函数
 */
function circleRadiusText(coord) {
    if (!coord) return '—';
    return displayNumber(Math.hypot(coord[1][0] - coord[0][0], coord[1][1] - coord[0][1]));
}

/**
 * 给图形改名 过程函数
 * 名称与别的图形重名时，那些重名的图形依次加上 1、2、3… 后缀（1 也被占了就试 2，以此类推）
 * @param {string} id 被改名的图形
 * @param {string} name 新名称（调用方保证已去空格且非空）
 * @returns {boolean} 是否真的改了名
 */
function renameGeometryElement(id, name) {
    const element = geometryManager.get(id);
    if (!element || !name) return false;
    element.modifyName(name);
    const taken = new Set([name]);
    geometryManager.getAllByOrder().forEach(item => {
        if (item.getId() === id || item.getName() !== name) return;
        let index = 1, candidate = name + index;
        while (taken.has(candidate)) {
            index++;
            candidate = name + index;
        }
        taken.add(candidate);
        item.modifyName(candidate);
    });
    return true;
}