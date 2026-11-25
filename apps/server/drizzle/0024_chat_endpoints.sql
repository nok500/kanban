CREATE TABLE "chat_endpoints" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"api_url" text NOT NULL,
	"ui_url" text,
	"api_key" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "chat_endpoints_name_unique" UNIQUE("name")
);
