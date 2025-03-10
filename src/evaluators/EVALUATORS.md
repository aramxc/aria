# Evaluators

# https://elizaos.github.io/eliza/docs/core/evaluators/

Evaluators are core components that assess and extract information from conversations. Agents use evaluators to automatically process conversations after they happen to help build up their knowledge and understanding over time.

```typescript
const evaluator = {
    // Should this evaluator run right now?
    validate: async (runtime, message) => {
        // Return true to run, false to skip
        return shouldRunThisTime;
    },

    // What to do when it runs
    handler: async (runtime, message) => {
        // Extract info, update memory, etc
        const newInfo = extractFromMessage(message);
        await storeInMemory(newInfo);
    }
};
```