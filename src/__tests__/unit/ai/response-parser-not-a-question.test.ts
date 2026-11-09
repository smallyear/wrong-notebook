/**
 * 识别结果的「非题目」归因与「无答案」容错
 *
 * 背景：上传的截图不是题目时，AI 会如实转录内容并把 answer_text 留空，
 * 旧逻辑统一报 Missing critical XML tags → 前端显示「未知 AI 错误」。
 * 现在：命中非题目信号时报 AI_NOT_A_QUESTION；确实是题目但没有答案时按空答案返回。
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
    createLogger: vi.fn(() => ({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        box: vi.fn(),
        divider: vi.fn(),
    })),
}));

import { AI_NOT_A_QUESTION, looksLikeNotAQuestion, parseQuestionResponse } from '@/lib/ai/response-parser';

/** 复现用户上传 issue 截图时的模型输出：有转录、无答案、解析说明不是题目 */
const NOT_A_QUESTION_RESPONSE = `
<question_text>【B】【高优先级】【港交所】验证 URA 系统对引号的支持程度</question_text>
<answer_text></answer_text>
<analysis>图片内容不是学科考试题目，而是代码托管平台上一个 issue 的评论截图。</analysis>
<subject>其他</subject>
<knowledge_points>测试,引号</knowledge_points>
`.trim();

describe('parseQuestionResponse 非题目归因', () => {
    it('答案为空且解析说明不是题目时抛出 AI_NOT_A_QUESTION', () => {
        expect(() => parseQuestionResponse(NOT_A_QUESTION_RESPONSE)).toThrow(AI_NOT_A_QUESTION);
    });

    it('英文解析中的非题目说明同样归因', () => {
        const response = `
<question_text>Issue #1156 comment</question_text>
<analysis>This image is not a question; it is a screenshot of a code hosting issue thread.</analysis>
        `.trim();

        expect(() => parseQuestionResponse(response)).toThrow(AI_NOT_A_QUESTION);
    });

    it('没有 analysis 标签但转录文字说明不是题目时也归因', () => {
        const response = `
<question_text>这张图片不是题目，是一段聊天记录截图。</question_text>
        `.trim();

        expect(() => parseQuestionResponse(response)).toThrow(AI_NOT_A_QUESTION);
    });
});

describe('parseQuestionResponse 无答案容错', () => {
    it('确实是题目但没有答案时正常返回，答案留空', () => {
        const response = `
<question_text>证明：三角形内角和为 180 度。</question_text>
<answer_text></answer_text>
<analysis>用平行线内错角相等的性质证明。</analysis>
        `.trim();

        const result = parseQuestionResponse(response);

        expect(result.questionText).toContain('三角形内角和');
        // 占位空白：通过 schema 的 min(1)，保存时由 parsedQuestionToSavePayload 还原为空串
        expect(result.answerText.trim()).toBe('');
    });

    it('答案标签缺失但有题干与解析时同样按空答案返回', () => {
        const response = `
<question_text>求 1 + 1 的值。</question_text>
<analysis>直接相加即可。</analysis>
        `.trim();

        const result = parseQuestionResponse(response);

        expect(result.questionText).toBe('求 1 + 1 的值。');
        expect(result.answerText.trim()).toBe('');
    });
});

describe('parseQuestionResponse 真正的解析失败仍报原错误', () => {
    it('缺少 analysis 时抛出 Missing critical XML tags', () => {
        const response = `
<question_text>测试题目</question_text>
<answer_text>测试答案</answer_text>
        `.trim();

        expect(() => parseQuestionResponse(response)).toThrow('Missing critical XML tags');
    });

    it('缺少 question_text 时抛出 Missing critical XML tags', () => {
        const response = `
<answer_text>测试答案</answer_text>
<analysis>测试解析</analysis>
        `.trim();

        expect(() => parseQuestionResponse(response)).toThrow('Missing critical XML tags');
    });
});

describe('looksLikeNotAQuestion', () => {
    it.each([
        '这不是一道题，而是一页笔记。',
        '图片中没有题目，只有表格。',
        '未能识别到任何题干内容。',
        '无法识别为学科题目。',
        'This is not a question, just a screenshot.',
        'No question found in the image.',
    ])('识别非题目描述：%s', (analysis) => {
        expect(looksLikeNotAQuestion(analysis)).toBe(true);
    });

    it.each([
        '本题考查一元二次方程的解法。',
        '题目中没有给出答案，需要学生自行推导。',
        '图中共有三条线段，求解阴影面积。',
    ])('正常解析不误判：%s', (analysis) => {
        expect(looksLikeNotAQuestion(analysis)).toBe(false);
    });

    it('空值返回 false', () => {
        expect(looksLikeNotAQuestion(null)).toBe(false);
        expect(looksLikeNotAQuestion(undefined)).toBe(false);
        expect(looksLikeNotAQuestion('')).toBe(false);
    });
});
