/**
 * 统一的 AI 回答解析工具
 *
 * 原先各提供商（OpenAI / Azure / Gemini / Anthropic）各自实现了一份
 * extractTag 与 parseResponse，行为存在差异，现收敛到本模块。
 *
 * 行为约定（以 OpenAI 版本为准，与各版本差异详见提交说明）：
 * - extractTag：analysis 标签缺少闭合标签（输出被截断）时读取到文本末尾，
 *   其余标签缺少闭合标签时返回 null
 * - parseQuestionResponse：返回 ParsedQuestion，必需标签缺失时抛错；
 *   图片里不是题目时抛 AI_NOT_A_QUESTION，答案缺失但确实是题目时按空答案返回
 * - splitKnowledgePoints：按中英文逗号或换行切分知识点
 */
import type { ParsedQuestion } from "./types";
import {
    safeParseParsedQuestion,
    parseDifficultyStars,
    parseFigure,
    parseQuestionType,
    stripThinkingTags,
} from "./schema";
import { normalizeMistakeStatusForSave } from "@/lib/question/mistake-status";
import { parseRecognizedGrade } from "@/lib/question/question-grade";
import { createLogger } from "../logger";

const logger = createLogger('ai:response-parser');

export function extractTag(text: string, tagName: string): string | null {
    const cleaned = stripThinkingTags(text);
    const startTag = `<${tagName}>`;
    const endTag = `</${tagName}>`;
    const startIndex = cleaned.indexOf(startTag);

    // 如果找不到开始标签，返回 null
    if (startIndex === -1) {
        return null;
    }

    const contentStartIndex = startIndex + startTag.length;
    const endIndex = cleaned.lastIndexOf(endTag);

    // 特殊处理：如果闭合标签丢失（通常主要发生在最后的 analysis 标签被截断时）
    // 我们尝试读取到字符串末尾
    if (endIndex === -1 && tagName === 'analysis') {
        logger.warn({ tagName }, 'Tag was verified unclosed, treating as truncated and reading to end');
        return cleaned.substring(contentStartIndex).trim();
    }

    if (endIndex === -1 || contentStartIndex >= endIndex) {
        return null;
    }

    return cleaned.substring(contentStartIndex, endIndex).trim();
}

export function splitKnowledgePoints(raw: string | null | undefined): string[] {
    return (raw || '').split(/[,，\n]/).map(k => k.trim()).filter(k => k.length > 0);
}

/** 图片里不是题目时抛出的错误码，前端按此码提示「没有识别到题目」 */
export const AI_NOT_A_QUESTION = 'AI_NOT_A_QUESTION';

/**
 * AI 解析文本中表示「这张图不是学科题目」的说法。
 * 只在答案缺失时参与判定：正常题目几乎总有答案，因此即便误命中也不会影响正常识别。
 */
const NOT_A_QUESTION_PATTERNS: RegExp[] = [
    // 中文：不是 / 并非 / 不属于 … 题目（「不是一道题」这类省略说法也包含）
    /(?:不是|并非|不属于)[^，。；\n]{0,8}(?:题目|试题|考题|题干|题(?=[，。；,;\n]|$))/,
    // 中文：图片 / 截图 / 内容 中没有（包含）题目
    /(?:图片|截图|照片|图像|内容)[^，。；\n]{0,12}(?:没有|不含|不包含|未包含|未涉及|并非)[^，。；\n]{0,8}(?:题目|试题|题干)/,
    // 中文：未识别到 / 无法识别为 题目
    /未(?:能)?(?:识别|检测)(?:到|出)[^，。；\n]{0,8}(?:题目|试题|题干)/,
    /无法(?:识别|判断)[^，。；\n]{0,10}(?:题目|试题|题干)/,
    // 中文：没有（任何）题目
    /(?:没有|不存在|无)[^，。；\n]{0,4}(?:学科)?(?:题目|试题|题干|考题)/,
    // 英文（不区分大小写，句首大写也能命中）
    /\bnot\s+(?:a|an)\s+[^.,;\n]{0,30}\b(?:question|problem|exam)\b/i,
    /\bno\s+[^.,;\n]{0,20}\b(?:question|problem)\b/i,
    /\bdoes(?:n't| not)\s+contain\b[^.,;\n]{0,30}\b(?:question|problem)\b/i,
];

/** AI 的解析文字是否在说明「图片里不是题目」 */
export function looksLikeNotAQuestion(analysis: string | null | undefined): boolean {
    if (!analysis) return false;
    return NOT_A_QUESTION_PATTERNS.some(pattern => pattern.test(analysis));
}

export function parseQuestionResponse(text: string): ParsedQuestion {
    logger.debug({ textLength: text.length }, 'Parsing AI response');

    const questionText = extractTag(text, "question_text");
    // 部分题目（如证明题、开放题）AI 可能不给答案：先用占位空格通过 schema 的 min(1) 校验，
    // 保存时由 parsedQuestionToSavePayload 还原为空串（与手工录入留空一致）
    const answerRaw = extractTag(text, "answer_text");
    const answerText = answerRaw && answerRaw.trim() ? answerRaw : " ";
    const analysis = extractTag(text, "analysis");
    const subjectRaw = extractTag(text, "subject");
    const knowledgePointsRaw = extractTag(text, "knowledge_points");
    const requiresImageRaw = extractTag(text, "requires_image");
    const wrongAnswerText = extractTag(text, "wrong_answer_text") || "";
    const mistakeAnalysis = extractTag(text, "mistake_analysis") || "";
    const mistakeStatusRaw = extractTag(text, "mistake_status");

    // 没有答案且模型在解析或转录里明确说「不是题目」：图片内容不是题目，
    // 单独归因，让前端提示换图，而不是误报成 AI 返回格式错误
    if (!answerRaw?.trim() && (looksLikeNotAQuestion(analysis) || looksLikeNotAQuestion(questionText))) {
        logger.warn({ analysisSample: (analysis || questionText || '').substring(0, 200) }, 'AI reported the image is not a question');
        throw new Error(AI_NOT_A_QUESTION);
    }

    // 没有解析文字就无法确认模型看到了什么，按解析失败处理
    if (!analysis) {
        logger.error({ rawTextSample: text.substring(0, 500) }, 'Missing critical XML tags');
        throw new Error("Invalid AI response: Missing critical XML tags (<analysis>)");
    }

    if (!questionText) {
        logger.error({ rawTextSample: text.substring(0, 500) }, 'Missing critical XML tags');
        throw new Error("Invalid AI response: Missing critical XML tags (<question_text>)");
    }

    // Process Subject
    let subject: ParsedQuestion['subject'] = '其他';
    const validSubjects: ParsedQuestion['subject'][] = ["数学", "物理", "化学", "生物", "英语", "语文", "历史", "地理", "政治", "其他"];
    if (subjectRaw && (validSubjects as string[]).includes(subjectRaw)) {
        subject = subjectRaw as ParsedQuestion['subject'];
    }

    // Process Knowledge Points
    const knowledgePoints = splitKnowledgePoints(knowledgePointsRaw);

    // Process requiresImage (default to false if not present or unrecognized)
    const requiresImage = requiresImageRaw?.toLowerCase().trim() === 'true';
    const mistakeStatus = normalizeMistakeStatusForSave(mistakeStatusRaw, wrongAnswerText);

    // Construct Result
    const result: ParsedQuestion = {
        questionText,
        answerText,
        analysis,
        wrongAnswerText,
        mistakeAnalysis,
        mistakeStatus,
        subject,
        knowledgePoints,
        requiresImage,
        gradeSemester: parseRecognizedGrade(extractTag(text, "grade_semester")),
        difficultyStars: parseDifficultyStars(extractTag(text, "difficulty_stars")),
        questionType: parseQuestionType(extractTag(text, "question_type")),
        ...parseFigure(extractTag(text, "has_figure"), extractTag(text, "figure_svg")),
    };

    // Final Schema Validation (just to be safe, though likely compliant by now)
    const validation = safeParseParsedQuestion(result);
    if (validation.success) {
        logger.debug('Validated successfully via XML tags');
        return validation.data;
    } else {
        logger.warn({ validationError: validation.error.format() }, 'Schema validation warning');
        // We still return it as we trust our extraction more than the schema at this point
        return result;
    }
}
