import type { Agent } from './agent';
import type { FunctionTool, Tool } from './tool';
export declare function registerAgentToolSourceAgent(tool: FunctionTool<any, any, any>, agent: Agent<any, any>): void;
export declare function getAgentToolSourceAgent(tool: Tool<any>): Agent<any, any> | undefined;
