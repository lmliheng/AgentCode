<script setup lang="ts">
import { Box, Text } from '@vue-tui/runtime';
import ToolCallCard from './ToolCallCard.vue';

defineProps<{
    messages: Array<{
        id: string;
        role: 'user' | 'assistant' | 'system';
        content?: string;
        thought?: string;
        answer?: string;
        toolCall?: {
            tool: string;
            params: Record<string, unknown>;
            status: 'running' | 'success' | 'failed';
            result?: any;
        };
    }>;
}>();
</script>

<template>
    <Box flex-direction="column">
        <Box
            v-for="msg in messages"
            :key="msg.id"
            flex-direction="column"
            :margin-bottom="1"
        >
            <!-- 用户消息 -->
            <Box v-if="msg.role === 'user'" justify-content="flex-end">
                <Box background-color="blue" :padding-x="1" :padding-y="0" :max-width="80">
                    <Text color="white">{{ msg.content }}</Text>
                </Box>
            </Box>

            <!-- 助手消息 -->
            <Box v-if="msg.role === 'assistant'" flex-direction="column">
                <Box v-if="msg.thought" :padding-left="1">
                    <Text dimColor italic>{{ msg.thought }}</Text>
                </Box>

                <Box v-if="msg.toolCall" :margin-top="1">
                    <ToolCallCard :tool-call="msg.toolCall" />
                </Box>

                <Box v-if="msg.answer" :margin-top="1">
                    <Box background-color="green" :padding-x="1" :padding-y="0">
                        <Text color="white">{{ msg.answer }}</Text>
                    </Box>
                </Box>
            </Box>

            <!-- 系统消息 -->
            <Box v-if="msg.role === 'system'" justify-content="center">
                <Text color="red" dimColor>{{ msg.content }}</Text>
            </Box>
        </Box>
    </Box>
</template>