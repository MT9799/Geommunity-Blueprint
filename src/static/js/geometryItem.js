/* geometryItem.js */

const overviewPanelSelector = document.getElementById("overview-select");
let overviewPanelSelect = 'all';
// 当前正在查看详情的元素 id：撤销 / 重做后按它把详情面板重画一遍
let openedGeometryItemId = null;
// 「一览」与「详情」共用的最小高度：两边撑到一样高，切来切去面板不会跳（见 primeOverviewListHeight）
let overviewListMinHeight = 0;
/**
 * 把量好的最小高度写到一览与详情两个容器上 过程函数
 */
function applyOverviewMinHeight() {
    if (overviewListMinHeight <= 0) return;
    const height = `${overviewListMinHeight}px`;
    const listMode = document.getElementById("geometry-item-list");
    const viewerMode = document.getElementById("geometry-item");
    if (listMode) listMode.style.minHeight = height;
    if (viewerMode) viewerMode.style.minHeight = height;
}
/**
 * 记下刚画好的详情有多高 过程函数
 * 详情（三列那块）画完之后量一次，取见过的最高那个，写回两个容器的 min-height
 */
function syncOverviewListHeight(viewerMode) {
    if (!viewerMode) return;
    const height = Math.round(viewerMode.getBoundingClientRect().height);
    if (height <= 0) return;
    overviewListMinHeight = Math.max(overviewListMinHeight, height);
    applyOverviewMinHeight();
}
/**
 * 刚打开一览（还没点过任何图形）时先把每个图形的详情都量一遍 过程函数
 * 详情高度跟图形有关，不画出来量不到 —— 那就把一览里的图形逐个偷偷点一下
 * （只走「画详情」那条路，量完立刻退回列表），连同列表自己有多高，取最大的当共同的最小高度。
 * 于是「刚点进一览」「点进最矮的详情」和「最高的详情」面板一样高，不会来回跳
 */
function primeOverviewListHeight() {
    if (overviewListMinHeight > 0) return;
    const overview = document.getElementById("container_overview");
    const listMode = document.getElementById("geometry-item-list");
    const viewerMode = document.getElementById("geometry-item");
    if (!overview || !listMode || !viewerMode) return;
    const items = [...overview.querySelectorAll('[data-action]')];
    if (!items.length || typeof selectElementByOverview !== 'function') return;
    // 列表自己现在多高（那 15 格网格 + 下拉框）也要算进来：不然后来退回列表会被详情的高度压矮
    const listHeight = Math.round(listMode.getBoundingClientRect().height);
    // 量的时候别让人看见闪一下（visibility 不影响布局，量到的还是真高度）
    viewerMode.style.visibility = "hidden";
    // 「全部」档点一下才是看详情，别的档点一下改的是标记 —— 这里借道走一次，借完就还
    const selectBefore = overviewPanelSelect;
    overviewPanelSelect = "all";
    items.forEach(item => {
        // 逐个按自己的内容量（上一条记下的最小高度先撤掉，不然量到的都是它）
        viewerMode.style.minHeight = "";
        selectElementByOverview({target: item});
    });
    overviewPanelSelect = selectBefore;
    overviewListMinHeight = Math.max(overviewListMinHeight, listHeight);
    applyOverviewMinHeight();
    closeItem();
    viewerMode.style.visibility = "";
}
/**
 * 重画当前正在查看的元素详情 过程函数
 * 撤销 / 重做会重建图形（面板里的旧对象、控件状态都会失效），这时整块重画一次
 */
function refreshOpenedGeometryItem() {
    const viewerMode = document.getElementById("geometry-item");
    if (!openedGeometryItemId || !viewerMode || viewerMode.style.display === "none") return;
    if (typeof window.showGeometryItemDetail === 'function') window.showGeometryItemDetail(openedGeometryItemId);
}
overviewPanelSelector.addEventListener('change', overviewPanelSelectorChanged);
// 一览面板右上角的关闭按钮：回到构造面板（与记录面板的 ✕ 一个意思）
const overviewCloseButton = document.getElementById("overview-close");
if (overviewCloseButton) {
    const closeTemplate = document.getElementById("svg-menuClose");
    if (closeTemplate) overviewCloseButton.innerHTML = closeTemplate.innerHTML;
    overviewCloseButton.title = typeof t === 'function' ? t('common.close') : '关闭';
    overviewCloseButton.addEventListener('click', () => {
        if (typeof switchPanel === 'function') switchPanel('toolbarPanel');
    });
}
/**
 * 「所求」档要显示的所有解判定集合 过程函数
 * 解 1 的键是 result，解 k 是 resultK（与标记工具一致）；
 * 只查 result 的话第二个解之后的对象都不会亮
 * @returns {Set[]}
 */
function overviewResultJudgedSets() {
    const sets = [];
    for (let index = 1; index <= 20; index++) {
        const key = index === 1 ? 'result' : `result${index}`;
        if (geometryElementLists[key]) sets.push(geometryElementLists[key]);
    }
    return sets;
}

/**
 * 几何元素列表选择器变化
 */
function overviewPanelSelectorChanged() {
    overviewPanelSelect = overviewPanelSelector.value;
    loadGeometryElements();
}

/**
 * 加载几何元素预览
 */
function loadGeometryElements() {
    const overview = document.getElementById("container_overview");
    // 已经量过就按那个高度撑住列表与详情（见 syncOverviewListHeight）：面板高度不变
    applyOverviewMinHeight();
    // 网格当作一整块：只列「格线」一行。位置放在**它原本出现的地方** ——
    // 网格生成之前作的图形排在它前面、之后作的排在它后面，与作图 / 撤销历史同一口径
    // （不再固定挂在第一行）。模板里的辅助对象不列
    const allElements = geometryManager.getAllByOrder();
    const gridIds = (typeof window.isGridObjectId === 'function'
        && typeof geometryElementLists !== 'undefined' && geometryElementLists.grid)
        ? [...geometryElementLists.grid] : [];
    const gridSegments = gridIds.filter(id => /^gS[XY]\d+$/.test(id))
        .map(id => geometryManager.get(id)).filter(Boolean);
    // 拿第一条格线当原型（其余方法照旧转发），只把名字换成「格线」
    const gridRow = gridSegments.length ? (() => {
        const row = Object.create(gridSegments[0]);
        row.getName = () => (typeof t === 'function' ? t('board.gridLabel') : '格线');
        row.getShowName = () => false;
        return row;
    })() : null;
    const geometryElements = [];
    let gridRowPlaced = false;
    allElements.forEach(element => {
        if (gridIds.includes(element.getId())) {
            // 整块网格只在遇到第一个网格对象时插一行
            if (gridRow && !gridRowPlaced) {
                geometryElements.push(gridRow);
                gridRowPlaced = true;
            }
            return;
        }
        geometryElements.push(element);
    });
    // 画布上只剩网格、没有普通对象时也要把「格线」那行列出来
    if (gridRow && !gridRowPlaced) geometryElements.push(gridRow);
    let count = 0;
    overview.innerHTML = "";
    // 「隐藏」档以外（初始 / 可动点 / 所求 / 探索…）看的是标记：被标出的格子换成红框，
    // 而且点一下不再把标记点掉（见 select）；「全部」档没有标出，不算 mark-mode
    overview.classList.toggle('mark-mode',
        !!overviewPanelSelect && overviewPanelSelect !== 'all' && overviewPanelSelect !== 'hidden');
    
    geometryElements.forEach((element) => {
        // 生成
        const item = document.createElement("div");
        const itemText = document.createElement("div");
        const itemIndex = document.createElement("span");
        const itemName = document.createElement("span");
        
        const type = element.getType();
        const name = element.getName();
        count += 1;
        
        // 创建SVG元素
        function createThumbnailSVG(element, type) {
            const svgNS = "http://www.w3.org/2000/svg";
            const size = 200;
            const svg = document.createElementNS(svgNS, "svg");
            svg.setAttribute("viewBox", `0 0 ${size} ${size}`);

            // 网格当作一整块：缩略图用「3×3 的格」（与工具栏「生成网格」同一个图），
            // 颜色与线径跟着格线走 —— 原来它按线段画，只画出一条斜线
            if (typeof window.isGridObjectId === 'function' && window.isGridObjectId(element.getId())) {
                const gridColor = typeof element.getColor === 'function' ? element.getColor() : '#000000';
                const gridWidth = 10 * (typeof element.getWidth === 'function' ? (element.getWidth() || 1) : 1);
                const frame = document.createElementNS(svgNS, "rect");
                frame.setAttribute("x", "30");
                frame.setAttribute("y", "30");
                frame.setAttribute("width", "140");
                frame.setAttribute("height", "140");
                frame.setAttribute("fill", "transparent");
                frame.setAttribute("stroke", gridColor);
                frame.setAttribute("stroke-width", gridWidth);
                svg.appendChild(frame);
                [76.7, 123.3].forEach(position => {
                    const horizontal = document.createElementNS(svgNS, "line");
                    horizontal.setAttribute("x1", 30);
                    horizontal.setAttribute("y1", position);
                    horizontal.setAttribute("x2", 170);
                    horizontal.setAttribute("y2", position);
                    horizontal.setAttribute("stroke", gridColor);
                    horizontal.setAttribute("stroke-width", gridWidth);
                    svg.appendChild(horizontal);
                    const vertical = document.createElementNS(svgNS, "line");
                    vertical.setAttribute("x1", position);
                    vertical.setAttribute("y1", 30);
                    vertical.setAttribute("x2", position);
                    vertical.setAttribute("y2", 170);
                    vertical.setAttribute("stroke", gridColor);
                    vertical.setAttribute("stroke-width", gridWidth);
                    svg.appendChild(vertical);
                });
                return svg;
            }

            if (type === "point") {
                // 中心圆点
                const centerX = size / 2;
                const centerY = size / 2;
                const color = element.getColor();
                
                const centerCircle = document.createElementNS(svgNS, "circle");
                centerCircle.setAttribute("cx", centerX);
                centerCircle.setAttribute("cy", centerY);
                centerCircle.setAttribute("r", "15");
                centerCircle.setAttribute("stroke", color);
                centerCircle.setAttribute("stroke-width", '10');
                centerCircle.setAttribute("fill", 'white');
                svg.appendChild(centerCircle);
            }else if (type === "line") {
                // 直线
                const color = element.getColor();
                const coordList = element.getCoordinate();
                // 退化对象（基点失效 / 基底还没接上）取不到坐标：给个空缩略图，别把整个一览打断
                if (!coordList) return svg;
                const [x1, y1] = coordList[0];
                const [x2, y2] = coordList[1];
                const dx = x1 - x2;
                const dy = y1 - y2;
                const angle = Math.atan2(dy, dx);
                
                const lineLength = size * 0.4; // 线长为方块的40%
                const radian = angle;
                const centerX = size / 2;
                const centerY = size / 2;
                
                const startX = centerX - lineLength * Math.cos(radian);
                const startY = centerY - lineLength * Math.sin(radian);
                const endX = centerX + lineLength * Math.cos(radian);
                const endY = centerY + lineLength * Math.sin(radian);
                
                const directionLine = document.createElementNS(svgNS, "line");
                directionLine.setAttribute("x1", startX);
                directionLine.setAttribute("y1", startY);
                directionLine.setAttribute("x2", endX);
                directionLine.setAttribute("y2", endY);
                directionLine.setAttribute("stroke", color);
                directionLine.setAttribute("stroke-width", "10");
                directionLine.setAttribute("stroke-linecap", "round");
                svg.appendChild(directionLine);

                // 端点
                const point1 = document.createElementNS(svgNS, "circle");
                point1.setAttribute("cx", startX);
                point1.setAttribute("cy", startY);
                point1.setAttribute("r", "15");
                point1.setAttribute("stroke", color);
                point1.setAttribute("stroke-width", '10');
                point1.setAttribute("fill", 'white');
                svg.appendChild(point1);

                const point2 = document.createElementNS(svgNS, "circle");
                point2.setAttribute("cx", endX);
                point2.setAttribute("cy", endY);
                point2.setAttribute("r", "15");
                point2.setAttribute("stroke", color);
                point2.setAttribute("stroke-width", '10');
                point2.setAttribute("fill", 'white');
                svg.appendChild(point2);
            }else if (type === "circle") {
                // 圆圈
                const centerX = size / 2;
                const centerY = size / 2;
                const color = element.getColor();
                const coordList = element.getCoordinate();
                // 退化对象（基点失效 / 基底还没接上）取不到坐标：给个空缩略图，别把整个一览打断
                if (!coordList) return svg;
                const [x1, y1] = coordList[0];
                const [x2, y2] = coordList[1];
                const dx = x1 - x2;
                const dy = y1 - y2;
                const angle = Math.atan2(dy, dx);
                
                const radius = size * 0.4;
                const radian = angle;
                const endX = centerX - radius * Math.cos(radian);
                const endY = centerY - radius * Math.sin(radian);
                
                const centerCircle = document.createElementNS(svgNS, "circle");
                centerCircle.setAttribute("cx", centerX);
                centerCircle.setAttribute("cy", centerY);
                centerCircle.setAttribute("r", radius);
                centerCircle.setAttribute("stroke", color);
                centerCircle.setAttribute("stroke-width", '10');
                centerCircle.setAttribute("fill", 'transparent');
                svg.appendChild(centerCircle);

                // 点点
                const point1 = document.createElementNS(svgNS, "circle");
                point1.setAttribute("cx", centerX);
                point1.setAttribute("cy", centerY);
                point1.setAttribute("r", "15");
                point1.setAttribute("stroke", color);
                point1.setAttribute("stroke-width", '10');
                point1.setAttribute("fill", 'white');
                svg.appendChild(point1);

                const point2 = document.createElementNS(svgNS, "circle");
                point2.setAttribute("cx", endX);
                point2.setAttribute("cy", endY);
                point2.setAttribute("r", "15");
                point2.setAttribute("stroke", color);
                point2.setAttribute("stroke-width", '10');
                point2.setAttribute("fill", 'white');
                svg.appendChild(point2);
            }
            return svg;
        }
        itemText.className = "overview-item-text";
        itemIndex.textContent = `${count}`;
        itemName.textContent = `${name}`;
        
        // 添加
        const id = element.getId();

        const svg = createThumbnailSVG(element, type);
        svg.setAttribute('class', 'svg-item');
        itemText.appendChild(itemIndex);
        itemText.appendChild(itemName);
        item.appendChild(svg);
        item.appendChild(itemText);
        item.className = "overview-item";
        item.setAttribute('data-action', id);
        overview.appendChild(item);

        if (overviewPanelSelect === 'hidden') {
            // 「隐藏」档看的是元素**实际**的显示状态：导入的 gmt 里预绘制的解是靠自身 visible=false
            // 隐藏的，不一定登记在 hidden 集合里，查集合会一个都不亮
            if (!element.getVisible()) item.classList.add('select');
        }else if (overviewPanelSelect === 'result') {
            // 「所求」档把**所有解**的所求判定都标出来，不只是第 1 个解
            if (overviewResultJudgedSets().some(set => set.has(id))) item.classList.add('select');
        }else{
            const set = geometryElementLists[overviewPanelSelect];
            if (set?.has(id)) item.classList.add('select');
        }
    });
    overview.style.display = 'none';
    overview.offsetHeight;
    overview.style.display = 'grid';
    // 头一次打开时先偷偷量一次详情有多高，让列表一开始就撑到那个高度（见 primeOverviewListHeight）
    primeOverviewListHeight();
}

/**
 * 从元素一览选中元素
 */
function selectElementByOverview(event) {
    const target = event.target;
    const id = event.target?.dataset.action;
    if (!id) return;
    
    if (overviewPanelSelect === "all") {
        show(id);
    }else if (overviewPanelSelect === 'result') {
        // 多解：点到哪个解的对象就改那个解的判定集合；都不属于任何解时，默认记到第 1 个解
        const sets = overviewResultJudgedSets();
        const owner = sets.find(set => set.has(id));
        select(target, id, owner || sets[0] || geometryElementLists.result);
    }else{
        const set = geometryElementLists[overviewPanelSelect];
        if (!set) return;
        select(target, id, set);
    }

    function show(id) {
        openedGeometryItemId = id;
        const overviewMode = document.getElementById("geometry-item-list");
        const viewerMode = document.getElementById("geometry-item");
        overviewMode.style.display = "none";
        viewerMode.style.display = "flex";
        viewerMode.innerHTML = "";
        
        const element = geometryManager.get(id);
        if (widthTypeEquipment === 'mobile') {
            const type = element.getType();
            let dataItem;
            
            if (type === "point") {
                // 标题行
                dataItem = titleRow(type, element);
                viewerMode.appendChild(dataItem);
                // id行
                dataItem = idRow(element);                
                viewerMode.appendChild(dataItem);
                // xy行
                dataItem = xyRow(element);                
                viewerMode.appendChild(dataItem);
                // 基底行
                dataItem = baseRow(element);
                viewerMode.appendChild(dataItem);
                const styleCol = document.createElement('div');
                styleCol.className = "item-container-plain";
                viewerMode.appendChild(styleCol);
                if (typeof renderInlineStyleControls === 'function') {
                    renderInlineStyleControls(styleCol, element, () => {
                        if (typeof drawContent === 'function') drawContent();
                        if (typeof notifyStorageChange === 'function') notifyStorageChange('style');
                    });
                }else{
                    styleCol.appendChild(showRow(element));
                    styleCol.appendChild(colorRow(element));
                }
                // 上层构造行
                dataItem = superstructureRow(element);
                viewerMode.appendChild(dataItem);
                // 有效性行（放在上层构造下面）
                dataItem = validRow(element);                
                viewerMode.appendChild(dataItem);
            }else if (type === "line" || type === "circle") {
                // 标题行
                dataItem = titleRow(type, element);
                viewerMode.appendChild(dataItem);
                // id行
                dataItem = idRow(element);                
                viewerMode.appendChild(dataItem);
                // 二坐标行
                dataItem = twoCoordinateRow(element);                
                viewerMode.appendChild(dataItem);
                // 基底行
                dataItem = baseRow(element);
                viewerMode.appendChild(dataItem);
                const styleCol = document.createElement('div');
                styleCol.className = "item-container-plain";
                viewerMode.appendChild(styleCol);
                if (typeof renderInlineStyleControls === 'function') {
                    renderInlineStyleControls(styleCol, element, () => {
                        if (typeof drawContent === 'function') drawContent();
                        if (typeof notifyStorageChange === 'function') notifyStorageChange('style');
                    });
                }else{
                    styleCol.appendChild(showRow(element));
                    styleCol.appendChild(colorRow(element));
                }
                // 上层构造行
                dataItem = superstructureRow(element);
                viewerMode.appendChild(dataItem);
                // 有效性行（放在上层构造下面）
                dataItem = validRow(element);                
                viewerMode.appendChild(dataItem);
            }
        }else{
            // 电脑端
            const type = element.getType();
            if (type === "point") {
                // 标题行
                dataItem = titleRowDesktop(type, element);
                viewerMode.appendChild(dataItem);

                const body = document.createElement('div');
                body.className = "item-container-row";
                const container1 = document.createElement('div');
                container1.className = "item-container-column";
                const container2 = document.createElement('div');
                container2.className = "item-container-column";
                const container3 = document.createElement('div');
                container3.className = "item-container-column";

                // xy行
                dataItem = xyRow(element);                
                container1.appendChild(dataItem);
                // 基底行
                dataItem = baseRow(element);
                container1.appendChild(dataItem);
                // 样式控件（颜色 / 粗细 / 标签 / 隐藏）直接铺在这一列里：
                if (typeof renderInlineStyleControls === 'function') {
                    renderInlineStyleControls(container2, element, () => {
                        if (typeof drawContent === 'function') drawContent();
                        if (typeof notifyStorageChange === 'function') notifyStorageChange('style');
                    });
                }else{
                    container2.appendChild(showRow(element));
                    container2.appendChild(colorRow(element));
                }
                // 上层构造行
                dataItem = superstructureRow(element);
                container3.appendChild(dataItem);
                // 有效性行（挪到上层构造下面：这样中间列只剩样式控件，
                // 控件每次重画清空容器时不会把它一起清掉）
                dataItem = validRow(element);                
                container3.appendChild(dataItem);

                body.appendChild(container1);
                body.appendChild(container2);
                body.appendChild(container3);
                viewerMode.appendChild(body);
                syncOverviewListHeight(viewerMode);
            }else if (type === "line" || type === "circle") {
                // 标题行
                dataItem = titleRowDesktop(type, element);
                viewerMode.appendChild(dataItem);

                const body = document.createElement('div');
                body.className = "item-container-row";
                const container1 = document.createElement('div');
                container1.className = "item-container-column";
                const container2 = document.createElement('div');
                container2.className = "item-container-column";
                const container3 = document.createElement('div');
                container3.className = "item-container-column";

                // 二坐标行
                dataItem = twoCoordinateRow(element);           
                container1.appendChild(dataItem);
                // 基底行
                dataItem = baseRow(element);
                container1.appendChild(dataItem);
                // 样式控件（颜色 / 粗细 / 标签 / 隐藏）直接铺在这一列里：
                if (typeof renderInlineStyleControls === 'function') {
                    renderInlineStyleControls(container2, element, () => {
                        if (typeof drawContent === 'function') drawContent();
                        if (typeof notifyStorageChange === 'function') notifyStorageChange('style');
                    });
                }else{
                    container2.appendChild(showRow(element));
                    container2.appendChild(colorRow(element));
                }
                // 上层构造行
                dataItem = superstructureRow(element);
                container3.appendChild(dataItem);
                // 有效性行（挪到上层构造下面：这样中间列只剩样式控件，
                // 控件每次重画清空容器时不会把它一起清掉）
                dataItem = validRow(element);                
                container3.appendChild(dataItem);

                body.appendChild(container1);
                body.appendChild(container2);
                body.appendChild(container3);
                viewerMode.appendChild(body);
                syncOverviewListHeight(viewerMode);
            }
        }
    }
    // show 是这个函数里的闭包，导出来给 refreshOpenedGeometryItem 用
    window.showGeometryItemDetail = show;

    function titleRow(type, element) {
        // 标题行
        const dataItem = document.createElement("div");
        dataItem.className = "item-container-title";

        const backButton = document.createElement('div');
        backButton.className = 'item-container-button';
        backButton.setAttribute('data-action', 'back');
        const template = document.getElementById(`svg-back`);
        if (template) {
            backButton.innerHTML = template.innerHTML;
        }
        dataItem.appendChild(backButton);

        const textNode = document.createElement('p');
        if (type === "point") {
            textNode.innerText = '点';
        }else if (type === "line") {
            textNode.innerText = '线';
        }else if (type === "circle") {
            textNode.innerText = '圆';
        }
        dataItem.appendChild(textNode);

        const inputDE = document.createElement('input');
        inputDE.value = element.getName();
        inputDE.id = `item-${id}-name-input`;
        dataItem.appendChild(inputDE);
        
        return dataItem;
    }
    function titleRowDesktop(type, element) {
        // 电脑端标题行
        const dataItem = document.createElement("div");
        dataItem.className = "item-container-title";

        const backButton = document.createElement('div');
        backButton.className = 'item-container-button';
        backButton.setAttribute('data-action', 'back');
        const template = document.getElementById(`svg-back`);
        if (template) {
            backButton.innerHTML = template.innerHTML;
        }
        dataItem.appendChild(backButton);

        const textNode = document.createElement('p');
        if (type === "point") {
            textNode.innerText = '点';
        }else if (type === "line") {
            textNode.innerText = '线';
        }else if (type === "circle") {
            textNode.innerText = '圆';
        }
        dataItem.appendChild(textNode);

        const inputDE = document.createElement('input');
        inputDE.value = element.getName();
        inputDE.id = `item-${id}-name-input`;
        dataItem.appendChild(inputDE);

        // 「id」连同它的值一起贴右（名字输入框后面），值也是不可编辑输入框
        const textNode2 = document.createElement('p');
        textNode2.className = 'item-id-value';
        textNode2.innerText = 'id';
        dataItem.appendChild(textNode2);

        const idInput = document.createElement('input');
        idInput.className = 'item-id-input';
        idInput.value = element.getId();
        idInput.disabled = true;
        dataItem.appendChild(idInput);
        
        return dataItem;
    }
    function idRow(element) {
        // id行
        const dataItem = document.createElement("div");
        dataItem.className = "item-container-row";

        const textNode = document.createElement('p');
        textNode.innerText = 'id';
        dataItem.appendChild(textNode);

        // 结果放进不可编辑（disabled）的输入框
        const inputDE = document.createElement('input');
        inputDE.value = element.getId();
        inputDE.disabled = true;
        dataItem.appendChild(inputDE);
        
        return dataItem;
    }
    function xyRow(element) {
        // xy行：x / y 各占一行（挤在一行太宽）
        const dataItem = document.createElement("div");
        dataItem.className = "item-container-plain";
        const dataItem1 = document.createElement("div");
        dataItem1.className = "item-container-row";
        const dataItem2 = document.createElement("div");
        dataItem2.className = "item-container-row";
        const [x, y] = element.getCoordinate();
        const elementBase = element.getBase();

        const textNode = document.createElement('p');
        textNode.innerText = 'x';
        dataItem1.appendChild(textNode);

        const inputDE = document.createElement('input');
        inputDE.value = x;
        inputDE.id = `item-${id}-x-input`;
        if (elementBase.type !== 'none') inputDE.disabled = true;
        dataItem1.appendChild(inputDE);

        const textNode2 = document.createElement('p');
        textNode2.innerText = 'y';
        dataItem2.appendChild(textNode2);

        const inputDE2 = document.createElement('input');
        inputDE2.value = y;
        inputDE2.id = `item-${id}-y-input`;
        if (elementBase.type !== 'none') inputDE2.disabled = true;
        dataItem2.appendChild(inputDE2);

        dataItem.appendChild(dataItem1);
        dataItem.appendChild(dataItem2);
        
        return dataItem;
    }
    function twoCoordinateRow(element) {
        // 图形本身的数据：直线看斜率 / 截距，圆看圆心 / 半径
        const dataItem = document.createElement("div");
        dataItem.className = "item-container-plain";
        const dataItem1 = document.createElement("div");
        dataItem1.className = "item-container-row";
        const dataItem2 = document.createElement("div");
        dataItem2.className = "item-container-row";
        const coordList = element.getCoordinate();
        const type = element.getType();

        let textNode = document.createElement('p');
        if (type === "line") {
            textNode.innerText = '斜率';
        }else if (type === "circle") {
            textNode.innerText = '圆心';
        }
        dataItem1.appendChild(textNode);
        const inputDE = document.createElement('input');
        inputDE.value = type === 'line' ? lineSlopeText(coordList) : circleCenterText(coordList);
        inputDE.disabled = true;
        dataItem1.appendChild(inputDE);
        
        textNode = document.createElement('p');
        if (type === "line") {
            textNode.innerText = '截距';
        }else if (type === "circle") {
            textNode.innerText = '半径';
        }
        dataItem2.appendChild(textNode);
        const inputDE2 = document.createElement('input');
        inputDE2.value = type === 'line' ? lineInterceptText(coordList) : circleRadiusText(coordList);
        inputDE2.disabled = true;
        dataItem2.appendChild(inputDE2);
        
        dataItem.appendChild(dataItem1);
        dataItem.appendChild(dataItem2);
        return dataItem;
    }
    function baseRow(element) {
        // 基底行（并进所在列，不单独占一个灰方块：整行高度能省下一截）
        const dataItem = document.createElement("div");
        dataItem.className = "item-container-plain";
        const type = element.getType();
        const elementBase = element.getBase();

        const dataItem1 = document.createElement("div");
        dataItem1.className = "item-container-row";

        const textNode = document.createElement('p');
        textNode.innerText = '基底';
        dataItem1.appendChild(textNode);

        // 基底的「结果」放进只读框：基底类型 + 各个基底图形
        const baseFigures = type === "point" ? elementBase.bases : elementBase.figure;
        let baseText = elementBase.type;
        if (Array.isArray(baseFigures) && baseFigures.length) {
            baseText += ' ' + baseFigures.map(item => item.getId()).join(' ');
        }
        const baseInput = document.createElement('input');
        baseInput.value = baseText;
        baseInput.disabled = true;
        dataItem1.appendChild(baseInput);

        dataItem.appendChild(dataItem1);

        if (elementBase.type !== 'none') {
            const dataItem2 = document.createElement("div");
            dataItem2.className = "item-container-row";
            let bases;
            if (type === "point") {
                bases = elementBase.bases;
            }else if (type === "line" || type === "circle") {
                bases = elementBase.figure;
            }

            bases.forEach((item) => {
                const textNode = document.createElement('p');
                textNode.innerText = item.getId();
                dataItem2.appendChild(textNode);
            });

            const textNode = document.createElement('p');
            textNode.innerText = '参数值';
            dataItem2.appendChild(textNode);

            const inputDE = document.createElement('input');
            inputDE.value = elementBase.value;
            inputDE.id = `item-${id}-base-value-input`;
            dataItem2.appendChild(inputDE);

            dataItem.appendChild(dataItem2);
        }
        
        return dataItem;
    }
    function showRow(element) {
        // 显示行
        const dataItem = document.createElement("div");
        dataItem.className = "item-container-row";

        const textNode = document.createElement('p');
        textNode.innerText = '显示';
        dataItem.appendChild(textNode);

        const inputDE = document.createElement('input');
        inputDE.type = 'checkbox';
        inputDE.checked = element.getVisible();
        inputDE.id = `item-${id}-visible-input`;
        dataItem.appendChild(inputDE);

        const textNode2 = document.createElement('p');
        textNode2.innerText = '显示名称';
        dataItem.appendChild(textNode2);

        const inputDE2 = document.createElement('input');
        inputDE2.type = 'checkbox';
        inputDE2.checked = element.getShowName();
        inputDE2.id = `item-${id}-show-name-input`;
        dataItem.appendChild(inputDE2);
        
        return dataItem;
    }
    function colorRow(element) {
        // 颜色行
        const dataItem = document.createElement("div");
        dataItem.className = "item-container-row";

        const textNode = document.createElement('p');
        textNode.innerText = '颜色';
        dataItem.appendChild(textNode);
        
        const inputDE = document.createElement('input');
        inputDE.type = 'color';
        inputDE.value = element.getColor();
        inputDE.id = `item-${id}-color-input`;
        dataItem.appendChild(inputDE);
        
        return dataItem;
    }
    function validRow(element) {
        // 有效性行（和「上层构造」一样换行：标签一行、值一行）
        const dataItem = document.createElement("div");
        dataItem.className = "item-container-plain";
        const dataItem1 = document.createElement("div");
        dataItem1.className = "item-container-row";

        const textNode = document.createElement('p');
        textNode.innerText = '有效性';
        dataItem1.appendChild(textNode);
        dataItem.appendChild(dataItem1);

        const dataItem2 = document.createElement("div");
        dataItem2.className = "item-container-row";
        // 结果放进不可编辑（disabled）的输入框
        const validInput = document.createElement('input');
        validInput.value = element.getValid() ? '有效' : '无效';
        validInput.disabled = true;
        dataItem2.appendChild(validInput);
        dataItem.appendChild(dataItem2);
        
        return dataItem;
    }
    function superstructureRow(element) {
        // 上层构造行（并进所在列，不单独占一个灰方块）
        const dataItem = document.createElement("div");
        dataItem.className = "item-container-plain";
        const dataItem1 = document.createElement("div");
        dataItem1.className = "item-container-row";
        const dataItem2 = document.createElement("div");
        dataItem2.className = "item-container-row";
        const superstructure = element.getSuperstructure();

        const textNode = document.createElement('p');
        textNode.innerText = '上层构造';
        dataItem1.appendChild(textNode);

        // 结果放进不可编辑（disabled）的输入框：上层构造的各个图形（或「无」）
        const superInput = document.createElement('input');
        superInput.value = superstructure.length === 0 ? '无' : superstructure.map(item => item.getId()).join(' ');
        superInput.disabled = true;
        dataItem2.appendChild(superInput);
        
        dataItem.appendChild(dataItem1);
        dataItem.appendChild(dataItem2);
        
        return dataItem;
    }
    function select(target, id, set) {
        // 「隐藏」档：以元素实际的显示状态为准来切换，并把 hidden 集合一起同步，
        // 这样撤销 / 存读档、重新导入之后列表与画布仍然对得上
        if (overviewPanelSelect === 'hidden') {
            // 试玩（mode-maker-play）里也只当「看」用：点不动（与关卡游玩一致），
            // 制题器 / 求解器里照旧点一下切换显示 / 隐藏
            if (document.body.classList.contains('mode-maker-play')) return;
            const geometryElement = geometryManager.get(id);
            const wasHidden = !geometryElement.getVisible();
            geometryElement.modifyVisible(wasHidden);
            if (wasHidden) set.delete(id);
            else set.add(id);
            target.classList.toggle('select', !geometryElement.getVisible());
            drawContent();
            return;
        }
        // 制题器 / 求解器：完全落在网格范围外的图形不许标记（见 board-tools.js 的 markBlockedOutsideGrid）
        // —— 这条在「隐藏」档之外，隐藏只是看不看得见，与题面无关
        if (typeof window.markBlockedOutsideGrid === 'function' && window.markBlockedOutsideGrid(id)) {
            if (typeof window.boardToast === 'function') window.boardToast(t('board.markOutsideGrid'));
            return;
        }
        // 这些档位是「看看有哪些标好的」：已经标上的不再点掉（免得误触取消标记、把画布上的高亮弄没），
        // 只有还没标的才补上。要取消标记请用画布上的标记工具
        if (set.has(id)) return;
        // 标记互斥（见 board-tools.js 的 markExclusive）：给定三项只能有一个，
        // 所求判定 / 所求显示 / 探索显示彼此能共存，但与给定三类互斥 ——
        // 在「所求」档补一个已经标了给定的图形，就顺手把它的给定标记撤掉
        if (typeof window.markExclusive === 'function') window.markExclusive(id, overviewPanelSelect);
        set.add(id);
        target.classList.add('select');
        // 标记集合变了，画布上的黑 / 蓝 / 金高亮跟着重画（撤掉的给定色也要退回去）
        if (typeof window.refreshMarkHighlight === 'function') window.refreshMarkHighlight();
        drawContent();
    }
}

/**
 * 几何查看器点击事件
 * @param {Object} event 
 */
function geometryItemClick(event) {
    const action = event.target?.dataset.action;
    if (!action) return;
    if (action === 'back') {
        closeItem();
    }
}

/**
 * 关闭元素查看器
 */
function closeItem() {
    const overviewMode = document.getElementById("geometry-item-list");
    const viewerMode = document.getElementById("geometry-item");
    overviewMode.style.display = "block";
    viewerMode.style.display = "none";
    openedGeometryItemId = null;
}
