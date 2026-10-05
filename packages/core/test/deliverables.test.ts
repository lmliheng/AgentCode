// 交付物声明的收敛：模型输出不可信，这里只保证「进得来的一定是能核对的形状」。
import { describe, it, expect } from 'vitest';
import { normalizeDeliverables } from '../src/deliverables.js';

describe('交付物声明收敛', () => {
    it('对象与裸字符串两种写法都收', () => {
        expect(normalizeDeliverables([
            { path: 'results/weather.md', contains: '北京' },
            'notes.md',
        ])).toEqual([
            { path: 'results/weather.md', contains: '北京' },
            { path: 'notes.md' },
        ]);
    });

    it('去掉空路径、重复路径与非对象项', () => {
        expect(normalizeDeliverables([
            { path: '  ' },
            { path: 'a.md' },
            { path: 'a.md' },
            null,
            42,
            ['a.md'],
            { path: 'b.md', contains: '' },
        ])).toEqual([
            { path: 'a.md' },
            { path: 'b.md' },
        ]);
    });

    it('路径两侧空白被裁掉（模型常带换行）', () => {
        expect(normalizeDeliverables(['  results/a.md  '])).toEqual([{ path: 'results/a.md' }]);
    });

    it('不是数组时返回空清单，不抛错', () => {
        expect(normalizeDeliverables(undefined)).toEqual([]);
        expect(normalizeDeliverables('a.md')).toEqual([]);
        expect(normalizeDeliverables({ path: 'a.md' })).toEqual([]);
    });

    it('不在这里判路径合法性（越界路径也要如实带进验收）', () => {
        // 静默丢掉一条越界声明，验收时就没人知道它被声明过；
        // 交出去由验收逐条给出「不通过」的结论才是可审计的。
        expect(normalizeDeliverables(['../../etc/passwd'])).toEqual([{ path: '../../etc/passwd' }]);
    });
});
