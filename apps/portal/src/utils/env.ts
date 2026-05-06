import { z } from "zod";
import { loadEnvConfig } from "@next/env";

const projectDir = process.cwd();
loadEnvConfig(projectDir);

const envSchema = z.object({
	DHIS2_BASE_URL: z.string().min(1, "DHIS2_BASE_URL is required"),
	DHIS2_BASE_PAT_TOKEN: z.string().min(1, "DHIS2_BASE_PAT_TOKEN is required"),
	CONTEXT_PATH: z.string().optional(),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
	const formatted = parsedEnv.error.issues
		.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
		.join("; ");
	throw new Error(
		`Invalid portal environment configuration. Loaded from ${projectDir}. ${formatted}`,
	);
}

export const env = parsedEnv.data;
