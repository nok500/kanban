CREATE TABLE "agent_settings" (
	"agent" text PRIMARY KEY NOT NULL,
	"mode" text NOT NULL,
	"api_key" text,
	"updated_at" bigint NOT NULL
);
