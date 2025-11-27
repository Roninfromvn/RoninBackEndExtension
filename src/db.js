// =============================================================================
// DATABASE SCHEMA DOCUMENTATION
// =============================================================================
// This file contains the complete database schema information
// Generated on: 2025-09-15T16:40:59.753Z
// 
// USAGE:
// - Tables: db.schema.tables.tableName
// - Views: db.schema.views.viewName  
// - Functions: db.schema.functions.functionName
// - Relationships: db.schema.relationships
// =============================================================================

const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: process.env.PGPORT || 5432,
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE || 'posting_analytics_db',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// =============================================================================
// DATABASE SCHEMA INFORMATION
// =============================================================================
const schema = {
  "tables": {
    "agents": {
      "type": "table",
      "columns": {
        "agent_id": {
          "type": "character varying",
          "nullable": false,
          "default": null,
          "maxLength": 100,
          "precision": null,
          "scale": null,
          "position": 1
        },
        "agent_label": {
          "type": "character varying",
          "nullable": true,
          "default": null,
          "maxLength": 200,
          "precision": null,
          "scale": null,
          "position": 2
        },
        "ext_version": {
          "type": "character varying",
          "nullable": true,
          "default": null,
          "maxLength": 50,
          "precision": null,
          "scale": null,
          "position": 3
        },
        "pages": {
          "type": "jsonb",
          "nullable": true,
          "default": "'[]'::jsonb",
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 4
        },
        "last_seen": {
          "type": "timestamp without time zone",
          "nullable": true,
          "default": "CURRENT_TIMESTAMP",
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 5
        },
        "created_at": {
          "type": "timestamp without time zone",
          "nullable": true,
          "default": "CURRENT_TIMESTAMP",
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 6
        },
        "updated_at": {
          "type": "timestamp without time zone",
          "nullable": true,
          "default": "CURRENT_TIMESTAMP",
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 7
        }
      },
      "primaryKeys": [
        "agent_id"
      ],
      "foreignKeys": {},
      "indexes": {
        "agents_pkey": {
          "definition": "CREATE UNIQUE INDEX agents_pkey ON public.agents USING btree (agent_id)",
          "unique": true,
          "primary": true
        },
        "idx_agents_ext_version": {
          "definition": "CREATE INDEX idx_agents_ext_version ON public.agents USING btree (ext_version)",
          "unique": false,
          "primary": false
        },
        "idx_agents_last_seen": {
          "definition": "CREATE INDEX idx_agents_last_seen ON public.agents USING btree (last_seen)",
          "unique": false,
          "primary": false
        },
        "idx_agents_pages": {
          "definition": "CREATE INDEX idx_agents_pages ON public.agents USING gin (pages)",
          "unique": false,
          "primary": false
        }
      },
      "constraints": {
        "2200_41491_1_not_null": {
          "type": "CHECK"
        },
        "agents_pkey": {
          "type": "PRIMARY KEY"
        }
      },
      "rowCount": 0
    },
    "assignments": {
      "type": "table",
      "columns": {
        "agent_id": {
          "type": "character varying",
          "nullable": false,
          "default": null,
          "maxLength": 100,
          "precision": null,
          "scale": null,
          "position": 1
        },
        "allowed_pages": {
          "type": "jsonb",
          "nullable": true,
          "default": "'[]'::jsonb",
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 2
        },
        "created_at": {
          "type": "timestamp without time zone",
          "nullable": true,
          "default": "CURRENT_TIMESTAMP",
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 3
        },
        "updated_at": {
          "type": "timestamp without time zone",
          "nullable": true,
          "default": "CURRENT_TIMESTAMP",
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 4
        }
      },
      "primaryKeys": [
        "agent_id"
      ],
      "foreignKeys": {
        "agent_id": {
          "referencesTable": "agents",
          "referencesColumn": "agent_id",
          "constraintName": "fk_assignments_agent",
          "onDelete": "CASCADE",
          "onUpdate": "NO ACTION"
        }
      },
      "indexes": {
        "assignments_pkey": {
          "definition": "CREATE UNIQUE INDEX assignments_pkey ON public.assignments USING btree (agent_id)",
          "unique": true,
          "primary": true
        },
        "idx_assignments_allowed_pages": {
          "definition": "CREATE INDEX idx_assignments_allowed_pages ON public.assignments USING gin (allowed_pages)",
          "unique": false,
          "primary": false
        }
      },
      "constraints": {
        "2200_41505_1_not_null": {
          "type": "CHECK"
        },
        "fk_assignments_agent": {
          "type": "FOREIGN KEY"
        },
        "assignments_pkey": {
          "type": "PRIMARY KEY"
        }
      },
      "rowCount": 0
    },
    "folder_captions": {
      "type": "table",
      "columns": {
        "folder_id": {
          "type": "character varying",
          "nullable": false,
          "default": null,
          "maxLength": 255,
          "precision": null,
          "scale": null,
          "position": 1
        },
        "folder_name": {
          "type": "character varying",
          "nullable": true,
          "default": null,
          "maxLength": 500,
          "precision": null,
          "scale": null,
          "position": 2
        },
        "captions": {
          "type": "jsonb",
          "nullable": true,
          "default": "'[]'::jsonb",
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 3
        },
        "created_at": {
          "type": "timestamp without time zone",
          "nullable": true,
          "default": "CURRENT_TIMESTAMP",
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 4
        },
        "updated_at": {
          "type": "timestamp without time zone",
          "nullable": true,
          "default": "CURRENT_TIMESTAMP",
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 5
        }
      },
      "primaryKeys": [
        "folder_id"
      ],
      "foreignKeys": {
        "folder_id": {
          "referencesTable": "folders",
          "referencesColumn": "id",
          "constraintName": "fk_folder_captions_folder",
          "onDelete": "CASCADE",
          "onUpdate": "NO ACTION"
        }
      },
      "indexes": {
        "folder_captions_pkey": {
          "definition": "CREATE UNIQUE INDEX folder_captions_pkey ON public.folder_captions USING btree (folder_id)",
          "unique": true,
          "primary": true
        },
        "idx_folder_captions_captions": {
          "definition": "CREATE INDEX idx_folder_captions_captions ON public.folder_captions USING gin (captions)",
          "unique": false,
          "primary": false
        },
        "idx_folder_captions_folder_id": {
          "definition": "CREATE INDEX idx_folder_captions_folder_id ON public.folder_captions USING btree (folder_id)",
          "unique": false,
          "primary": false
        },
        "idx_folder_captions_updated_at": {
          "definition": "CREATE INDEX idx_folder_captions_updated_at ON public.folder_captions USING btree (updated_at)",
          "unique": false,
          "primary": false
        }
      },
      "constraints": {
        "2200_41735_1_not_null": {
          "type": "CHECK"
        },
        "fk_folder_captions_folder": {
          "type": "FOREIGN KEY"
        },
        "folder_captions_pkey": {
          "type": "PRIMARY KEY"
        }
      },
      "rowCount": 0
    },
    "folders": {
      "type": "table",
      "columns": {
        "id": {
          "type": "character varying",
          "nullable": false,
          "default": null,
          "maxLength": 255,
          "precision": null,
          "scale": null,
          "position": 1
        },
        "name": {
          "type": "character varying",
          "nullable": false,
          "default": null,
          "maxLength": 500,
          "precision": null,
          "scale": null,
          "position": 2
        },
        "parent_id": {
          "type": "character varying",
          "nullable": true,
          "default": null,
          "maxLength": 255,
          "precision": null,
          "scale": null,
          "position": 3
        },
        "path": {
          "type": "text",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 4
        },
        "level": {
          "type": "integer",
          "nullable": true,
          "default": "0",
          "maxLength": null,
          "precision": 32,
          "scale": 0,
          "position": 5
        },
        "created_time": {
          "type": "timestamp without time zone",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 6
        },
        "updated_at": {
          "type": "timestamp without time zone",
          "nullable": true,
          "default": "CURRENT_TIMESTAMP",
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 7
        },
        "synced_at": {
          "type": "timestamp without time zone",
          "nullable": true,
          "default": "CURRENT_TIMESTAMP",
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 8
        },
        "is_active": {
          "type": "boolean",
          "nullable": true,
          "default": "true",
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 9
        },
        "image_count": {
          "type": "integer",
          "nullable": true,
          "default": "0",
          "maxLength": null,
          "precision": 32,
          "scale": 0,
          "position": 10
        },
        "last_used_at": {
          "type": "timestamp with time zone",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 11
        },
        "usage_count": {
          "type": "integer",
          "nullable": true,
          "default": "0",
          "maxLength": null,
          "precision": 32,
          "scale": 0,
          "position": 12
        },
        "last_posted_at": {
          "type": "timestamp with time zone",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 13
        },
        "category": {
          "type": "character varying",
          "nullable": true,
          "default": null,
          "maxLength": 100,
          "precision": null,
          "scale": null,
          "position": 14
        }
      },
      "primaryKeys": [
        "id"
      ],
      "foreignKeys": {
        "parent_id": {
          "referencesTable": "folders",
          "referencesColumn": "id",
          "constraintName": "fk_folders_parent",
          "onDelete": "SET NULL",
          "onUpdate": "NO ACTION"
        }
      },
      "indexes": {
        "folders_pkey": {
          "definition": "CREATE UNIQUE INDEX folders_pkey ON public.folders USING btree (id)",
          "unique": true,
          "primary": true
        },
        "idx_folders_active": {
          "definition": "CREATE INDEX idx_folders_active ON public.folders USING btree (is_active)",
          "unique": false,
          "primary": false
        },
        "idx_folders_dashboard": {
          "definition": "CREATE INDEX idx_folders_dashboard ON public.folders USING btree (is_active, parent_id, image_count DESC)",
          "unique": false,
          "primary": false
        },
        "idx_folders_level": {
          "definition": "CREATE INDEX idx_folders_level ON public.folders USING btree (level)",
          "unique": false,
          "primary": false
        },
        "idx_folders_name": {
          "definition": "CREATE INDEX idx_folders_name ON public.folders USING btree (name)",
          "unique": false,
          "primary": false
        },
        "idx_folders_parent_id": {
          "definition": "CREATE INDEX idx_folders_parent_id ON public.folders USING btree (parent_id)",
          "unique": false,
          "primary": false
        },
        "idx_folders_path": {
          "definition": "CREATE INDEX idx_folders_path ON public.folders USING btree (path)",
          "unique": false,
          "primary": false
        },
        "idx_folders_usage": {
          "definition": "CREATE INDEX idx_folders_usage ON public.folders USING btree (last_used_at DESC, usage_count DESC)",
          "unique": false,
          "primary": false
        }
      },
      "constraints": {
        "2200_41438_1_not_null": {
          "type": "CHECK"
        },
        "2200_41438_2_not_null": {
          "type": "CHECK"
        },
        "fk_folders_parent": {
          "type": "FOREIGN KEY"
        },
        "folders_pkey": {
          "type": "PRIMARY KEY"
        }
      },
      "rowCount": 1
    },
    "images": {
      "type": "table",
      "columns": {
        "id": {
          "type": "character varying",
          "nullable": false,
          "default": null,
          "maxLength": 255,
          "precision": null,
          "scale": null,
          "position": 1
        },
        "name": {
          "type": "character varying",
          "nullable": false,
          "default": null,
          "maxLength": 512,
          "precision": null,
          "scale": null,
          "position": 2
        },
        "created_time": {
          "type": "timestamp with time zone",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 3
        },
        "parents": {
          "type": "jsonb",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 4
        },
        "mime_type": {
          "type": "character varying",
          "nullable": true,
          "default": null,
          "maxLength": 50,
          "precision": null,
          "scale": null,
          "position": 5
        },
        "thumbnail_link": {
          "type": "text",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 6
        },
        "last_synced_at": {
          "type": "timestamp with time zone",
          "nullable": true,
          "default": "now()",
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 7
        }
      },
      "primaryKeys": [
        "id"
      ],
      "foreignKeys": {},
      "indexes": {
        "images_pkey": {
          "definition": "CREATE UNIQUE INDEX images_pkey ON public.images USING btree (id)",
          "unique": true,
          "primary": true
        }
      },
      "constraints": {
        "2200_74033_1_not_null": {
          "type": "CHECK"
        },
        "2200_74033_2_not_null": {
          "type": "CHECK"
        },
        "images_pkey": {
          "type": "PRIMARY KEY"
        }
      },
      "rowCount": 3
    },
    "ingestion_runs": {
      "type": "table",
      "columns": {
        "id": {
          "type": "integer",
          "nullable": false,
          "default": "nextval('ingestion_runs_id_seq'::regclass)",
          "maxLength": null,
          "precision": 32,
          "scale": 0,
          "position": 1
        },
        "run_date": {
          "type": "date",
          "nullable": false,
          "default": null,
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 2
        },
        "status": {
          "type": "character varying",
          "nullable": false,
          "default": "'running'::character varying",
          "maxLength": 20,
          "precision": null,
          "scale": null,
          "position": 3
        },
        "pages_processed": {
          "type": "integer",
          "nullable": true,
          "default": "0",
          "maxLength": null,
          "precision": 32,
          "scale": 0,
          "position": 4
        },
        "pages_success": {
          "type": "integer",
          "nullable": true,
          "default": "0",
          "maxLength": null,
          "precision": 32,
          "scale": 0,
          "position": 5
        },
        "pages_failed": {
          "type": "integer",
          "nullable": true,
          "default": "0",
          "maxLength": null,
          "precision": 32,
          "scale": 0,
          "position": 6
        },
        "started_at": {
          "type": "timestamp with time zone",
          "nullable": true,
          "default": "now()",
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 7
        },
        "completed_at": {
          "type": "timestamp with time zone",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 8
        },
        "error_message": {
          "type": "text",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 9
        }
      },
      "primaryKeys": [
        "id"
      ],
      "foreignKeys": {},
      "indexes": {
        "ingestion_runs_pkey": {
          "definition": "CREATE UNIQUE INDEX ingestion_runs_pkey ON public.ingestion_runs USING btree (id)",
          "unique": true,
          "primary": true
        },
        "ingestion_runs_run_date_key": {
          "definition": "CREATE UNIQUE INDEX ingestion_runs_run_date_key ON public.ingestion_runs USING btree (run_date)",
          "unique": true,
          "primary": false
        }
      },
      "constraints": {
        "2200_33122_1_not_null": {
          "type": "CHECK"
        },
        "2200_33122_2_not_null": {
          "type": "CHECK"
        },
        "2200_33122_3_not_null": {
          "type": "CHECK"
        },
        "ingestion_runs_pkey": {
          "type": "PRIMARY KEY"
        },
        "ingestion_runs_run_date_key": {
          "type": "UNIQUE"
        }
      },
      "rowCount": 2
    },
    "page_configs": {
      "type": "table",
      "columns": {
        "page_id": {
          "type": "character varying",
          "nullable": false,
          "default": null,
          "maxLength": 100,
          "precision": null,
          "scale": null,
          "position": 1
        },
        "enabled": {
          "type": "boolean",
          "nullable": true,
          "default": "false",
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 2
        },
        "folder_ids": {
          "type": "jsonb",
          "nullable": true,
          "default": "'[]'::jsonb",
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 3
        },
        "schedule": {
          "type": "jsonb",
          "nullable": true,
          "default": "'[]'::jsonb",
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 4
        },
        "posts_per_slot": {
          "type": "integer",
          "nullable": true,
          "default": "1",
          "maxLength": null,
          "precision": 32,
          "scale": 0,
          "position": 5
        },
        "default_caption": {
          "type": "text",
          "nullable": true,
          "default": "''::text",
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 6
        },
        "caption_by_folder": {
          "type": "jsonb",
          "nullable": true,
          "default": "'{}'::jsonb",
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 7
        },
        "created_at": {
          "type": "timestamp without time zone",
          "nullable": true,
          "default": "CURRENT_TIMESTAMP",
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 8
        },
        "updated_at": {
          "type": "timestamp without time zone",
          "nullable": true,
          "default": "CURRENT_TIMESTAMP",
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 9
        }
      },
      "primaryKeys": [
        "page_id"
      ],
      "foreignKeys": {},
      "indexes": {
        "idx_page_configs_enabled": {
          "definition": "CREATE INDEX idx_page_configs_enabled ON public.page_configs USING btree (enabled)",
          "unique": false,
          "primary": false
        },
        "idx_page_configs_folder_ids": {
          "definition": "CREATE INDEX idx_page_configs_folder_ids ON public.page_configs USING gin (folder_ids)",
          "unique": false,
          "primary": false
        },
        "idx_page_configs_updated_at": {
          "definition": "CREATE INDEX idx_page_configs_updated_at ON public.page_configs USING btree (updated_at)",
          "unique": false,
          "primary": false
        },
        "page_configs_pkey": {
          "definition": "CREATE UNIQUE INDEX page_configs_pkey ON public.page_configs USING btree (page_id)",
          "unique": true,
          "primary": true
        }
      },
      "constraints": {
        "2200_41459_1_not_null": {
          "type": "CHECK"
        },
        "page_configs_pkey": {
          "type": "PRIMARY KEY"
        }
      },
      "rowCount": 4
    },
    "page_folder_relationships": {
      "type": "table",
      "columns": {
        "id": {
          "type": "integer",
          "nullable": false,
          "default": "nextval('page_folder_relationships_id_seq'::regclass)",
          "maxLength": null,
          "precision": 32,
          "scale": 0,
          "position": 1
        },
        "page_id": {
          "type": "character varying",
          "nullable": false,
          "default": null,
          "maxLength": 100,
          "precision": null,
          "scale": null,
          "position": 2
        },
        "folder_id": {
          "type": "character varying",
          "nullable": false,
          "default": null,
          "maxLength": 100,
          "precision": null,
          "scale": null,
          "position": 3
        },
        "created_at": {
          "type": "timestamp without time zone",
          "nullable": true,
          "default": "CURRENT_TIMESTAMP",
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 4
        },
        "updated_at": {
          "type": "timestamp without time zone",
          "nullable": true,
          "default": "CURRENT_TIMESTAMP",
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 5
        }
      },
      "primaryKeys": [
        "id"
      ],
      "foreignKeys": {
        "page_id": {
          "referencesTable": "page_configs",
          "referencesColumn": "page_id",
          "constraintName": "fk_page_folder_page_id",
          "onDelete": "CASCADE",
          "onUpdate": "NO ACTION"
        },
        "folder_id": {
          "referencesTable": "folders",
          "referencesColumn": "id",
          "constraintName": "fk_page_folder_folder_id",
          "onDelete": "CASCADE",
          "onUpdate": "NO ACTION"
        }
      },
      "indexes": {
        "idx_page_folder_created_at": {
          "definition": "CREATE INDEX idx_page_folder_created_at ON public.page_folder_relationships USING btree (created_at)",
          "unique": false,
          "primary": false
        },
        "idx_page_folder_folder_id": {
          "definition": "CREATE INDEX idx_page_folder_folder_id ON public.page_folder_relationships USING btree (folder_id)",
          "unique": false,
          "primary": false
        },
        "idx_page_folder_page_id": {
          "definition": "CREATE INDEX idx_page_folder_page_id ON public.page_folder_relationships USING btree (page_id)",
          "unique": false,
          "primary": false
        },
        "page_folder_relationships_pkey": {
          "definition": "CREATE UNIQUE INDEX page_folder_relationships_pkey ON public.page_folder_relationships USING btree (id)",
          "unique": true,
          "primary": true
        },
        "uk_page_folder_relationship": {
          "definition": "CREATE UNIQUE INDEX uk_page_folder_relationship ON public.page_folder_relationships USING btree (page_id, folder_id)",
          "unique": true,
          "primary": false
        }
      },
      "constraints": {
        "2200_98619_1_not_null": {
          "type": "CHECK"
        },
        "2200_98619_2_not_null": {
          "type": "CHECK"
        },
        "2200_98619_3_not_null": {
          "type": "CHECK"
        },
        "fk_page_folder_folder_id": {
          "type": "FOREIGN KEY"
        },
        "fk_page_folder_page_id": {
          "type": "FOREIGN KEY"
        },
        "page_folder_relationships_pkey": {
          "type": "PRIMARY KEY"
        },
        "uk_page_folder_relationship": {
          "type": "UNIQUE"
        }
      },
      "rowCount": 0
    },
    "page_stats_daily": {
      "type": "table",
      "columns": {
        "id": {
          "type": "integer",
          "nullable": false,
          "default": "nextval('page_stats_daily_id_seq'::regclass)",
          "maxLength": null,
          "precision": 32,
          "scale": 0,
          "position": 1
        },
        "page_id": {
          "type": "character varying",
          "nullable": false,
          "default": null,
          "maxLength": 50,
          "precision": null,
          "scale": null,
          "position": 2
        },
        "date": {
          "type": "date",
          "nullable": false,
          "default": null,
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 3
        },
        "fan_count": {
          "type": "integer",
          "nullable": true,
          "default": "0",
          "maxLength": null,
          "precision": 32,
          "scale": 0,
          "position": 4
        },
        "follower_count": {
          "type": "integer",
          "nullable": true,
          "default": "0",
          "maxLength": null,
          "precision": 32,
          "scale": 0,
          "position": 5
        },
        "created_at": {
          "type": "timestamp with time zone",
          "nullable": true,
          "default": "now()",
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 6
        },
        "updated_at": {
          "type": "timestamp with time zone",
          "nullable": true,
          "default": "now()",
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 7
        }
      },
      "primaryKeys": [
        "id"
      ],
      "foreignKeys": {
        "page_id": {
          "referencesTable": "pages",
          "referencesColumn": "page_id",
          "constraintName": "page_stats_daily_page_id_fkey",
          "onDelete": "CASCADE",
          "onUpdate": "NO ACTION"
        }
      },
      "indexes": {
        "idx_page_stats_daily_page_date": {
          "definition": "CREATE INDEX idx_page_stats_daily_page_date ON public.page_stats_daily USING btree (page_id, date)",
          "unique": false,
          "primary": false
        },
        "page_stats_daily_page_id_date_key": {
          "definition": "CREATE UNIQUE INDEX page_stats_daily_page_id_date_key ON public.page_stats_daily USING btree (page_id, date)",
          "unique": true,
          "primary": false
        },
        "page_stats_daily_pkey": {
          "definition": "CREATE UNIQUE INDEX page_stats_daily_pkey ON public.page_stats_daily USING btree (id)",
          "unique": true,
          "primary": true
        }
      },
      "constraints": {
        "2200_33064_1_not_null": {
          "type": "CHECK"
        },
        "2200_33064_2_not_null": {
          "type": "CHECK"
        },
        "2200_33064_3_not_null": {
          "type": "CHECK"
        },
        "page_stats_daily_page_id_fkey": {
          "type": "FOREIGN KEY"
        },
        "page_stats_daily_pkey": {
          "type": "PRIMARY KEY"
        },
        "page_stats_daily_page_id_date_key": {
          "type": "UNIQUE"
        }
      },
      "rowCount": 46
    },
    "page_swipe_categories": {
      "type": "table",
      "columns": {
        "id": {
          "type": "integer",
          "nullable": false,
          "default": "nextval('page_swipe_categories_id_seq'::regclass)",
          "maxLength": null,
          "precision": 32,
          "scale": 0,
          "position": 1
        },
        "page_id": {
          "type": "character varying",
          "nullable": false,
          "default": null,
          "maxLength": 100,
          "precision": null,
          "scale": null,
          "position": 2
        },
        "category": {
          "type": "character varying",
          "nullable": false,
          "default": null,
          "maxLength": 100,
          "precision": null,
          "scale": null,
          "position": 3
        },
        "is_active": {
          "type": "boolean",
          "nullable": true,
          "default": "true",
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 4
        },
        "created_at": {
          "type": "timestamp with time zone",
          "nullable": true,
          "default": "CURRENT_TIMESTAMP",
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 5
        },
        "updated_at": {
          "type": "timestamp with time zone",
          "nullable": true,
          "default": "CURRENT_TIMESTAMP",
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 6
        }
      },
      "primaryKeys": [
        "id"
      ],
      "foreignKeys": {
        "page_id": {
          "referencesTable": "pages",
          "referencesColumn": "page_id",
          "constraintName": "fk_page_swipe_categories_page_id",
          "onDelete": "CASCADE",
          "onUpdate": "NO ACTION"
        },
        "category": {
          "referencesTable": "swipe_link_categories",
          "referencesColumn": "name",
          "constraintName": "fk_page_swipe_categories_category",
          "onDelete": "CASCADE",
          "onUpdate": "NO ACTION"
        }
      },
      "indexes": {
        "idx_page_swipe_categories_active": {
          "definition": "CREATE INDEX idx_page_swipe_categories_active ON public.page_swipe_categories USING btree (is_active)",
          "unique": false,
          "primary": false
        },
        "idx_page_swipe_categories_category": {
          "definition": "CREATE INDEX idx_page_swipe_categories_category ON public.page_swipe_categories USING btree (category)",
          "unique": false,
          "primary": false
        },
        "idx_page_swipe_categories_page_active": {
          "definition": "CREATE INDEX idx_page_swipe_categories_page_active ON public.page_swipe_categories USING btree (page_id, is_active)",
          "unique": false,
          "primary": false
        },
        "idx_page_swipe_categories_page_id": {
          "definition": "CREATE INDEX idx_page_swipe_categories_page_id ON public.page_swipe_categories USING btree (page_id)",
          "unique": false,
          "primary": false
        },
        "page_swipe_categories_page_id_category_key": {
          "definition": "CREATE UNIQUE INDEX page_swipe_categories_page_id_category_key ON public.page_swipe_categories USING btree (page_id, category)",
          "unique": true,
          "primary": false
        },
        "page_swipe_categories_pkey": {
          "definition": "CREATE UNIQUE INDEX page_swipe_categories_pkey ON public.page_swipe_categories USING btree (id)",
          "unique": true,
          "primary": true
        }
      },
      "constraints": {
        "2200_65864_1_not_null": {
          "type": "CHECK"
        },
        "2200_65864_2_not_null": {
          "type": "CHECK"
        },
        "2200_65864_3_not_null": {
          "type": "CHECK"
        },
        "fk_page_swipe_categories_category": {
          "type": "FOREIGN KEY"
        },
        "fk_page_swipe_categories_page_id": {
          "type": "FOREIGN KEY"
        },
        "page_swipe_categories_pkey": {
          "type": "PRIMARY KEY"
        },
        "page_swipe_categories_page_id_category_key": {
          "type": "UNIQUE"
        }
      },
      "rowCount": 39
    },
    "pages": {
      "type": "table",
      "columns": {
        "page_id": {
          "type": "character varying",
          "nullable": false,
          "default": null,
          "maxLength": 50,
          "precision": null,
          "scale": null,
          "position": 1
        },
        "page_name": {
          "type": "text",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 2
        },
        "created_at": {
          "type": "timestamp with time zone",
          "nullable": true,
          "default": "now()",
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 3
        },
        "updated_at": {
          "type": "timestamp with time zone",
          "nullable": true,
          "default": "now()",
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 4
        },
        "facebook_url": {
          "type": "text",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 5
        },
        "notes": {
          "type": "text",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 6
        },
        "status": {
          "type": "character varying",
          "nullable": true,
          "default": "'active'::character varying",
          "maxLength": 20,
          "precision": null,
          "scale": null,
          "position": 7
        },
        "avatar_url": {
          "type": "text",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 8
        }
      },
      "primaryKeys": [
        "page_id"
      ],
      "foreignKeys": {},
      "indexes": {
        "pages_pkey": {
          "definition": "CREATE UNIQUE INDEX pages_pkey ON public.pages USING btree (page_id)",
          "unique": true,
          "primary": true
        }
      },
      "constraints": {
        "2200_33054_1_not_null": {
          "type": "CHECK"
        },
        "pages_pkey": {
          "type": "PRIMARY KEY"
        }
      },
      "rowCount": 784
    },
    "post_logs": {
      "type": "table",
      "columns": {
        "id": {
          "type": "integer",
          "nullable": false,
          "default": "nextval('post_logs_id_seq'::regclass)",
          "maxLength": null,
          "precision": 32,
          "scale": 0,
          "position": 1
        },
        "log_id": {
          "type": "character varying",
          "nullable": true,
          "default": null,
          "maxLength": 255,
          "precision": null,
          "scale": null,
          "position": 2
        },
        "page_id": {
          "type": "character varying",
          "nullable": true,
          "default": null,
          "maxLength": 255,
          "precision": null,
          "scale": null,
          "position": 3
        },
        "file_id": {
          "type": "character varying",
          "nullable": true,
          "default": null,
          "maxLength": 255,
          "precision": null,
          "scale": null,
          "position": 4
        },
        "caption": {
          "type": "text",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 5
        },
        "comment": {
          "type": "text",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 6
        },
        "status": {
          "type": "character varying",
          "nullable": true,
          "default": null,
          "maxLength": 50,
          "precision": null,
          "scale": null,
          "position": 7
        },
        "ts": {
          "type": "timestamp with time zone",
          "nullable": true,
          "default": "now()",
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 8
        },
        "correlation_id": {
          "type": "character varying",
          "nullable": true,
          "default": null,
          "maxLength": 255,
          "precision": null,
          "scale": null,
          "position": 9
        },
        "photo_id": {
          "type": "character varying",
          "nullable": true,
          "default": null,
          "maxLength": 255,
          "precision": null,
          "scale": null,
          "position": 10
        },
        "comment_id": {
          "type": "character varying",
          "nullable": true,
          "default": null,
          "maxLength": 255,
          "precision": null,
          "scale": null,
          "position": 11
        },
        "fb_response": {
          "type": "jsonb",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 12
        },
        "completed_at": {
          "type": "timestamp with time zone",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 13
        },
        "file_name": {
          "type": "character varying",
          "nullable": true,
          "default": null,
          "maxLength": 512,
          "precision": null,
          "scale": null,
          "position": 14
        },
        "folder_id": {
          "type": "character varying",
          "nullable": true,
          "default": null,
          "maxLength": 255,
          "precision": null,
          "scale": null,
          "position": 15
        },
        "total_time": {
          "type": "integer",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "precision": 32,
          "scale": 0,
          "position": 16
        },
        "request_duration": {
          "type": "integer",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "precision": 32,
          "scale": 0,
          "position": 17
        },
        "step_logs": {
          "type": "jsonb",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 18
        },
        "error_message": {
          "type": "text",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 19
        },
        "error_code": {
          "type": "character varying",
          "nullable": true,
          "default": null,
          "maxLength": 100,
          "precision": null,
          "scale": null,
          "position": 20
        },
        "error_details": {
          "type": "jsonb",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 21
        },
        "fb_code": {
          "type": "integer",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "precision": 32,
          "scale": 0,
          "position": 22
        },
        "fb_type": {
          "type": "character varying",
          "nullable": true,
          "default": null,
          "maxLength": 100,
          "precision": null,
          "scale": null,
          "position": 23
        },
        "needs_review": {
          "type": "boolean",
          "nullable": true,
          "default": "false",
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 24
        },
        "severity": {
          "type": "character varying",
          "nullable": true,
          "default": null,
          "maxLength": 50,
          "precision": null,
          "scale": null,
          "position": 25
        }
      },
      "primaryKeys": [
        "id"
      ],
      "foreignKeys": {},
      "indexes": {
        "post_logs_log_id_key": {
          "definition": "CREATE UNIQUE INDEX post_logs_log_id_key ON public.post_logs USING btree (log_id)",
          "unique": true,
          "primary": false
        },
        "post_logs_pkey": {
          "definition": "CREATE UNIQUE INDEX post_logs_pkey ON public.post_logs USING btree (id)",
          "unique": true,
          "primary": true
        }
      },
      "constraints": {
        "2200_74043_1_not_null": {
          "type": "CHECK"
        },
        "post_logs_pkey": {
          "type": "PRIMARY KEY"
        },
        "post_logs_log_id_key": {
          "type": "UNIQUE"
        }
      },
      "rowCount": 0
    },
    "post_reactions_daily": {
      "type": "table",
      "columns": {
        "id": {
          "type": "integer",
          "nullable": false,
          "default": "nextval('post_reactions_daily_id_seq'::regclass)",
          "maxLength": null,
          "precision": 32,
          "scale": 0,
          "position": 1
        },
        "post_id": {
          "type": "character varying",
          "nullable": false,
          "default": null,
          "maxLength": 100,
          "precision": null,
          "scale": null,
          "position": 2
        },
        "date": {
          "type": "date",
          "nullable": false,
          "default": null,
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 3
        },
        "like_count": {
          "type": "integer",
          "nullable": true,
          "default": "0",
          "maxLength": null,
          "precision": 32,
          "scale": 0,
          "position": 4
        },
        "love_count": {
          "type": "integer",
          "nullable": true,
          "default": "0",
          "maxLength": null,
          "precision": 32,
          "scale": 0,
          "position": 5
        },
        "wow_count": {
          "type": "integer",
          "nullable": true,
          "default": "0",
          "maxLength": null,
          "precision": 32,
          "scale": 0,
          "position": 6
        },
        "haha_count": {
          "type": "integer",
          "nullable": true,
          "default": "0",
          "maxLength": null,
          "precision": 32,
          "scale": 0,
          "position": 7
        },
        "sad_count": {
          "type": "integer",
          "nullable": true,
          "default": "0",
          "maxLength": null,
          "precision": 32,
          "scale": 0,
          "position": 8
        },
        "angry_count": {
          "type": "integer",
          "nullable": true,
          "default": "0",
          "maxLength": null,
          "precision": 32,
          "scale": 0,
          "position": 9
        },
        "care_count": {
          "type": "integer",
          "nullable": true,
          "default": "0",
          "maxLength": null,
          "precision": 32,
          "scale": 0,
          "position": 10
        },
        "comments_count": {
          "type": "integer",
          "nullable": true,
          "default": "0",
          "maxLength": null,
          "precision": 32,
          "scale": 0,
          "position": 11
        },
        "shares_count": {
          "type": "integer",
          "nullable": true,
          "default": "0",
          "maxLength": null,
          "precision": 32,
          "scale": 0,
          "position": 12
        },
        "total_reactions": {
          "type": "integer",
          "nullable": true,
          "default": "0",
          "maxLength": null,
          "precision": 32,
          "scale": 0,
          "position": 13
        },
        "created_at": {
          "type": "timestamp with time zone",
          "nullable": true,
          "default": "now()",
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 14
        },
        "updated_at": {
          "type": "timestamp with time zone",
          "nullable": true,
          "default": "now()",
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 15
        }
      },
      "primaryKeys": [
        "id"
      ],
      "foreignKeys": {
        "post_id": {
          "referencesTable": "posts",
          "referencesColumn": "post_id",
          "constraintName": "post_reactions_daily_post_id_fkey",
          "onDelete": "CASCADE",
          "onUpdate": "NO ACTION"
        }
      },
      "indexes": {
        "idx_post_reactions_daily_post_date": {
          "definition": "CREATE INDEX idx_post_reactions_daily_post_date ON public.post_reactions_daily USING btree (post_id, date)",
          "unique": false,
          "primary": false
        },
        "post_reactions_daily_pkey": {
          "definition": "CREATE UNIQUE INDEX post_reactions_daily_pkey ON public.post_reactions_daily USING btree (id)",
          "unique": true,
          "primary": true
        },
        "post_reactions_daily_post_id_date_key": {
          "definition": "CREATE UNIQUE INDEX post_reactions_daily_post_id_date_key ON public.post_reactions_daily USING btree (post_id, date)",
          "unique": true,
          "primary": false
        }
      },
      "constraints": {
        "2200_33096_1_not_null": {
          "type": "CHECK"
        },
        "2200_33096_2_not_null": {
          "type": "CHECK"
        },
        "2200_33096_3_not_null": {
          "type": "CHECK"
        },
        "post_reactions_daily_post_id_fkey": {
          "type": "FOREIGN KEY"
        },
        "post_reactions_daily_pkey": {
          "type": "PRIMARY KEY"
        },
        "post_reactions_daily_post_id_date_key": {
          "type": "UNIQUE"
        }
      },
      "rowCount": 5889
    },
    "posting_queue": {
      "type": "table",
      "columns": {
        "id": {
          "type": "character varying",
          "nullable": false,
          "default": null,
          "maxLength": 255,
          "precision": null,
          "scale": null,
          "position": 1
        },
        "page_id": {
          "type": "character varying",
          "nullable": false,
          "default": null,
          "maxLength": 100,
          "precision": null,
          "scale": null,
          "position": 2
        },
        "request_id": {
          "type": "character varying",
          "nullable": false,
          "default": null,
          "maxLength": 255,
          "precision": null,
          "scale": null,
          "position": 3
        },
        "priority": {
          "type": "character varying",
          "nullable": true,
          "default": "'normal'::character varying",
          "maxLength": 20,
          "precision": null,
          "scale": null,
          "position": 4
        },
        "status": {
          "type": "character varying",
          "nullable": true,
          "default": "'pending'::character varying",
          "maxLength": 20,
          "precision": null,
          "scale": null,
          "position": 5
        },
        "scheduled_time": {
          "type": "timestamp with time zone",
          "nullable": false,
          "default": null,
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 6
        },
        "created_at": {
          "type": "timestamp with time zone",
          "nullable": true,
          "default": "now()",
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 7
        },
        "claimed_at": {
          "type": "timestamp with time zone",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 8
        },
        "completed_at": {
          "type": "timestamp with time zone",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 9
        },
        "source": {
          "type": "character varying",
          "nullable": true,
          "default": "'scheduler'::character varying",
          "maxLength": 50,
          "precision": null,
          "scale": null,
          "position": 10
        },
        "agent_id": {
          "type": "character varying",
          "nullable": true,
          "default": null,
          "maxLength": 100,
          "precision": null,
          "scale": null,
          "position": 11
        },
        "metadata": {
          "type": "jsonb",
          "nullable": true,
          "default": "'{}'::jsonb",
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 12
        },
        "error_message": {
          "type": "text",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 13
        },
        "retry_count": {
          "type": "integer",
          "nullable": true,
          "default": "0",
          "maxLength": null,
          "precision": 32,
          "scale": 0,
          "position": 14
        },
        "updated_at": {
          "type": "timestamp with time zone",
          "nullable": true,
          "default": "now()",
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 15
        }
      },
      "primaryKeys": [
        "id"
      ],
      "foreignKeys": {},
      "indexes": {
        "idx_posting_queue_page_id": {
          "definition": "CREATE INDEX idx_posting_queue_page_id ON public.posting_queue USING btree (page_id)",
          "unique": false,
          "primary": false
        },
        "idx_posting_queue_priority": {
          "definition": "CREATE INDEX idx_posting_queue_priority ON public.posting_queue USING btree (priority)",
          "unique": false,
          "primary": false
        },
        "idx_posting_queue_request_id": {
          "definition": "CREATE INDEX idx_posting_queue_request_id ON public.posting_queue USING btree (request_id)",
          "unique": false,
          "primary": false
        },
        "idx_posting_queue_scheduled_time": {
          "definition": "CREATE INDEX idx_posting_queue_scheduled_time ON public.posting_queue USING btree (scheduled_time)",
          "unique": false,
          "primary": false
        },
        "idx_posting_queue_status": {
          "definition": "CREATE INDEX idx_posting_queue_status ON public.posting_queue USING btree (status)",
          "unique": false,
          "primary": false
        },
        "idx_posting_queue_worker_query": {
          "definition": "CREATE INDEX idx_posting_queue_worker_query ON public.posting_queue USING btree (status, scheduled_time, priority DESC, id)",
          "unique": false,
          "primary": false
        },
        "posting_queue_pkey": {
          "definition": "CREATE UNIQUE INDEX posting_queue_pkey ON public.posting_queue USING btree (id)",
          "unique": true,
          "primary": true
        }
      },
      "constraints": {
        "2200_57638_1_not_null": {
          "type": "CHECK"
        },
        "2200_57638_2_not_null": {
          "type": "CHECK"
        },
        "2200_57638_3_not_null": {
          "type": "CHECK"
        },
        "2200_57638_6_not_null": {
          "type": "CHECK"
        },
        "posting_queue_priority_check": {
          "type": "CHECK"
        },
        "posting_queue_status_check": {
          "type": "CHECK"
        },
        "posting_queue_pkey": {
          "type": "PRIMARY KEY"
        }
      },
      "rowCount": 58
    },
    "posts": {
      "type": "table",
      "columns": {
        "post_id": {
          "type": "character varying",
          "nullable": false,
          "default": null,
          "maxLength": 100,
          "precision": null,
          "scale": null,
          "position": 1
        },
        "page_id": {
          "type": "character varying",
          "nullable": false,
          "default": null,
          "maxLength": 50,
          "precision": null,
          "scale": null,
          "position": 2
        },
        "message": {
          "type": "text",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 3
        },
        "created_time": {
          "type": "timestamp with time zone",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 4
        },
        "permalink_url": {
          "type": "text",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 5
        },
        "created_at": {
          "type": "timestamp with time zone",
          "nullable": true,
          "default": "now()",
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 6
        },
        "updated_at": {
          "type": "timestamp with time zone",
          "nullable": true,
          "default": "now()",
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 7
        },
        "updated_time": {
          "type": "timestamp with time zone",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 8
        },
        "link_ảnh": {
          "type": "text",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 9
        }
      },
      "primaryKeys": [
        "post_id"
      ],
      "foreignKeys": {
        "page_id": {
          "referencesTable": "pages",
          "referencesColumn": "page_id",
          "constraintName": "posts_page_id_fkey",
          "onDelete": "CASCADE",
          "onUpdate": "NO ACTION"
        }
      },
      "indexes": {
        "idx_posts_page_id_time": {
          "definition": "CREATE INDEX idx_posts_page_id_time ON public.posts USING btree (page_id, created_time DESC)",
          "unique": false,
          "primary": false
        },
        "posts_pkey": {
          "definition": "CREATE UNIQUE INDEX posts_pkey ON public.posts USING btree (post_id)",
          "unique": true,
          "primary": true
        }
      },
      "constraints": {
        "2200_33081_1_not_null": {
          "type": "CHECK"
        },
        "2200_33081_2_not_null": {
          "type": "CHECK"
        },
        "posts_page_id_fkey": {
          "type": "FOREIGN KEY"
        },
        "posts_pkey": {
          "type": "PRIMARY KEY"
        }
      },
      "rowCount": 5889
    },
    "swipe_link_categories": {
      "type": "table",
      "columns": {
        "name": {
          "type": "character varying",
          "nullable": false,
          "default": null,
          "maxLength": 100,
          "precision": null,
          "scale": null,
          "position": 1
        },
        "display_name": {
          "type": "character varying",
          "nullable": false,
          "default": null,
          "maxLength": 200,
          "precision": null,
          "scale": null,
          "position": 2
        },
        "description": {
          "type": "text",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 3
        },
        "color": {
          "type": "character varying",
          "nullable": true,
          "default": "'#007bff'::character varying",
          "maxLength": 7,
          "precision": null,
          "scale": null,
          "position": 4
        },
        "icon": {
          "type": "character varying",
          "nullable": true,
          "default": "'🔗'::character varying",
          "maxLength": 50,
          "precision": null,
          "scale": null,
          "position": 5
        },
        "sort_order": {
          "type": "integer",
          "nullable": true,
          "default": "0",
          "maxLength": null,
          "precision": 32,
          "scale": 0,
          "position": 6
        },
        "is_active": {
          "type": "boolean",
          "nullable": true,
          "default": "true",
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 7
        },
        "created_at": {
          "type": "timestamp with time zone",
          "nullable": true,
          "default": "CURRENT_TIMESTAMP",
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 8
        },
        "updated_at": {
          "type": "timestamp with time zone",
          "nullable": true,
          "default": "CURRENT_TIMESTAMP",
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 9
        }
      },
      "primaryKeys": [
        "name"
      ],
      "foreignKeys": {},
      "indexes": {
        "idx_swipe_link_categories_active": {
          "definition": "CREATE INDEX idx_swipe_link_categories_active ON public.swipe_link_categories USING btree (is_active)",
          "unique": false,
          "primary": false
        },
        "idx_swipe_link_categories_sort": {
          "definition": "CREATE INDEX idx_swipe_link_categories_sort ON public.swipe_link_categories USING btree (sort_order, display_name)",
          "unique": false,
          "primary": false
        },
        "swipe_link_categories_pkey": {
          "definition": "CREATE UNIQUE INDEX swipe_link_categories_pkey ON public.swipe_link_categories USING btree (name)",
          "unique": true,
          "primary": true
        }
      },
      "constraints": {
        "2200_65846_1_not_null": {
          "type": "CHECK"
        },
        "2200_65846_2_not_null": {
          "type": "CHECK"
        },
        "swipe_link_categories_pkey": {
          "type": "PRIMARY KEY"
        }
      },
      "rowCount": 8
    },
    "swipe_link_usages": {
      "type": "table",
      "columns": {
        "id": {
          "type": "bigint",
          "nullable": false,
          "default": "nextval('swipe_link_usages_id_seq'::regclass)",
          "maxLength": null,
          "precision": 64,
          "scale": 0,
          "position": 1
        },
        "swipe_link_id": {
          "type": "character varying",
          "nullable": false,
          "default": null,
          "maxLength": 100,
          "precision": null,
          "scale": null,
          "position": 2
        },
        "page_id": {
          "type": "character varying",
          "nullable": false,
          "default": null,
          "maxLength": 100,
          "precision": null,
          "scale": null,
          "position": 3
        },
        "story_id": {
          "type": "character varying",
          "nullable": true,
          "default": null,
          "maxLength": 100,
          "precision": null,
          "scale": null,
          "position": 4
        },
        "success": {
          "type": "boolean",
          "nullable": true,
          "default": "true",
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 5
        },
        "error_message": {
          "type": "text",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 6
        },
        "used_at": {
          "type": "timestamp with time zone",
          "nullable": true,
          "default": "CURRENT_TIMESTAMP",
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 7
        },
        "created_at": {
          "type": "timestamp with time zone",
          "nullable": true,
          "default": "CURRENT_TIMESTAMP",
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 8
        }
      },
      "primaryKeys": [
        "id"
      ],
      "foreignKeys": {
        "swipe_link_id": {
          "referencesTable": "swipe_links",
          "referencesColumn": "id",
          "constraintName": "fk_swipe_link_usages_swipe_link_id",
          "onDelete": "CASCADE",
          "onUpdate": "NO ACTION"
        },
        "page_id": {
          "referencesTable": "pages",
          "referencesColumn": "page_id",
          "constraintName": "fk_swipe_link_usages_page_id",
          "onDelete": "CASCADE",
          "onUpdate": "NO ACTION"
        }
      },
      "indexes": {
        "idx_swipe_link_usages_page_id": {
          "definition": "CREATE INDEX idx_swipe_link_usages_page_id ON public.swipe_link_usages USING btree (page_id)",
          "unique": false,
          "primary": false
        },
        "idx_swipe_link_usages_page_used_at": {
          "definition": "CREATE INDEX idx_swipe_link_usages_page_used_at ON public.swipe_link_usages USING btree (page_id, used_at)",
          "unique": false,
          "primary": false
        },
        "idx_swipe_link_usages_success": {
          "definition": "CREATE INDEX idx_swipe_link_usages_success ON public.swipe_link_usages USING btree (success)",
          "unique": false,
          "primary": false
        },
        "idx_swipe_link_usages_swipe_link_id": {
          "definition": "CREATE INDEX idx_swipe_link_usages_swipe_link_id ON public.swipe_link_usages USING btree (swipe_link_id)",
          "unique": false,
          "primary": false
        },
        "idx_swipe_link_usages_used_at": {
          "definition": "CREATE INDEX idx_swipe_link_usages_used_at ON public.swipe_link_usages USING btree (used_at)",
          "unique": false,
          "primary": false
        },
        "swipe_link_usages_pkey": {
          "definition": "CREATE UNIQUE INDEX swipe_link_usages_pkey ON public.swipe_link_usages USING btree (id)",
          "unique": true,
          "primary": true
        }
      },
      "constraints": {
        "2200_65892_1_not_null": {
          "type": "CHECK"
        },
        "2200_65892_2_not_null": {
          "type": "CHECK"
        },
        "2200_65892_3_not_null": {
          "type": "CHECK"
        },
        "fk_swipe_link_usages_page_id": {
          "type": "FOREIGN KEY"
        },
        "fk_swipe_link_usages_swipe_link_id": {
          "type": "FOREIGN KEY"
        },
        "swipe_link_usages_pkey": {
          "type": "PRIMARY KEY"
        }
      },
      "rowCount": 3327
    },
    "swipe_links": {
      "type": "table",
      "columns": {
        "id": {
          "type": "character varying",
          "nullable": false,
          "default": null,
          "maxLength": 255,
          "precision": null,
          "scale": null,
          "position": 1
        },
        "date": {
          "type": "date",
          "nullable": false,
          "default": null,
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 2
        },
        "link": {
          "type": "text",
          "nullable": false,
          "default": null,
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 3
        },
        "title": {
          "type": "character varying",
          "nullable": true,
          "default": null,
          "maxLength": 255,
          "precision": null,
          "scale": null,
          "position": 4
        },
        "description": {
          "type": "text",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 5
        },
        "is_active": {
          "type": "boolean",
          "nullable": true,
          "default": "true",
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 6
        },
        "created_at": {
          "type": "timestamp with time zone",
          "nullable": true,
          "default": "now()",
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 7
        },
        "updated_at": {
          "type": "timestamp with time zone",
          "nullable": true,
          "default": "now()",
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 8
        },
        "category": {
          "type": "character varying",
          "nullable": false,
          "default": "'general'::character varying",
          "maxLength": 100,
          "precision": null,
          "scale": null,
          "position": 9
        }
      },
      "primaryKeys": [
        "id"
      ],
      "foreignKeys": {},
      "indexes": {
        "idx_swipe_links_active": {
          "definition": "CREATE INDEX idx_swipe_links_active ON public.swipe_links USING btree (is_active)",
          "unique": false,
          "primary": false
        },
        "idx_swipe_links_active_category": {
          "definition": "CREATE INDEX idx_swipe_links_active_category ON public.swipe_links USING btree (is_active, category)",
          "unique": false,
          "primary": false
        },
        "idx_swipe_links_category": {
          "definition": "CREATE INDEX idx_swipe_links_category ON public.swipe_links USING btree (category)",
          "unique": false,
          "primary": false
        },
        "idx_swipe_links_date": {
          "definition": "CREATE INDEX idx_swipe_links_date ON public.swipe_links USING btree (date)",
          "unique": false,
          "primary": false
        },
        "idx_swipe_links_date_active": {
          "definition": "CREATE INDEX idx_swipe_links_date_active ON public.swipe_links USING btree (date, is_active)",
          "unique": false,
          "primary": false
        },
        "swipe_links_pkey": {
          "definition": "CREATE UNIQUE INDEX swipe_links_pkey ON public.swipe_links USING btree (id)",
          "unique": true,
          "primary": true
        }
      },
      "constraints": {
        "2200_65823_1_not_null": {
          "type": "CHECK"
        },
        "2200_65823_2_not_null": {
          "type": "CHECK"
        },
        "2200_65823_3_not_null": {
          "type": "CHECK"
        },
        "2200_65823_9_not_null": {
          "type": "CHECK"
        },
        "swipe_links_pkey": {
          "type": "PRIMARY KEY"
        }
      },
      "rowCount": 15
    },
    "sync_tracking": {
      "type": "table",
      "columns": {
        "page_id": {
          "type": "character varying",
          "nullable": false,
          "default": null,
          "maxLength": 50,
          "precision": null,
          "scale": null,
          "position": 1
        },
        "last_sync_time": {
          "type": "timestamp with time zone",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 2
        },
        "last_post_id": {
          "type": "character varying",
          "nullable": true,
          "default": null,
          "maxLength": 100,
          "precision": null,
          "scale": null,
          "position": 3
        },
        "posts_count": {
          "type": "integer",
          "nullable": true,
          "default": "0",
          "maxLength": null,
          "precision": 32,
          "scale": 0,
          "position": 4
        },
        "first_sync_time": {
          "type": "timestamp with time zone",
          "nullable": true,
          "default": "now()",
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 5
        },
        "updated_at": {
          "type": "timestamp with time zone",
          "nullable": true,
          "default": "now()",
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 6
        }
      },
      "primaryKeys": [
        "page_id"
      ],
      "foreignKeys": {
        "page_id": {
          "referencesTable": "pages",
          "referencesColumn": "page_id",
          "constraintName": "sync_tracking_page_id_fkey",
          "onDelete": "CASCADE",
          "onUpdate": "NO ACTION"
        }
      },
      "indexes": {
        "sync_tracking_pkey": {
          "definition": "CREATE UNIQUE INDEX sync_tracking_pkey ON public.sync_tracking USING btree (page_id)",
          "unique": true,
          "primary": true
        }
      },
      "constraints": {
        "2200_33141_1_not_null": {
          "type": "CHECK"
        },
        "sync_tracking_page_id_fkey": {
          "type": "FOREIGN KEY"
        },
        "sync_tracking_pkey": {
          "type": "PRIMARY KEY"
        }
      },
      "rowCount": 36
    },
    "system_state": {
      "type": "table",
      "columns": {
        "document_id": {
          "type": "character varying",
          "nullable": false,
          "default": null,
          "maxLength": 100,
          "precision": null,
          "scale": null,
          "position": 1
        },
        "data": {
          "type": "jsonb",
          "nullable": false,
          "default": null,
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 2
        },
        "created_at": {
          "type": "timestamp without time zone",
          "nullable": true,
          "default": "CURRENT_TIMESTAMP",
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 3
        },
        "updated_at": {
          "type": "timestamp without time zone",
          "nullable": true,
          "default": "CURRENT_TIMESTAMP",
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 4
        },
        "version": {
          "type": "integer",
          "nullable": true,
          "default": "1",
          "maxLength": null,
          "precision": 32,
          "scale": 0,
          "position": 5
        }
      },
      "primaryKeys": [
        "document_id"
      ],
      "foreignKeys": {},
      "indexes": {
        "idx_system_state_data": {
          "definition": "CREATE INDEX idx_system_state_data ON public.system_state USING gin (data)",
          "unique": false,
          "primary": false
        },
        "idx_system_state_document_id": {
          "definition": "CREATE INDEX idx_system_state_document_id ON public.system_state USING btree (document_id)",
          "unique": false,
          "primary": false
        },
        "idx_system_state_updated_at": {
          "definition": "CREATE INDEX idx_system_state_updated_at ON public.system_state USING btree (updated_at)",
          "unique": false,
          "primary": false
        },
        "system_state_pkey": {
          "definition": "CREATE UNIQUE INDEX system_state_pkey ON public.system_state USING btree (document_id)",
          "unique": true,
          "primary": true
        }
      },
      "constraints": {
        "2200_41552_1_not_null": {
          "type": "CHECK"
        },
        "2200_41552_2_not_null": {
          "type": "CHECK"
        },
        "system_state_document_id_check": {
          "type": "CHECK"
        },
        "system_state_pkey": {
          "type": "PRIMARY KEY"
        }
      },
      "rowCount": 4
    }
  },
  "views": {
    "folder_dashboard_summary": {
      "type": "view",
      "columns": {
        "id": {
          "type": "character varying",
          "nullable": true,
          "default": null,
          "maxLength": 255,
          "precision": null,
          "scale": null,
          "position": 1
        },
        "name": {
          "type": "character varying",
          "nullable": true,
          "default": null,
          "maxLength": 500,
          "precision": null,
          "scale": null,
          "position": 2
        },
        "parent_id": {
          "type": "character varying",
          "nullable": true,
          "default": null,
          "maxLength": 255,
          "precision": null,
          "scale": null,
          "position": 3
        },
        "level": {
          "type": "integer",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "precision": 32,
          "scale": 0,
          "position": 4
        },
        "image_count": {
          "type": "integer",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "precision": 32,
          "scale": 0,
          "position": 5
        },
        "last_used_at": {
          "type": "timestamp with time zone",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 6
        },
        "last_posted_at": {
          "type": "timestamp with time zone",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 7
        },
        "usage_count": {
          "type": "integer",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "precision": 32,
          "scale": 0,
          "position": 8
        },
        "is_active": {
          "type": "boolean",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 9
        },
        "assigned_pages_count": {
          "type": "bigint",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "precision": 64,
          "scale": 0,
          "position": 10
        },
        "has_captions": {
          "type": "boolean",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 11
        },
        "caption_count": {
          "type": "integer",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "precision": 32,
          "scale": 0,
          "position": 12
        }
      },
      "primaryKeys": [],
      "foreignKeys": {},
      "indexes": {},
      "constraints": {},
      "rowCount": 0
    },
    "page_configs_with_folders": {
      "type": "view",
      "columns": {
        "page_id": {
          "type": "character varying",
          "nullable": true,
          "default": null,
          "maxLength": 100,
          "precision": null,
          "scale": null,
          "position": 1
        },
        "enabled": {
          "type": "boolean",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 2
        },
        "folder_ids": {
          "type": "jsonb",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 3
        },
        "schedule": {
          "type": "jsonb",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 4
        },
        "posts_per_slot": {
          "type": "integer",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "precision": 32,
          "scale": 0,
          "position": 5
        },
        "default_caption": {
          "type": "text",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 6
        },
        "caption_by_folder": {
          "type": "jsonb",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 7
        },
        "created_at": {
          "type": "timestamp without time zone",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 8
        },
        "updated_at": {
          "type": "timestamp without time zone",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 9
        }
      },
      "primaryKeys": [],
      "foreignKeys": {},
      "indexes": {},
      "constraints": {},
      "rowCount": 0
    },
    "swipe_link_usage_stats": {
      "type": "view",
      "columns": {
        "swipe_link_id": {
          "type": "character varying",
          "nullable": true,
          "default": null,
          "maxLength": 255,
          "precision": null,
          "scale": null,
          "position": 1
        },
        "title": {
          "type": "character varying",
          "nullable": true,
          "default": null,
          "maxLength": 255,
          "precision": null,
          "scale": null,
          "position": 2
        },
        "category": {
          "type": "character varying",
          "nullable": true,
          "default": null,
          "maxLength": 100,
          "precision": null,
          "scale": null,
          "position": 3
        },
        "total_usage": {
          "type": "bigint",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "precision": 64,
          "scale": 0,
          "position": 4
        },
        "successful_usage": {
          "type": "bigint",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "precision": 64,
          "scale": 0,
          "position": 5
        },
        "failed_usage": {
          "type": "bigint",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "precision": 64,
          "scale": 0,
          "position": 6
        },
        "last_used_at": {
          "type": "timestamp with time zone",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 7
        },
        "first_used_at": {
          "type": "timestamp with time zone",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "precision": null,
          "scale": null,
          "position": 8
        }
      },
      "primaryKeys": [],
      "foreignKeys": {},
      "indexes": {},
      "constraints": {},
      "rowCount": 0
    }
  },
  "functions": {
    "add_folder_to_page": {
      "type": "FUNCTION",
      "returnType": "boolean",
      "definition": "\r\nBEGIN\r\n    INSERT INTO page_folder_relationships (page_id, folder_id)\r\n    VALUES (p_page_id, p_folder_id)\r\n    ON CONFLICT (page_id, folder_id) DO NOTHING;\r\n    \r\n    RETURN FOUND;\r\nEND;\r\n"
    },
    "armor": {
      "type": "FUNCTION",
      "returnType": "text",
      "definition": "pg_armor"
    },
    "atomic_update_system_state": {
      "type": "FUNCTION",
      "returnType": "USER-DEFINED",
      "definition": "\r\nDECLARE\r\n    result system_state;\r\n    current_version INTEGER;\r\nBEGIN\r\n    -- Check version if provided (optimistic locking)\r\n    IF expected_version IS NOT NULL THEN\r\n        SELECT version INTO current_version\r\n        FROM system_state\r\n        WHERE document_id = doc_id;\r\n        \r\n        IF current_version IS NOT NULL AND current_version != expected_version THEN\r\n            RAISE EXCEPTION 'Optimistic lock failed: expected version %, got %', expected_version, current_version;\r\n        END IF;\r\n    END IF;\r\n    \r\n    -- Perform upsert\r\n    INSERT INTO system_state (document_id, data)\r\n    VALUES (doc_id, doc_data)\r\n    ON CONFLICT (document_id) DO UPDATE SET\r\n        data = EXCLUDED.data,\r\n        updated_at = CURRENT_TIMESTAMP,\r\n        version = system_state.version + 1\r\n    RETURNING * INTO result;\r\n    \r\n    RETURN result;\r\nEND;\r\n"
    },
    "crypt": {
      "type": "FUNCTION",
      "returnType": "text",
      "definition": "pg_crypt"
    },
    "dearmor": {
      "type": "FUNCTION",
      "returnType": "bytea",
      "definition": "pg_dearmor"
    },
    "decrypt": {
      "type": "FUNCTION",
      "returnType": "bytea",
      "definition": "pg_decrypt"
    },
    "decrypt_iv": {
      "type": "FUNCTION",
      "returnType": "bytea",
      "definition": "pg_decrypt_iv"
    },
    "digest": {
      "type": "FUNCTION",
      "returnType": "bytea",
      "definition": "pg_digest"
    },
    "encrypt": {
      "type": "FUNCTION",
      "returnType": "bytea",
      "definition": "pg_encrypt"
    },
    "encrypt_iv": {
      "type": "FUNCTION",
      "returnType": "bytea",
      "definition": "pg_encrypt_iv"
    },
    "gen_random_bytes": {
      "type": "FUNCTION",
      "returnType": "bytea",
      "definition": "pg_random_bytes"
    },
    "gen_random_uuid": {
      "type": "FUNCTION",
      "returnType": "uuid",
      "definition": "pg_random_uuid"
    },
    "gen_salt": {
      "type": "FUNCTION",
      "returnType": "text",
      "definition": "pg_gen_salt_rounds"
    },
    "get_folder_pages": {
      "type": "FUNCTION",
      "returnType": "record",
      "definition": "\r\nBEGIN\r\n    RETURN QUERY\r\n    SELECT \r\n        pfr.page_id,\r\n        pc.enabled\r\n    FROM page_folder_relationships pfr\r\n    JOIN page_configs pc ON pc.page_id = pfr.page_id\r\n    WHERE pfr.folder_id = p_folder_id\r\n    ORDER BY pfr.created_at;\r\nEND;\r\n"
    },
    "get_page_folders": {
      "type": "FUNCTION",
      "returnType": "record",
      "definition": "\r\nBEGIN\r\n    RETURN QUERY\r\n    SELECT \r\n        pfr.folder_id,\r\n        f.name as folder_name\r\n    FROM page_folder_relationships pfr\r\n    JOIN folders f ON f.id = pfr.folder_id\r\n    WHERE pfr.page_id = p_page_id\r\n    ORDER BY pfr.created_at;\r\nEND;\r\n"
    },
    "get_system_state": {
      "type": "FUNCTION",
      "returnType": "jsonb",
      "definition": "\r\nDECLARE\r\n    result JSONB;\r\nBEGIN\r\n    SELECT data INTO result\r\n    FROM system_state\r\n    WHERE document_id = doc_id;\r\n    \r\n    RETURN COALESCE(result, '{}'::jsonb);\r\nEND;\r\n"
    },
    "hmac": {
      "type": "FUNCTION",
      "returnType": "bytea",
      "definition": "pg_hmac"
    },
    "pgp_armor_headers": {
      "type": "FUNCTION",
      "returnType": "record",
      "definition": "pgp_armor_headers"
    },
    "pgp_key_id": {
      "type": "FUNCTION",
      "returnType": "text",
      "definition": "pgp_key_id_w"
    },
    "pgp_pub_decrypt": {
      "type": "FUNCTION",
      "returnType": "text",
      "definition": "pgp_pub_decrypt_text"
    },
    "pgp_pub_decrypt_bytea": {
      "type": "FUNCTION",
      "returnType": "bytea",
      "definition": "pgp_pub_decrypt_bytea"
    },
    "pgp_pub_encrypt": {
      "type": "FUNCTION",
      "returnType": "bytea",
      "definition": "pgp_pub_encrypt_text"
    },
    "pgp_pub_encrypt_bytea": {
      "type": "FUNCTION",
      "returnType": "bytea",
      "definition": "pgp_pub_encrypt_bytea"
    },
    "pgp_sym_decrypt": {
      "type": "FUNCTION",
      "returnType": "text",
      "definition": "pgp_sym_decrypt_text"
    },
    "pgp_sym_decrypt_bytea": {
      "type": "FUNCTION",
      "returnType": "bytea",
      "definition": "pgp_sym_decrypt_bytea"
    },
    "pgp_sym_encrypt": {
      "type": "FUNCTION",
      "returnType": "bytea",
      "definition": "pgp_sym_encrypt_text"
    },
    "pgp_sym_encrypt_bytea": {
      "type": "FUNCTION",
      "returnType": "bytea",
      "definition": "pgp_sym_encrypt_bytea"
    },
    "remove_folder_from_page": {
      "type": "FUNCTION",
      "returnType": "boolean",
      "definition": "\r\nBEGIN\r\n    DELETE FROM page_folder_relationships \r\n    WHERE page_id = p_page_id AND folder_id = p_folder_id;\r\n    \r\n    RETURN FOUND;\r\nEND;\r\n"
    },
    "update_page_folder_relationships_updated_at": {
      "type": "FUNCTION",
      "returnType": "trigger",
      "definition": "\r\nBEGIN\r\n    NEW.updated_at = CURRENT_TIMESTAMP;\r\n    RETURN NEW;\r\nEND;\r\n"
    },
    "update_page_swipe_categories_updated_at": {
      "type": "FUNCTION",
      "returnType": "trigger",
      "definition": "\r\nBEGIN\r\n    NEW.updated_at = CURRENT_TIMESTAMP;\r\n    RETURN NEW;\r\nEND;\r\n"
    },
    "update_posting_queue_updated_at": {
      "type": "FUNCTION",
      "returnType": "trigger",
      "definition": "\r\nBEGIN\r\n    NEW.updated_at = NOW();\r\n    RETURN NEW;\r\nEND;\r\n"
    },
    "update_swipe_link_categories_updated_at": {
      "type": "FUNCTION",
      "returnType": "trigger",
      "definition": "\r\nBEGIN\r\n    NEW.updated_at = CURRENT_TIMESTAMP;\r\n    RETURN NEW;\r\nEND;\r\n"
    },
    "update_system_state_updated_at": {
      "type": "FUNCTION",
      "returnType": "trigger",
      "definition": "\r\nBEGIN\r\n    NEW.updated_at = CURRENT_TIMESTAMP;\r\n    NEW.version = OLD.version + 1;\r\n    RETURN NEW;\r\nEND;\r\n"
    },
    "update_updated_at_column": {
      "type": "FUNCTION",
      "returnType": "trigger",
      "definition": "\r\nBEGIN\r\n    NEW.updated_at = CURRENT_TIMESTAMP;\r\n    RETURN NEW;\r\nEND;\r\n"
    },
    "upsert_system_state": {
      "type": "FUNCTION",
      "returnType": "USER-DEFINED",
      "definition": "\r\nDECLARE\r\n    result system_state;\r\nBEGIN\r\n    INSERT INTO system_state (document_id, data)\r\n    VALUES (doc_id, doc_data)\r\n    ON CONFLICT (document_id) DO UPDATE SET\r\n        data = EXCLUDED.data,\r\n        updated_at = CURRENT_TIMESTAMP,\r\n        version = system_state.version + 1\r\n    RETURNING * INTO result;\r\n    \r\n    RETURN result;\r\nEND;\r\n"
    }
  },
  "indexes": {},
  "constraints": {},
  "relationships": [
    {
      "from": {
        "table": "assignments",
        "column": "agent_id"
      },
      "to": {
        "table": "agents",
        "column": "agent_id"
      },
      "constraint": "fk_assignments_agent",
      "onDelete": "CASCADE",
      "onUpdate": "NO ACTION"
    },
    {
      "from": {
        "table": "folder_captions",
        "column": "folder_id"
      },
      "to": {
        "table": "folders",
        "column": "id"
      },
      "constraint": "fk_folder_captions_folder",
      "onDelete": "CASCADE",
      "onUpdate": "NO ACTION"
    },
    {
      "from": {
        "table": "folders",
        "column": "parent_id"
      },
      "to": {
        "table": "folders",
        "column": "id"
      },
      "constraint": "fk_folders_parent",
      "onDelete": "SET NULL",
      "onUpdate": "NO ACTION"
    },
    {
      "from": {
        "table": "page_folder_relationships",
        "column": "page_id"
      },
      "to": {
        "table": "page_configs",
        "column": "page_id"
      },
      "constraint": "fk_page_folder_page_id",
      "onDelete": "CASCADE",
      "onUpdate": "NO ACTION"
    },
    {
      "from": {
        "table": "page_folder_relationships",
        "column": "folder_id"
      },
      "to": {
        "table": "folders",
        "column": "id"
      },
      "constraint": "fk_page_folder_folder_id",
      "onDelete": "CASCADE",
      "onUpdate": "NO ACTION"
    },
    {
      "from": {
        "table": "page_stats_daily",
        "column": "page_id"
      },
      "to": {
        "table": "pages",
        "column": "page_id"
      },
      "constraint": "page_stats_daily_page_id_fkey",
      "onDelete": "CASCADE",
      "onUpdate": "NO ACTION"
    },
    {
      "from": {
        "table": "page_swipe_categories",
        "column": "page_id"
      },
      "to": {
        "table": "pages",
        "column": "page_id"
      },
      "constraint": "fk_page_swipe_categories_page_id",
      "onDelete": "CASCADE",
      "onUpdate": "NO ACTION"
    },
    {
      "from": {
        "table": "page_swipe_categories",
        "column": "category"
      },
      "to": {
        "table": "swipe_link_categories",
        "column": "name"
      },
      "constraint": "fk_page_swipe_categories_category",
      "onDelete": "CASCADE",
      "onUpdate": "NO ACTION"
    },
    {
      "from": {
        "table": "post_reactions_daily",
        "column": "post_id"
      },
      "to": {
        "table": "posts",
        "column": "post_id"
      },
      "constraint": "post_reactions_daily_post_id_fkey",
      "onDelete": "CASCADE",
      "onUpdate": "NO ACTION"
    },
    {
      "from": {
        "table": "posts",
        "column": "page_id"
      },
      "to": {
        "table": "pages",
        "column": "page_id"
      },
      "constraint": "posts_page_id_fkey",
      "onDelete": "CASCADE",
      "onUpdate": "NO ACTION"
    },
    {
      "from": {
        "table": "swipe_link_usages",
        "column": "swipe_link_id"
      },
      "to": {
        "table": "swipe_links",
        "column": "id"
      },
      "constraint": "fk_swipe_link_usages_swipe_link_id",
      "onDelete": "CASCADE",
      "onUpdate": "NO ACTION"
    },
    {
      "from": {
        "table": "swipe_link_usages",
        "column": "page_id"
      },
      "to": {
        "table": "pages",
        "column": "page_id"
      },
      "constraint": "fk_swipe_link_usages_page_id",
      "onDelete": "CASCADE",
      "onUpdate": "NO ACTION"
    },
    {
      "from": {
        "table": "sync_tracking",
        "column": "page_id"
      },
      "to": {
        "table": "pages",
        "column": "page_id"
      },
      "constraint": "sync_tracking_page_id_fkey",
      "onDelete": "CASCADE",
      "onUpdate": "NO ACTION"
    }
  ]
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get table information
 * @param {string} tableName - Name of the table
 * @returns {object} Table schema information
 */
function getTableInfo(tableName) {
  return schema.tables[tableName] || schema.views[tableName] || null;
}

/**
 * Get all foreign key relationships for a table
 * @param {string} tableName - Name of the table
 * @returns {array} Array of foreign key relationships
 */
function getTableForeignKeys(tableName) {
  return schema.relationships.filter(rel => rel.from.table === tableName);
}

/**
 * Get all tables that reference a specific table
 * @param {string} tableName - Name of the table
 * @returns {array} Array of tables that reference this table
 */
function getReferencingTables(tableName) {
  return schema.relationships.filter(rel => rel.to.table === tableName);
}

/**
 * Get column information for a table
 * @param {string} tableName - Name of the table
 * @param {string} columnName - Name of the column
 * @returns {object} Column information
 */
function getColumnInfo(tableName, columnName) {
  const tableInfo = getTableInfo(tableName);
  return tableInfo ? tableInfo.columns[columnName] : null;
}

/**
 * Check if a column is a foreign key
 * @param {string} tableName - Name of the table
 * @param {string} columnName - Name of the column
 * @returns {object|null} Foreign key information or null
 */
function isForeignKey(tableName, columnName) {
  const tableInfo = getTableInfo(tableName);
  return tableInfo ? tableInfo.foreignKeys[columnName] : null;
}

/**
 * Get all tables with their row counts
 * @returns {object} Object with table names and row counts
 */
function getTableStats() {
  const stats = {};
  Object.keys(schema.tables).forEach(tableName => {
    stats[tableName] = schema.tables[tableName].rowCount;
  });
  return stats;
}

// =============================================================================
// EXPORTS
// =============================================================================
module.exports = {
  pool,
  schema,
  getTableInfo,
  getTableForeignKeys,
  getReferencingTables,
  getColumnInfo,
  isForeignKey,
  getTableStats
};

// =============================================================================
// SCHEMA SUMMARY
// =============================================================================
console.log('📊 Database Schema Summary:');
console.log(`   Tables: ${Object.keys(schema.tables).length}`);
console.log(`   Views: ${Object.keys(schema.views).length}`);
console.log(`   Functions: ${Object.keys(schema.functions).length}`);
console.log(`   Relationships: ${schema.relationships.length}`);
console.log('\n📋 Tables:');
Object.keys(schema.tables).forEach(tableName => {
  const table = schema.tables[tableName];
  console.log(`   - ${tableName} (${table.rowCount} rows, ${Object.keys(table.columns).length} columns)`);
});
console.log('\n🔗 Key Relationships:');
schema.relationships.forEach(rel => {
  console.log(`   - ${rel.from.table}.${rel.from.column} -> ${rel.to.table}.${rel.to.column} (ON DELETE: ${rel.onDelete})`);
});
