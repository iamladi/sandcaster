import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const docs = defineCollection({
	loader: glob({ pattern: "**/*.mdx", base: "./src/content/docs" }),
	schema: z.object({
		title: z.string(),
		description: z.string(),
		order: z.number(),
		section: z.string(),
	}),
});

const blog = defineCollection({
	loader: glob({ pattern: "**/*.mdx", base: "./src/content/blog" }),
	schema: z.object({
		title: z.string(),
		description: z.string(),
		date: z.date(),
		author: z.string().optional(),
		tags: z.array(z.string()).optional(),
		draft: z.boolean().optional(),
	}),
});

const changelog = defineCollection({
	loader: glob({ pattern: "**/*.md", base: "./src/content/changelog" }),
	schema: z.object({
		version: z.string(),
		date: z.date(),
		title: z.string().optional(),
	}),
});

export const collections = { docs, blog, changelog };
