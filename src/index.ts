import axios from "axios";
import * as cheerio from "cheerio";
import OpenAI from "openai";
import { ChromaClient } from "chromadb";
import { config } from "dotenv";
config();


const openai = new OpenAI();
const chromaClient = new ChromaClient({ path: "http://localhost:8000" })
const WEB_COLLECTION = "WEB_SCRAPTED_DATA_COLLECTION";


async function scrapeWebPage(url: string) {
    try {
        if (!url.startsWith('http')) {
            throw new Error('Invalid URL: must start with http/https');
        }

        const { data } = await axios.get(url, {
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; WebPageChatbot/1.0)'
            }
        });

        const $ = cheerio.load(data);

     
        const head = {
            title: $('title').text(),
            meta: $('meta').map((_, el) => ({
                name: $(el).attr('name'),
                content: $(el).attr('content')
            })).get(),
            description: $('meta[name="description"]').attr('content') || '',
            keywords: $('meta[name="keywords"]').attr('content') || ''
        };

        // Clean and extract body text
        const body = $('body')
            .find('script, style, noscript')
            .remove()
            .end()
            .text()
            .replace(/\s+/g, ' ')
            .trim();

        console.log("scraped body", body);
        const internalLinks: Set<string> = new Set();
        const externalLinks: Set<string> = new Set();

        // Better URL handling
        const baseUrl = new URL(url);

        $('a').each((_, el) => {
            const href = $(el).attr('href');
            if (!href) return;

            try {
                const absoluteUrl = new URL(href, baseUrl.origin);

                // Normalize URL
                const normalizedUrl = absoluteUrl.toString()
                    .replace(/#.*$/, '') // Remove fragments
                    .replace(/\/$/, ''); // Remove trailing slash

                if (absoluteUrl.origin === baseUrl.origin) {

                    internalLinks.add(normalizedUrl);

                } else {
                    externalLinks.add(normalizedUrl);
                }
            } catch (e) {
             
                console.warn(`Invalid URL found: ${href}`);
            }
        });

        return {
            head,
            body,
            internalLinks: Array.from(internalLinks),
            externalLinks: Array.from(externalLinks)
        };
    } catch (error) {
        console.error(`Error scraping ${url}:`, error);
        throw error;
    }
}

async function ingest(url: string) {
    console.log("Ingesting", url);

    try {
        const { head, body, internalLinks, externalLinks } = await scrapeWebPage(url);
        console.log("Found internal links:", internalLinks.length);

        const headString = JSON.stringify(head);
        const headChunks = await chunkText(headString, 1000);
        const bodyChunks = await chunkText(body, 1000);
        console.log("head", head);
        console.log("body", body);

      
        for (const chunk of headChunks) {
            const headEmbedding = await generateVectorEmbeddings(chunk);
            await insertIntoDB({ embedding: headEmbedding, url, head: chunk });
        }

      
        for (const chunk of bodyChunks) {
            const bodyEmbedding = await generateVectorEmbeddings(chunk);
            await insertIntoDB({ embedding: bodyEmbedding, url, head: headString, body: chunk });
        }
        
        console.log("Body chunks", bodyChunks);
    } catch (error) {
        console.error(`Failed to ingest ${url}:`, error);
    }
}

async function chunkText(text: string, maxChunkSize: number): Promise<string[]> {
    const chunks: string[] = [];
    let currentChunk = '';
    let currentSize = 0;

    // Split text into paragraphs first
    const paragraphs = text.split(/\n\s*\n/);

    for (const paragraph of paragraphs) {
        // If adding this paragraph would exceed max size, start a new chunk
        if (currentSize + paragraph.length > maxChunkSize && currentChunk !== '') {
            chunks.push(currentChunk.trim());
            currentChunk = '';
            currentSize = 0;
        }

        // Split paragraph into sentences
        const sentences = paragraph.split(/(?<=[.!?])\s+/);

        for (const sentence of sentences) {
            // If adding this sentence would exceed max size, start a new chunk
            if (currentSize + sentence.length > maxChunkSize && currentChunk !== '') {
                chunks.push(currentChunk.trim());
                currentChunk = '';
                currentSize = 0;
            }

            // Add sentence to current chunk
            currentChunk += (currentChunk ? ' ' : '') + sentence;
            currentSize += sentence.length;
        }

        // Add paragraph separator
        if (currentChunk) {
            currentChunk += '\n\n';
            currentSize += 2;
        }
    }

    // Add the last chunk if it's not empty
    if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
    }

    return chunks;
}

async function generateVectorEmbeddings(text: string): Promise<number[]> {
    const response = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: text,
    });
    return response.data[0].embedding;
}


async function insertIntoDB({ embedding, url, head = "", body = "" }: { embedding: number[], url: string, head?: string, body?: string }) {
    if (body !== "") {
        console.log("inserting body to chroma", body);
    }
    const collection = await chromaClient.getOrCreateCollection({
        name: WEB_COLLECTION
    });
    const uniqueId = `${url}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    collection.add({
        ids: [uniqueId],
        embeddings: [embedding],
        metadatas: [{ url, body, head }]
    })
}



async function chat(query: string) {
    const questionEmbedding = await generateVectorEmbeddings(query);
    const collection = await chromaClient.getOrCreateCollection({
        name: WEB_COLLECTION
    });
    const collectionResult = await collection.query({
        queryEmbeddings: questionEmbedding,
        nResults: 20
    });
    const head = collectionResult.metadatas[0].map((metadata) => metadata?.head).join("\n");
    const body = collectionResult.metadatas[0].map((document) => document?.body).filter((body) => body !== "").join("\n");
    const url = collectionResult.metadatas[0].map((metadata) => metadata?.url).join("\n");
    console.log("collectionResult", collectionResult);
    console.log("head", head);
    console.log("body", body);
    console.log("url", url);
    const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: "You are a helpful assistant that can answer questions about the web page." }, {
            role: "user", content: `
            Query: ${query},
            Web Page URL: ${url}
            Web Page Head: ${head}
            Web Page Body: ${body}
            ` }],
    });
    return response.choices[0].message.content;
}

async function viewChromaDBData() {
    try {
        const collection = await chromaClient.getOrCreateCollection({
            name: WEB_COLLECTION
        });

      
        const result = await collection.get();

        console.log("\n=== ChromaDB Collection Data ===");
        console.log("Total documents:", result.ids.length);
        console.log("\nDocuments:");

        for (let i = 0; i < result.ids.length; i++) {
            console.log("\n---Document", i + 1, "---");
            console.log("ID:", result.ids[i]);
            console.log("Metadata:", result.metadatas[i]);
        }
    } catch (error) {
        console.error("Error viewing ChromaDB data:", error);
    }
}

async function main() {
    try {
        // await ingest("https://abdulsami-sami-07.vercel.app/");
       
        const response = await chat("What Projects does Abdul Sami have?");
        console.log(response);

      
        await viewChromaDBData();
    } catch (error) {
        console.error("Main function error:", error);
    }
}

main();
