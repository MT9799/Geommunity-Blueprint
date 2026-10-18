/**
 * 生成页面缩略图 过程脚本
 *
 * 关卡包总览 / 关卡选择 / 搜索页上的图都只有几十到一百多像素，
 * 直接用原图（示意图平均 168 KB、最大 1.4 MB）太浪费。这里把
 * data/diagrams/** 与 data/packcovers/* 缩到 360px 的 WebP，输出到
 * data/thumbs/ 下（目录结构与原图一致），页面只引用缩略图；
 * 原图仍留给关卡选择页的头图等需要大图的场景。
 *
 * 用法：npm run thumbs        （需要 ffmpeg 在 PATH 里，或用 FFMPEG 指定路径）
 *      FFMPEG=/path/to/ffmpeg npm run thumbs
 */
const {execFileSync} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(PROJECT_ROOT, 'data');
const OUT_DIR = path.join(DATA_DIR, 'thumbs');
const SOURCE_DIRS = ['diagrams', 'packcovers'];
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const MAX_SIZE = 360;
const WEBP_QUALITY = '80';
const FFMPEG = process.env.FFMPEG || 'ffmpeg';

/**
 * 递归列出目录里的图片 过程函数
 * @param {string} dir
 * @returns {string[]}
 */
function listImages(dir) {
    if (!fs.existsSync(dir)) return [];
    const found = [];
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) found.push(...listImages(full));
        else if (IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) found.push(full);
    }
    return found;
}

let converted = 0;
for (const sourceName of SOURCE_DIRS) {
    const sourceDir = path.join(DATA_DIR, sourceName);
    for (const file of listImages(sourceDir)) {
        const relative = path.relative(DATA_DIR, file);
        const target = path.join(OUT_DIR, relative.replace(/\.[^.]+$/, '.webp'));
        fs.mkdirSync(path.dirname(target), {recursive: true});
        execFileSync(FFMPEG, [
            '-y', '-loglevel', 'error',
            '-i', file,
            // 等比缩到 360×360 以内，不放大
            '-vf', `scale=${MAX_SIZE}:${MAX_SIZE}:force_original_aspect_ratio=decrease`,
            '-c:v', 'libwebp', '-quality', WEBP_QUALITY,
            target,
        ]);
        converted++;
    }
}

let total = 0;
for (const file of listImages(OUT_DIR)) total += fs.statSync(file).size;
console.log(`缩略图已生成：${converted} 张，共 ${(total / 1024 / 1024).toFixed(1)} MB`);
console.log(`输出目录：${path.relative(PROJECT_ROOT, OUT_DIR)}`);
