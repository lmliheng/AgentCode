<script setup lang="ts">
import { ref } from 'vue';
import { Box, Text, useInput } from '@vue-tui/runtime';
import ChatView from './components/ChatView.vue';
import ApprovalModal from './components/ApprovalModal.vue';
import { useAgent } from './composable/useAgent.js';

const {
    messages,
    isRunning,
    stats,
    pendingApproval,
    submitPrompt,
    handleApproval,
} = useAgent();

const inputValue = ref('');

useInput((event: any) => {
    if (pendingApproval.value) {
        if (event.type === 'text' && (event.text === 'y' || event.text === 'Y')) {
            handleApproval('approve');
        } else if (event.type === 'key' && event.key?.name === 'return') {
            handleApproval('approve');
        } else if (event.type === 'text' && (event.text === 'n' || event.text === 'N')) {
            handleApproval('reject');
        }
        return;
    }

    if (event.type === 'key' && event.key?.name === 'return') {
        if (inputValue.value.trim()) {
            submitPrompt(inputValue.value.trim());
            inputValue.value = '';
        }
        return;
    }

    if (event.type === 'key' && (event.key?.name === 'backspace' || event.key?.name === 'delete')) {
        inputValue.value = inputValue.value.slice(0, -1);
        return;
    }

    if (event.type === 'text') {
        inputValue.value += event.text;
    }
});
</script>

<template>
    <Box flex-direction="column" :height="100">
        <Box border-style="single" :padding-x="1">
            <Text bold color="cyan"> AI Coding Agent</Text>
            <Text dimColor> | {{ stats.modelName }}</Text>
            <Text v-if="isRunning" color="yellow"> | ● 运行中</Text>
            <Text v-else color="green"> | ● 就绪</Text>
        </Box>

        <Box :flex-grow="1" overflow-y="visible" :padding-x="1" :padding-y="1">
            <ChatView :messages="messages" />
        </Box>

        <Box border-style="single" :padding-x="1">
            <Text dimColor>
                工具调用: {{ stats.toolCallCount }} | 迭代: {{ stats.iterationCount }} | Token: {{ stats.totalTokens }}
            </Text>
        </Box>

        <Box :padding-x="1" :padding-bottom="1">
            <Text color="green">&gt; </Text>
            <Text>{{ inputValue }}<Text v-if="!isRunning">▌</Text></Text>
        </Box>

        <ApprovalModal
            v-if="pendingApproval"
            :pending-action="pendingApproval"
        />
    </Box>
</template>