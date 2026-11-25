CREATE TABLE "agent_card_cvs" (
	"card_id" text PRIMARY KEY NOT NULL,
	"board_id" text NOT NULL,
	"cv_card_id" text NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_columns" (
	"column_id" text PRIMARY KEY NOT NULL,
	"board_id" text NOT NULL,
	"enabled" boolean NOT NULL,
	"updated_at" bigint NOT NULL
);
