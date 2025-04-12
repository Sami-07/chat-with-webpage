# Chat with Web Pages

A powerful tool that can scrape, store, and answer questions about web page content using OpenAI's embeddings and ChromaDB for vector storage.

## Features

- Web page scraping with content extraction
- Vector embeddings using OpenAI's text-embedding-3-small model
- Vector storage using ChromaDB
- Natural language querying of scraped content
- Content chunking for efficient processing


## Usage

### Ingesting Web Pages

To scrape and store a web page's content:

```typescript
await ingest("https://example.com");
```

### Querying Content

To ask questions about the scraped content:

```typescript
const response = await chat("What is the main topic of the page?");
console.log(response);
```

### Viewing Stored Data

To view the data stored in ChromaDB:

```typescript
await viewChromaDBData();
```

## Project Structure

- `src/index.ts`: Main application file containing all core functionality
  - Web scraping
  - Text chunking
  - Vector embeddings generation
  - ChromaDB operations
  - Chat interface

## Dependencies

- axios: For making HTTP requests
- cheerio: For web scraping and HTML parsing
- openai: For OpenAI API integration
- chromadb: For vector database operations
- dotenv: For environment variable management
