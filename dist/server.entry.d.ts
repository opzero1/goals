/**
 * Server plugin entry. OpenCode resolves this module for the `server` plugin
 * kind via the package.json `exports["./server"]` subpath and expects a
 * default export shaped `{ id?, server }` (PluginModule).
 */
declare const module: {
    id: string;
    server: import("@opencode-ai/plugin").Plugin;
};
export default module;
