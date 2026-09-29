/* record-manager.js */
/**
 * 首页「清除缓存」 模块
 *
 * 列出本机保存的全部作图记录（数据见 recordStore.js），逐级分组：
 * 模式（画板 / 制题器 / 求解器 / 关卡游玩 / 试玩）→ 关卡游玩再按 关卡包 → 关卡。
 * 每条记录的可用操作与画板的历史记录界面一致：重命名 / 导出（查看 gmt 代码、导出为 gmt 文件）/ 删除，
 * 右上角「多选」进去以后可以全选、批量导出（合并成一份）、批量删除。
 * 首页没有画布，所以不提供「载入记录」。
 */
(function (global) {
    const store = global.recordStore;
    const MODE_ORDER = ['normal', 'maker', 'solver', 'level', 'maker-play'];
    const MODE_LABEL = {
        normal: 'index.recordModeNormal',
        maker: 'index.recordModeMaker',
        solver: 'index.recordModeSolver',
        level: 'index.recordModeLevel',
        'maker-play': 'index.recordModeTestPlay',
    };

    const ICON = {
        // 全选：三行，每行一个「√」加一短横 —— 整个列表都被勾上了
        selectAll: '<svg viewBox="0 0 200 200">'
            + '<polyline points="18 40, 38 60, 76 22" fill="none" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>'
            + '<line x1="94" y1="42" x2="180" y2="42" stroke-width="10" fill="none" stroke-linecap="round"/>'
            + '<polyline points="18 98, 38 118, 76 80" fill="none" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>'
            + '<line x1="94" y1="100" x2="180" y2="100" stroke-width="10" fill="none" stroke-linecap="round"/>'
            + '<polyline points="18 156, 38 176, 76 138" fill="none" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>'
            + '<line x1="94" y1="158" x2="180" y2="158" stroke-width="10" fill="none" stroke-linecap="round"/></svg>',
        edit: '<svg viewBox="0 0 200 200">'
            + '<polygon points="30 150, 45 110, 130 25, 165 60, 80 145" fill="none" stroke-width="10" stroke-linejoin="round"/>'
            + '<line x1="115" y1="40" x2="150" y2="75" stroke-width="10"/></svg>',
        export: '<svg viewBox="0 0 200 200">'
            + '<polyline points="40 75, 100 27, 160 75" fill="none" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>'
            + '<line x1="100" y1="27" x2="100" y2="150" stroke-width="10" stroke-linecap="round"/>'
            + '<line x1="45" y1="162" x2="155" y2="162" stroke-width="10" stroke-linecap="round"/></svg>',
        remove: '<svg viewBox="0 0 200 200">'
            + '<line x1="30" y1="60" x2="170" y2="60" fill="none" stroke-width="10" stroke-linecap="round"/>'
            + '<line x1="60" y1="40" x2="140" y2="40" fill="none" stroke-width="10" stroke-linecap="round"/>'
            + '<line x1="75" y1="80" x2="80" y2="150" fill="none" stroke-width="10" stroke-linecap="round"/>'
            + '<line x1="125" y1="80" x2="120" y2="150" fill="none" stroke-width="10" stroke-linecap="round"/>'
            + '<polyline points="50 60, 60 170, 140 170, 150 60" fill="none" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        select: '<svg viewBox="0 0 200 200">'
            + '<rect x="35" y="35" width="130" height="130" rx="20" fill="none" stroke-width="10"/>'
            + '<polyline points="65 102, 92 130, 140 70" fill="none" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        // 退出多选：同一个勾选框加一道斜杠，与「多选」区分开
        exit: '<svg viewBox="0 0 200 200">'
            + '<rect x="35" y="35" width="130" height="130" rx="20" fill="none" stroke-width="10"/>'
            + '<polyline points="65 102, 92 130, 140 70" fill="none" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>'
            + '<line x1="45" y1="155" x2="155" y2="45" stroke-width="10" stroke-linecap="round"/></svg>',
    };

    const text = (key, fallback) => (typeof t === 'function' ? t(key) : (fallback || key));

    let mask = null;
    let body = null;
    let toolbar = null;
    let multi = false;
    const selected = new Set();
    // 关卡名 / 包名（点开「清除缓存」时才去取，取到之前先显示 id）
    let levelTitles = null;

    /**
     * 下载一份文本 过程函数
     * @param {string} name
     * @param {string} content
     */
    function download(name, content) {
        const blob = new Blob([content], {type: 'text/plain'});
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = name;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    /**
     * 通用弹层 过程函数
     * @param {{title: string, body?: string, withInput?: boolean, buttons?: {label: string, action: Function}[]}} options
     * @returns {HTMLElement}
     */
    function dialog(options) {
        const shell = document.createElement('div');
        shell.className = 'rec-dialog-mask';
        shell.innerHTML = '<div class="rec-dialog"><strong></strong><p class="rec-dialog-hint"></p>'
            + '<div class="rec-dialog-body"></div><div class="rec-dialog-actions"></div></div>';
        shell.querySelector('strong').textContent = options.title;
        const hint = shell.querySelector('.rec-dialog-hint');
        hint.textContent = options.body || '';
        if (!options.body) hint.remove();
        const bodyBox = shell.querySelector('.rec-dialog-body');
        if (options.withInput) {
            bodyBox.innerHTML = '<input class="rec-dialog-input" type="text" spellcheck="false">';
            bodyBox.querySelector('input').value = options.value || '';
        }else{
            bodyBox.remove();
        }
        const actions = shell.querySelector('.rec-dialog-actions');
        (options.buttons || []).forEach(button => {
            const element = document.createElement('button');
            element.type = 'button';
            element.textContent = button.label;
            element.addEventListener('click', () => { shell.remove(); button.action?.(options.withInput ? shell : undefined); });
            actions.appendChild(element);
        });
        shell.addEventListener('click', event => { if (event.target === shell) shell.remove(); });
        document.body.appendChild(shell);
        return shell;
    }

    /**
     * 确认 / 输入 / 代码 弹层 过程函数
     */
    function confirmDialog(title, onConfirm) {
        dialog({title: title, buttons: [
            {label: text('common.cancel', '取消')},
            {label: text('common.confirm', '确定'), action: onConfirm},
        ]});
    }

    function inputDialog(title, value, onSubmit) {
        const shell = dialog({title: title, withInput: true, value: value, buttons: [
            {label: text('common.cancel', '取消')},
        ]});
        const input = shell.querySelector('.rec-dialog-input');
        const confirm = document.createElement('button');
        confirm.type = 'button';
        confirm.textContent = text('common.confirm', '确定');
        confirm.addEventListener('click', () => {
            const result = input.value.trim();
            shell.remove();
            if (result) onSubmit(result);
        });
        shell.querySelector('.rec-dialog-actions').appendChild(confirm);
        input.focus();
        input.select();
    }

    function codeDialog(title, code) {
        const shell = dialog({title: title, buttons: [
            {label: text('board.recordCopy', '复制'), action: () => {
                navigator.clipboard?.writeText(code);
            }},
            {label: text('common.close', '关闭')},
        ]});
        const pre = document.createElement('pre');
        pre.className = 'rec-dialog-code';
        pre.textContent = code;
        shell.querySelector('.rec-dialog').insertBefore(pre, shell.querySelector('.rec-dialog-actions'));
    }

    /**
     * 导出 / 导入 这类两条路的选择弹层 过程函数
     * @param {string} title
     * @param {{label: string, action: Function}[]} items
     */
    function chooseDialog(title, items) {
        dialog({title: title, buttons: items.concat([{label: text('common.cancel', '取消')}])});
    }

    /**
     * 导出若干条记录 过程函数
     * @param {Object[]} records
     */
    function exportRecords(records) {
        if (!records.length) return;
        const many = records.length > 1;
        // 多条合并成一份（每条前用名称分隔）；只有一条时就导出那条的 gmt（带撤销清单注释）
        const textOf = () => (many ? store.mergedExportText(records) : store.exportTextOf(records[0]));
        chooseDialog(text(many ? 'board.recordExportSelected' : 'board.recordExport'), [
            {label: text('board.recordViewCode'), action: () => codeDialog(text('board.recordGmtCode'), textOf())},
            {label: text('board.recordSaveFile'), action: () => {
                // 多条合并导出的文件用 .gmts（导入时会把每条拆开），单条仍是 .gmt
                const name = many ? 'records.gmts' : `${(records[0].name || records[0].id).replace(/[:\s]/g, '-')}.gmt`;
                download(name, textOf());
            }},
        ]);
    }

    /**
     * 重命名记录 过程函数
     * @param {Object} dict
     */
    function renameRecord(dict) {
        inputDialog(text('board.recordRename'), dict.name || dict.id, name => {
            const saved = store.getRecord(dict.id);
            if (!saved) return;
            saved.name = name;
            store.putRecord(saved);
            render();
        });
    }

    /**
     * 删除若干条记录 过程函数
     * @param {string[]} ids
     */
    function deleteRecords(ids) {
        if (!ids.length) return;
        confirmDialog(text(ids.length > 1 ? 'board.recordDeleteSelectedAsk' : 'board.recordDeleteAsk'), () => {
            store.removeRecords(ids);
            ids.forEach(id => selected.delete(id));
            render();
        });
    }

    /**
     * 一条记录 过程函数
     * @param {Object} dict
     * @param {number} index
     * @returns {HTMLElement}
     */
    function recordRow(dict, index) {
        const row = document.createElement('div');
        row.className = 'rec-row' + (selected.has(dict.id) ? ' select' : '');
        row.dataset.id = dict.id;

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'rec-check';
        checkbox.checked = selected.has(dict.id);
        checkbox.hidden = !multi;
        checkbox.tabIndex = -1;

        const indexText = document.createElement('span');
        indexText.className = 'rec-row-index';
        indexText.textContent = `${index + 1}`;

        const name = document.createElement('span');
        name.className = 'rec-row-name';
        name.textContent = dict.name || dict.id;
        name.title = name.textContent;

        row.appendChild(checkbox);
        row.appendChild(indexText);
        row.appendChild(name);

        const summary = store.stepsSummary(dict);
        if (summary) {
            const steps = document.createElement('span');
            // 没作出所求：灰；作出所求：正文色；其中达标的那个 L / E 由 .gold 标金
            steps.className = 'rec-row-steps' + (summary.reached ? ' reached' : '');
            summary.parts.forEach(part => {
                const goal = document.createElement('span');
                goal.className = part.gold ? 'gold' : '';
                goal.textContent = part.text;
                steps.appendChild(goal);
            });
            row.appendChild(steps);
        }

        const actions = document.createElement('span');
        actions.className = 'rec-row-actions';
        [
            {action: 'rename', icon: ICON.edit, title: text('board.recordRename')},
            {action: 'export', icon: ICON.export, title: text('board.recordExport')},
            {action: 'delete', icon: ICON.remove, title: text('board.recordDelete')},
        ].forEach(config => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'rec-icon-button';
            button.dataset.action = config.action;
            button.dataset.id = dict.id;
            button.title = config.title;
            button.innerHTML = config.icon;
            button.hidden = multi;
            button.addEventListener('click', event => {
                event.stopPropagation();
                if (config.action === 'rename') renameRecord(dict);
                else if (config.action === 'export') exportRecords([dict]);
                else if (config.action === 'delete') deleteRecords([dict.id]);
            });
            actions.appendChild(button);
        });
        row.appendChild(actions);

        row.addEventListener('click', event => {
            // 点行内的按钮（重命名 / 导出 / 删除）不算勾选
            if (event.target.closest('[data-action]')) return;
            if (!multi) return;
            if (selected.has(dict.id)) selected.delete(dict.id);
            else selected.add(dict.id);
            render();
        });
        return row;
    }

    /**
     * 关卡 / 关卡包的显示名 过程函数
     * @param {string} pack
     * @param {string} levelId
     * @param {string} fallback
     */
    function levelLabel(pack, levelId, fallback) {
        const data = levelTitles;
        const level = data && data.levels ? data.levels.find(item => item.id === levelId) : null;
        return (level && level.title) || fallback || levelId || '—';
    }

    function packLabel(pack) {
        const data = levelTitles;
        const found = data && data.packs ? data.packs.find(item => item.id === pack) : null;
        return (found && found.name) || pack || '—';
    }

    /**
     * 重画整个列表 过程函数
     */
    function render() {
        if (!body) return;
        body.innerHTML = '';
        const records = store.listRecords();
        // 记录被删掉的不再留在选中集里
        const alive = new Set(records.map(dict => dict.id));
        [...selected].forEach(id => { if (!alive.has(id)) selected.delete(id); });
        if (multi && !records.length) multi = false;

        if (!records.length) {
            const empty = document.createElement('p');
            empty.className = 'rec-empty';
            empty.textContent = text('index.clearCacheNone');
            body.appendChild(empty);
        }

        // 按模式分组，关卡游玩再按关卡包 → 关卡（基本信息都从 store.infoOf 里取）
        const modeOf = dict => store.infoOf(dict).mode || 'normal';
        MODE_ORDER.concat([...new Set(records.map(modeOf))].filter(mode => !MODE_ORDER.includes(mode)))
            .forEach(mode => {
                const group = records.filter(dict => modeOf(dict) === mode);
                if (!group.length) return;
                const title = document.createElement('h3');
                title.className = 'rec-group-title';
                title.textContent = text(MODE_LABEL[mode], mode);
                body.appendChild(title);

                if (mode === 'level') {
                    const packs = [...new Set(group.map(dict => store.infoOf(dict).pack || ''))];
                    packs.forEach(pack => {
                        const inPack = group.filter(dict => (store.infoOf(dict).pack || '') === pack);
                        const packTitle = document.createElement('h4');
                        packTitle.className = 'rec-sub-title';
                        packTitle.textContent = packLabel(pack);
                        body.appendChild(packTitle);
                        const levels = [...new Set(inPack.map(dict => store.infoOf(dict).levelId || ''))];
                        levels.forEach(levelId => {
                            const inLevel = inPack.filter(dict => (store.infoOf(dict).levelId || '') === levelId);
                            const levelTitle = document.createElement('p');
                            levelTitle.className = 'rec-sub-title';
                            levelTitle.textContent = levelLabel(pack, levelId, store.infoOf(inLevel[0]).levelName);
                            body.appendChild(levelTitle);
                            inLevel.forEach((dict, index) => body.appendChild(recordRow(dict, index)));
                        });
                    });
                    return;
                }
                group.forEach((dict, index) => body.appendChild(recordRow(dict, index)));
            });

        syncToolbar(records);
    }

    /**
     * 顶部工具条 过程函数
     * @param {Object[]} records
     */
    function syncToolbar(records) {
        if (!toolbar) return;
        toolbar.innerHTML = '';
        const button = (id, icon, title, action, disabled) => {
            const element = document.createElement('button');
            element.type = 'button';
            element.className = 'rec-icon-button';
            element.id = id;
            element.title = title;
            element.innerHTML = icon;
            element.disabled = !!disabled;
            element.addEventListener('click', action);
            toolbar.appendChild(element);
            return element;
        };
        if (multi) {
            button('rec-select-all', ICON.selectAll, text('board.recordSelectAll'), () => {
                const all = records.length > 0 && records.every(dict => selected.has(dict.id));
                selected.clear();
                if (!all) records.forEach(dict => selected.add(dict.id));
                render();
            }, !records.length);
            button('rec-batch-export', ICON.export, text('board.recordExportSelected'), () => {
                exportRecords(store.listRecords().filter(dict => selected.has(dict.id)));
            }, !selected.size);
            button('rec-batch-delete', ICON.remove, text('board.recordDeleteSelected'), () => {
                deleteRecords([...selected]);
            }, !selected.size);
            button('rec-exit-select', ICON.exit, text('board.recordExitMultiSelect'), () => {
                multi = false;
                selected.clear();
                render();
            });
        }else{
            button('rec-select-mode', ICON.select, text('board.recordMultiSelect'), () => {
                multi = true;
                selected.clear();
                render();
            }, !records.length);
        }
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'rec-icon-button';
        close.id = 'rec-close';
        close.title = text('common.close', '关闭');
        close.textContent = '✕';
        close.addEventListener('click', closeManager);
        toolbar.appendChild(close);
    }

    /**
     * 关闭「清除缓存」 过程函数
     * 关掉后要把状态清空：openRecordManager 开头靠 `if (mask) return` 防重复打开，
     * 不清的话第二次就再也打不开了
     */
    function closeManager() {
        mask?.remove();
        mask = null;
        toolbar = null;
        body = null;
        multi = false;
        selected.clear();
    }

    /**
     * 打开「清除缓存」 过程函数
     */
    async function openRecordManager() {
        if (mask) return;
        mask = document.createElement('div');
        mask.className = 'rec-mask';
        mask.innerHTML = '<div class="rec-dialog-main"><header><strong></strong><span class="rec-tools"></span></header>'
            + '<div class="rec-main-body"><p class="rec-note"></p><div class="rec-list"></div></div></div>';
        mask.querySelector('strong').textContent = text('index.clearCache');
        mask.querySelector('.rec-note').textContent = text('index.clearCacheNote');
        toolbar = mask.querySelector('.rec-tools');
        body = mask.querySelector('.rec-list');
        mask.addEventListener('click', event => { if (event.target === mask) closeManager(); });
        document.addEventListener('keydown', function onKey(event) {
            if (event.key !== 'Escape' || !mask) return;
            closeManager();
            document.removeEventListener('keydown', onKey);
        });
        document.body.appendChild(mask);
        render();
        // 关卡游玩的记录用关卡标题显示更好读，取不到就退回关卡 id
        if (typeof loadLevelsData === 'function' && !levelTitles) {
            try {
                levelTitles = await loadLevelsData();
                if (mask) render();
            }catch (error) {
                levelTitles = null;
            }
        }
    }

    global.openRecordManager = openRecordManager;
    document.addEventListener('DOMContentLoaded', () => {
        document.querySelectorAll('[data-clear-cache-button]').forEach(button => {
            button.addEventListener('click', openRecordManager);
        });
    });
})(window);
