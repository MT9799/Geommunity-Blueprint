/* storageLoad.js */

/**
 * 几何元素全存储
 */
class StorageManager {
    constructor() {
        this.repository = [];
        this.pointer = -1;
        this.status = false;
    }
    
    /**
     * 存储
     * @param {any} snapshot 快照：几何对象数组，或 {elements, lists}（含选定栏，如标记）
     */
    append(snapshot) {
        if (!this.status) return;
        this.pointer++;
        // 删除后继列表元素并添加新元素
        this.repository.splice(this.pointer, Infinity, snapshot);
    }
    
    /**
     * 快照浅拷贝
     * 兼容两种格式：早期的「元素数组」与现在的「元素 + 选定栏」对象
     * @param {any} snapshot
     * @returns {any}
     */
    copy(snapshot) {
        if (Array.isArray(snapshot)) return [...snapshot];
        const lists = {};
        const snapshotLists = snapshot?.lists || {};
        for (const [key, value] of Object.entries(snapshotLists)) lists[key] = [...value];
        // grid：网格信息（{m, n, unit, style} 或 null）—— 不带上它的话，撤销 / 重做之后
        // 网格对象回来了、网格标记却丢了（导出不再带 #grid= 行、求解器也不认这是网格模式）
        return {elements: [...(snapshot?.elements || [])], lists: lists, grid: snapshot?.grid || null};
    }
    
    /**
     * 恢复
     * @returns {any}
     */
    restore() {
        if (this.pointer === 0) return;
        this.pointer--;
        return this.copy(this.repository[this.pointer]);
    }
    
    /**
     * 重做
     * @returns {any}
     */
    redo() {
        if (this.pointer === this.repository.length) return;
        this.pointer++;
        return this.copy(this.repository[this.pointer]);
    }
    
    /**
     * 获取指针状态
     * @returns {[boolean, boolean]} top-bottom
     */
    getPointerStatus() {
        const len = this.repository.length;
        const list = new Array();
        if (this.pointer + 1 === len) {
            list.push(true);
        }else{
            list.push(false);
        }
        if (this.pointer <= 0) {
            list.push(true);
        }else{
            list.push(false);
        }
        return list;
    }
    
    /**
     * 重置
     */
    clear() {
        this.repository = [];
        this.pointer = -1;
    }

    /**
     * 使能
     * @param {boolean} bool 
     */
    setStatus(bool) {
        this.status = bool;
    }

    /**
     * 序列化
     * @returns {string} JSON
     */
    serialization() {
        const dict = {};
        dict.repository = this.repository;
        dict.pointer = this.pointer;
        dict.status = this.status;
        const json = JSON.stringify(dict);
        return json;
    }

    /**
     * 反序列化
     * @param {string} json 
     */
    deserialization(json) {
        const dict = JSON.parse(json);
        // 存进来的是空值（如字符串 "null"）时当作没有记录，避免解析后取属性报错
        if (!dict) return;
        this.repository = dict.repository;
        this.pointer = dict.pointer;
        this.status = dict.status;
    }
}

/**
 * 步数存储
 */
class MovesStorageManager {
    constructor() {
        this.repository = [];
        this.pointer = -1;
        this.status = false;
    }
    
    /**
     * 存储
     * @param {{string: number}} moveDict
     */
    append(moveDict) {
        if (!this.status) return;
        this.pointer++;
        // 浅拷贝避免同一对象引用
        const copyDict = Object.assign({}, moveDict);
        // 删除后继列表元素并添加新元素
        this.repository.splice(this.pointer, Infinity, copyDict);
    }

    /**
     * 读取
     * @returns {{string: number}}
     */
    get() {
        const copy = Object.assign({}, this.repository[this.pointer]);
        return copy;
    }
    
    /**
     * 恢复
     * @returns {{string: number}}
     */
    restore() {
        if (this.pointer === 0) return;
        this.pointer--;
        const copy = Object.assign({}, this.repository[this.pointer]);
        return copy;
    }
    
    /**
     * 重做
     * @returns {{string: number}}
     */
    redo() {
        if (this.pointer === this.repository.length) return;
        this.pointer++;
        const copy = Object.assign({}, this.repository[this.pointer]);
        return copy;
    }
    
    /**
     * 重置
     */
    clear() {
        this.repository = [];
        this.pointer = -1;
    }

    /**
     * 使能
     * @param {boolean} bool 
     */
    setStatus(bool) {
        this.status = bool;
    }
    
    /**
     * 序列化
     * @returns {string} JSON
     */
    serialization() {
        const dict = {};
        dict.repository = this.repository;
        dict.pointer = this.pointer;
        dict.status = this.status;
        const json = JSON.stringify(dict);
        return json;
    }

    /**
     * 反序列化
     * @param {string} json 
     */
    deserialization(json) {
        const dict = JSON.parse(json);
        // 存进来的是空值（如字符串 "null"）时当作没有记录，避免解析后取属性报错
        if (!dict) return;
        this.repository = dict.repository;
        this.pointer = dict.pointer;
        this.status = dict.status;
    }
}
