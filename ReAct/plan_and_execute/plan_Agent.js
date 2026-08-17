/**
 *   runPlanAgent 会完成以下工作：
 * 1. 根据 goal 和 completionCriteria 生成初始排查计划；
 * 2. 从 toolCatalog 中选择合适的工具；
 * 3. 通过 executeTool 执行工具；
 * 4. 根据工具返回的 Observation 调整后续计划；
 * 5. 满足完成标准后，输出故障原因和处理建议。
 */


