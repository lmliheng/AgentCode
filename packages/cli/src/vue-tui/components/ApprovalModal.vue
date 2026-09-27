<script setup lang="ts">
import { Box, Text } from '@vue-tui/runtime';

defineProps<{
    pendingAction: {
        id: string;
        preview: {
            tool: string;
            summary: string;
            riskLevel: 'low' | 'medium' | 'high';
        };
    };
}>();
</script>

<template>
    <Box position="absolute" top="50%" left="50%" width="50%" :height="100">
        <Box
            border-style="double"
            background-color="black"
            :padding="2"
            flex-direction="column"
        >
            <Text bold color="yellow"> 需要人工确认</Text>

            <Box :margin-top="1">
                <Text>工具: </Text>
                <Text bold>{{ pendingAction.preview.tool }}</Text>
            </Box>

            <Box :margin-top="1">
                <Text>操作: </Text>
                <Text>{{ pendingAction.preview.summary }}</Text>
            </Box>

            <Box :margin-top="1">
                <Text>风险等级: </Text>
                <Text
                    :color="pendingAction.preview.riskLevel === 'high' ? 'red' : pendingAction.preview.riskLevel === 'medium' ? 'yellow' : 'green'"
                >
                    {{ pendingAction.preview.riskLevel }}
                </Text>
            </Box>

            <Box :margin-top="2" justify-content="space-around">
                <Text color="green">[Enter/Y] 批准</Text>
                <Text color="red">[N] 拒绝</Text>
            </Box>
        </Box>
    </Box>
</template>