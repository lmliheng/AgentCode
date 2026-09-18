<script setup lang="ts">
import { Box, Text } from '@vue-tui/runtime';

defineProps<{
    toolCall: {
        tool: string;
        params: Record<string, unknown>;
        status: 'running' | 'success' | 'failed';
        result?: any;
    };
}>();
</script>

<template>
    <Box border-style="round" flex-direction="column" :padding-x="1" :padding-y="1">
        <Box>
            <Text
                bold
                :color="toolCall.status === 'failed' ? 'red' : toolCall.status === 'running' ? 'yellow' : 'green'"
            >
                {{ toolCall.status === 'running' ? '⟳' : toolCall.status === 'success' ? '✓' : '✗' }}
                {{ toolCall.tool }}
            </Text>
        </Box>

        <Box :margin-top="1">
            <Text dimColor>参数: {{ JSON.stringify(toolCall.params) }}</Text>
        </Box>

        <Box v-if="toolCall.result && toolCall.status === 'success'" :margin-top="1">
            <Text color="green" dimColor>
                {{ typeof toolCall.result === 'string' ? toolCall.result.slice(0, 200) : 'OK' }}
            </Text>
        </Box>

        <Box v-if="toolCall.result && toolCall.status === 'failed'" :margin-top="1">
            <Text color="red" dimColor>
                {{ typeof toolCall.result === 'string' ? toolCall.result.slice(0, 200) : '失败' }}
            </Text>
        </Box>
    </Box>
</template>