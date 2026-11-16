/* ggbImport.js */
/**
 * 导入 GeoGebra 文档（.ggb）→ gmt 文本
 *
 * .ggb 是 zip，里面 geogebra.xml 的 <construction> 由 <element>（对象本身，带齐次坐标
 * <coords x y z>）与 <command>（input / output 描述作图来源）组成，另外 <expression> 里的
 * 列表用来标记 initial / named / movepoints / result / display / explore。
 *
 * 两点关键口径（按本项目 README 的「参数怎么算」「交点参数」与几何内核）：
 * 1. ggb 不保存对象上点的 path parameter，<coords> 存的是**实际位置**（齐次坐标 x/z、y/z，
 *    且 ggb 的 y 轴向上、gmt 画布 y 向下，要取反）。所以 Linepoint / Intersect 的参数不能
 *    照抄 ggb 的编号，而是把该坐标当目标，在这套几何引擎上反解：
 *      · Linepoint → GeometryElementManager.modifyPointCoordinate 内部会调
 *        ToolsFunction.onlineValueOf（线）/ nearPointOnCircle（圆）写出 app 口径的参数，
 *        垂线「+1」、角平分线基底、切线半径倍数等分支全部自动对上；
 *      · Intersect  → 用 ToolsFunction.intersectionCandidates 取 gmt 编号候选，再逐个
 *        把候选写法载入引擎、读回坐标比对，选误差最小的（优先第四参数「已知点」写法，
 *        它不受「同一对基底第一个交点取非定义点」规则影响）。
 * 2. 反解在**独立的 GeometryElementManager 实例**上做，不碰当前画布。
 *
 * 命令到 gmt 的映射参考 ggb2gmt/strucmmar.md 的 ggb 部分与 ggb2gmt.py，但只输出本项目
 * 支持的指令；参数部分一律以上面的反解为准。
 */
(function () {
    'use strict';

    /* ===================== raw DEFLATE / ZIP ===================== */

    /** 解压 zip 里 method=8 的 raw deflate 数据（纯 JS，无外部依赖） */
    const inflateRaw = (src, expectedSize) => {
        let pos = 0;
        let bitBuf = 0;
        let bitCount = 0;
        let out = new Uint8Array(Math.max(expectedSize || 0, 4096));
        let outLen = 0;
        const push = value => {
            if (outLen === out.length) {
                const bigger = new Uint8Array(out.length * 2);
                bigger.set(out);
                out = bigger;
            }
            out[outLen++] = value;
        };
        const readBit = () => {
            if (!bitCount) {
                if (pos >= src.length) throw new Error('ggb: deflate data truncated');
                bitBuf = src[pos++];
                bitCount = 8;
            }
            const bit = bitBuf & 1;
            bitBuf >>>= 1;
            bitCount--;
            return bit;
        };
        const readBits = count => {
            let value = 0;
            for (let i = 0; i < count; i++) value |= readBit() << i;
            return value;
        };
        // canonical Huffman：解码时逐位按 MSB 优先拼码，直接与规范码比较
        const buildTree = lengths => {
            const maxBits = Math.max(1, ...lengths);
            const blCount = new Array(maxBits + 1).fill(0);
            lengths.forEach(length => { if (length) blCount[length]++; });
            const nextCode = new Array(maxBits + 1).fill(0);
            let code = 0;
            for (let bits = 1; bits <= maxBits; bits++) {
                code = (code + blCount[bits - 1]) << 1;
                nextCode[bits] = code;
            }
            const table = new Map();
            lengths.forEach((length, symbol) => {
                if (!length) return;
                table.set((length << 16) | nextCode[length]++, symbol);
            });
            return {table, maxBits};
        };
        const decode = tree => {
            let code = 0;
            for (let length = 1; length <= tree.maxBits; length++) {
                code = (code << 1) | readBit();
                const symbol = tree.table.get((length << 16) | code);
                if (symbol !== undefined) return symbol;
            }
            throw new Error('ggb: invalid huffman code');
        };
        const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31,
            35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
        const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2,
            3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
        const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193,
            257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
        const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6,
            7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
        const fixedLit = buildTree(Array.from({length: 288}, (_, i) =>
            i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8));
        const fixedDist = buildTree(new Array(32).fill(5));
        let final = 0;
        while (!final) {
            final = readBit();
            const type = readBits(2);
            if (type === 0) {
                // 丢掉当前字节剩余位，从下一字节开始读 LEN / NLEN / 原始数据
                bitCount = 0;
                if (pos + 4 > src.length) throw new Error('ggb: stored block truncated');
                const length = src[pos] | (src[pos + 1] << 8);
                pos += 4;
                for (let i = 0; i < length; i++) push(src[pos++]);
                continue;
            }
            if (type !== 1 && type !== 2) throw new Error('ggb: invalid deflate block type');
            let litTree = fixedLit;
            let distTree = fixedDist;
            if (type === 2) {
                const hlit = readBits(5) + 257;
                const hdist = readBits(5) + 1;
                const hclen = readBits(4) + 4;
                const order = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
                const codeLengths = new Array(19).fill(0);
                for (let i = 0; i < hclen; i++) codeLengths[order[i]] = readBits(3);
                const codeTree = buildTree(codeLengths);
                const lengths = [];
                while (lengths.length < hlit + hdist) {
                    const symbol = decode(codeTree);
                    if (symbol < 16) lengths.push(symbol);
                    else if (symbol === 16) {
                        const previous = lengths[lengths.length - 1] || 0;
                        const repeat = readBits(2) + 3;
                        for (let i = 0; i < repeat; i++) lengths.push(previous);
                    } else if (symbol === 17) {
                        const repeat = readBits(3) + 3;
                        for (let i = 0; i < repeat; i++) lengths.push(0);
                    } else {
                        const repeat = readBits(7) + 11;
                        for (let i = 0; i < repeat; i++) lengths.push(0);
                    }
                }
                litTree = buildTree(lengths.slice(0, hlit));
                distTree = buildTree(lengths.slice(hlit, hlit + hdist));
            }
            for (;;) {
                const symbol = decode(litTree);
                if (symbol < 256) push(symbol);
                else if (symbol === 256) break;
                else {
                    const index = symbol - 257;
                    if (index >= LEN_BASE.length) throw new Error('ggb: invalid length code');
                    const length = LEN_BASE[index] + readBits(LEN_EXTRA[index]);
                    const distSymbol = decode(distTree);
                    if (distSymbol >= DIST_BASE.length) throw new Error('ggb: invalid distance code');
                    const distance = DIST_BASE[distSymbol] + readBits(DIST_EXTRA[distSymbol]);
                    if (distance > outLen) throw new Error('ggb: distance out of range');
                    for (let i = 0; i < length; i++) push(out[outLen - distance]);
                }
            }
        }
        return out.subarray(0, outLen);
    };

    /** 从 zip 里取出指定名字的文件（走中央目录，压缩大小准确） */
    const unzipEntry = (buffer, wanted) => {
        const bytes = new Uint8Array(buffer);
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        let eocd = -1;
        for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
            if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
        }
        if (eocd < 0) throw new Error('ggb: not a zip file');
        const count = view.getUint16(eocd + 10, true);
        let offset = view.getUint32(eocd + 16, true);
        const decoder = new TextDecoder('utf-8');
        for (let n = 0; n < count; n++) {
            if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) break;
            const method = view.getUint16(offset + 10, true);
            const compressedSize = view.getUint32(offset + 20, true);
            const uncompressedSize = view.getUint32(offset + 24, true);
            const nameLength = view.getUint16(offset + 28, true);
            const extraLength = view.getUint16(offset + 30, true);
            const commentLength = view.getUint16(offset + 32, true);
            const localOffset = view.getUint32(offset + 42, true);
            const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
            if (name === wanted) {
                const localNameLength = view.getUint16(localOffset + 26, true);
                const localExtraLength = view.getUint16(localOffset + 28, true);
                const start = localOffset + 30 + localNameLength + localExtraLength;
                const data = bytes.subarray(start, start + compressedSize);
                if (method === 0) return decoder.decode(data);
                if (method === 8) return decoder.decode(inflateRaw(data, uncompressedSize));
                throw new Error('ggb: unsupported zip compression ' + method);
            }
            offset += 46 + nameLength + extraLength + commentLength;
        }
        throw new Error('ggb: geogebra.xml not found');
    };

    /* ===================== XML → 结构 ===================== */

    const attrOf = (node, name, fallback = '') => node.getAttribute(name) ?? fallback;
    const fmt = value => {
        if (!Number.isFinite(value)) return '0';
        const text = String(value);
        return text === '-0' ? '0' : text;
    };
    const inputArgsOf = node => {
        const out = [];
        for (let i = 0; i < 12; i++) {
            const value = node.getAttribute('a' + i);
            if (value === null || value === '') break;
            out.push(value);
        }
        return out;
    };
    const outputArgsOf = node => {
        const out = [];
        for (let i = 0; i < 12; i++) {
            const value = node.getAttribute('a' + i);
            if (value) out.push(value);
        }
        return out;
    };

    /** 把 ggb label 变成合法的 gmt id，并登记映射（ggb 的下标 a_1、多字符名都要处理） */
    const makeIdMap = labels => {
        const map = new Map();
        const used = new Set();
        labels.forEach(label => {
            if (!label || map.has(label)) return;
            let id = label.replace(/[^A-Za-z0-9_]/g, '_');
            if (!/^[A-Za-z_]/.test(id)) id = 'g' + id;
            if (!id) id = 'g';
            let unique = id;
            let suffix = 2;
            while (used.has(unique)) unique = id + '_' + suffix++;
            used.add(unique);
            map.set(label, unique);
        });
        return map;
    };

    const readModel = xmlText => {
        const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
        if (doc.querySelector('parsererror')) throw new Error('ggb: malformed geogebra.xml');
        const constructions = doc.getElementsByTagName('construction');
        const construction = constructions[0];
        if (!construction) throw new Error('ggb: no construction');
        const elements = [...construction.getElementsByTagName('element')];
        const commands = [...construction.getElementsByTagName('command')];
        const expressions = [...construction.getElementsByTagName('expression')];
        const idOf = makeIdMap(elements.map(node => attrOf(node, 'label')));

        const typeOf = new Map();
        // 齐次坐标 x/z、y/z；ggb 的 y 轴朝上，gmt 画布朝下，故 y 取负
        const targetOf = new Map();
        elements.forEach(node => {
            const label = attrOf(node, 'label');
            const type = attrOf(node, 'type');
            if (!label || !type) return;
            typeOf.set(label, type);
            // line 的 <coords> 是 ax+by+c=0 的系数、conic 用 <matrix>，只有 point 的才是位置
            if (type !== 'point') return;
            const coords = node.getElementsByTagName('coords')[0];
            if (!coords) return;
            const x = Number(attrOf(coords, 'x', '0'));
            const y = Number(attrOf(coords, 'y', '0'));
            const z = Number(attrOf(coords, 'z', '1')) || 1;
            if (!Number.isFinite(x) || !Number.isFinite(y)) return;
            targetOf.set(label, [x / z, -y / z]);
        });

        const commandOf = new Map();
        const inputsOf = new Map();
        commands.forEach(node => {
            const name = attrOf(node, 'name');
            const input = node.getElementsByTagName('input')[0];
            const output = node.getElementsByTagName('output')[0];
            if (!name || !output) return;
            const inputs = input ? inputArgsOf(input) : [];
            outputArgsOf(output).forEach(label => {
                if (!label) return;
                commandOf.set(label, name);
                inputsOf.set(label, inputs);
            });
        });

        // 列表：initial / named / movepoints / result(1,2…) / display(1,2…) / explore
        const lists = new Map();
        expressions.forEach(node => {
            const label = attrOf(node, 'label');
            const exp = attrOf(node, 'exp');
            if (!label || !exp) return;
            const match = exp.trim().match(/^\{(.*)\}$/s);
            if (!match) return;
            const members = match[1].split(',').map(item => item.trim()).filter(Boolean);
            lists.set(label, members);
        });
        return {idOf, typeOf, targetOf, commandOf, inputsOf, lists, commands};
    };

    /* ===================== 结构 → 草图 gmt ===================== */

    /** command 的 input 可能是简单 label，也可能是内联表达式 Segment[A, B] / Radius[c] */
    const parseRef = raw => {
        const text = String(raw || '').trim();
        const match = text.match(/^([A-Za-z]\w*)\s*\[(.*)\]$/);
        if (match) return {inline: match[1], args: match[2].split(',').map(item => item.trim())};
        return {label: text};
    };

    const convertXml = xmlText => {
        const model = readModel(xmlText);
        const {idOf, typeOf, targetOf, commandOf, inputsOf, lists, commands} = model;
        const id = label => idOf.get(label) || label;
        const resolve = label => id(label);
        const inputs = label => inputsOf.get(label) || [];
        const lines = [];
        const internal = [];
        const warnings = [];
        const dropped = new Set();
        // 输入不可用、但自身有坐标而“拍平”成自由点的对象（如建在内置坐标轴上的点）
        const flattened = [];
        const linepoints = [];
        const intersections = [];
        let auxCount = 0;
        const aux = prefix => {
            let name;
            do { name = prefix + ++auxCount; } while (lines.some(line => line.id === name));
            internal.push(name);
            return name;
        };
        const setLine = (name, expression) => {
            const found = lines.find(line => line.id === name);
            if (found) found.expression = expression;
            else lines.push({id: name, expression});
        };
        const segmentEnds = label => {
            const ref = parseRef(label);
            if (ref.inline === 'Segment') return ref.args.map(resolve);
            if (commandOf.get(label) === 'Segment' && typeOf.get(label) === 'segment') {
                return inputs(label).slice(0, 2).map(resolve);
            }
            return null;
        };
        const addAux = (expression, prefix) => {
            const name = aux(prefix);
            setLine(name, expression);
            return name;
        };

        // 自由对象（没有 command 的 element）：点写成坐标；其它类型没有构造来源
        for (const [label, type] of typeOf) {
            if (commandOf.has(label)) continue;
            if (type === 'point') {
                const coord = targetOf.get(label);
                if (!coord) { dropped.add(label); continue; }
                setLine(id(label), `[${fmt(coord[0])},${fmt(coord[1])}]`);
                continue;
            }
            // 函数图像、以及「直接用表达式定义、没有构造指令」的图形：gmt 里没有对应对象，
            // 计入丢失（否则导入后少了东西却毫无提示）
            if (['function', 'conic', 'line', 'ray', 'segment'].includes(type)) dropped.add(label);
        }

        // 输入对象必须能在 gmt 里找到：内置坐标轴（xAxis / yAxis）没有 element，
        // 函数图像、表达式直接定义的图形也没有可引用的 id
        const isUsableInput = raw => {
            const ref = parseRef(raw);
            if (ref.inline) return true;
            const label = ref.label;
            if (!label) return false;
            // 非对象参数（Intersect 的编号 2、FixAngle 的 45° 等）不是引用，直接放行
            if (!/^[A-Za-z_][A-Za-z0-9_']*$/.test(label)) return true;
            if (!typeOf.has(label)) return false;
            if (commandOf.has(label)) return !dropped.has(label);
            return typeOf.get(label) === 'point' && targetOf.has(label);
        };

        // 按 command 在 xml 里的顺序生成（ggb 保证父对象先出现）
        for (const node of commands) {
            const name = attrOf(node, 'name');
            const input = node.getElementsByTagName('input')[0];
            const output = node.getElementsByTagName('output')[0];
            if (!name || !output) continue;
            const rawInputs = input ? inputArgsOf(input) : [];
            const outputs = outputArgsOf(output).filter(Boolean);
            if (!outputs.length) continue;
            // 输入不可用（含上游已被判定丢失的）：输出全是「带坐标的点」时降级成自由点，
            // 尽量保住整张图；否则只能丢弃（例如以函数图像为输入的线 / 圆）。
            // 注意不能把「上游丢失」单独提前处理 —— 否则像 eq1 / 函数这类本来就没有
            // 构造来源的输入会把整条下游链一次性丢光，连降级机会都没有
            if (rawInputs.some(ref => !isUsableInput(ref))) {
                const flattenable = outputs.every(label =>
                    typeOf.get(label) === 'point' && targetOf.has(label));
                if (flattenable) {
                    outputs.forEach(label => {
                        const coord = targetOf.get(label);
                        setLine(resolve(label), `[${fmt(coord[0])},${fmt(coord[1])}]`);
                    });
                    flattened.push(...outputs);
                }else{
                    outputs.forEach(label => dropped.add(label));
                    warnings.push(name);
                }
                continue;
            }
            const a = rawInputs.map(resolve);
            const first = outputs[0];
            const outId = resolve(first);
            const type0 = typeOf.get(parseRef(rawInputs[0]).label);
            const type1 = typeOf.get(parseRef(rawInputs[1]).label);
            let expression = null;
            // 有些指令会「逐个输出自己写行」（切线 / 无穷远点），不能因为它们没有统一的
            // expression 就当成支持成功 —— 否则不支持的切线（线+圆、两圆）会被静默丢掉
            let handled = false;
            switch (name) {
                case 'Line':
                    expression = type1 === 'point' ? `Line[${a[0]},${a[1]}]` : `Parallel[${a[0]},${a[1]}]`;
                    break;
                case 'Ray': expression = `Ray[${a[0]},${a[1]}]`; break;
                case 'Segment': expression = `Segment[${a[0]},${a[1]}]`; break;
                case 'Circle': {
                    if (rawInputs.length >= 3) expression = `Circle3[${a[0]},${a[1]},${a[2]}]`;
                    else if (type1 === 'point') expression = `Circle[${a[0]},${a[1]}]`;
                    else {
                        const ref = parseRef(rawInputs[1]);
                        let ends = segmentEnds(rawInputs[1]);
                        if (ref.inline === 'Radius' && ref.args.length) {
                            const circle = resolve(ref.args[0]);
                            ends = [addAux(`CenterPoint[${circle}]`, 'med'), addAux(`Linepoint[${circle},0]`, 'med')];
                        }
                        if (ends && ends.length === 2) expression = `Compass[${ends[0]},${ends[1]},${a[0]}]`;
                    }
                    break;
                }
                case 'Point': {
                    // 对象上的点：参数不能从 ggb 得到，先占位 0，后面按 coords 反解
                    expression = `Linepoint[${a[0]},0]`;
                    linepoints.push({id: outId, baseId: a[0], target: targetOf.get(first)});
                    break;
                }
                case 'Intersect': {
                    expression = `Intersect[${a[0]},${a[1]},0]`;
                    outputs.forEach((label, index) => intersections.push({
                        id: resolve(label), aId: a[0], bId: a[1], target: targetOf.get(label),
                        expression: `Intersect[${a[0]},${a[1]},${index}]`,
                    }));
                    break;
                }
                case 'Midpoint': {
                    const ends = rawInputs.length < 2 ? segmentEnds(rawInputs[0]) : null;
                    expression = ends ? `Midpoint[${ends[0]},${ends[1]}]` : `Midpoint[${a[0]},${a[1]}]`;
                    break;
                }
                case 'OrthogonalLine': expression = `Perp[${a[0]},${a[1]}]`; break;
                case 'ParallelLine': expression = `Parallel[${a[0]},${a[1]}]`; break;
                case 'LineBisector': {
                    const ends = rawInputs.length < 2 ? segmentEnds(rawInputs[0]) : null;
                    expression = ends ? `PBisect[${ends[0]},${ends[1]}]` : `PBisect[${a[0]},${a[1]}]`;
                    break;
                }
                case 'AngularBisector':
                    if (rawInputs.length >= 3) expression = `ABisect[${a[0]},${a[1]},${a[2]}]`;
                    break;
                case 'Center': expression = `CenterPoint[${a[0]}]`; break;
                case 'Tangent':
                    if (type0 === 'point' && type1 === 'conic') {
                        outputs.forEach((label, index) => setLine(resolve(label),
                            `Tangent[${a[0]},${a[1]},${index}]`));
                        expression = null;
                        handled = true;
                    }
                    break;
                case 'Polar': expression = `PolarLine[${a[0]},${a[1]}]`; break;
                case 'PolarPoint': expression = `PolarPoint[${a[0]},${a[1]}]`; break;
                case 'CopyAngle':
                    if (a.length >= 5) expression = `CopyAngle[${a.slice(0, 5).join(',')}]`;
                    break;
                case 'FixAngle':
                    expression = `FixAngle[${a[0]},${a[1]},${fmt(Number(String(rawInputs[2] || '0').replace(/[^\d.\-+eE]/g, '')) || 0)}]`;
                    break;
                case 'EdgePoint':
                    outputs.forEach((label, index) => setLine(resolve(label), `EdgePoint[${a[0]},${index}]`));
                    expression = null;
                    handled = true;
                    break;
                default: break;
            }
            if (expression) {
                setLine(outId, expression);
            } else if (!handled) {
                outputs.forEach(label => dropped.add(label));
                warnings.push(name);
                continue;
            }
            // Intersect 的其余输出：先占位，反解阶段统一回填
            if (name === 'Intersect') {
                outputs.slice(1).forEach((label, index) =>
                    setLine(resolve(label), `Intersect[${a[0]},${a[1]},${index + 1}]`));
            }
        }

        const settingLines = [];
        const membersOf = key => (lists.get(key) || []).map(resolve).filter(Boolean);
        settingLines.push('initial=' + membersOf('initial').join(','));
        settingLines.push('named=' + membersOf('named').join(','));
        settingLines.push('movepoints=' + membersOf('movepoints').join(','));
        settingLines.push('hidden=');
        const resultKeys = [...lists.keys()].filter(key => /^result\d*$/.test(key))
            .sort((x, y) => (Number(x.slice(6)) || 0) - (Number(y.slice(6)) || 0));
        resultKeys.forEach(key => {
            const suffix = key.slice(6);
            const judged = membersOf(key);
            const shown = membersOf('display' + suffix);
            settingLines.push('result=' + judged.join(',') + (shown.length ? ':' + shown.join(',') : ''));
        });
        if (!resultKeys.length) settingLines.push('result=');
        settingLines.push('explore=' + membersOf('explore').join(','));

        const alias = new Map();
        const resolveAlias = word => {
            let current = word;
            for (let guard = 0; alias.has(current) && guard < 8; guard++) current = alias.get(current);
            return current;
        };
        const applyAliases = text => alias.size
            ? text.replace(/[A-Za-z_]\w*/g, resolveAlias)
            : text;
        const build = () => {
            const objectLines = lines
                .filter(line => line.expression && !alias.has(line.id))
                .map(line => `${line.id}=${applyAliases(line.expression)}`);
            const head = [];
            if (warnings.length) head.push('# ggb: unsupported command(s): ' + [...new Set(warnings)].join(', '));
            if (flattened.length) {
                head.push('# ggb: flattened to free points (input not convertible): '
                    + [...new Set(flattened)].join(', '));
            }
            const internalIds = internal.filter(name => !alias.has(name));
            if (internalIds.length) head.push('#internal=' + internalIds.map(applyAliases).join(','));
            const settings = settingLines.map(applyAliases);
            return [...head, ...objectLines, '', ...settings, ''].join('\n');
        };

        /* ---------- 参数反解：在独立几何引擎上按目标坐标求 gmt 参数 ---------- */
        const refine = () => {
            if (typeof window.parseGmt !== 'function'
                || typeof GeometryElementManager === 'undefined'
                || typeof ToolsFunction === 'undefined') return;
            const probe = text => {
                const parsed = window.parseGmt(text);
                const manager = new GeometryElementManager();
                manager.loadStorage(parsed.elements);
                // ToolsFunction.intersectionSiblingCount 读的是**全局** geometryManager，
                // 独立引擎里查不到自己会一律当成「第一个交点」，编号规则就和最终载入不一致。
                // 这里按 gmt 顺序把「同一对基底上的第几个」写进它的缓存再重算一次
                const globalTotal = typeof geometryManager !== 'undefined'
                    && typeof geometryManager.getAllByOrder === 'function'
                    ? geometryManager.getAllByOrder().length : -1;
                const seen = new Map();
                [...manager.getAllByOrder()].forEach(item => {
                    const base = item.getBase?.();
                    if (!base || base.type !== 'intersection' || !Array.isArray(base.bases)) return;
                    const key = base.bases.slice(0, 2).map(entry => entry?.getId?.()).sort().join('|');
                    const index = seen.get(key) || 0;
                    seen.set(key, index + 1);
                    base.siblingCount = index;
                    base.siblingCountTotal = globalTotal;
                    delete base.candidateIdentity;
                    delete base.rawIndex;
                    item.modifyBase?.('intersection', base.bases, base.value, base.exclude);
                });
                return manager;
            };
            const coordOf = (manager, name) => {
                const item = manager.get(name);
                const coord = item && item.getCoordinate ? item.getCoordinate() : null;
                return Array.isArray(coord) && Number.isFinite(coord[0]) ? coord : null;
            };
            const distance = (coord, target) => coord && target
                ? Math.hypot(coord[0] - target[0], coord[1] - target[1]) : Infinity;

            // 别名判断只比 ggb 的**目标坐标**，且只能并入 gmt 里更早出现的点：
            // 草图里的参数全是占位值，交点位置本来就错，拿运行时坐标比会把不重合的点
            // 误判成重合（ys2610.ggb 里 E、H 相差 7.9，却被并成一个，e=Circle[O,H]
            // 于是引用到后面才定义的 H，parseGmt 随后丢掉大半图形）
            const orderOf = new Map(lines.map((line, index) => [line.id, index]));
            const targetByGmtId = new Map();
            targetOf.forEach((coord, label) => targetByGmtId.set(id(label), coord));
            const earlierTwinOf = item => {
                if (!item.target) return null;
                const index = orderOf.get(item.id) ?? Infinity;
                let best = null;
                targetByGmtId.forEach((coord, otherId) => {
                    if (otherId === item.id) return;
                    if ((orderOf.get(otherId) ?? Infinity) >= index) return;
                    const delta = Math.hypot(coord[0] - item.target[0], coord[1] - item.target[1]);
                    if (delta <= 1e-9 && (!best || delta < best.delta)) best = {id: otherId, delta};
                });
                return best ? best.id : null;
            };

            // 按 gmt 行序（= ggb 命令序，父一定先于子）逐个反解。
            // 不能「先把所有 Linepoint 解完、再解 Intersect」：线上点的基底可能是一个
            // 还没反解的 Intersect（aaatest.ggb 里 H=Point[g]、g=Line[E,F]，E 是交点），
            // 那样 H 的参数会按占位交点算出来，落到线的另一个位置
            const tasks = [
                ...linepoints.map(item => ({kind: 'linepoint', item})),
                ...intersections.map(item => ({kind: 'intersection', item})),
            ].sort((a, b) => (orderOf.get(a.item.id) ?? Infinity) - (orderOf.get(b.item.id) ?? Infinity));

            tasks.forEach(task => {
                const item = task.item;
                if (!item.target) return;
                const manager = probe(build());
                if (task.kind === 'linepoint') {
                    // 让 app 自己按目标坐标反解参数（onlineValueOf / nearPointOnCircle）
                    if (!manager.get(item.id)) return;
                    manager.modifyPointCoordinate(item.id, item.target[0], item.target[1]);
                    const base = manager.get(item.id).getBase?.();
                    if (base && Number.isFinite(base.value)) {
                        item.expression = `Linepoint[${item.baseId},${fmt(base.value)}]`;
                        setLine(item.id, item.expression);
                    }
                    return;
                }
                // Intersect：枚举「编号 0/1」与「第四参数已知点」写法，读回坐标取最准的
                const first = manager.get(item.aId);
                const second = manager.get(item.bId);
                if (!first || !second) return;
                let candidates = [];
                try { candidates = ToolsFunction.intersectionCandidates(first, second) || []; } catch (e) { /* 退化 */ }
                let bestIndex = 0;
                let bestDistance = Infinity;
                candidates.forEach(candidate => {
                    const d = distance([candidate.x, candidate.y], item.target);
                    if (d < bestDistance) { bestDistance = d; bestIndex = candidate.index; }
                });
                // 目标落在更早的已有点上：不再造重合的交点对象，所有引用改指那个点
                const twinId = earlierTwinOf(item);
                if (twinId) {
                    alias.set(item.id, twinId);
                    return;
                }
                const args = [item.aId, item.bId];
                const variants = [];
                [bestIndex, 1 - bestIndex, 0, 1].forEach(index => {
                    const expression = `Intersect[${args[0]},${args[1]},${index}]`;
                    if (!variants.some(entry => entry.expression === expression)) variants.push({expression});
                });
                // 第四参数：把「目标之外的那个候选」上已有的点排除掉，身份最稳定
                const otherCandidates = candidates.filter(candidate => candidate.index !== bestIndex);
                const knownIds = [];
                [...manager.getAllByOrder()].forEach(other => {
                    if (other.getType?.() !== 'point' || other.getId() === item.id) return;
                    const coord = coordOf(manager, other.getId());
                    if (otherCandidates.some(candidate => distance([candidate.x, candidate.y], coord) < 1e-6)) {
                        knownIds.push(other.getId());
                    }
                });
                knownIds.slice(0, 4).forEach(knownId => variants.push({
                    expression: `Intersect[${args[0]},${args[1]},-,${knownId}]`,
                }));
                let best = null;
                variants.forEach(variant => {
                    setLine(item.id, variant.expression);
                    const check = probe(build());
                    const error = distance(coordOf(check, item.id), item.target);
                    const stable = variant.expression.includes(',-,');
                    if (!best || error < best.error - 1e-7
                        || (Math.abs(error - best.error) <= 1e-7 && stable && !best.stable)) {
                        best = {expression: variant.expression, error, stable};
                    }
                });
                setLine(item.id, best ? best.expression : item.expression);
            });
        };
        refine();
        // dropped 是「因指令不支持（含被连带丢弃的下游对象）而没能转换」的 ggb 对象名，
        // 交给调用方在导入后提示用户，避免图形缺了一块却毫无反馈
        return {
            text: build(),
            dropped: [...dropped],
            unsupported: [...new Set(warnings)],
            flattened: [...new Set(flattened)],
        };
    };

    /* ===================== 对外接口 ===================== */

    const convert = (buffer, detailed) => {
        const result = convertXml(unzipEntry(buffer, 'geogebra.xml'));
        return detailed ? result : result.text;
    };

    /** 转换结果有对象丢失时的提示文案 */
    const skipMessage = result => {
        const english = typeof currentLang === 'function' && currentLang() === 'en';
        const separator = english ? ', ' : '、';
        const labels = result.dropped.slice(0, 6);
        const list = labels.join(separator) + (result.dropped.length > labels.length ? '…' : '');
        const template = typeof t === 'function' ? t('board.ggbImportSkipped')
            : '已导入，但 {n} 个对象未能转换：{list}';
        return template.replace('{n}', String(result.dropped.length)).replace('{list}', list);
    };

    /** 弹出文件选择框，转换成功后把 gmt 文本交给 onGmtText */
    const pickGgbFile = (onGmtText, onError) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.ggb,application/zip';
        input.addEventListener('change', () => {
            const file = input.files && input.files[0];
            if (!file) return;
            file.arrayBuffer().then(buffer => {
                try {
                    const result = convert(buffer, true);
                    if (typeof onGmtText === 'function') onGmtText(result.text);
                    if (result.dropped.length) {
                        const message = skipMessage(result);
                        if (typeof window.boardToast === 'function') window.boardToast(message);
                        else console.warn('[ggb import]', message);
                    }
                } catch (error) {
                    console.error('[ggb import]', error);
                    if (typeof onError === 'function') onError(error);
                }
            }).catch(error => {
                console.error('[ggb import]', error);
                if (typeof onError === 'function') onError(error);
            });
        });
        input.click();
    };

    const importFailed = error => {
        if (typeof window.boardToast === 'function') {
            const prefix = typeof t === 'function' ? t('board.ggbImportFailed') : 'ggb 导入失败';
            window.boardToast(prefix + '：' + (error && error.message ? error.message : String(error)));
        }
    };

    window.ggbImport = {
        convert,
        convertXml,
        pickGgbFile: (onGmtText, onError) => pickGgbFile(onGmtText, onError || importFailed),
    };
})();
