import git_ai from '@lmliheng/ai_git'
import path from 'path'
if (process.argv[2] === 'comsume') {
    await git_ai.ai_commsume(path.join(import.meta.dirname, '../CHANGLOG.md'), {
        branch: 'main'
    })
}

if (process.argv[2] === 'commits') {
    let commits = await git_ai.commit_history()
    console.table(commits)
}

if (process.argv[2] === 'batch') {
    await git_ai.ai_commsume(path.join(import.meta.dirname, '../CHANGLOG.md'), {
        branch: 'main',
        batch: [0,26]
    })
}