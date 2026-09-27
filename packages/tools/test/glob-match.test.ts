// glob 匹配器：语义不多，但每条都要钉住 —— 它一旦判错，工具就会要么什么都找不到、
// 要么在「看起来对」的结果里混进不该有的东西。

import { describe, it, expect } from 'vitest';
import {
    compileGlob,
    expandBraces,
    hasWildcard,
    matchesGlob,
    matchesNamePattern,
} from '../src/glob-match.js';

describe('glob 通配符匹配', () => {
    it('* 不跨 /，? 只吃一个字符', () => {
        expect(matchesGlob('src/a.ts', 'src/*.ts')).toBe(true);
        expect(matchesGlob('src/sub/a.ts', 'src/*.ts')).toBe(false);
        expect(matchesGlob('a.ts', '?.ts')).toBe(true);
        expect(matchesGlob('ab.ts', '?.ts')).toBe(false);
        // ? 不吃 /
        expect(matchesGlob('a/b.ts', 'a?b.ts')).toBe(false);
    });

    it('** 跨任意层目录，也可以一层都不跨', () => {
        expect(matchesGlob('a.ts', '**/*.ts')).toBe(true);
        expect(matchesGlob('src/a.ts', '**/*.ts')).toBe(true);
        expect(matchesGlob('src/x/y/a.ts', '**/*.ts')).toBe(true);
        expect(matchesGlob('a/**/b.ts', 'a/**/b.ts')).toBe(true);
        expect(matchesGlob('a/x/b.ts', 'a/**/b.ts')).toBe(true);
        expect(matchesGlob('a/x/y/b.ts', 'a/**/b.ts')).toBe(true);
        expect(matchesGlob('c/b.ts', 'a/**/b.ts')).toBe(false);
    });

    it('模式里不写 / 时按「任意目录下的这个文件名」理解', () => {
        expect(matchesGlob('a.md', '*.md')).toBe(true);
        expect(matchesGlob('docs/a.md', '*.md')).toBe(true);
        expect(matchesGlob('docs/deep/a.md', '*.md')).toBe(true);
        expect(matchesGlob('docs/a.txt', '*.md')).toBe(false);
    });

    it('{a,b} 多选一，可嵌套，可带前后缀', () => {
        expect(matchesGlob('src/a.ts', 'src/*.{ts,tsx}')).toBe(true);
        expect(matchesGlob('src/a.tsx', 'src/*.{ts,tsx}')).toBe(true);
        expect(matchesGlob('src/a.js', 'src/*.{ts,tsx}')).toBe(false);
        expect(matchesGlob('a.ts', '{src,lib}/a.ts')).toBe(false);
        expect(matchesGlob('lib/a.ts', '{src,lib}/a.ts')).toBe(true);
        expect(matchesGlob('x1.md', 'x{1,2}{a,}.md')).toBe(true);
        expect(matchesGlob('x2a.md', 'x{1,2}{a,}.md')).toBe(true);
    });

    it('正则元字符按字面处理（. 不该变成任意字符）', () => {
        expect(matchesGlob('a.ts', 'a.ts')).toBe(true);
        expect(matchesGlob('aXts', 'a.ts')).toBe(false);
        expect(matchesGlob('a+b.ts', 'a+b.ts')).toBe(true);
        expect(matchesGlob('node_modules/x.ts', 'node_modules/*.ts')).toBe(true);
    });

    it('未闭合的 { 与单选项按字面处理，不猜意思', () => {
        expect(expandBraces('a{b')).toEqual(['a{b']);
        expect(expandBraces('a{b}')).toEqual(['a{b}']);
        expect(expandBraces('a{b,c}')).toEqual(['ab', 'ac']);
    });

    it('花括号展开有上限，指数级模式不会把内存拉满', () => {
        // 8 组二选一 = 256 种；截到上限而不是全部展开
        const expanded = expandBraces('{a,b}/{a,b}/{a,b}/{a,b}/{a,b}/{a,b}/{a,b}/{a,b}');
        expect(expanded.length).toBeLessThanOrEqual(64);
        expect(expanded.length).toBeGreaterThan(0);
    });

    it('开头的 ./ 与分隔符写法不影响匹配', () => {
        expect(matchesGlob('./src/a.ts', 'src/*.ts')).toBe(true);
        expect(matchesGlob('src\\a.ts', 'src/*.ts')).toBe(true);
    });

    it('hasWildcard 只认真正的通配符', () => {
        expect(hasWildcard('*.ts')).toBe(true);
        expect(hasWildcard('a?b')).toBe(true);
        expect(hasWildcard('{a,b}')).toBe(true);
        expect(hasWildcard('README')).toBe(false);
    });

    it('compileGlob 一次编译可反复判定（结果与单次匹配一致）', () => {
        const match = compileGlob('src/**/*.ts');

        expect(match('src/a.ts')).toBe(true);
        expect(match('src/x/a.ts')).toBe(true);
        expect(match('other/a.ts')).toBe(false);
    });

    it('列表工具的 pattern：带通配符按通配符，不带按前缀（旧行为）', () => {
        expect(matchesNamePattern('test_utils.ts', 'test_')).toBe(true);
        expect(matchesNamePattern('utils.ts', 'test_')).toBe(false);
        expect(matchesNamePattern('utils.ts', '*.ts')).toBe(true);
        expect(matchesNamePattern('utils.js', '*.ts')).toBe(false);
        // 从前传 "*.ts" 一条都匹配不到，这条就是那次修正的回归
        expect(matchesNamePattern('README.md', '*.md')).toBe(true);
    });
});
