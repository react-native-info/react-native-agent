import { DEFAULT_REQUEST_TIMEOUT_MSEC } from '@modelcontextprotocol/sdk/shared/protocol.js';
import { BaseMCPServerStdio, BaseMCPServerStreamableHttp, BaseMCPServerSSE, invalidateServerToolsCache, } from '../../mcp';
import logger from '../../logger';
function failedToImport(error) {
    logger.error(`
Failed to load the MCP SDK. Please install the @modelcontextprotocol/sdk package.

npm install @modelcontextprotocol/sdk
    `.trim());
    throw error;
}
function buildRequestOptions(clientSessionTimeoutSeconds, overrides) {
    const baseOptions = clientSessionTimeoutSeconds === undefined
        ? undefined
        : { timeout: clientSessionTimeoutSeconds * 1000 };
    const mergedOptions = { ...(baseOptions ?? {}), ...(overrides ?? {}) };
    return Object.keys(mergedOptions).length === 0 ? undefined : mergedOptions;
}
function hasSessionTransport(transport) {
    return (transport != null &&
        typeof transport.close === 'function' &&
        (typeof transport.terminateSession === 'function' ||
            transport.sessionId !== undefined));
}
function getTransportProtocolVersion(transport) {
    if (transport != null &&
        typeof transport.protocolVersion ===
            'string') {
        return transport.protocolVersion;
    }
    return undefined;
}
function isNotConnectedError(error, client) {
    return (error instanceof Error &&
        error.message === 'Not connected' &&
        client.transport == null);
}
function attachCause(error, cause) {
    if (!(error instanceof Error)) {
        return error;
    }
    try {
        if (error.cause === undefined) {
            Object.defineProperty(error, 'cause', {
                value: cause,
                configurable: true,
                enumerable: false,
                writable: true,
            });
        }
    }
    catch {
        // Best effort only.
    }
    return error;
}
function getSessionId(transport) {
    return hasSessionTransport(transport) ? transport.sessionId : undefined;
}
function shouldTerminateTransportSession(transportToClose, activeTransport) {
    const closingSessionId = getSessionId(transportToClose);
    if (closingSessionId === undefined) {
        return false;
    }
    const activeSessionId = getSessionId(activeTransport);
    return activeSessionId === undefined || activeSessionId !== closingSessionId;
}
function withTimeout(promise, timeoutMs, onTimeout) {
    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            reject(onTimeout());
        }, timeoutMs);
        void promise.then((value) => {
            clearTimeout(timeoutId);
            resolve(value);
        }, (error) => {
            clearTimeout(timeoutId);
            reject(error);
        });
    });
}
export class NodeMCPServerStdio extends BaseMCPServerStdio {
    session = null;
    _cacheDirty = true;
    _toolsList = [];
    serverInitializeResult = null;
    clientSessionTimeoutSeconds;
    timeout;
    params;
    _name;
    transport = null;
    constructor(params) {
        super(params);
        this.clientSessionTimeoutSeconds = params.clientSessionTimeoutSeconds ?? 5;
        this.timeout = params.timeout ?? DEFAULT_REQUEST_TIMEOUT_MSEC;
        if ('fullCommand' in params) {
            const elements = params.fullCommand.split(' ');
            const command = elements.shift();
            if (!command) {
                throw new Error('Invalid fullCommand: ' + params.fullCommand);
            }
            this.params = {
                ...params,
                command: command,
                args: elements,
                encoding: params.encoding || 'utf-8',
                encodingErrorHandler: params.encodingErrorHandler || 'strict',
            };
        }
        else {
            this.params = params;
        }
        this._name = params.name || `stdio: ${this.params.command}`;
    }
    async connect() {
        try {
            const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js').catch(failedToImport);
            const { Client } = await import('@modelcontextprotocol/sdk/client/index.js').catch(failedToImport);
            this.transport = new StdioClientTransport({
                command: this.params.command,
                args: this.params.args,
                env: this.params.env,
                cwd: this.params.cwd,
            });
            this.session = new Client({
                name: this._name,
                version: '1.0.0', // You may want to make this configurable
            });
            const requestOptions = buildRequestOptions(this.clientSessionTimeoutSeconds);
            await this.session.connect(this.transport, requestOptions);
            this.serverInitializeResult = {
                serverInfo: { name: this._name, version: '1.0.0' },
            };
        }
        catch (e) {
            this.logger.error('Error initializing MCP server:', e);
            await this.close();
            throw e;
        }
        this.debugLog(() => `Connected to MCP server: ${this._name}`);
    }
    async invalidateToolsCache() {
        await invalidateServerToolsCache(this.name);
        this._cacheDirty = true;
    }
    async listTools() {
        const { ListToolsResultSchema } = await import('@modelcontextprotocol/sdk/types.js').catch(failedToImport);
        if (!this.session) {
            throw new Error('Server not initialized. Make sure you call connect() first.');
        }
        if (this.cacheToolsList && !this._cacheDirty && this._toolsList) {
            return this._toolsList;
        }
        this._cacheDirty = false;
        const requestOptions = buildRequestOptions(this.clientSessionTimeoutSeconds);
        const response = await this.session.listTools(undefined, requestOptions);
        this.debugLog(() => `Listed tools: ${JSON.stringify(response)}`);
        this._toolsList = ListToolsResultSchema.parse(response).tools;
        return this._toolsList;
    }
    async callTool(toolName, args, meta) {
        const { CallToolResultSchema } = await import('@modelcontextprotocol/sdk/types.js').catch(failedToImport);
        if (!this.session) {
            throw new Error('Server not initialized. Make sure you call connect() first.');
        }
        const requestOptions = buildRequestOptions(this.clientSessionTimeoutSeconds, { timeout: this.timeout });
        const params = {
            name: toolName,
            arguments: args ?? {},
            ...(meta != null ? { _meta: meta } : {}),
        };
        const response = await this.session.callTool(params, undefined, requestOptions);
        const parsed = CallToolResultSchema.parse(response);
        const result = parsed.content;
        this.debugLog(() => `Called tool ${toolName} (args: ${JSON.stringify(args)}, result: ${JSON.stringify(result)})`);
        return result;
    }
    async listResources(params) {
        const { ListResourcesResultSchema } = await import('@modelcontextprotocol/sdk/types.js').catch(failedToImport);
        if (!this.session) {
            throw new Error('Server not initialized. Make sure you call connect() first.');
        }
        const requestOptions = buildRequestOptions(this.clientSessionTimeoutSeconds);
        const response = await this.session.listResources(params, requestOptions);
        this.debugLog(() => `Listed resources: ${JSON.stringify(response)}`);
        return ListResourcesResultSchema.parse(response);
    }
    async listResourceTemplates(params) {
        const { ListResourceTemplatesResultSchema } = await import('@modelcontextprotocol/sdk/types.js').catch(failedToImport);
        if (!this.session) {
            throw new Error('Server not initialized. Make sure you call connect() first.');
        }
        const requestOptions = buildRequestOptions(this.clientSessionTimeoutSeconds);
        const response = await this.session.listResourceTemplates(params, requestOptions);
        this.debugLog(() => `Listed resource templates: ${JSON.stringify(response)}`);
        return ListResourceTemplatesResultSchema.parse(response);
    }
    async readResource(uri) {
        const { ReadResourceResultSchema } = await import('@modelcontextprotocol/sdk/types.js').catch(failedToImport);
        if (!this.session) {
            throw new Error('Server not initialized. Make sure you call connect() first.');
        }
        const requestOptions = buildRequestOptions(this.clientSessionTimeoutSeconds);
        const response = await this.session.readResource({ uri }, requestOptions);
        this.debugLog(() => `Read resource ${uri}: ${JSON.stringify(response)}`);
        return ReadResourceResultSchema.parse(response);
    }
    get name() {
        return this._name;
    }
    async close() {
        const transport = this.transport;
        if (transport && typeof transport.terminateSession === 'function') {
            try {
                // Best-effort cleanup: we do not actively manage session lifecycles,
                // but if the server supports sessions we terminate to avoid leaks.
                await transport.terminateSession();
            }
            catch (error) {
                this.logger.warn('Failed to terminate MCP session:', error);
            }
        }
        if (transport) {
            await transport.close();
            this.transport = null;
        }
        if (this.session) {
            await this.session.close();
            this.session = null;
        }
    }
}
export class NodeMCPServerSSE extends BaseMCPServerSSE {
    session = null;
    _cacheDirty = true;
    _toolsList = [];
    serverInitializeResult = null;
    clientSessionTimeoutSeconds;
    timeout;
    params;
    _name;
    transport = null;
    constructor(params) {
        super(params);
        this.clientSessionTimeoutSeconds = params.clientSessionTimeoutSeconds ?? 5;
        this.params = params;
        this._name = params.name || `sse: ${this.params.url}`;
        this.timeout = params.timeout ?? DEFAULT_REQUEST_TIMEOUT_MSEC;
    }
    async connect() {
        try {
            const { SSEClientTransport } = await import('@modelcontextprotocol/sdk/client/sse.js').catch(failedToImport);
            const { Client } = await import('@modelcontextprotocol/sdk/client/index.js').catch(failedToImport);
            this.transport = new SSEClientTransport(new URL(this.params.url), {
                authProvider: this.params.authProvider,
                requestInit: this.params.requestInit,
                eventSourceInit: this.params.eventSourceInit,
                fetch: this.params.fetch,
            });
            this.session = new Client({
                name: this._name,
                version: '1.0.0', // You may want to make this configurable
            });
            const requestOptions = buildRequestOptions(this.clientSessionTimeoutSeconds);
            await this.session.connect(this.transport, requestOptions);
            this.serverInitializeResult = {
                serverInfo: { name: this._name, version: '1.0.0' },
            };
        }
        catch (e) {
            this.logger.error('Error initializing MCP server:', e);
            await this.close();
            throw e;
        }
        this.debugLog(() => `Connected to MCP server: ${this._name}`);
    }
    async invalidateToolsCache() {
        await invalidateServerToolsCache(this.name);
        this._cacheDirty = true;
    }
    async listTools() {
        const { ListToolsResultSchema } = await import('@modelcontextprotocol/sdk/types.js').catch(failedToImport);
        if (!this.session) {
            throw new Error('Server not initialized. Make sure you call connect() first.');
        }
        if (this.cacheToolsList && !this._cacheDirty && this._toolsList) {
            return this._toolsList;
        }
        this._cacheDirty = false;
        const requestOptions = buildRequestOptions(this.clientSessionTimeoutSeconds);
        const response = await this.session.listTools(undefined, requestOptions);
        this.debugLog(() => `Listed tools: ${JSON.stringify(response)}`);
        this._toolsList = ListToolsResultSchema.parse(response).tools;
        return this._toolsList;
    }
    async callTool(toolName, args, meta) {
        const { CallToolResultSchema } = await import('@modelcontextprotocol/sdk/types.js').catch(failedToImport);
        if (!this.session) {
            throw new Error('Server not initialized. Make sure you call connect() first.');
        }
        const requestOptions = buildRequestOptions(this.clientSessionTimeoutSeconds, { timeout: this.timeout });
        const params = {
            name: toolName,
            arguments: args ?? {},
            ...(meta != null ? { _meta: meta } : {}),
        };
        const response = await this.session.callTool(params, undefined, requestOptions);
        const parsed = CallToolResultSchema.parse(response);
        const result = parsed.content;
        this.debugLog(() => `Called tool ${toolName} (args: ${JSON.stringify(args)}, result: ${JSON.stringify(result)})`);
        return result;
    }
    async listResources(params) {
        const { ListResourcesResultSchema } = await import('@modelcontextprotocol/sdk/types.js').catch(failedToImport);
        if (!this.session) {
            throw new Error('Server not initialized. Make sure you call connect() first.');
        }
        const requestOptions = buildRequestOptions(this.clientSessionTimeoutSeconds);
        const response = await this.session.listResources(params, requestOptions);
        this.debugLog(() => `Listed resources: ${JSON.stringify(response)}`);
        return ListResourcesResultSchema.parse(response);
    }
    async listResourceTemplates(params) {
        const { ListResourceTemplatesResultSchema } = await import('@modelcontextprotocol/sdk/types.js').catch(failedToImport);
        if (!this.session) {
            throw new Error('Server not initialized. Make sure you call connect() first.');
        }
        const requestOptions = buildRequestOptions(this.clientSessionTimeoutSeconds);
        const response = await this.session.listResourceTemplates(params, requestOptions);
        this.debugLog(() => `Listed resource templates: ${JSON.stringify(response)}`);
        return ListResourceTemplatesResultSchema.parse(response);
    }
    async readResource(uri) {
        const { ReadResourceResultSchema } = await import('@modelcontextprotocol/sdk/types.js').catch(failedToImport);
        if (!this.session) {
            throw new Error('Server not initialized. Make sure you call connect() first.');
        }
        const requestOptions = buildRequestOptions(this.clientSessionTimeoutSeconds);
        const response = await this.session.readResource({ uri }, requestOptions);
        this.debugLog(() => `Read resource ${uri}: ${JSON.stringify(response)}`);
        return ReadResourceResultSchema.parse(response);
    }
    get name() {
        return this._name;
    }
    async close() {
        const transport = this.transport;
        if (hasSessionTransport(transport)) {
            const sessionId = transport.sessionId;
            if (sessionId && typeof transport.terminateSession === 'function') {
                try {
                    // Best-effort cleanup: we do not actively manage session lifecycles,
                    // but if the server supports sessions we terminate to avoid leaks.
                    await transport.terminateSession();
                }
                catch (error) {
                    this.logger.warn('Failed to terminate MCP session:', error);
                }
            }
        }
        if (transport) {
            await transport.close();
            this.transport = null;
        }
        if (this.session) {
            await this.session.close();
            this.session = null;
        }
    }
}
export class NodeMCPServerStreamableHttp extends BaseMCPServerStreamableHttp {
    session = null;
    _cacheDirty = true;
    _toolsList = [];
    serverInitializeResult = null;
    clientSessionTimeoutSeconds;
    timeout;
    params;
    _name;
    transport = null;
    reconnectingClientPromise = null;
    reconnectingClientTarget = null;
    isClosed = false;
    connectionStateVersion = 0;
    constructor(params) {
        super(params);
        this.clientSessionTimeoutSeconds = params.clientSessionTimeoutSeconds ?? 5;
        this.params = params;
        this._name = params.name || `streamable-http: ${this.params.url}`;
        this.timeout = params.timeout ?? DEFAULT_REQUEST_TIMEOUT_MSEC;
    }
    async loadStreamableHttpRuntime() {
        const [clientModule, transportModule, typesModule] = await Promise.all([
            import('@modelcontextprotocol/sdk/client/index.js').catch(failedToImport),
            import('@modelcontextprotocol/sdk/client/streamableHttp.js').catch(failedToImport),
            import('@modelcontextprotocol/sdk/types.js').catch(failedToImport),
        ]);
        return { clientModule, transportModule, typesModule };
    }
    createStreamableHttpTransport(StreamableHTTPClientTransport, options = {}) {
        const transportOptions = {
            authProvider: this.params.authProvider,
            requestInit: this.params.requestInit,
            fetch: this.params.fetch,
            reconnectionOptions: this.params.reconnectionOptions,
            sessionId: options.sessionId,
        };
        const transport = new StreamableHTTPClientTransport(new URL(this.params.url), transportOptions);
        if (options.protocolVersion !== undefined &&
            typeof transport.setProtocolVersion === 'function') {
            transport.setProtocolVersion(options.protocolVersion);
        }
        return transport;
    }
    async createConnectedStreamableHttpClient(options = {}) {
        const { clientModule, transportModule } = await this.loadStreamableHttpRuntime();
        const { Client } = clientModule;
        const { StreamableHTTPClientTransport } = transportModule;
        const transport = this.createStreamableHttpTransport(StreamableHTTPClientTransport, options);
        const client = new Client({
            name: this._name,
            version: '1.0.0',
        });
        try {
            const requestOptions = buildRequestOptions(this.clientSessionTimeoutSeconds);
            await client.connect(transport, requestOptions);
            return { client, transport };
        }
        catch (error) {
            await this.closeStreamableHttpClient({
                client,
                transport,
            }, {
                terminateSession: options.sessionId === undefined,
                closeWarningMessage: 'Failed to close failed MCP connect client:',
                terminateWarningMessage: 'Failed to terminate failed MCP connect session:',
            });
            throw error;
        }
    }
    getClientSessionTimeoutMs() {
        return Math.max(1, (this.clientSessionTimeoutSeconds ?? 5) * 1000);
    }
    resetClientToolMetadataCache(client) {
        client.cacheToolMetadata?.([]);
    }
    async publishConnectedStreamableHttpClient(args) {
        this.transport = args.transport;
        this.session = args.client;
        this.connectionStateVersion += 1;
        this._cacheDirty = true;
        this._toolsList = [];
        const previousSessionId = getSessionId(args.previousTransport);
        const nextSessionId = getSessionId(args.transport);
        if (previousSessionId === undefined ||
            nextSessionId === undefined ||
            previousSessionId !== nextSessionId) {
            this.resetClientToolMetadataCache(args.client);
        }
        await invalidateServerToolsCache(this.name);
    }
    async clearPublishedStreamableHttpClientIfCurrent(args) {
        if (this.connectionStateVersion !== args.stateVersion ||
            this.session !== args.client ||
            this.transport !== args.transport) {
            return;
        }
        this.session = null;
        this.transport = null;
        this._cacheDirty = true;
        this._toolsList = [];
        await invalidateServerToolsCache(this.name);
    }
    async reopenSharedStreamableHttpSession(client) {
        await withTimeout(client.notification({ method: 'notifications/initialized' }), this.getClientSessionTimeoutMs(), () => new Error('Timed out reopening shared streamable HTTP MCP session.'));
    }
    async terminateDetachedStreamableHttpSession(transport, warningMessage) {
        const sessionId = getSessionId(transport);
        if (sessionId === undefined) {
            return;
        }
        try {
            const { transportModule } = await this.loadStreamableHttpRuntime();
            const detachedTransport = this.createStreamableHttpTransport(transportModule.StreamableHTTPClientTransport, {
                protocolVersion: getTransportProtocolVersion(transport),
                sessionId,
            });
            try {
                if (typeof detachedTransport.terminateSession === 'function') {
                    await detachedTransport.terminateSession();
                }
            }
            finally {
                await detachedTransport.close().catch(() => { });
            }
        }
        catch (error) {
            this.logger.warn(warningMessage, error);
        }
    }
    async closeCloseOwnedStreamableHttpState(args) {
        const { client, transport, closeStateVersion, closeWarningMessage, terminateWarningMessage, } = args;
        if (client && transport) {
            await this.closeStreamableHttpClient({
                client,
                transport,
            }, {
                terminateSession: false,
                closeWarningMessage,
                terminateWarningMessage,
            });
        }
        else if (transport) {
            await transport.close().catch((error) => {
                this.logger.warn(closeWarningMessage, error);
            });
        }
        else if (client) {
            await client.close().catch((error) => {
                this.logger.warn(closeWarningMessage, error);
            });
        }
        if (!transport ||
            this.connectionStateVersion !== closeStateVersion ||
            !this.isClosed ||
            !shouldTerminateTransportSession(transport, this.transport)) {
            return;
        }
        await this.terminateDetachedStreamableHttpSession(transport, terminateWarningMessage);
    }
    async callToolWithClient(client, toolName, args, meta) {
        const { CallToolResultSchema } = await import('@modelcontextprotocol/sdk/types.js').catch(failedToImport);
        const requestOptions = buildRequestOptions(this.clientSessionTimeoutSeconds, {
            timeout: this.timeout,
        });
        const params = {
            name: toolName,
            arguments: args ?? {},
            ...(meta != null ? { _meta: meta } : {}),
        };
        const response = await client.callTool(params, undefined, requestOptions);
        const parsed = CallToolResultSchema.parse(response);
        return parsed.content;
    }
    async closeStreamableHttpClient(args, options) {
        const { client, transport } = args;
        if (options.terminateSession && transport.sessionId) {
            await this.terminateDetachedStreamableHttpSession(transport, options.terminateWarningMessage);
        }
        if (client.transport === transport) {
            await client.close().catch((error) => {
                this.logger.warn(options.closeWarningMessage, error);
            });
            return;
        }
        await transport.close().catch((error) => {
            this.logger.warn(options.closeWarningMessage, error);
        });
        await client.close().catch((error) => {
            this.logger.warn(options.closeWarningMessage, error);
        });
    }
    async reconnectExistingStreamableHttpClient(args) {
        const { transportModule } = await this.loadStreamableHttpRuntime();
        const { StreamableHTTPClientTransport } = transportModule;
        const transport = this.createStreamableHttpTransport(StreamableHTTPClientTransport, {
            protocolVersion: args.protocolVersion,
            sessionId: args.sessionId,
        });
        try {
            const requestOptions = buildRequestOptions(this.clientSessionTimeoutSeconds);
            await args.client.connect(transport, requestOptions);
            if (args.sessionId !== undefined) {
                // Reconnecting with an existing session skips initialize(), so resend
                // initialized to reopen the shared SSE stream for async responses.
                await this.reopenSharedStreamableHttpSession(args.client);
            }
            return { client: args.client, transport };
        }
        catch (error) {
            await this.closeStreamableHttpClient({
                client: args.client,
                transport,
            }, {
                terminateSession: args.sessionId === undefined,
                closeWarningMessage: 'Failed to close failed MCP reconnect client:',
                terminateWarningMessage: 'Failed to terminate failed MCP reconnect session:',
            });
            throw error;
        }
    }
    async reconnectClosedStreamableHttpClient(args) {
        const { cause, failedClient, failedStateVersion } = args;
        if (this.isClosed) {
            throw attachCause(new Error('Cannot reconnect a closed streamable HTTP MCP server.'), cause);
        }
        if (this.connectionStateVersion !== failedStateVersion ||
            this.session !== failedClient) {
            if (this.session) {
                return this.session;
            }
            throw attachCause(new Error('Streamable HTTP MCP server changed before reconnect.'), cause);
        }
        // Multiple tool calls can discover the same closed shared session in parallel.
        // Share one reconnect so later callers do not replace and close the new client.
        if (this.reconnectingClientPromise) {
            const reconnectingClientTarget = this.reconnectingClientTarget;
            if (reconnectingClientTarget?.client === failedClient &&
                reconnectingClientTarget.stateVersion === failedStateVersion) {
                try {
                    return await this.reconnectingClientPromise;
                }
                catch (error) {
                    throw attachCause(error, cause);
                }
            }
        }
        const reconnectStateVersion = this.connectionStateVersion;
        const previousClient = this.session;
        const previousTransport = this.transport;
        const reconnectPromise = (async () => {
            const sessionId = previousTransport && hasSessionTransport(previousTransport)
                ? previousTransport.sessionId
                : undefined;
            const protocolVersion = getTransportProtocolVersion(previousTransport);
            if (!previousClient || !previousTransport) {
                throw new Error('Cannot reconnect streamable HTTP MCP server without an active client.');
            }
            try {
                await this.closeStreamableHttpClient({
                    client: previousClient,
                    transport: previousTransport,
                }, {
                    terminateSession: false,
                    closeWarningMessage: 'Failed to close stale MCP client:',
                    terminateWarningMessage: 'Failed to terminate stale MCP session:',
                });
                const recovered = await this.reconnectExistingStreamableHttpClient({
                    client: previousClient,
                    protocolVersion,
                    sessionId,
                });
                if (this.connectionStateVersion !== reconnectStateVersion ||
                    this.isClosed) {
                    await this.closeStreamableHttpClient({
                        client: recovered.client,
                        transport: recovered.transport,
                    }, {
                        terminateSession: false,
                        closeWarningMessage: 'Failed to close discarded MCP client:',
                        terminateWarningMessage: 'Failed to terminate discarded MCP session:',
                    });
                    if (this.isClosed) {
                        throw new Error('Streamable HTTP MCP server was closed during reconnect.');
                    }
                    if (this.session) {
                        return this.session;
                    }
                    throw new Error('Streamable HTTP MCP server changed during reconnect.');
                }
                await this.publishConnectedStreamableHttpClient({
                    client: recovered.client,
                    transport: recovered.transport,
                    previousTransport,
                });
                return recovered.client;
            }
            catch (error) {
                await this.clearPublishedStreamableHttpClientIfCurrent({
                    client: previousClient,
                    transport: previousTransport,
                    stateVersion: reconnectStateVersion,
                });
                throw error;
            }
        })();
        this.reconnectingClientPromise = reconnectPromise;
        this.reconnectingClientTarget = {
            client: failedClient,
            stateVersion: failedStateVersion,
        };
        try {
            return await reconnectPromise;
        }
        catch (error) {
            throw attachCause(error, cause);
        }
        finally {
            if (this.reconnectingClientPromise === reconnectPromise) {
                this.reconnectingClientPromise = null;
                this.reconnectingClientTarget = null;
            }
        }
    }
    async shouldReconnectClosedStreamableHttpClient(error, client) {
        // Explicit session ids are a released contract, so keep callers pinned to the
        // session they selected instead of silently switching them to a fresh one.
        if (this.params.sessionId !== undefined) {
            return 'none';
        }
        if (isNotConnectedError(error, client)) {
            return 'reconnect-and-retry';
        }
        const { typesModule } = await this.loadStreamableHttpRuntime();
        const { ErrorCode, McpError } = typesModule;
        return error instanceof McpError &&
            error.code === ErrorCode.ConnectionClosed
            ? 'reconnect-only'
            : 'none';
    }
    async connect() {
        const connectStateVersion = this.connectionStateVersion;
        this.isClosed = false;
        try {
            const { client, transport } = await this.createConnectedStreamableHttpClient({
                sessionId: this.params.sessionId,
            });
            if (this.isClosed ||
                this.connectionStateVersion !== connectStateVersion) {
                await this.closeStreamableHttpClient({
                    client,
                    transport,
                }, {
                    // A stale overlapping connect can point at the same shared session as
                    // the winner, so only terminate truly discarded sessions.
                    terminateSession: shouldTerminateTransportSession(transport, this.transport),
                    closeWarningMessage: 'Failed to close discarded MCP client:',
                    terminateWarningMessage: 'Failed to terminate discarded MCP session:',
                });
                if (this.isClosed) {
                    throw new Error('Streamable HTTP MCP server was closed during connect.');
                }
                throw new Error('Streamable HTTP MCP server changed during connect.');
            }
            const previousClient = this.session;
            const previousTransport = this.transport;
            await this.publishConnectedStreamableHttpClient({
                client,
                transport,
                previousTransport,
            });
            this.serverInitializeResult = {
                serverInfo: { name: this._name, version: '1.0.0' },
            };
            if (previousClient && previousTransport) {
                await this.closeStreamableHttpClient({
                    client: previousClient,
                    transport: previousTransport,
                }, {
                    terminateSession: shouldTerminateTransportSession(previousTransport, transport),
                    closeWarningMessage: 'Failed to close replaced MCP client:',
                    terminateWarningMessage: 'Failed to terminate replaced MCP session:',
                });
            }
        }
        catch (e) {
            // A losing concurrent connect can fail after another connect already
            // published a healthy shared session, so avoid closing shared state here.
            this.logger.error('Error initializing MCP server:', e);
            throw e;
        }
        this.debugLog(() => `Connected to MCP server: ${this._name}`);
    }
    async invalidateToolsCache() {
        await invalidateServerToolsCache(this.name);
        this._cacheDirty = true;
    }
    async listTools() {
        const { ListToolsResultSchema } = await import('@modelcontextprotocol/sdk/types.js').catch(failedToImport);
        if (!this.session) {
            throw new Error('Server not initialized. Make sure you call connect() first.');
        }
        if (this.cacheToolsList && !this._cacheDirty && this._toolsList) {
            return this._toolsList;
        }
        this._cacheDirty = false;
        const requestOptions = buildRequestOptions(this.clientSessionTimeoutSeconds);
        const response = await this.session.listTools(undefined, requestOptions);
        this.debugLog(() => `Listed tools: ${JSON.stringify(response)}`);
        this._toolsList = ListToolsResultSchema.parse(response).tools;
        return this._toolsList;
    }
    async callTool(toolName, args, meta) {
        const client = this.session;
        if (!client) {
            throw new Error('Server not initialized. Make sure you call connect() first.');
        }
        const callToolStateVersion = this.connectionStateVersion;
        let result;
        try {
            result = await this.callToolWithClient(client, toolName, args, meta);
        }
        catch (error) {
            const recoveryStrategy = await this.shouldReconnectClosedStreamableHttpClient(error, client);
            if (recoveryStrategy === 'none') {
                throw error;
            }
            this.debugLog(() => `Reconnecting closed streamable HTTP MCP session for ${toolName}.`);
            const recoveredClient = await this.reconnectClosedStreamableHttpClient({
                cause: error,
                failedClient: client,
                failedStateVersion: callToolStateVersion,
            });
            if (recoveryStrategy === 'reconnect-only') {
                throw error;
            }
            try {
                result = await this.callToolWithClient(recoveredClient, toolName, args, meta);
            }
            catch (retryError) {
                throw attachCause(retryError, error);
            }
        }
        this.debugLog(() => `Called tool ${toolName} (args: ${JSON.stringify(args)}, result: ${JSON.stringify(result)})`);
        return result;
    }
    async listResources(params) {
        const { ListResourcesResultSchema } = await import('@modelcontextprotocol/sdk/types.js').catch(failedToImport);
        if (!this.session) {
            throw new Error('Server not initialized. Make sure you call connect() first.');
        }
        const requestOptions = buildRequestOptions(this.clientSessionTimeoutSeconds);
        const response = await this.session.listResources(params, requestOptions);
        this.debugLog(() => `Listed resources: ${JSON.stringify(response)}`);
        return ListResourcesResultSchema.parse(response);
    }
    async listResourceTemplates(params) {
        const { ListResourceTemplatesResultSchema } = await import('@modelcontextprotocol/sdk/types.js').catch(failedToImport);
        if (!this.session) {
            throw new Error('Server not initialized. Make sure you call connect() first.');
        }
        const requestOptions = buildRequestOptions(this.clientSessionTimeoutSeconds);
        const response = await this.session.listResourceTemplates(params, requestOptions);
        this.debugLog(() => `Listed resource templates: ${JSON.stringify(response)}`);
        return ListResourceTemplatesResultSchema.parse(response);
    }
    async readResource(uri) {
        const { ReadResourceResultSchema } = await import('@modelcontextprotocol/sdk/types.js').catch(failedToImport);
        if (!this.session) {
            throw new Error('Server not initialized. Make sure you call connect() first.');
        }
        const requestOptions = buildRequestOptions(this.clientSessionTimeoutSeconds);
        const response = await this.session.readResource({ uri }, requestOptions);
        this.debugLog(() => `Read resource ${uri}: ${JSON.stringify(response)}`);
        return ReadResourceResultSchema.parse(response);
    }
    get name() {
        return this._name;
    }
    get sessionId() {
        const transport = this.transport;
        return hasSessionTransport(transport) ? transport.sessionId : undefined;
    }
    async close() {
        this.isClosed = true;
        this.connectionStateVersion += 1;
        const closeStateVersion = this.connectionStateVersion;
        const reconnectPromise = this.reconnectingClientPromise;
        const client = this.session;
        const transport = this.transport;
        this.session = null;
        this.transport = null;
        await this.closeCloseOwnedStreamableHttpState({
            client,
            transport,
            closeStateVersion,
            closeWarningMessage: client && transport
                ? 'Failed to close MCP client:'
                : transport
                    ? 'Failed to close MCP transport:'
                    : 'Failed to close MCP client:',
            terminateWarningMessage: 'Failed to terminate MCP session:',
        });
        if (reconnectPromise) {
            await reconnectPromise.catch(() => { });
            // A new connect() may have reopened the server while close() was waiting
            // for the stale reconnect to settle, so only clean up close-owned state.
            if (this.connectionStateVersion !== closeStateVersion || !this.isClosed) {
                return;
            }
            const recoveredClient = this.session;
            const recoveredTransport = this.transport;
            this.session = null;
            this.transport = null;
            await this.closeCloseOwnedStreamableHttpState({
                client: recoveredClient,
                transport: recoveredTransport,
                closeStateVersion,
                closeWarningMessage: 'Failed to close reconnected MCP client:',
                terminateWarningMessage: 'Failed to terminate reconnected MCP session:',
            });
        }
    }
}
//# sourceMappingURL=node.js.map