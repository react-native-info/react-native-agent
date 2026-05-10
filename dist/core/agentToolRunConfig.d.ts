import type { RunConfig } from './run';
export declare function setAgentToolParentRunConfigOnDetails(details: object, parentRunConfig: Partial<RunConfig> | undefined): void;
export declare function getAgentToolParentRunConfigFromDetails(details: unknown): Partial<RunConfig> | undefined;
export declare function getInheritedAgentToolRunConfig(parentRunConfig: Partial<RunConfig> | undefined, toolRunConfigOverride: Partial<RunConfig> | undefined): Partial<RunConfig> | undefined;
export declare function mergeAgentToolRunConfig(inheritedRunConfig: Partial<RunConfig> | undefined, toolRunConfigOverride: Partial<RunConfig> | undefined): Partial<RunConfig>;
