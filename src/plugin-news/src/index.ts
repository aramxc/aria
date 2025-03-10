import type { Plugin } from "@elizaos/core";

import { factEvaluator } from "./evaluators/fact";

import { boredomProvider } from "./providers/boredom";
import { currentNewsAction } from "./actions/currentNews";
import { randomEmotionProvider } from "./providers/emotionProvider";

export * as actions from "./actions/index";

export const newsPlugin: Plugin = {
    name: "news",
    description: "Gets the current news",
    actions: [
        currentNewsAction,
    ],
    evaluators: [factEvaluator],
    providers: [boredomProvider, randomEmotionProvider],
};
export default newsPlugin;
