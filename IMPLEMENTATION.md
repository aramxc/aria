# Eliza RAG System Implementation Plan

This document outlines a step-by-step plan to implement a Retrieval Augmented Generation (RAG) system for an Eliza agent running in Discord. The plan includes setting up a vector database, scraping GitHub documentation, and implementing retrieval actions.

## Project Overview

- **Goal**: Enhance Eliza with the ability to answer questions using knowledge from specified GitHub documentation repositories
- **Base**: Existing Eliza agent running in Discord
- **Components to Implement**:
  1. Vector database setup (Supabase with pgvector)
  2. Document scraping from GitHub repositories
  3. Document processing and embedding generation
  4. RAG action implementation for Eliza
  5. Response formatting with source links

## 1. Setting Up Supabase Vector Database

### 1.1. Supabase Project Setup

1. **Create a Supabase project**:
   - Go to [supabase.com](https://supabase.com/) and sign up/login
   - Create a new project and note your project URL and service_role key

2. **Install the pgvector extension**:
   ```sql
   -- Run this in the Supabase SQL Editor
   CREATE EXTENSION IF NOT EXISTS vector;
   ```

3. **Create the documents table**:
   ```sql
   CREATE TABLE documents (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     content TEXT NOT NULL,
     metadata JSONB NOT NULL,
     embedding VECTOR(1536) NOT NULL,
     created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
   );
   ```

4. **Create a search function**:
   ```sql
   CREATE OR REPLACE FUNCTION match_documents (
     query_embedding VECTOR(1536),
     match_threshold FLOAT,
     match_count INT
   )
   RETURNS TABLE (
     id UUID,
     content TEXT,
     metadata JSONB,
     similarity FLOAT
   )
   LANGUAGE plpgsql
   AS $$
   BEGIN
     RETURN QUERY
     SELECT
       documents.id,
       documents.content,
       documents.metadata,
       1 - (documents.embedding <=> query_embedding) AS similarity
     FROM documents
     WHERE 1 - (documents.embedding <=> query_embedding) > match_threshold
     ORDER BY similarity DESC
     LIMIT match_count;
   END;
   $$;
   ```

### 1.2. Set Up Supabase Client in Eliza

1. **Install dependencies**:
   ```bash
   npm install @supabase/supabase-js openai
   ```

2. **Create a database client file** (`src/utils/supabaseClient.ts`):
   ```typescript
   import { createClient } from '@supabase/supabase-js';
   
   const supabaseUrl = process.env.SUPABASE_URL || '';
   const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
   
   if (!supabaseUrl || !supabaseKey) {
     console.error('Missing Supabase URL or key. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables.');
   }
   
   export const supabaseClient = createClient(supabaseUrl, supabaseKey);
   ```

3. **Add environment variables** to your `.env.local` file:
   ```
   SUPABASE_URL=https://your-project-id.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=your-service-key
   OPENAI_API_KEY=your-openai-key
   ```

## 2. Document Scraping Script

### 2.1. Create GitHub Scraper Script

Create a file `scripts/scrapeGitHubDocs.ts` with the following content:

```typescript
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { Octokit } from '@octokit/rest';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const octokit = new Octokit({ auth: GITHUB_TOKEN });

// Repositories to scrape
const REPOS_TO_SCRAPE = [
  { owner: 'recallnet', repo: 'docs', path: 'docs' },
  // Add more repositories here
];

// Output directory for downloaded content
const OUTPUT_DIR = path.join(process.cwd(), 'data', 'scraped');

// Create output directory if it doesn't exist
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Function to get all markdown files from a repository directory
async function getMarkdownFiles(owner: string, repo: string, path: string) {
  const { data } = await octokit.repos.getContent({
    owner,
    repo,
    path,
  });

  let files: { path: string; name: string; download_url: string | null; type: string }[] = [];

  // Handle array response (directory)
  if (Array.isArray(data)) {
    for (const item of data) {
      if (item.type === 'file' && item.name.endsWith('.md')) {
        files.push({
          path: item.path,
          name: item.name,
          download_url: item.download_url,
          type: 'file',
        });
      } else if (item.type === 'dir') {
        // Recursively get files from subdirectories
        const subFiles = await getMarkdownFiles(owner, repo, item.path);
        files = [...files, ...subFiles];
      }
    }
  }

  return files;
}

// Function to download a file
async function downloadFile(url: string, filePath: string) {
  console.log(`Downloading ${url} to ${filePath}`);
  
  try {
    const response = await axios.get(url);
    fs.writeFileSync(filePath, response.data);
    console.log(`Successfully downloaded ${url}`);
    return response.data;
  } catch (error) {
    console.error(`Error downloading ${url}:`, error);
    return null;
  }
}

// Function to process a repository
async function processRepository(owner: string, repo: string, path: string) {
  console.log(`Processing repository: ${owner}/${repo}/${path}`);
  
  const files = await getMarkdownFiles(owner, repo, path);
  console.log(`Found ${files.length} markdown files`);
  
  const repoOutputDir = `${OUTPUT_DIR}/${owner}/${repo}`;
  if (!fs.existsSync(repoOutputDir)) {
    fs.mkdirSync(repoOutputDir, { recursive: true });
  }
  
  const results = [];
  
  for (const file of files) {
    if (file.download_url) {
      const outputFilePath = `${repoOutputDir}/${file.path.replace(/\//g, '_')}`;
      const content = await downloadFile(file.download_url, outputFilePath);
      
      if (content) {
        results.push({
          filename: file.name,
          path: file.path,
          repository: `${owner}/${repo}`,
          url: `https://github.com/${owner}/${repo}/blob/main/${file.path}`,
          content,
        });
      }
    }
  }
  
  return results;
}

// Main function
async function main() {
  let allDocuments = [];
  
  for (const repo of REPOS_TO_SCRAPE) {
    const documents = await processRepository(repo.owner, repo.repo, repo.path);
    allDocuments.push(...documents);
  }
  
  // Save all scraped documents to a single JSON file
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'all_documents.json'),
    JSON.stringify(allDocuments, null, 2)
  );
  
  console.log(`Scraped ${allDocuments.length} documents successfully`);
}

main().catch(console.error);
```

### 2.2. Install Dependencies for Scraper

```bash
npm install axios @octokit/rest dotenv
```

### 2.3. Add GitHub Token to Environment

Add the following to your `.env.local` file:
```
GITHUB_TOKEN=your-github-personal-access-token
```

## 3. Document Processing and Embedding Generation

### 3.1. Create Embedding and Storage Script

Create a file `scripts/embedDocuments.ts` with the following content:

```typescript
import fs from 'fs';
import path from 'path';
import { OpenAIEmbeddings } from 'langchain/embeddings/openai';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { supabaseClient } from '../src/utils/supabaseClient';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const INPUT_FILE = path.join(process.cwd(), 'data', 'scraped', 'all_documents.json');
const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 200;

// Function to split document into chunks
async function splitDocumentIntoChunks(document: any) {
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: CHUNK_SIZE,
    chunkOverlap: CHUNK_OVERLAP,
  });
  
  const textChunks = await splitter.splitText(document.content);
  
  return textChunks.map((chunk, index) => ({
    content: chunk,
    metadata: {
      filename: document.filename,
      path: document.path,
      repository: document.repository,
      url: document.url,
      chunk_index: index,
    },
  }));
}

// Initialize OpenAI embeddings
const embeddings = new OpenAIEmbeddings({
  openAIApiKey: process.env.OPENAI_API_KEY,
  model: 'text-embedding-3-large',
});

// Process documents and store embeddings
async function processDocuments() {
  if (!fs.existsSync(INPUT_FILE)) {
    console.error(`Input file not found: ${INPUT_FILE}`);
    return;
  }
  
  const documents = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf-8'));
  console.log(`Processing ${documents.length} documents...`);
  
  let totalChunks = 0;
  
  for (const document of documents) {
    console.log(`Processing document: ${document.path}`);
    
    // Split document into chunks
    const chunks = await splitDocumentIntoChunks(document);
    totalChunks += chunks.length;
    
    // Process chunks in batches to avoid rate limits
    const BATCH_SIZE = 10;
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);
      
      // Generate embeddings for batch
      const texts = batch.map(chunk => chunk.content);
      const embeddingVectors = await embeddings.embedDocuments(texts);
      
      // Store in Supabase
      for (let j = 0; j < batch.length; j++) {
        const { content, metadata } = batch[j];
        const embedding = embeddingVectors[j];
        
        const { error } = await supabaseClient
          .from('documents')
          .insert({
            content,
            metadata,
            embedding,
          });
        
        if (error) {
          console.error(`Error storing embedding for chunk ${j}:`, error);
        }
      }
      
      console.log(`Processed ${i + batch.length}/${chunks.length} chunks for document ${document.path}`);
    }
  }
  
  console.log(`Successfully processed ${totalChunks} chunks from ${documents.length} documents`);
}

processDocuments().catch(console.error);
```

### 3.2. Install Additional Dependencies

```bash
npm install langchain @langchain/openai
```

## 4. RAG Action Implementation for Eliza

### 4.1. Create Vector Search Utility

Create a file `src/utils/vectorSearch.ts`:

```typescript
import { OpenAIEmbeddings } from 'langchain/embeddings/openai';
import { supabaseClient } from './supabaseClient';

const embeddings = new OpenAIEmbeddings({
  openAIApiKey: process.env.OPENAI_API_KEY,
  model: 'text-embedding-3-large',
});

export interface SearchResult {
  content: string;
  metadata: {
    filename: string;
    path: string;
    repository: string;
    url: string;
    chunk_index: number;
  };
  similarity: number;
}

export async function queryVectorStore(
  query: string,
  options = { threshold: 0.7, limit: 5 }
): Promise<SearchResult[]> {
  try {
    console.log(`Searching for: "${query}"`);
    
    // Generate embedding for the query
    const queryEmbedding = await embeddings.embedQuery(query);
    
    // Query Supabase for similar documents
    const { data, error } = await supabaseClient.rpc('match_documents', {
      query_embedding: queryEmbedding,
      match_threshold: options.threshold,
      match_count: options.limit,
    });
    
    if (error) {
      console.error('Error querying vector store:', error);
      throw error;
    }
    
    return data as SearchResult[];
  } catch (error) {
    console.error('Error in queryVectorStore:', error);
    throw error;
  }
}
```

### 4.2. Create Template for Query Extraction

Create a file `src/actions/searchDocs/getQueryTemplate.ts`:

```typescript
export const getQueryTemplate = `Extract search parameters from the most recent message.
Return a JSON object with:
- query: The main search query (required)
- limit: Number of results to return (default: 3)

Example:
\`\`\`json
{
    "query": "How to use RecallNet's API",
    "limit": 3
}
\`\`\`

{{recentMessages}}

Extract search parameters and respond with a JSON object.`;
```

### 4.3. Create the Search Action

Create a file `src/actions/searchDocs/searchDocs.ts`:

```typescript
import {
  type ActionExample,
  type IAgentRuntime,
  type Memory,
  type Action,
  composeContext,
  State,
  ModelClass,
  generateMessageResponse,
  HandlerCallback,
} from "@elizaos/core";
import { getQueryTemplate } from "./getQueryTemplate";
import { queryVectorStore, type SearchResult } from "../../utils/vectorSearch";

export const searchDocs: Action = {
  name: "SEARCH_DOCS",
  similes: ["DOCUMENT_SEARCH", "LOOKUP", "FIND_DOCS"],
  suppressInitialMessage: true,
  validate: async (_runtime: IAgentRuntime, _message: Memory) => true,
  description: "Search documentation to answer user questions",
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State,
    _options: { [key: string]: unknown },
    callback: HandlerCallback
  ): Promise<boolean> => {
    try {
      // Extract search query from user message
      let currentState = state || (await runtime.composeState(message));
      currentState = await runtime.updateRecentMessageState(currentState);

      const queryContext = composeContext({
        state: currentState,
        template: getQueryTemplate,
      });

      const params = await generateMessageResponse({
        runtime: runtime,
        context: queryContext,
        modelClass: ModelClass.SMALL,
      });

      if (!params.query) {
        callback({
          text: "I couldn't understand what you're looking for. Could you please rephrase your question?",
          action: "SEARCH_DOCS",
        });
        return true;
      }

      // Query vector store for relevant documents
      const results = await queryVectorStore(
        params.query as string,
        { threshold: 0.7, limit: (params.limit as number) || 3 }
      );

      if (results.length === 0) {
        callback({
          text: "I couldn't find any relevant information about that. Could you try a different question?",
          action: "SEARCH_DOCS",
        });
        return true;
      }

      // Format search results for context
      const documentsContext = results
        .map((result, index) => {
          return `Document ${index + 1} (${result.metadata.filename}):\n${result.content}\nSource: ${result.metadata.url}`;
        })
        .join("\n\n");

      // Generate a response using the retrieved documents
      const responseContext = composeContext({
        state: currentState,
        template: `Based on the user's question and the following information, provide a helpful response:
  
User question: {{recentMessage}}

Information found:
${documentsContext}

Respond naturally and include the relevant source links at the end of your response. 
Format the sources as numbered references: "[1] Source: URL".`,
      });

      const finalResponse = await generateMessageResponse({
        runtime: runtime,
        context: responseContext,
        modelClass: ModelClass.MEDIUM,
      });

      callback({
        text: finalResponse.text,
        action: "SEARCH_DOCS",
      });

      return true;
    } catch (error) {
      console.error("Error in SEARCH_DOCS action:", error);
      callback({
        text: "I encountered an error while searching for information. Please try again later.",
        action: "SEARCH_DOCS",
      });
      return false;
    }
  },
  examples: [
    [
      {
        user: "{{user1}}",
        content: { text: "How does RecallNet's API work?" },
      },
      {
        user: "{{user2}}",
        content: {
          text: "RecallNet's API allows you to interact with the platform programmatically. The API uses REST principles and returns JSON responses. You need to authenticate using API keys which you can generate in your account settings.\n\nSources:\n[1] Source: https://github.com/recallnet/docs/blob/main/docs/api/overview.md",
          action: "SEARCH_DOCS",
        },
      },
    ],
    [
      {
        user: "{{user1}}",
        content: { text: "Can you find documentation about authentication?" },
      },
      {
        user: "{{user2}}",
        content: {
          text: "Authentication in RecallNet is handled using API keys. You can create and manage your API keys in the dashboard under Account Settings. When making requests, include your API key in the Authorization header as `Bearer YOUR_API_KEY`.\n\nSources:\n[1] Source: https://github.com/recallnet/docs/blob/main/docs/authentication/api-keys.md",
          action: "SEARCH_DOCS",
        },
      },
    ],
  ] as ActionExample[][],
} as Action;
```

### 4.4. Register the Action in the Agent Runtime

Modify your `src/index.ts` to include the new action:

```typescript
// Add this import at the top of the file
import { searchDocs } from "./actions/searchDocs/searchDocs";

// Then in the AgentRuntime creation function, add searchDocs to the actions array
return new AgentRuntime({
  // ... other settings
  actions: [noneAction, /* other existing actions */, searchDocs],
  // ...
});
```

## 5. Running the System

### 5.1. Run the Scraper Script

```bash
# Create a build script in package.json
npm run build

# Run the scraper
node dist/scripts/scrapeGitHubDocs.js
```

### 5.2. Run the Embedding Script

```bash
node dist/scripts/embedDocuments.js
```

### 5.3. Restart Your Eliza Agent

```bash
# Start the agent with your updated code
npm run start
```

## Testing Your Implementation

1. Your Eliza agent should now be able to respond to queries like:
   - "What is RecallNet's API authentication process?"
   - "How do I install RecallNet?"
   - "Tell me about RecallNet's documentation structure"

2. The responses should include relevant information and source links.

## Troubleshooting

1. **Vector Search Issues**:
   - Check the embeddings in Supabase to ensure they were properly saved
   - Verify your OpenAI API key is working
   - Adjust the similarity threshold if you're getting too few/many results

2. **RAG Response Quality Issues**:
   - Try adjusting the chunk size and overlap
   - Consider using different templates for response generation
   - Add more examples to the action to improve its behavior

3. **Discord Integration Issues**:
   - Ensure your action properly formats responses for Discord
   - Check Discord's message length limits (2000 chars) and split long responses if needed

## Future Enhancements

1. **Add more data sources** by updating the `REPOS_TO_SCRAPE` array
2. **Implement user feedback** by adding a rating system for responses
3. **Add periodic reindexing** to keep your knowledge base current
4. **Implement keyword filtering** to target specific topics in the documentation
5. **Add caching** to improve performance for common queries