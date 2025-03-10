```typescript
interface Action {
  name: string; // what action gets called
  similies: string[]; // used if similar trigger words are needed, prevent hallucinations
  description: string; // what an action is and how/when to use it. 
  examples: ActionExample[]; // added at top of context to prepare model to see examples of how an action is used or NOT used.
  handler: Handler; // action code, what gets executed
  validate: Validator; // checks if the action should be added to the context, is this action available in the current context? can use if different actions are true, different states, etc.
}
```
