/* readme-dialog.js */
/**
 * 项目说明弹窗
 * 首页的「项目说明」不再跳到 README.md，而是取回 README 的内容用页面风格渲染出来
 */

/**
 * 行内标记 工具函数
 * 支持 `代码`、**粗体**、[文字](链接)
 * @param {string} text
 * @returns {string}
 */
function renderInline(text) {
    const escape = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    let html = escape(text);
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
    return html;
}

/**
 * 渲染 markdown 过程函数
 * 只处理 README 里用得到的语法：标题、段落、列表、引用、代码块、表格、行内标记
 * @param {string} text
 * @returns {string}
 */
function renderMarkdown(text) {
    const lines = String(text).replace(/\r\n/g, '\n').split('\n');
    const html = [];
    let index = 0;
    let listType = null;
    const closeList = () => {
        if (listType) html.push(`</${listType}>`);
        listType = null;
    };
    const openList = type => {
        if (listType !== type) {
            closeList();
            html.push(`<${type}>`);
            listType = type;
        }
    };
    while (index < lines.length) {
        const line = lines[index];
        // 代码块
        if (/^```/.test(line)) {
            closeList();
            const code = [];
            index++;
            while (index < lines.length && !/^```/.test(lines[index])) code.push(lines[index++]);
            index++;
            html.push(`<pre><code>${code.join('\n').replace(/&/g, '&amp;').replace(/</g, '&lt;')}</code></pre>`);
            continue;
        }
        // 表格：当前行是表头且下一行是分隔行
        if (/^\s*\|/.test(line) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[index + 1] || '')) {
            closeList();
            const cells = row => row.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());
            const head = cells(line);
            index += 2;
            const body = [];
            while (index < lines.length && /^\s*\|/.test(lines[index])) body.push(cells(lines[index++]));
            html.push('<table><thead><tr>' + head.map(cell => `<th>${renderInline(cell)}</th>`).join('') + '</tr></thead><tbody>' +
                body.map(row => '<tr>' + row.map(cell => `<td>${renderInline(cell)}</td>`).join('') + '</tr>').join('') + '</tbody></table>');
            continue;
        }
        // 标题
        const heading = /^(#{1,6})\s+(.*)$/.exec(line);
        if (heading) {
            closeList();
            const level = heading[1].length;
            html.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
            index++;
            continue;
        }
        // 引用
        if (/^\s*>\s?/.test(line)) {
            closeList();
            const quote = [];
            while (index < lines.length && /^\s*>\s?/.test(lines[index])) quote.push(lines[index++].replace(/^\s*>\s?/, ''));
            html.push(`<blockquote>${renderInline(quote.join(' '))}</blockquote>`);
            continue;
        }
        // 列表
        const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
        const numbered = /^\s*\d+[.、)]\s+(.*)$/.exec(line);
        if (bullet || numbered) {
            openList(bullet ? 'ul' : 'ol');
            html.push(`<li>${renderInline((bullet || numbered)[1])}</li>`);
            index++;
            continue;
        }
        // 分割线
        if (/^\s*-{3,}\s*$/.test(line)) {
            closeList();
            html.push('<hr>');
            index++;
            continue;
        }
        // 空行
        if (!line.trim()) {
            closeList();
            index++;
            continue;
        }
        // 段落（连续行合并）
        closeList();
        const paragraph = [line];
        index++;
        while (index < lines.length && lines[index].trim() && !/^(#{1,6}\s|```|\s*>|\s*[-*]\s|\s*\d+[.、)]\s|\s*\|)/.test(lines[index])) {
            paragraph.push(lines[index++]);
        }
        html.push(`<p>${renderInline(paragraph.join(' '))}</p>`);
    }
    closeList();
    return html.join('\n');
}

/**
 * 打开项目说明弹窗 过程函数
 */
async function openReadmeDialog() {
    if (document.querySelector('.readme-mask')) return;
    const mask = document.createElement('div');
    mask.className = 'readme-mask';
    mask.innerHTML = '<div class="readme-dialog"><header><strong></strong><button type="button" class="readme-close"></button></header><div class="readme-body"><p class="readme-loading">…</p></div></div>';
    mask.querySelector('strong').textContent = typeof t === 'function' ? t('index.readmeTitle') : '项目说明';
    const closeButton = mask.querySelector('.readme-close');
    closeButton.textContent = typeof t === 'function' ? t('common.close') : '关闭';
    closeButton.addEventListener('click', () => mask.remove());
    mask.addEventListener('click', event => { if (event.target === mask) mask.remove(); });
    document.addEventListener('keydown', function onKey(event) {
        if (event.key !== 'Escape') return;
        mask.remove();
        document.removeEventListener('keydown', onKey);
    });
    document.body.appendChild(mask);
    const body = mask.querySelector('.readme-body');
    try {
        // 说明文档按当前界面语言取：英文界面读英文版，其余读中文版
        const readmeFile = typeof currentLang === 'function' && currentLang() === 'en' ? './src/README.en.md' : './README.md';
        const response = await fetch(readmeFile);
        if (!response.ok) throw new Error(String(response.status));
        body.innerHTML = renderMarkdown(await response.text());
    }catch (error) {
        console.error(error);
        body.innerHTML = `<p>${typeof t === 'function' ? t('index.readmeFailed') : '项目说明加载失败。'}</p>`;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // 头部按钮与 footer 里的按钮（手机端）都打开同一个弹层
    document.querySelectorAll('#readme-button, [data-readme-button]').forEach(button => {
        button.addEventListener('click', openReadmeDialog);
    });
});
