
import type { Tool } from '../types/Tool.js'
import { ReadFileTool } from './read_file.js';
import { ApplyDiffTool } from './apply_diff.js';
import { CreateFileTool } from './create_file.js';
import { DeleteFileTool } from './delete_file.js';
import { EditFileTool } from './edit_file.js';
import { FetchUrlTool } from './fetch_url.js';
import { GitOperationTool } from './git_operation.js';
import { ListFilesTool } from './list_files.js';
import { MoveFileTool } from './move_file.js';
import { ReadDirectoryTool } from './read_directory.js';
import { RunCommandTool } from './run_command.js';
import { SearchCodeTool } from './search_code.js';


export function baseTools(): Tool[] {
    return [
        new ReadFileTool(),
        new ApplyDiffTool(),
        new RunCommandTool(),
        new FetchUrlTool(),
        new CreateFileTool(),
        new GitOperationTool(),
        new ListFilesTool(),
        new EditFileTool(),
        new ReadDirectoryTool(),
        new DeleteFileTool(),
        new MoveFileTool(),
        new SearchCodeTool(),
    ];
}

